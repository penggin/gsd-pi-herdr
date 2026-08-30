import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, openDatabase, _getAdapter } from "../gsd-db.ts";
import { requestAssessmentCancellation, startAssessmentGate } from "../assessment-gates/runner.ts";
import {
  getAssessmentRun,
  getGateRecommendationDisposition,
  markAssessmentStale,
  recordGateRecommendationDisposition,
} from "../assessment-gates/store.ts";
import type { InstalledAssessmentGate } from "../assessment-gates/registry.ts";
import type { RestrictedSubagentRequest, RestrictedSubagentResult } from "../../subagent/index.ts";
import { captureVerificationSourceSnapshot } from "../verification-source-integrity.ts";
import { handleGateCommand } from "../commands-gate.ts";
import { withCommandCwd } from "../commands/context.ts";

function fixture(): string {
  const base = mkdtempSync(join(tmpdir(), "gsd-assessment-"));
  mkdirSync(join(base, ".gsd"), { recursive: true });
  writeFileSync(join(base, "source.ts"), "export const value = 1;\n");
  execFileSync("git", ["init", "-q"], { cwd: base });
  execFileSync("git", ["add", "source.ts"], { cwd: base });
  execFileSync("git", ["-c", "user.name=GSD Test", "-c", "user.email=gsd@example.invalid", "commit", "-qm", "initial"], { cwd: base });
  assert.equal(openDatabase(join(base, ".gsd", "gsd.db")), true);
  return base;
}

function cleanup(base: string): void {
  closeDatabase();
  rmSync(base, { recursive: true, force: true });
}

function gate(overrides: Partial<InstalledAssessmentGate> = {}): InstalledAssessmentGate {
  const value: InstalledAssessmentGate = {
    gateId: "design-review",
    description: "Independent product design review for significant user flows.",
    filePath: "/tmp/design-review/SKILL.md",
    source: "project",
    invocation: "suggest",
    lifecycle: ["pre-milestone"],
    capabilities: ["repository.read", "artifacts.read"],
    revisionBinding: "optional",
    resultSchema: "gsd.findings/v1",
    effect: "report-only",
    diagnostics: [],
    healthy: true,
    body: "Inspect the requested scope and report findings only.",
    skill: {
      name: "design-review",
      description: "Independent product design review for significant user flows.",
      filePath: "/tmp/design-review/SKILL.md",
      baseDir: "/tmp/design-review",
      sourceInfo: {
        path: "/tmp/design-review/SKILL.md",
        source: "project",
        scope: "project",
        origin: "top-level",
        baseDir: "/tmp/design-review",
      },
      source: "project",
      disableModelInvocation: true,
    },
    ...overrides,
  };
  if (!value.skill) throw new Error("test gate skill is required");
  return value;
}

function result(output: string, exitCode = 0): RestrictedSubagentResult {
  return {
    exitCode,
    output,
    stderr: "",
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 2, turns: 1 },
  };
}

function identityFromPrompt(task: string): Record<string, unknown> {
  const line = task.split("\n").find((value) => value.startsWith('{"schemaVersion":"gsd.findings/v1"'));
  assert.ok(line, "host prompt should contain the required identity object");
  return JSON.parse(line);
}

function validOutput(request: RestrictedSubagentRequest): string {
  return JSON.stringify({
    ...identityFromPrompt(request.task),
    verdict: "pass",
    summary: "No actionable findings.",
    findings: [],
  });
}

function currentRevision(base: string): string {
  const captured = captureVerificationSourceSnapshot([{ id: "project", cwd: base }]);
  if (!captured.ok) throw new Error(captured.error);
  return captured.snapshot.aggregateRevision;
}

function recordValidation(base: string, testedSourceRevision = currentRevision(base)): void {
  const now = new Date().toISOString();
  const db = _getAdapter()!;
  db.prepare(`
    INSERT OR IGNORE INTO project_authority (singleton, project_id, project_root_realpath, revision, authority_epoch, created_at, updated_at)
    VALUES (1, 'project-test', ?, 0, 0, ?, ?)
  `).run(base, now, now);
  const projectId = String(db.prepare("SELECT project_id FROM project_authority WHERE singleton = 1").get()!.project_id);
  db.prepare(`
    INSERT INTO workflow_operations (
      operation_id, project_id, operation_type, idempotency_key, expected_revision, resulting_revision,
      expected_authority_epoch, resulting_authority_epoch, actor_type, source_transport, request_hash, created_at
    ) VALUES ('op-validation', ?, 'milestone.validate', 'validate/M001', 0, 1, 0, 0,
      'test', 'test', 'hash', ?)
  `).run(projectId, now);
  db.prepare(`
    INSERT INTO workflow_domain_events (
      event_id, operation_id, event_index, project_id, project_revision, authority_epoch,
      event_type, entity_type, entity_id, payload_json, created_at
    ) VALUES ('event-validation', 'op-validation', 0, ?, 1, 0,
      'milestone.validation.recorded', 'milestone', 'M001', ?, ?)
  `).run(projectId, JSON.stringify({ testedSourceRevision }), now);
}

