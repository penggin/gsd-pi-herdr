// Project/App: gsd-pi
// File Purpose: Canonical DB schema for optional, report-only Assessment Gates.

import type { DbAdapter } from "./db-adapter.js";

export function createAssessmentGateSchemaV49(db: DbAdapter): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS assessment_runs (
      run_id TEXT PRIMARY KEY,
      gate_id TEXT NOT NULL,
      gate_version TEXT,
      project_id TEXT,
      milestone_id TEXT,
      slice_id TEXT,
      lifecycle TEXT NOT NULL CHECK (lifecycle IN ('pre-milestone', 'post-validation')),
      effect TEXT NOT NULL CHECK (effect = 'report-only'),
      status TEXT NOT NULL CHECK (status IN (
        'pending', 'running', 'completed', 'failed', 'inconclusive',
        'cancelled', 'stale', 'policy-violation'
      )),
      verdict TEXT CHECK (verdict IS NULL OR verdict IN ('pass', 'needs-attention', 'inconclusive')),
      tested_source_revision TEXT,
      input_digest TEXT,
      repository_revision TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      summary TEXT NOT NULL DEFAULT '',
      findings_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(findings_json)),
      evidence_refs_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(evidence_refs_json)),
      tool_profile_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tool_profile_json)),
      blocked_capabilities_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(blocked_capabilities_json)),
      target_url TEXT,
      failure_reason TEXT,
      invocation_reason TEXT NOT NULL DEFAULT '',
      approval_json TEXT CHECK (approval_json IS NULL OR json_valid(approval_json)),
      model TEXT,
      provider TEXT,
      source_snapshot_json TEXT CHECK (source_snapshot_json IS NULL OR json_valid(source_snapshot_json)),
      source_drift_paths_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(source_drift_paths_json)),
      policy_violations_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(policy_violations_json)),
      raw_diagnostic_ref TEXT,
      projection_path TEXT,
      updated_at TEXT NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS gate_recommendation_dispositions (
      gate_id TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('accepted', 'declined', 'suppressed')),
      recorded_at TEXT NOT NULL,
      PRIMARY KEY (gate_id, scope_id)
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_assessment_runs_scope ON assessment_runs(milestone_id, slice_id, started_at)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_assessment_runs_gate ON assessment_runs(gate_id, started_at)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_assessment_runs_status ON assessment_runs(status, started_at)");
}

export function applyMigrationV49AssessmentGates(db: DbAdapter): void {
  createAssessmentGateSchemaV49(db);
}
