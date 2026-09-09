import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs, { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path, { join } from "node:path";
import { tmpdir } from "node:os";
import { syncBuiltinESMExports } from "node:module";
import {
  computeResourceFingerprint,
  getCurrentResourceFingerprint,
  initResources,
  resolveResourceFingerprintMode,
  setBundledResourcesDirForTests,
  setGsdBrowserPackageSkillPathForTests,
} from "../resource-loader.ts";

function fixture(t: TestContext) {
  const base = mkdtempSync(join(tmpdir(), "gsd-resource-policy-"));
  const ownRoot = join(base, "package");
  const bundle = join(ownRoot, "dist", "resources");
  mkdirSync(join(bundle, "extensions", "fixture"), { recursive: true });
  mkdirSync(join(bundle, "agents"), { recursive: true });
  mkdirSync(join(bundle, "shared"), { recursive: true });
  writeFileSync(join(bundle, "extensions", "fixture", "index.js"), "export const fixture = true;\n");
  writeFileSync(join(bundle, "agents", "worker.md"), "fixture worker\n");
  writeFileSync(join(bundle, "shared", "prompt.md"), "alpha\n");
  const previousMode = process.env.GSD_RESOURCE_FINGERPRINT_MODE;
  t.after(() => {
    if (previousMode === undefined) delete process.env.GSD_RESOURCE_FINGERPRINT_MODE;
    else process.env.GSD_RESOURCE_FINGERPRINT_MODE = previousMode;
    setBundledResourcesDirForTests(undefined);
    setGsdBrowserPackageSkillPathForTests(undefined);
    rmSync(base, { recursive: true, force: true });
  });
  return { base, ownRoot, bundle };
}

test("resource mode ignores an ancestor repository but recognizes this package's own checkout", (t) => {
  const { base, ownRoot, bundle } = fixture(t);
  mkdirSync(join(base, ".git"));
  assert.equal(resolveResourceFingerprintMode(ownRoot, bundle, "auto"), "bundled");
  writeFileSync(join(ownRoot, ".git"), "gitdir: /fixture/worktrees/package\n");
  assert.equal(resolveResourceFingerprintMode(ownRoot, bundle, "auto"), "live");
  assert.equal(resolveResourceFingerprintMode(ownRoot, bundle, " BUNDLED "), "bundled");
  assert.equal(resolveResourceFingerprintMode(ownRoot, bundle, " LIVE "), "live");
});

test("resource mode follows npm-link identity and distinguishes source bundles from release dist", (t) => {
  const { base, ownRoot, bundle } = fixture(t);
  const source = join(ownRoot, "src", "resources");
  mkdirSync(source, { recursive: true });
  assert.equal(resolveResourceFingerprintMode(ownRoot, source, "auto"), "live");
  assert.equal(resolveResourceFingerprintMode(ownRoot, bundle, "auto"), "bundled");
  const linked = join(base, "linked-package");
  symlinkSync(ownRoot, linked, "dir");
  mkdirSync(join(ownRoot, ".git"));
  assert.equal(resolveResourceFingerprintMode(linked, join(linked, "dist", "resources"), "auto"), "live");
});

test("release fingerprint fast path reads only the valid shipped hash rather than resource contents", (t) => {
  const { bundle } = fixture(t);
  const marker = join(bundle, ".managed-resources-content-hash");
  writeFileSync(marker, "0123456789abcdef\n");
  const reads: string[] = [];
  const originalRead = fs.readFileSync;
  t.mock.method(fs, "readFileSync", (...args: any[]) => {
    reads.push(String(args[0]));
    return (originalRead as any)(...args);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  assert.equal(getCurrentResourceFingerprint(bundle, "bundled"), "0123456789abcdef");
  assert.deepEqual(reads, [marker]);
});

test("release startup skips unchanged stamped resources and honors an explicit live override", (t) => {
  const { base, ownRoot, bundle } = fixture(t);
  const shipped = computeResourceFingerprint(bundle);
  writeFileSync(join(bundle, ".managed-resources-content-hash"), shipped);
  setBundledResourcesDirForTests(bundle, ownRoot);
  setGsdBrowserPackageSkillPathForTests(null);
  process.env.GSD_RESOURCE_FINGERPRINT_MODE = "auto";
  const agent = join(base, "agent");
  const skills = join(base, "skills");
  initResources(agent, skills);
  const manifest = readFileSync(join(agent, "managed-resources.json"), "utf8");
  writeFileSync(join(bundle, "shared", "prompt.md"), "bravo\n");
  initResources(agent, skills);
  assert.equal(readFileSync(join(agent, "shared", "prompt.md"), "utf8"), "alpha\n");
  assert.equal(readFileSync(join(agent, "managed-resources.json"), "utf8"), manifest);
  process.env.GSD_RESOURCE_FINGERPRINT_MODE = "live";
  initResources(agent, skills);
  assert.equal(readFileSync(join(agent, "shared", "prompt.md"), "utf8"), "bravo\n");
  assert.equal(JSON.parse(readFileSync(join(agent, "managed-resources.json"), "utf8")).contentHash, computeResourceFingerprint(bundle));
  const converged = readFileSync(join(agent, "managed-resources.json"), "utf8");
  initResources(agent, skills);
  assert.equal(readFileSync(join(agent, "managed-resources.json"), "utf8"), converged);
});

test("missing or malformed shipped hashes fall back to content fingerprints", (t) => {
  const { bundle } = fixture(t);
  const actual = computeResourceFingerprint(bundle);
  assert.equal(getCurrentResourceFingerprint(bundle, "bundled"), actual);
  writeFileSync(join(bundle, ".managed-resources-content-hash"), "not-a-content-hash");
  assert.equal(getCurrentResourceFingerprint(bundle, "bundled"), actual);
  writeFileSync(join(bundle, "shared", "prompt.md"), "bravo\n");
  assert.notEqual(getCurrentResourceFingerprint(bundle, "bundled"), actual);
});

test("invalid fingerprint configuration refuses before creating or pruning managed resources", (t) => {
  const { base, ownRoot, bundle } = fixture(t);
  setBundledResourcesDirForTests(bundle, ownRoot);
  process.env.GSD_RESOURCE_FINGERPRINT_MODE = "unsupported-fixture-value";
  const missingAgent = join(base, "missing-agent");
  assert.throws(() => initResources(missingAgent, join(base, "skills")), /must be auto, live, or bundled/);
  assert.equal(existsSync(missingAgent), false);
  const existingAgent = join(base, "existing-agent");
  mkdirSync(join(existingAgent, "extensions"), { recursive: true });
  const stale = join(existingAgent, "extensions", "env-utils.js");
  writeFileSync(stale, "preserve until valid startup\n");
  assert.throws(() => initResources(existingAgent, join(base, "skills")), /must be auto, live, or bundled/);
  assert.equal(readFileSync(stale, "utf8"), "preserve until valid startup\n");
});

test("live fingerprints normalize platform path separators to the build representation", (t) => {
  const { bundle } = fixture(t);
  const expected = computeResourceFingerprint(bundle);
  const originalRelative = path.relative;
  t.mock.method(path, "relative", (from: string, to: string) => originalRelative(from, to).replaceAll("/", "\\"));
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  assert.equal(computeResourceFingerprint(bundle), expected);
});
