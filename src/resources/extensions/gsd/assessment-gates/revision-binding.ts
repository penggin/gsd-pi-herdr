import { createHash } from "node:crypto";
import { getDb } from "../db/engine.js";
import { isCurrentMilestoneValidationOperation } from "../milestone-validation-domain-operation.js";
import { loadEffectiveGSDPreferences } from "../preferences.js";
import {
  captureVerificationSourceSnapshot,
  diagnoseMilestoneVerificationSourceDrift,
  resolveVerificationRepositoryTargets,
  verificationSourceChanged,
  type VerificationSourceSnapshot,
  type VerificationSourceTarget,
} from "../verification-source-integrity.js";

export interface GateSourceBinding {
  testedSourceRevision?: string;
  inputDigest?: string;
  repositoryRevision?: string;
  snapshot: VerificationSourceSnapshot;
  targets: VerificationSourceTarget[];
}

function sourceTargets(basePath: string): VerificationSourceTarget[] {
  const preferences = loadEffectiveGSDPreferences(basePath)?.preferences;
  const resolved = resolveVerificationRepositoryTargets(basePath, preferences, null, null);
  if (resolved.missingRepositoryIds.length > 0) {
    throw new Error(`assessment source repositories are missing: ${resolved.missingRepositoryIds.join(", ")}`);
  }
  return resolved.repositories.map((repository) => ({ id: repository.id, cwd: repository.root }));
}

function stableSnapshot(targets: VerificationSourceTarget[]): VerificationSourceSnapshot {
  const result = captureVerificationSourceSnapshot(targets);
  if (!result.ok) throw new Error(result.error);
  return result.snapshot;
}

export function readCurrentMilestoneValidationRevision(milestoneId: string): string | null {
  const row = getDb().prepare(`
    SELECT event.operation_id, json_extract(event.payload_json, '$.testedSourceRevision') AS tested_source_revision
    FROM workflow_domain_events event
    JOIN workflow_operations operation
      ON operation.operation_id = event.operation_id AND operation.project_id = event.project_id
    WHERE event.event_type = 'milestone.validation.recorded'
      AND event.entity_type = 'milestone' AND event.entity_id = :milestone_id
      AND operation.operation_type = 'milestone.validate'
    ORDER BY event.project_revision DESC, event.event_index DESC, event.event_id DESC
    LIMIT 1
  `).get({ ":milestone_id": milestoneId });
  if (!row) return null;
  const operationId = String(row.operation_id);
  if (!isCurrentMilestoneValidationOperation(operationId, milestoneId)) return null;
  const revision = row.tested_source_revision;
  return typeof revision === "string" && revision.length > 0 ? revision : null;
}

export function preparePostValidationBinding(basePath: string, milestoneId: string): GateSourceBinding {
  const validationRevision = readCurrentMilestoneValidationRevision(milestoneId);
  if (!validationRevision) {
    throw new Error(`post-validation assessment requires a current GSD validation for milestone ${milestoneId}`);
  }
  const targets = sourceTargets(basePath);
  const snapshot = stableSnapshot(targets);
  if (snapshot.aggregateRevision !== validationRevision) {
    throw new Error(
      `post-validation assessment source mismatch: validation tested ${validationRevision}, current source is ${snapshot.aggregateRevision}`,
    );
  }
  return { testedSourceRevision: validationRevision, snapshot, targets };
}

export function preparePreMilestoneBinding(basePath: string, input: string): GateSourceBinding {
  const targets = sourceTargets(basePath);
  const snapshot = stableSnapshot(targets);
  const inputDigest = `sha256:${createHash("sha256").update(input).digest("hex")}`;
  return { inputDigest, repositoryRevision: snapshot.aggregateRevision, snapshot, targets };
}

export function confirmGateSourceIntegrity(
  basePath: string,
  binding: GateSourceBinding,
): { ok: true } | { ok: false; paths: string[]; currentRevision?: string; error?: string } {
  const current = captureVerificationSourceSnapshot(binding.targets);
  if (!current.ok) return { ok: false, paths: [], error: current.error };
  if (!verificationSourceChanged(binding.snapshot, current.snapshot)) return { ok: true };
  const diagnosis = diagnoseMilestoneVerificationSourceDrift(
    basePath,
    loadEffectiveGSDPreferences(basePath)?.preferences,
  );
  return {
    ok: false,
    paths: diagnosis.paths,
    currentRevision: current.snapshot.aggregateRevision,
  };
}

export function captureCurrentAssessmentSourceRevision(basePath: string): string {
  return stableSnapshot(sourceTargets(basePath)).aggregateRevision;
}

export function diagnoseCurrentAssessmentSourceDrift(basePath: string): string[] {
  return diagnoseMilestoneVerificationSourceDrift(
    basePath,
    loadEffectiveGSDPreferences(basePath)?.preferences,
  ).paths;
}
