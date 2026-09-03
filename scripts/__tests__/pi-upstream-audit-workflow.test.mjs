// Project/App: GSD Pi Herdr
// File Purpose: Keep the upstream freshness audit automated, read-only, and fail-closed.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import YAML from "yaml";

const workflowPath = ".github/workflows/pi-upstream-audit.yml";
const source = readFileSync(workflowPath, "utf8");
const workflow = YAML.parse(source);
const auditJob = workflow.jobs.audit;

test("upstream audit runs weekly, manually, and when its contract changes", () => {
  assert.ok(Object.hasOwn(workflow.on, "workflow_dispatch"));
  assert.deepEqual(workflow.on.schedule, [{ cron: "17 6 * * 3" }]);
  assert.ok(workflow.on.pull_request.paths.includes("scripts/pi-upstream.json"));
  assert.ok(workflow.on.pull_request.paths.includes("scripts/audit-pi-upstream.mjs"));
  assert.equal(auditJob["timeout-minutes"], 5);
});

test("upstream audit has read-only repository permissions", () => {
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.doesNotMatch(source, /contents:\s*write/u);
  assert.doesNotMatch(source, /issues:\s*write/u);
  assert.doesNotMatch(source, /pull-requests:\s*write/u);
});

test("upstream changes fail the workflow and always retain evidence", () => {
  const auditStep = auditJob.steps.find((step) => step.id === "audit");
  const summaryStep = auditJob.steps.find((step) => step.name === "Publish audit summary");
  const uploadStep = auditJob.steps.find((step) => step.name === "Upload audit evidence");

  assert.ok(auditStep);
  assert.match(auditStep.run, /audit-pi-upstream\.mjs --markdown/u);
  assert.doesNotMatch(auditStep.run, /--no-fail/u);
  assert.match(auditStep.run, /exit "\$status"/u);
  assert.equal(summaryStep.if, "always()");
  assert.equal(uploadStep.if, "always()");
  assert.equal(uploadStep.with["if-no-files-found"], "error");
  assert.equal(uploadStep.with["retention-days"], 30);
});

test("audit implementation remains network-read-only", () => {
  const script = readFileSync("scripts/audit-pi-upstream.mjs", "utf8");

  assert.match(script, /\["ls-remote", "--heads", "--tags"/u);
  assert.doesNotMatch(script, /\["(?:push|fetch|checkout)"/u);
});
