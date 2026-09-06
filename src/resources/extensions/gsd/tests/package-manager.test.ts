/**
 * Tests for package-manager.ts — shared package manager detection utilities.
 */

import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  detectPackageManager,
  buildScriptCommand,
  normalizeWindowsPackageManagerCommand,
} from "../package-manager.js";

describe("package-manager: detectPackageManager", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "gsd-pm-test-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("pnpm-lock.yaml → pnpm", () => {
    writeFileSync(join(tmp, "package.json"), "{}");
    writeFileSync(join(tmp, "pnpm-lock.yaml"), "lockfileVersion: 9.0");
    assert.equal(detectPackageManager(tmp), "pnpm");
  });

  test("yarn.lock → yarn", () => {
    writeFileSync(join(tmp, "package.json"), "{}");
    writeFileSync(join(tmp, "yarn.lock"), "# yarn lockfile v1");
    assert.equal(detectPackageManager(tmp), "yarn");
  });

  test("bun.lockb → bun", () => {
    writeFileSync(join(tmp, "package.json"), "{}");
    writeFileSync(join(tmp, "bun.lockb"), "binary");
    assert.equal(detectPackageManager(tmp), "bun");
  });

  test("bun.lock (text format) → bun", () => {
    writeFileSync(join(tmp, "package.json"), "{}");
    writeFileSync(join(tmp, "bun.lock"), "bun lockfile");
    assert.equal(detectPackageManager(tmp), "bun");
  });

  test("package-lock.json → npm", () => {
    writeFileSync(join(tmp, "package.json"), "{}");
    writeFileSync(join(tmp, "package-lock.json"), "{}");
    assert.equal(detectPackageManager(tmp), "npm");
  });

  test("packageManager field pnpm@x.y.z → pnpm (no lock file)", () => {
    writeFileSync(
      join(tmp, "package.json"),
      JSON.stringify({ packageManager: "pnpm@9.12.2" }),
    );
    assert.equal(detectPackageManager(tmp), "pnpm");
  });

  test("packageManager field yarn@x.y.z → yarn (no lock file)", () => {
    writeFileSync(
      join(tmp, "package.json"),
      JSON.stringify({ packageManager: "yarn@4.0.0" }),
    );
    assert.equal(detectPackageManager(tmp), "yarn");
  });

  test("lock file takes precedence over packageManager field", () => {
    writeFileSync(
      join(tmp, "package.json"),
      JSON.stringify({ packageManager: "npm@10.0.0" }),
    );
    writeFileSync(join(tmp, "pnpm-lock.yaml"), "lockfileVersion: 9.0");
    assert.equal(detectPackageManager(tmp), "pnpm");
  });

  test("package.json only → npm fallback", () => {
    writeFileSync(join(tmp, "package.json"), "{}");
    assert.equal(detectPackageManager(tmp), "npm");
  });

  test("no package.json → undefined", () => {
    assert.equal(detectPackageManager(tmp), undefined);
  });

  test("malformed package.json → npm fallback", () => {
    writeFileSync(join(tmp, "package.json"), "not json");
    assert.equal(detectPackageManager(tmp), "npm");
  });
});

