import assert from "node:assert/strict";
import test from "node:test";

import { buildAuditReport, compareStableTags, parseLsRemote, renderMarkdown } from "../audit-pi-upstream.mjs";

const stableCommit = "1111111111111111111111111111111111111111";
const mainCommit = "2222222222222222222222222222222222222222";
const manifest = {
  repository: "https://example.test/pi",
  pinnedRef: "v0.75.5",
  pinnedCommit: null,
  upstreamAudit: {
    reviewedStableRef: "v0.84.4",
    reviewedStableCommit: stableCommit,
    reviewedMainRef: "refs/heads/main",
    reviewedMainCommit: mainCommit,
    reviewedAt: "2026-09-03",
    auditDocument: "docs/dev/pi-upstream-audit-2026-09-02.md",
  },
};

test("compares stable tags numerically rather than lexicographically", () => {
  assert.equal(compareStableTags("v0.10.0", "v0.9.9"), 1);
  assert.equal(compareStableTags("v1.0.0", "v0.99.99"), 1);
  assert.equal(compareStableTags("v0.84.4", "v0.84.4"), 0);
});

test("prefers an annotated tag's peeled commit", () => {
  const refs = parseLsRemote([
    `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\trefs/tags/v0.84.4`,
    `${stableCommit}\trefs/tags/v0.84.4^{}`,
  ].join("\n"));
  assert.equal(refs.get("refs/tags/v0.84.4"), stableCommit);
});

test("reports a current audit independently from the older vendor pin", () => {
  const report = buildAuditReport({
    manifest,
    generatedAt: "2026-09-03T00:00:00.000Z",
    lsRemoteOutput: [
      `${mainCommit}\trefs/heads/main`,
      `${stableCommit}\trefs/tags/v0.84.4`,
      `3333333333333333333333333333333333333333\trefs/tags/v0.83.0`,
    ].join("\n"),
  });
  assert.equal(report.current, true);
  assert.deepEqual(report.changes, []);
  assert.deepEqual(report.vendorPin, { ref: "v0.75.5", commit: null });
  assert.match(renderMarkdown(report), /Status: \*\*current\*\*/);
});

test("fails closed when either the latest stable release or main changes", () => {
  const nextStable = "4444444444444444444444444444444444444444";
  const nextMain = "5555555555555555555555555555555555555555";
  const report = buildAuditReport({
    manifest,
    lsRemoteOutput: [
      `${nextMain}\trefs/heads/main`,
      `${stableCommit}\trefs/tags/v0.84.4`,
      `${nextStable}\trefs/tags/v0.85.0`,
    ].join("\n"),
  });
  assert.equal(report.current, false);
  assert.deepEqual(report.changes.map((change) => change.kind), ["stable-release-changed", "main-changed"]);
  assert.match(renderMarkdown(report), /review required/);
});

test("rejects malformed or incomplete audit inputs", () => {
  assert.throws(() => parseLsRemote("not-a-commit\trefs/heads/main"), /Malformed/);
  assert.throws(
    () => buildAuditReport({ manifest: { ...manifest, upstreamAudit: undefined }, lsRemoteOutput: "" }),
    /must define upstreamAudit/,
  );
});
