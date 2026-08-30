import { randomUUID } from "node:crypto";
import { getDb } from "../db/engine.js";
import {
  insertAssessmentRun,
  updateAssessmentProjectionPath as writeAssessmentProjectionPath,
  updateAssessmentRunRunning,
  updateAssessmentRunSettlement,
  upsertGateRecommendationDisposition,
} from "../db/writers/assessment-gates.js";
import type {
  AssessmentFinding,
  AssessmentRun,
  AssessmentRunStatus,
  AssessmentVerdict,
  EvidenceRef,
  GateRecommendationDisposition,
} from "./types.js";

function json<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function optional(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function rowToRun(row: Record<string, unknown>): AssessmentRun {
  return {
    runId: String(row.run_id),
    gateId: String(row.gate_id),
    gateVersion: optional(row.gate_version),
    scope: {
      projectId: optional(row.project_id),
      milestoneId: optional(row.milestone_id),
      sliceId: optional(row.slice_id),
    },
    lifecycle: String(row.lifecycle) as AssessmentRun["lifecycle"],
    effect: "report-only",
    status: String(row.status) as AssessmentRunStatus,
    verdict: optional(row.verdict) as AssessmentVerdict | undefined,
    testedSourceRevision: optional(row.tested_source_revision),
    inputDigest: optional(row.input_digest),
    repositoryRevision: optional(row.repository_revision),
    startedAt: String(row.started_at),
    completedAt: optional(row.completed_at),
    summary: String(row.summary ?? ""),
    findings: json<AssessmentFinding[]>(row.findings_json, []),
    evidenceRefs: json<EvidenceRef[]>(row.evidence_refs_json, []),
    toolProfile: json<AssessmentRun["toolProfile"]>(row.tool_profile_json, []),
    blockedCapabilities: json<string[]>(row.blocked_capabilities_json, []),
    targetUrl: optional(row.target_url),
    failureReason: optional(row.failure_reason),
    invocationReason: String(row.invocation_reason ?? ""),
    approval: json<AssessmentRun["approval"] | undefined>(row.approval_json, undefined),
    model: optional(row.model),
    provider: optional(row.provider),
    sourceSnapshot: json<unknown>(row.source_snapshot_json, undefined),
    sourceDriftPaths: json<string[]>(row.source_drift_paths_json, []),
    policyViolations: json<string[]>(row.policy_violations_json, []),
    rawDiagnosticRef: optional(row.raw_diagnostic_ref),
    projectionPath: optional(row.projection_path),
  };
}

export function createAssessmentRun(input: Omit<AssessmentRun, "runId" | "status" | "startedAt" | "summary" | "findings" | "evidenceRefs" | "sourceDriftPaths" | "policyViolations"> & {
  runId?: string;
}): AssessmentRun {
  const runId = input.runId ?? `GAR-${randomUUID()}`;
  const now = new Date().toISOString();
  insertAssessmentRun({
    runId,
    gateId: input.gateId,
    gateVersion: input.gateVersion,
    projectId: input.scope.projectId,
    milestoneId: input.scope.milestoneId,
    sliceId: input.scope.sliceId,
    lifecycle: input.lifecycle,
    testedSourceRevision: input.testedSourceRevision,
    inputDigest: input.inputDigest,
    repositoryRevision: input.repositoryRevision,
    startedAt: now,
    toolProfile: input.toolProfile,
    blockedCapabilities: input.blockedCapabilities,
    targetUrl: input.targetUrl,
    invocationReason: input.invocationReason,
    approval: input.approval,
    model: input.model,
    provider: input.provider,
    sourceSnapshot: input.sourceSnapshot,
  });
  return getAssessmentRun(runId)!;
}

export function getAssessmentRun(runId: string): AssessmentRun | null {
  const row = getDb().prepare("SELECT * FROM assessment_runs WHERE run_id = :run_id").get({ ":run_id": runId });
  return row ? rowToRun(row) : null;
}

export function listAssessmentRuns(limit = 50): AssessmentRun[] {
  return getDb().prepare("SELECT * FROM assessment_runs ORDER BY started_at DESC LIMIT :limit")
    .all({ ":limit": Math.max(1, Math.min(limit, 500)) })
    .map(rowToRun);
}

export function markAssessmentRunning(runId: string): void {
  updateAssessmentRunRunning(runId, new Date().toISOString());
}

export function settleAssessmentRun(input: {
  runId: string;
  status: Exclude<AssessmentRunStatus, "pending" | "running">;
  verdict?: AssessmentVerdict;
  summary?: string;
  findings?: AssessmentFinding[];
  evidenceRefs?: EvidenceRef[];
  failureReason?: string;
  sourceDriftPaths?: string[];
  policyViolations?: string[];
  rawDiagnosticRef?: string;
  projectionPath?: string;
}): AssessmentRun {
  const now = new Date().toISOString();
  updateAssessmentRunSettlement({
    runId: input.runId,
    status: input.status,
    verdict: input.verdict,
    summary: input.summary ?? "",
    findings: input.findings ?? [],
    evidenceRefs: input.evidenceRefs ?? [],
    failureReason: input.failureReason,
    sourceDriftPaths: input.sourceDriftPaths ?? [],
    policyViolations: input.policyViolations ?? [],
    rawDiagnosticRef: input.rawDiagnosticRef,
    projectionPath: input.projectionPath,
    completedAt: now,
  });
  const run = getAssessmentRun(input.runId);
  if (!run) throw new Error(`Assessment run not found after settlement: ${input.runId}`);
  return run;
}

export function updateAssessmentProjectionPath(runId: string, projectionPath: string): void {
  writeAssessmentProjectionPath(runId, projectionPath, new Date().toISOString());
}

export function markAssessmentStale(runId: string, driftPaths: string[]): AssessmentRun {
  const current = getAssessmentRun(runId);
  if (!current) throw new Error(`Assessment run not found: ${runId}`);
  if (current.status === "stale") return current;
  return settleAssessmentRun({
    runId,
    status: "stale",
    verdict: current.verdict,
    summary: current.summary,
    findings: current.findings,
    evidenceRefs: current.evidenceRefs,
    failureReason: "The source revision no longer matches this assessment.",
    sourceDriftPaths: driftPaths,
    policyViolations: current.policyViolations,
    rawDiagnosticRef: current.rawDiagnosticRef,
    projectionPath: current.projectionPath,
  });
}

export function cancelAssessmentRun(runId: string): AssessmentRun | null {
  const run = getAssessmentRun(runId);
  if (!run || !["pending", "running"].includes(run.status)) return run;
  return settleAssessmentRun({
    runId,
    status: "cancelled",
    summary: "Assessment cancelled by the user.",
    failureReason: "cancelled",
  });
}

export function recordGateRecommendationDisposition(input: GateRecommendationDisposition): void {
  upsertGateRecommendationDisposition(input);
}

export function getGateRecommendationDisposition(gateId: string, scopeId: string): GateRecommendationDisposition | null {
  const row = getDb().prepare(`
    SELECT gate_id, scope_id, status, recorded_at
    FROM gate_recommendation_dispositions WHERE gate_id = :gate_id AND scope_id = :scope_id
  `).get({ ":gate_id": gateId, ":scope_id": scopeId });
  return row ? {
    gateId: String(row.gate_id),
    scopeId: String(row.scope_id),
    status: String(row.status) as GateRecommendationDisposition["status"],
    recordedAt: String(row.recorded_at),
  } : null;
}
