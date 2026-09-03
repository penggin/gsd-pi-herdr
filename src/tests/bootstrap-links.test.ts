import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const bootstrapPath = join(process.cwd(), "dist", "bootstrap.js");
const bootstrap = await import(pathToFileURL(bootstrapPath).href);

function makeSafeCopy(): (from: string, to: string, options: { recursive: true }) => void {
  return (from, to) => {
    const copyDir = (src: string, dest: string): void => {
      mkdirSync(dest, { recursive: true });
      for (const entry of readdirSync(src)) {
        const source = join(src, entry);
        const destination = join(dest, entry);
        if (existsSync(source) && lstatSync(source).isDirectory()) copyDir(source, destination);
        else writeFileSync(destination, readFileSync(source));
      }
    };
    rmSync(to, { force: true });
    copyDir(from, to);
  };
}

function makeInstallTree(t: import("node:test").TestContext): {
  root: string;
  gsdScopeDir: string;
  openGsdScopeDir: string;
} {
  const root = mkdtempSync(join(tmpdir(), "gsd-bootstrap-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "dist"), { recursive: true });
  const packagesDir = join(root, "packages");
  for (const [dir, scope, name] of [
    ["pi-coding-agent", "@gsd", "pi-coding-agent"],
    ["pi-tui", "@gsd", "pi-tui"],
    ["contracts", "@opengsd", "contracts"],
  ] as const) {
    mkdirSync(join(packagesDir, dir), { recursive: true });
    writeFileSync(join(packagesDir, dir, "package.json"), JSON.stringify({
      name: `${scope}/${name}`,
      version: "1.17.0",
      main: "./dist/index.js",
      gsd: { linkable: true, scope, name },
    }));
    mkdirSync(join(packagesDir, dir, "dist"), { recursive: true });
    writeFileSync(join(packagesDir, dir, "dist", "index.js"), "export {};\n");
  }
  return {
    root,
    gsdScopeDir: join(root, "node_modules", "@gsd"),
    openGsdScopeDir: join(root, "node_modules", "@opengsd"),
  };
}

test("ensureWorkspaceLinks repairs every canonical scope via directory copy when symlinks are unavailable", (t) => {
  const { root, gsdScopeDir, openGsdScopeDir } = makeInstallTree(t);
  const { repaired, failed } = bootstrap.ensureWorkspaceLinks(root, {
    symlinkImpl: () => { throw new Error("EPERM: operation not permitted, symlink"); },
    cpSyncImpl: makeSafeCopy(),
  });
  assert.deepEqual(failed, []);
  assert.deepEqual([...repaired].sort(), ["@gsd/pi-coding-agent", "@gsd/pi-tui", "@opengsd/contracts"]);
  assert.ok(existsSync(join(gsdScopeDir, "pi-coding-agent", "dist", "index.js")));
  assert.ok(existsSync(join(gsdScopeDir, "pi-tui", "package.json")));
  assert.ok(existsSync(join(openGsdScopeDir, "contracts", "dist", "index.js")));
});

test("ensureWorkspaceLinks leaves healthy links and real directories untouched", (t) => {
  const { root, gsdScopeDir, openGsdScopeDir } = makeInstallTree(t);
  mkdirSync(join(gsdScopeDir, "pi-coding-agent", "dist"), { recursive: true });
  writeFileSync(join(gsdScopeDir, "pi-coding-agent", "dist", "index.js"), "export {};\n");
  mkdirSync(join(gsdScopeDir, "pi-tui"), { recursive: true });
  mkdirSync(join(openGsdScopeDir, "contracts"), { recursive: true });
  let symlinkCalls = 0;
  const { repaired } = bootstrap.ensureWorkspaceLinks(root, {
    symlinkImpl: () => { symlinkCalls++; throw new Error("should not be reached"); },
  });
  assert.deepEqual(repaired, []);
  assert.equal(symlinkCalls, 0);
});

test("ensureWorkspaceLinks reports packages it could not repair", (t) => {
  const { root } = makeInstallTree(t);
  const { repaired, failed } = bootstrap.ensureWorkspaceLinks(root, {
    symlinkImpl: () => { throw new Error("EPERM: operation not permitted, symlink"); },
    cpSyncImpl: () => { throw new Error("EACCES: permission denied, copy file"); },
  });
  assert.deepEqual(repaired, []);
  assert.equal(failed.length, 3);
  assert.match(failed.join("\n"), /pi-coding-agent/);
  assert.match(failed.join("\n"), /@opengsd\/contracts/);
  assert.match(failed.join("\n"), /EACCES/);
});
