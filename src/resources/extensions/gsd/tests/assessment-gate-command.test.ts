import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSkills } from "@gsd/pi-coding-agent";
import { handleGateCommand } from "../commands-gate.ts";
import { withCommandCwd } from "../commands/context.ts";
import { closeDatabase, openDatabase, _getAdapter } from "../gsd-db.ts";
import { getGateRecommendationDisposition } from "../assessment-gates/store.ts";
import type { AssessmentRun } from "../assessment-gates/types.ts";

function setup() {
  const base = mkdtempSync(join(tmpdir(), "gsd-gate-command-"));
  mkdirSync(join(base, ".gsd"), { recursive: true });
  writeFileSync(join(base, "README.md"), "project\n");
  execFileSync("git", ["init", "-q"], { cwd: base });
  execFileSync("git", ["add", "README.md"], { cwd: base });
  execFileSync("git", ["-c", "user.name=GSD Test", "-c", "user.email=gsd@example.invalid", "commit", "-qm", "initial"], { cwd: base });
  const skillDir = join(base, ".agents", "skills", "design-review");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), [
    "---", "name: design-review", "description: Substantial product design review",
    "gsd:", "  kind: assessment-gate", "  invocation: suggest", "  lifecycle: [pre-milestone]",
    "  effect: report-only", "  revisionBinding: optional", "  resultSchema: gsd.findings/v1",
    "  capabilities: [repository.read]", "---", "Report findings only.",
  ].join("\n"));
  loadSkills({ cwd: base, agentDir: join(base, ".agent"), includeDefaults: false, skillPaths: [join(base, ".agents", "skills")] });
  assert.equal(openDatabase(join(base, ".gsd", "gsd.db")), true);
  return base;
}

function context(choice: string, notifications: string[]) {
  return {
    hasUI: true,
    ui: {
      notify(message: string) { notifications.push(message); },
      async select() { return choice; },
    },
  } as any;
}

function pendingRun(): AssessmentRun {
  return {
    runId: "GAR-command-test", gateId: "design-review", scope: {}, lifecycle: "pre-milestone",
    effect: "report-only", status: "pending", startedAt: new Date().toISOString(), summary: "", findings: [],
    evidenceRefs: [], toolProfile: ["repository.read"], blockedCapabilities: [], invocationReason: "test",
    sourceDriftPaths: [], policyViolations: [],
  };
}

test("gate run preview requires approval and Skip records decline without starting", async () => {
  const base = setup();
  const notifications: string[] = [];
  let starts = 0;
  try {
    await withCommandCwd(base, () => handleGateCommand(
      "run design-review Review the new checkout experience",
      context("Skip", notifications),
      { start: async () => { starts++; return { run: pendingRun(), completion: Promise.resolve(pendingRun()) }; } },
    ));
    assert.equal(starts, 0);
    assert.equal(_getAdapter()!.prepare("SELECT COUNT(*) AS count FROM assessment_runs").get()?.count, 0);
    assert.equal(getGateRecommendationDisposition("design-review", "project:pre-milestone")?.status, "declined");
    assert.match(notifications[0] ?? "", /Effect: report-only/);
    assert.match(notifications[0] ?? "", /Capabilities: repository.read/);
  } finally { closeDatabase(); rmSync(base, { recursive: true, force: true }); }
});

test("explicit Run now approval starts exactly one AssessmentRun and records acceptance", async () => {
  const base = setup();
  const notifications: string[] = [];
  let starts = 0;
  let approved = false;
  try {
    await withCommandCwd(base, () => handleGateCommand(
      "run design-review Review the new checkout experience",
      context("Run now", notifications),
      { start: async (input) => {
        starts++;
        approved = input.approval.approved;
        const run = pendingRun();
        return { run, completion: Promise.resolve({ ...run, status: "completed", verdict: "pass" }) };
      } },
    ));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(starts, 1);
    assert.equal(approved, true);
    assert.equal(getGateRecommendationDisposition("design-review", "project:pre-milestone")?.status, "accepted");
    assert.ok(notifications.some((message) => /Started GAR-command-test/.test(message)));
  } finally { closeDatabase(); rmSync(base, { recursive: true, force: true }); }
});