describe("package-manager: workspace inheritance", () => {
  let tmp: string;

  function packageAt(path: string, manifest: Record<string, unknown> = {}): string {
    const directory = join(tmp, path);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "package.json"), JSON.stringify(manifest));
    return directory;
  }

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "gsd-pm-workspace-"));
    mkdirSync(join(tmp, ".git"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("pnpm YAML members inherit the root manager without child locks or Corepack", () => {
    packageAt(".", { packageManager: "pnpm@10.0.0" });
    writeFileSync(join(tmp, "pnpm-workspace.yaml"), "packages:\n  - 'apps/*'\n");
    for (const child of ["apps/api", "apps/penglava"]) {
      assert.equal(detectPackageManager(packageAt(child)), "pnpm");
    }
    assert.equal(detectPackageManager(tmp), "pnpm");
  });

  for (const workspaces of [["apps/*"], { packages: ["apps/*"] }]) {
    test(`package.json workspaces ${Array.isArray(workspaces) ? "array" : "object"} inherits a root lock`, () => {
      packageAt(".", { workspaces, packageManager: "npm@10.0.0" });
      writeFileSync(join(tmp, "pnpm-lock.yaml"), "lockfileVersion: 9.0");
      assert.equal(detectPackageManager(packageAt("apps/api")), "pnpm");
      assert.equal(detectPackageManager(tmp), "pnpm");
    });
  }

  test("workspace inheritance uses the declared manager, including Yarn and Bun", () => {
    const child = packageAt("apps/api");
    for (const manager of ["npm", "yarn", "bun"]) {
      packageAt(".", { workspaces: ["apps/*"], packageManager: `${manager}@1.0.0` });
      assert.equal(detectPackageManager(child), manager);
    }
  });

  for (const source of ["json", "yaml"]) {
    test(`${source} workspace exclusions win regardless of pattern order`, () => {
      packageAt(".", {
        packageManager: "pnpm@10.0.0",
        ...(source === "json" ? { workspaces: ["!apps/private/**", "apps/**"] } : {}),
      });
      if (source === "yaml") {
        writeFileSync(join(tmp, "pnpm-workspace.yaml"), "packages:\n  - '!apps/private/**'\n  - 'apps/**'\n");
      }
      assert.equal(detectPackageManager(packageAt("apps/public/api")), "pnpm");
      assert.equal(detectPackageManager(packageAt("apps/private/api")), "npm");
      assert.equal(detectPackageManager(packageAt("tools/unrelated")), "npm");
    });
  }

  test("pnpm workspace exclusions cannot be bypassed by package.json workspaces", () => {
    packageAt(".", { workspaces: ["apps/*"], packageManager: "pnpm@10.0.0" });
    writeFileSync(join(tmp, "pnpm-workspace.yaml"), "packages: ['apps/*', '!apps/private']\n");
    assert.equal(detectPackageManager(packageAt("apps/public")), "pnpm");
    assert.equal(detectPackageManager(packageAt("apps/private")), "npm");
  });

  test("workspace glob matching supports nested paths, braces and normalized relative patterns", () => {
    packageAt(".", { workspaces: ["./apps/{api,penglava}/", "packages/**"], packageManager: "pnpm@10.0.0" });
    for (const child of ["apps/api", "apps/penglava", "packages/nested/sdk"]) {
      assert.equal(detectPackageManager(packageAt(child)), "pnpm");
    }
    assert.equal(detectPackageManager(packageAt("apps/other")), "npm");
  });

  test("unrelated parent locks and Corepack declarations do not imply workspace membership", () => {
    packageAt(".", { packageManager: "pnpm@10.0.0" });
    writeFileSync(join(tmp, "pnpm-lock.yaml"), "lockfileVersion: 9.0");
    const child = packageAt("standalone");
    assert.equal(detectPackageManager(child), "npm");
    packageAt(".", { workspaces: ["apps/*"], packageManager: "pnpm@10.0.0" });
    assert.equal(detectPackageManager(child), "npm");
  });

  test("a workspace directory without its own package.json remains undetected", () => {
    packageAt(".", { workspaces: ["apps/*"], packageManager: "pnpm@10.0.0" });
    const child = join(tmp, "apps/api");
    mkdirSync(child, { recursive: true });
    assert.equal(detectPackageManager(child), undefined);
  });

  test("local Corepack and every supported local lock override the workspace manager", () => {
    packageAt(".", { workspaces: ["apps/*"], packageManager: "pnpm@10.0.0" });
    assert.equal(detectPackageManager(packageAt("apps/corepack", { packageManager: "yarn@4.0.0" })), "yarn");
    for (const [lock, manager] of [
      ["pnpm-lock.yaml", "pnpm"], ["yarn.lock", "yarn"], ["bun.lock", "bun"],
      ["bun.lockb", "bun"], ["package-lock.json", "npm"],
    ]) {
      const child = packageAt(`apps/${lock}`, { packageManager: "yarn@4.0.0" });
      writeFileSync(join(child, lock), "lock");
      assert.equal(detectPackageManager(child), manager);
    }
  });

  for (const kind of ["directory", "file"]) {
    test(`a nested Git ${kind} prevents inheritance across its boundary`, () => {
      packageAt(".", { workspaces: ["apps/**"], packageManager: "pnpm@10.0.0" });
      const nested = packageAt("apps/independent");
      if (kind === "directory") mkdirSync(join(nested, ".git"));
      else writeFileSync(join(nested, ".git"), "gitdir: /unused/worktree-metadata\n");
      assert.equal(detectPackageManager(nested), "npm");
      assert.equal(detectPackageManager(packageAt("apps/independent/packages/api")), "npm");
      packageAt("apps/independent", { workspaces: ["packages/*"], packageManager: "yarn@4.0.0" });
      assert.equal(detectPackageManager(join(nested, "packages/api")), "yarn");
    });
  }

  test("a workspace at a Git worktree boundary can supply its own child manager", () => {
    const root = packageAt("worktree", { workspaces: ["apps/*"], packageManager: "pnpm@10.0.0" });
    writeFileSync(join(root, ".git"), "gitdir: /unused/worktree-metadata\n");
    assert.equal(detectPackageManager(packageAt("worktree/apps/api")), "pnpm");
  });

  for (const source of ["json", "yaml"]) {
    test(`nearest ${source} workspace members use its manager and cannot escape exclusions`, () => {
      packageAt(".", { workspaces: ["nested", "nested/**"], packageManager: "yarn@4.0.0" });
      const nested = packageAt("nested", {
        packageManager: "pnpm@10.0.0",
        ...(source === "json" ? { workspaces: ["apps/*", "!apps/excluded"] } : {}),
      });
      if (source === "yaml") {
        writeFileSync(join(nested, "pnpm-workspace.yaml"), "packages: ['apps/*', '!apps/excluded']\n");
      }
      assert.equal(detectPackageManager(packageAt("nested/apps/api")), "pnpm");
      assert.equal(detectPackageManager(packageAt("nested/apps/excluded")), "npm");
      assert.equal(detectPackageManager(packageAt("nested/tools/nonmember")), "npm");
    });

    test(`a nested ${source} workspace root without local markers retains npm`, () => {
      packageAt(".", { workspaces: ["nested", "nested/**"], packageManager: "yarn@4.0.0" });
      const nested = packageAt("nested", source === "json" ? { workspaces: ["apps/*"] } : {});
      if (source === "yaml") {
        writeFileSync(join(nested, "pnpm-workspace.yaml"), "packages: ['apps/*']\n");
      }
      assert.equal(detectPackageManager(nested), "npm");
      assert.equal(detectPackageManager(packageAt("nested/apps/api")), "npm");
      writeFileSync(join(nested, "bun.lock"), "bun lockfile");
      assert.equal(detectPackageManager(nested), "bun");
    });
  }

  test("pnpm YAML membership alone preserves the root and child npm fallback", () => {
    packageAt(".");
    writeFileSync(join(tmp, "pnpm-workspace.yaml"), "packages: ['apps/*']\n");
    assert.equal(detectPackageManager(tmp), "npm");
    assert.equal(detectPackageManager(packageAt("apps/api")), "npm");
  });

  test("workspace membership follows physical directories, not an escaping symlink", () => {
    const root = packageAt("workspace", { workspaces: ["apps/*"], packageManager: "pnpm@10.0.0" });
    mkdirSync(join(root, ".git"));
    mkdirSync(join(root, "apps"));
    const external = packageAt("external");
    symlinkSync(external, join(root, "apps/api"), process.platform === "win32" ? "junction" : "dir");
    assert.equal(detectPackageManager(join(root, "apps/api")), "npm");
  });

  test("a symlink alias still detects the physical workspace and its exclusions", () => {
    const root = packageAt("workspace", { workspaces: ["apps/*", "!apps/private"], packageManager: "pnpm@10.0.0" });
    mkdirSync(join(root, ".git"));
    packageAt("workspace/apps/api");
    packageAt("workspace/apps/private");
    symlinkSync(root, join(tmp, "alias"), process.platform === "win32" ? "junction" : "dir");
    assert.equal(detectPackageManager(join(tmp, "alias/apps/api")), "pnpm");
    symlinkSync(join(root, "apps/private"), join(root, "apps/public"), process.platform === "win32" ? "junction" : "dir");
    assert.equal(detectPackageManager(join(root, "apps/public")), "npm");
  });

  test("malformed local or ancestor manifests conservatively retain npm", () => {
    packageAt(".", { workspaces: ["apps/*"], packageManager: "pnpm@10.0.0" });
    const child = packageAt("apps/api");
    for (const malformed of ["not json", "null", "[]"]) {
      writeFileSync(join(child, "package.json"), malformed);
      assert.equal(detectPackageManager(child), "npm");
    }
    packageAt("apps/api");
    writeFileSync(join(tmp, "package.json"), "not json");
    writeFileSync(join(tmp, "pnpm-lock.yaml"), "lockfileVersion: 9.0");
    writeFileSync(join(tmp, "pnpm-workspace.yaml"), "packages: ['apps/*']\n");
    assert.equal(detectPackageManager(child), "npm");
  });

  for (const workspaces of [null, "apps/*", { packages: "apps/*" }, ["apps/*", 42], ["apps/*", ""], ["!apps/private"], ["apps/*", "../outside/*"]]) {
    test(`invalid or exclusion-only workspace patterns retain npm: ${JSON.stringify(workspaces)}`, () => {
      packageAt(".", { workspaces, packageManager: "pnpm@10.0.0" });
      assert.equal(detectPackageManager(packageAt("apps/api")), "npm");
    });
  }

  test("invalid or unspecified YAML membership never broadens to all children", () => {
    packageAt(".", { packageManager: "pnpm@10.0.0" });
    const child = packageAt("apps/api");
    for (const yaml of ["packages: [", "packages: 'apps/*'", "packages: ['apps/*', null]", "packages: null", "packages: []", "catalog: {}", "null", "[]"]) {
      writeFileSync(join(tmp, "pnpm-workspace.yaml"), yaml);
      assert.equal(detectPackageManager(child), "npm", yaml);
    }
  });
});

