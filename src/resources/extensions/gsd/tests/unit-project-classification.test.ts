import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyProject } from "../detection.ts";
import {
  createUnitProjectClassifier,
  resolveEmptyWorktreeWithProjectContent,
} from "../auto/worktree-safety-phase.ts";
import { createWorktreeSafetyModule } from "../worktree-safety.ts";

function fixture(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(join(tmpdir(), "gsd-unit-classification-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  function repo(name: string, marker = "package.json") {
    const directory = join(root, name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, ".git"), "gitdir: /fixture-only/unavailable\n");
    writeFileSync(join(directory, marker), "{}");
    return directory;
  }
  return { root, repo };
}

test("one unit reuses the safety classification for immediate task guidance", (t) => {
  const { root, repo } = fixture(t);
  const worktree = repo("worktree");
  let calls = 0;
  const classify = createUnitProjectClassifier((path) => { calls++; return classifyProject(path); });
  assert.equal(calls, 0, "classification remains lazy");
  assert.equal(resolveEmptyWorktreeWithProjectContent(worktree, root, classify), false);
  assert.equal(classify(worktree).kind, "typed-existing");
  assert.equal(calls, 1, "the same source root is scanned once for both consumers");
});

test("every new unit sees source changes without cross-unit caching", (t) => {
  const { repo } = fixture(t);
  const worktree = repo("worktree");
  let calls = 0;
  const source = (path: string) => { calls++; return classifyProject(path); };
  assert.ok(createUnitProjectClassifier(source)(worktree).signals.detectedFiles.includes("package.json"));
  unlinkSync(join(worktree, "package.json"));
  writeFileSync(join(worktree, "Cargo.toml"), "[package]\nname='changed'\n");
  const refreshed = createUnitProjectClassifier(source)(worktree);
  assert.ok(!refreshed.signals.detectedFiles.includes("package.json"));
  assert.ok(refreshed.signals.detectedFiles.includes("Cargo.toml"));
  assert.equal(calls, 2);
});

test("explicit refresh observes nested source changes within a unit", (t) => {
  const { repo } = fixture(t);
  const worktree = repo("worktree");
  const nested = join(worktree, "apps", "native");
  mkdirSync(nested, { recursive: true });
  let calls = 0;
  const classify = createUnitProjectClassifier((path) => { calls++; return classifyProject(path); });
  assert.ok(!classify(worktree).signals.detectedFiles.includes("Cargo.toml"));
  writeFileSync(join(nested, "Cargo.toml"), "[package]\nname='native'\n");
  assert.ok(classify(worktree, { refresh: true }).signals.detectedFiles.includes("Cargo.toml"));
  assert.equal(calls, 2);
});

test("root changes and symlink retargeting cannot reuse another worktree classification", (t) => {
  const { root, repo } = fixture(t);
  const first = repo("first");
  const second = repo("second", "Cargo.toml");
  const alias = join(root, "alias");
  symlinkSync(first, alias, process.platform === "win32" ? "junction" : "dir");
  const classify = createUnitProjectClassifier();
  assert.ok(classify(first).signals.detectedFiles.includes("package.json"));
  assert.ok(classify(second).signals.detectedFiles.includes("Cargo.toml"));
  assert.ok(classify(alias).signals.detectedFiles.includes("package.json"));
  unlinkSync(alias);
  symlinkSync(second, alias, process.platform === "win32" ? "junction" : "dir");
  assert.ok(classify(alias).signals.detectedFiles.includes("Cargo.toml"));
});

test("missing worktrees and changed Git markers refresh after recovery", (t) => {
  const { root, repo } = fixture(t);
  const path = join(root, "recovered");
  let calls = 0;
  const classify = createUnitProjectClassifier((value) => { calls++; return classifyProject(value); });
  assert.equal(classify(path).kind, "invalid-repo");
  repo("recovered");
  assert.equal(classify(path).kind, "typed-existing");
  unlinkSync(join(path, ".git"));
  assert.equal(classify(path).kind, "invalid-repo");
  writeFileSync(join(path, ".git"), "gitdir: /fixture-only/new-registration\n");
  assert.equal(classify(path).kind, "typed-existing");
  assert.equal(calls, 4);
});

test("same-path worktree replacement cannot reuse the removed checkout", (t) => {
  const { repo } = fixture(t);
  const path = repo("replaced");
  const classify = createUnitProjectClassifier();
  assert.ok(classify(path).signals.detectedFiles.includes("package.json"));
  rmSync(path, { recursive: true });
  repo("replaced", "Cargo.toml");
  assert.ok(classify(path).signals.detectedFiles.includes("Cargo.toml"));
  assert.ok(!classify(path).signals.detectedFiles.includes("package.json"));
});

test("orphan-removal safety failure remains a failure and a subsequent read sees the missing checkout", (t) => {
  const { root, repo } = fixture(t);
  const projectRoot = repo("project");
  const worktree = repo("project/.gsd/worktrees/M001");
  const classify = createUnitProjectClassifier();
  assert.equal(classify(worktree).kind, "typed-existing");
  let removed = false;
  const safety = createWorktreeSafetyModule({
    existsSync: (path) => path === worktree || path === join(worktree, ".git"),
    lstatSync: () => ({ isFile: () => true }),
    listRegisteredWorktrees: () => [],
    pruneRegisteredWorktrees: () => {},
    removeStaleWorktreeDirectory: (path) => { removed = true; rmSync(path, { recursive: true }); },
  });
  const result = safety.validateUnitRoot({
    unitType: "execute-task", unitId: "M001/S01/T01", milestoneId: "M001",
    projectRoot, unitRoot: worktree, isolationMode: "worktree", writeScope: "source-writing",
    emptyWorktreeWithProjectContent: resolveEmptyWorktreeWithProjectContent(worktree, root, classify),
  });
  assert.equal(result.ok, false);
  assert.equal(result.kind, "worktree-missing");
  assert.equal(removed, true);
  assert.equal(classify(worktree).kind, "invalid-repo");
});