test("fresh schema has separate AssessmentRun and recommendation tables", () => {
  const base = fixture();
  try {
    const tables = _getAdapter()!.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table'
        AND name IN ('assessment_runs', 'gate_recommendation_dispositions') ORDER BY name
    `).all().map((row) => row.name);
    assert.deepEqual(tables, ["assessment_runs", "gate_recommendation_dispositions"]);
  } finally { cleanup(base); }
});

test("report-only runner uses fresh restricted tools and accepts only structured output", async () => {
  const base = fixture();
  try {
    let captured: RestrictedSubagentRequest | undefined;
    const started = await startAssessmentGate({
      basePath: base,
      gate: gate(),
      lifecycle: "pre-milestone",
      scopeText: "Review the checkout flow before milestone planning.",
      invocationReason: "user approved suggested design review",
      approval: { approved: true, approvedAt: new Date().toISOString(), method: "interactive" },
      executeChild: async (request) => {
        captured = request;
        return result(validOutput(request));
      },
    });
    const completed = await started.completion;
    assert.equal(completed.status, "completed");
    assert.equal(completed.verdict, "pass");
    assert.equal(completed.repositoryRevision, currentRevision(base));
    assert.deepEqual(captured?.agent.tools, [
      "assessment_read", "assessment_list", "assessment_search", "assessment_git_read", "assessment_artifact_read",
    ]);
    assert.match(captured?.task ?? "", /fresh, isolated GSD Assessment Gate agent/);
    assert.equal(captured?.task.includes("source.write"), false);
    assert.ok(completed.projectionPath && existsSync(completed.projectionPath));
    assert.match(readFileSync(completed.projectionPath!, "utf8"), /canonical record is stored in GSD SQLite/i);
  } finally { cleanup(base); }
});

test("malformed output retries exactly once then becomes inconclusive with redacted diagnostics", async () => {
  const base = fixture();
  try {
    let attempts = 0;
    const started = await startAssessmentGate({
      basePath: base,
      gate: gate(),
      lifecycle: "pre-milestone",
      scopeText: "Review a substantial design proposal for checkout.",
      invocationReason: "manual test",
      approval: { approved: true, approvedAt: new Date().toISOString(), method: "explicit-command" },
      executeChild: async () => {
        attempts++;
        return result("not json token=ghp_abcdefghijklmnopqrstuvwxyz123456");
      },
    });
    const completed = await started.completion;
    assert.equal(attempts, 2);
    assert.equal(completed.status, "inconclusive");
    assert.ok(completed.rawDiagnosticRef && existsSync(completed.rawDiagnosticRef));
    assert.equal(readFileSync(completed.rawDiagnosticRef!, "utf8").includes("ghp_abcdefghijklmnopqrstuvwxyz123456"), false);
  } finally { cleanup(base); }
});

test("source mutation is retained for the user and makes the run a policy violation", async () => {
  const base = fixture();
  try {
    const started = await startAssessmentGate({
      basePath: base,
      gate: gate(),
      lifecycle: "pre-milestone",
      scopeText: "Review a substantial design proposal for checkout.",
      invocationReason: "manual test",
      approval: { approved: true, approvedAt: new Date().toISOString(), method: "explicit-command" },
      executeChild: async (request) => {
        writeFileSync(join(base, "source.ts"), "export const value = 2;\n");
        return result(validOutput(request));
      },
    });
    const completed = await started.completion;
    assert.equal(completed.status, "policy-violation");
    assert.deepEqual(completed.sourceDriftPaths, ["source.ts"]);
    assert.match(readFileSync(join(base, "source.ts"), "utf8"), /value = 2/);
  } finally { cleanup(base); }
});

test("unexpected child failure settles the canonical run instead of leaving it running", async () => {
  const base = fixture();
  try {
    const started = await startAssessmentGate({
      basePath: base,
      gate: gate(),
      lifecycle: "pre-milestone",
      scopeText: "Review a substantial design proposal for checkout.",
      invocationReason: "manual test",
      approval: { approved: true, approvedAt: new Date().toISOString(), method: "explicit-command" },
      executeChild: async () => { throw new Error("provider token=secret-value"); },
    });
    const completed = await started.completion;
    assert.equal(completed.status, "failed");
    assert.equal(completed.failureReason?.includes("secret-value"), false);
    assert.equal(getAssessmentRun(started.run.runId)?.status, "failed");
  } finally { cleanup(base); }
});

test("cancellation terminates only the AssessmentRun and records cancelled", async () => {
  const base = fixture();
  try {
    const started = await startAssessmentGate({
      basePath: base,
      gate: gate(),
      lifecycle: "pre-milestone",
      scopeText: "Review a substantial design proposal for checkout.",
      invocationReason: "manual test",
      approval: { approved: true, approvedAt: new Date().toISOString(), method: "explicit-command" },
      executeChild: async (request) => new Promise((resolve) => {
        request.signal?.addEventListener("abort", () => resolve(result("", 1)), { once: true });
      }),
    });
    assert.equal(requestAssessmentCancellation(started.run.runId), true);
    const completed = await started.completion;
    assert.equal(completed.status, "cancelled");
    assert.equal(_getAdapter()!.prepare("SELECT COUNT(*) AS count FROM milestones").get()?.count, 0);
  } finally { cleanup(base); }
});

test("unsupported browser inspection and missing verifier approval fail before a run is created", async () => {
  const base = fixture();
  try {
    await assert.rejects(() => startAssessmentGate({
      basePath: base, gate: gate({ capabilities: ["browser.inspect"] }), lifecycle: "pre-milestone",
      scopeText: "Inspect staging", invocationReason: "manual",
      approval: { approved: true, approvedAt: new Date().toISOString(), method: "explicit-command" },
    }), /not available in v1/);
    await assert.rejects(() => startAssessmentGate({
      basePath: base, gate: gate({ capabilities: ["process.verification"] }), lifecycle: "pre-milestone",
      scopeText: "Run benchmark", invocationReason: "manual",
      approval: { approved: true, approvedAt: new Date().toISOString(), method: "explicit-command" },
    }), /host-approved verifier/);
    assert.equal(_getAdapter()!.prepare("SELECT COUNT(*) AS count FROM assessment_runs").get()?.count, 0);
  } finally { cleanup(base); }
});

test("post-validation placement requires current validation with an exact source revision", async () => {
  const base = fixture();
  const postGate = gate({
    gateId: "second-opinion",
    lifecycle: ["post-validation"],
    revisionBinding: "required",
    invocation: "manual",
  });
  const input = {
    basePath: base,
    gate: postGate,
    lifecycle: "post-validation" as const,
    scopeText: "Independent release-critical second opinion.",
    milestoneId: "M001",
    invocationReason: "manual",
    approval: { approved: true as const, approvedAt: new Date().toISOString(), method: "explicit-command" as const },
  };
  try {
    await assert.rejects(() => startAssessmentGate(input), /requires a current GSD validation/);
    recordValidation(base, "sha256:not-current");
    await assert.rejects(() => startAssessmentGate(input), /source mismatch/);
  } finally { cleanup(base); }

  const matchingBase = fixture();
  try {
    recordValidation(matchingBase);
    const started = await startAssessmentGate({
      ...input,
      basePath: matchingBase,
      executeChild: async (request) => result(validOutput(request)),
    });
    const completed = await started.completion;
    assert.equal(completed.status, "completed");
    assert.equal(completed.testedSourceRevision, currentRevision(matchingBase));
  } finally { cleanup(matchingBase); }
});

test("recommendation disposition is GSD-owned and stale does not mutate lifecycle records", () => {
  const base = fixture();
  try {
    recordGateRecommendationDisposition({
      gateId: "design-review", scopeId: "M001", status: "suppressed", recordedAt: new Date().toISOString(),
    });
    assert.equal(getGateRecommendationDisposition("design-review", "M001")?.status, "suppressed");
    const runId = "GAR-stale-test";
    _getAdapter()!.prepare(`
      INSERT INTO assessment_runs (
        run_id, gate_id, lifecycle, effect, status, tested_source_revision, started_at,
        summary, findings_json, evidence_refs_json, tool_profile_json, blocked_capabilities_json,
        invocation_reason, source_drift_paths_json, policy_violations_json, updated_at
      ) VALUES (?, 'second-opinion', 'post-validation', 'report-only', 'completed', 'old', ?,
        'done', '[]', '[]', '[]', '[]', 'manual', '[]', '[]', ?)
    `).run(runId, new Date().toISOString(), new Date().toISOString());
    const stale = markAssessmentStale(runId, ["source.ts"]);
    assert.equal(stale.status, "stale");
    assert.equal(_getAdapter()!.prepare("SELECT COUNT(*) AS count FROM milestones").get()?.count, 0);
  } finally { cleanup(base); }
});

test("status refresh automatically marks a completed result stale after source changes", async () => {
  const base = fixture();
  try {
    const started = await startAssessmentGate({
      basePath: base,
      gate: gate(),
      lifecycle: "pre-milestone",
      scopeText: "Review a substantial design proposal for checkout.",
      invocationReason: "manual test",
      approval: { approved: true, approvedAt: new Date().toISOString(), method: "explicit-command" },
      executeChild: async (request) => result(validOutput(request)),
    });
    const completed = await started.completion;
    assert.equal(completed.status, "completed");
    writeFileSync(join(base, "source.ts"), "export const value = 99;\n");
    const notifications: string[] = [];
    await withCommandCwd(base, () => handleGateCommand(`status ${completed.runId}`, {
      hasUI: true,
      ui: { notify(message: string) { notifications.push(message); } },
    } as any));
    assert.equal(getAssessmentRun(completed.runId)?.status, "stale");
    assert.match(notifications[0] ?? "", /stale/);
  } finally { cleanup(base); }
});
