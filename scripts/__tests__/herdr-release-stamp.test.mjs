import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildReleaseMetadata } from "../herdr-integration/release-stamp.mjs";

test("stamps exact upstream/downstream identity and embeds a prior rollback target", (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "gsd-herdr-release-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(join(cwd, "integrations", "herdr", "release"), { recursive: true });
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "@test/gsd", version: "9.9.9" }));
  writeFileSync(join(cwd, "integrations", "herdr", "compatibility.json"), JSON.stringify({ schemaVersion: 1, supported: { version: "0.8.2", protocol: 20 } }));
  const knownGoodPath = join(cwd, "integrations", "herdr", "release", "known-good.json");
  writeFileSync(knownGoodPath, JSON.stringify({ schemaVersion: 1, downstreamCommit: "1".repeat(40) }));
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd });
  execFileSync("git", ["config", "user.name", "Test"], { cwd });
  execFileSync("git", ["add", "."], { cwd });
  execFileSync("git", ["commit", "-qm", "base"], { cwd });
  execFileSync("git", ["branch", "upstream-main"], { cwd });
  writeFileSync(join(cwd, "downstream.txt"), "fork\n");
  execFileSync("git", ["add", "."], { cwd });
  execFileSync("git", ["commit", "-qm", "downstream"], { cwd });

  const metadata = buildReleaseMetadata({ cwd, upstreamRef: "upstream-main", knownGoodPath, now: new Date("2026-08-30T00:00:00.000Z") });
  assert.equal(metadata.createdAt, "2026-08-30T00:00:00.000Z");
  assert.equal(metadata.downstream.version, "9.9.9");
  assert.equal(metadata.upstream.commit.length, 40);
  assert.notEqual(metadata.downstream.commit, metadata.upstream.commit);
  assert.equal(metadata.rollback.previousKnownGood.downstreamCommit, "1".repeat(40));
  assert.equal(metadata.rollback.preservesRuntimeArtifacts, true);
  assert.equal(readFileSync(knownGoodPath, "utf8").includes("1".repeat(40)), true);

  writeFileSync(join(cwd, "uncommitted.txt"), "dirty\n");
  assert.throws(
    () => buildReleaseMetadata({ cwd, upstreamRef: "upstream-main", knownGoodPath }),
    /dirty worktree/,
  );
});
