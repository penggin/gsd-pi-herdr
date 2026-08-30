// Canonical single-writer seam for AssessmentRun and recommendation records.

import { getDb } from "../engine.js";
import type {
  AssessmentFinding,
  AssessmentRunStatus,
  AssessmentVerdict,
  EvidenceRef,
  GateRecommendationDisposition,
} from "../../assessment-gates/types.js";

export interface AssessmentRunInsert {
  runId: string;
  gateId: string;
  gateVersion?: string;
  projectId?: string;
  milestoneId?: string;
  sliceId?: string;
  lifecycle: "pre-milestone" | "post-validation";
  testedSourceRevision?: string;
  inputDigest?: string;
  repositoryRevision?: string;
  startedAt: string;
  toolProfile: string[];
  blockedCapabilities: string[];
  targetUrl?: string;
  invocationReason: string;
  approval?: unknown;
  model?: string;
  provider?: string;
  sourceSnapshot?: unknown;
}

export function insertAssessmentRun(input: AssessmentRunInsert): void {
  getDb().prepare(`
    INSERT INTO assessment_runs (
      run_id, gate_id, gate_version, project_id, milestone_id, slice_id,
      lifecycle, effect, status, tested_source_revision, input_digest, repository_revision,
      started_at, summary, findings_json, evidence_refs_json, tool_profile_json,
      blocked_capabilities_json, target_url, invocation_reason, approval_json,
      model, provider, source_snapshot_json, source_drift_paths_json,
      policy_violations_json, updated_at
    ) VALUES (
      :run_id, :gate_id, :gate_version, :project_id, :milestone_id, :slice_id,
      :lifecycle, 'report-only', 'pending', :tested_source_revision, :input_digest, :repository_revision,
      :started_at, '', '[]', '[]', :tool_profile_json,
      :blocked_capabilities_json, :target_url, :invocation_reason, :approval_json,
      :model, :provider, :source_snapshot_json, '[]', '[]', :updated_at
    )
  `).run({
    ":run_id": input.runId,
    ":gate_id": input.gateId,
    ":gate_version": input.gateVersion ?? null,
    ":project_id": input.projectId ?? null,
    ":milestone_id": input.milestoneId ?? null,
    ":slice_id": input.sliceId ?? null,
    ":lifecycle": input.lifecycle,
    ":tested_source_revision": input.testedSourceRevision ?? null,
    ":input_digest": input.inputDigest ?? null,
    ":repository_revision": input.repositoryRevision ?? null,
    ":started_at": input.startedAt,
    ":tool_profile_json": JSON.stringify(input.toolProfile),
    ":blocked_capabilities_json": JSON.stringify(input.blockedCapabilities),
    ":target_url": input.targetUrl ?? null,
    ":invocation_reason": input.invocationReason,
    ":approval_json": input.approval === undefined ? null : JSON.stringify(input.approval),
    ":model": input.model ?? null,
    ":provider": input.provider ?? null,
    ":source_snapshot_json": input.sourceSnapshot === undefined ? null : JSON.stringify(input.sourceSnapshot),
    ":updated_at": input.startedAt,
  });
}

export function updateAssessmentRunRunning(runId: string, updatedAt: string): void {
  getDb().prepare(`
    UPDATE assessment_runs SET status = 'running', updated_at = :updated_at
    WHERE run_id = :run_id AND status = 'pending'
  `).run({ ":run_id": runId, ":updated_at": updatedAt });
}

export function updateAssessmentRunSettlement(input: {
  runId: string;
  status: Exclude<AssessmentRunStatus, "pending" | "running">;
  verdict?: AssessmentVerdict;
  summary: string;
  findings: AssessmentFinding[];
  evidenceRefs: EvidenceRef[];
  failureReason?: string;
  sourceDriftPaths: string[];
  policyViolations: string[];
  rawDiagnosticRef?: string;
  projectionPath?: string;
  completedAt: string;
}): void {
  getDb().prepare(`
    UPDATE assessment_runs
    SET status = :status, verdict = :verdict, summary = :summary,
        findings_json = :findings_json, evidence_refs_json = :evidence_refs_json,
        failure_reason = :failure_reason, source_drift_paths_json = :source_drift_paths_json,
        policy_violations_json = :policy_violations_json, raw_diagnostic_ref = :raw_diagnostic_ref,
        projection_path = COALESCE(:projection_path, projection_path),
        completed_at = COALESCE(completed_at, :completed_at), updated_at = :updated_at
    WHERE run_id = :run_id
  `).run({
    ":run_id": input.runId,
    ":status": input.status,
    ":verdict": input.verdict ?? null,
    ":summary": input.summary,
    ":findings_json": JSON.stringify(input.findings),
    ":evidence_refs_json": JSON.stringify(input.evidenceRefs),
    ":failure_reason": input.failureReason ?? null,
    ":source_drift_paths_json": JSON.stringify(input.sourceDriftPaths),
    ":policy_violations_json": JSON.stringify(input.policyViolations),
    ":raw_diagnostic_ref": input.rawDiagnosticRef ?? null,
    ":projection_path": input.projectionPath ?? null,
    ":completed_at": input.completedAt,
    ":updated_at": input.completedAt,
  });
}

export function updateAssessmentProjectionPath(runId: string, projectionPath: string, updatedAt: string): void {
  getDb().prepare(`UPDATE assessment_runs SET projection_path = :path, updated_at = :updated_at WHERE run_id = :run_id`)
    .run({ ":run_id": runId, ":path": projectionPath, ":updated_at": updatedAt });
}

export function upsertGateRecommendationDisposition(input: GateRecommendationDisposition): void {
  getDb().prepare(`
    INSERT INTO gate_recommendation_dispositions (gate_id, scope_id, status, recorded_at)
    VALUES (:gate_id, :scope_id, :status, :recorded_at)
    ON CONFLICT(gate_id, scope_id) DO UPDATE SET status = excluded.status, recorded_at = excluded.recorded_at
  `).run({
    ":gate_id": input.gateId,
    ":scope_id": input.scopeId,
    ":status": input.status,
    ":recorded_at": input.recordedAt,
  });
}
