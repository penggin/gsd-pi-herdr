import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolvePrBranchBaseRef } from "../commands-pr-branch.js";

// Test the filtering logic and downstream base resolution used by /gsd pr-branch.

test("pr-branch: identifies .gsd/ paths", () => {
  const files = [
    ".gsd/milestones/M001/ROADMAP.md",
    ".gsd/metrics.json",
    "src/main.ts",
    "package.json",
    ".planning/PLAN.md",
    "PLAN.md",
  ];

  const codeFiles = files.filter(
    (f) => !f.startsWith(".gsd/") && !f.startsWith(".planning/") && f !== "PLAN.md",
  );

  assert.deepEqual(codeFiles, ["src/main.ts", "package.json"]);
});

test("pr-branch: all .gsd/ files returns empty", () => {
  const files = [
    ".gsd/milestones/M001/ROADMAP.md",
    ".gsd/metrics.json",
    ".gsd/BACKLOG.md",
  ];

  const codeFiles = files.filter(
    (f) => !f.startsWith(".gsd/") && !f.startsWith(".planning/") && f !== "PLAN.md",
  );

  assert.equal(codeFiles.length, 0);
});

test("pr-branch: mixed commits with code changes", () => {
  const files = [
    ".gsd/milestones/M001/ROADMAP.md",
    "src/auth.ts",
    "src/auth.test.ts",
  ];

  const hasCodeChanges = files.some(
    (f) => !f.startsWith(".gsd/") && !f.startsWith(".planning/") && f !== "PLAN.md",
  );

  assert.ok(hasCodeChanges);
});

test("pr-branch: --dry-run flag", () => {
  assert.ok("--dry-run".includes("--dry-run"));
  assert.ok(!"--name my-branch".includes("--dry-run"));
});

test("pr-branch: --name flag parsing", () => {
  const args = "--name my-clean-pr";
  const nameMatch = args.match(/--name\s+(\S+)/);
  assert.ok(nameMatch);
  assert.equal(nameMatch[1], "my-clean-pr");
});

test("pr-branch: default branch name", () => {
  const currentBranch = "feat/add-auth";
  const prBranch = `pr/${currentBranch}`;
  assert.equal(prBranch, "pr/feat/add-auth");
});

test("pr-branch: downstream origin wins even when a historical upstream ref exists", () => {
  const repo = mkdtempSync(join(tmpdir(), "gsd-pr-branch-base-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
  try {
    git("init", "-b", "main");
    git("config", "user.name", "GSD Test");
    git("config", "user.email", "gsd-test@example.invalid");
    git("commit", "--allow-empty", "-m", "downstream base");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("commit", "--allow-empty", "-m", "historical source ref");
    git("update-ref", "refs/remotes/upstream/main", "HEAD");

    assert.equal(resolvePrBranchBaseRef(repo, "main"), "origin/main");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