describe("package-manager: buildScriptCommand", () => {
  test("npm test → npm test (special shorthand)", () => {
    assert.equal(buildScriptCommand("npm", "test"), "npm test");
  });

  test("npm lint → npm run lint", () => {
    assert.equal(buildScriptCommand("npm", "lint"), "npm run lint");
  });

  test("npm typecheck → npm run typecheck", () => {
    assert.equal(buildScriptCommand("npm", "typecheck"), "npm run typecheck");
  });

  test("pnpm test → pnpm test (implicit run)", () => {
    assert.equal(buildScriptCommand("pnpm", "test"), "pnpm test");
  });

  test("pnpm lint → pnpm lint (implicit run)", () => {
    assert.equal(buildScriptCommand("pnpm", "lint"), "pnpm lint");
  });

  test("yarn test → yarn test (implicit run)", () => {
    assert.equal(buildScriptCommand("yarn", "test"), "yarn test");
  });

  test("yarn typecheck → yarn typecheck (implicit run)", () => {
    assert.equal(buildScriptCommand("yarn", "typecheck"), "yarn typecheck");
  });

  test("bun test → bun run test (explicit run)", () => {
    assert.equal(buildScriptCommand("bun", "test"), "bun run test");
  });

  test("bun build → bun run build (explicit run)", () => {
    assert.equal(buildScriptCommand("bun", "build"), "bun run build");
  });
});

describe("package-manager: normalizeWindowsPackageManagerCommand", () => {
  test("makes a forward-slash relative pnpm.cmd path native and explicitly relative", () => {
    assert.equal(
      normalizeWindowsPackageManagerCommand("app/pnpm.cmd --dir app test", "win32"),
      ".\\app\\pnpm.cmd --dir app test",
    );
  });

  test("preserves non-Windows commands", () => {
    assert.equal(
      normalizeWindowsPackageManagerCommand("app/pnpm.cmd --dir app test", "linux"),
      "app/pnpm.cmd --dir app test",
    );
  });

  test("preserves bare and already-native Windows package-manager commands", () => {
    assert.equal(normalizeWindowsPackageManagerCommand("pnpm test", "win32"), "pnpm test");
    assert.equal(
      normalizeWindowsPackageManagerCommand(".\\app\\pnpm.cmd --dir app test", "win32"),
      ".\\app\\pnpm.cmd --dir app test",
    );
  });
});
