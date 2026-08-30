import type {
  GsdAssessmentCapability,
  GsdSkillInvocation,
  GsdSkillLifecycle,
} from "@gsd/pi-coding-agent";

export type AssessmentRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "inconclusive"
  | "cancelled"
  | "stale"
  | "policy-violation";

export type AssessmentVerdict = "pass" | "needs-attention" | "inconclusive";
export type AssessmentSeverity = "critical" | "high" | "medium" | "low" | "info";
export type AssessmentEvidenceKind =
  | "source"
  | "diff"
  | "command"
  | "browser"
  | "screenshot"
  | "network"
  | "console"
  | "artifact"
  | "runtime-log";

export interface EvidenceRef {
  kind: AssessmentEvidenceKind;
  ref: string;
  note?: string;
}

export interface AssessmentFinding {
  id: string;
  severity: AssessmentSeverity;
  category: string;
  title: string;
  description: string;
  affectedPaths: string[];
  evidence: EvidenceRef[];
  recommendedAction?: string;
}

export interface AssessmentFindingsDocument {
  schemaVersion: "gsd.findings/v1";
  runId: string;
  gateId: string;
  lifecycle: GsdSkillLifecycle;
  testedSourceRevision?: string;
  inputDigest?: string;
  verdict: AssessmentVerdict;
  summary: string;
  findings: AssessmentFinding[];
}

export interface AssessmentRun {
  runId: string;
  gateId: string;
  gateVersion?: string;
  scope: { projectId?: string; milestoneId?: string; sliceId?: string };
  lifecycle: GsdSkillLifecycle;
  effect: "report-only";
  status: AssessmentRunStatus;
  verdict?: AssessmentVerdict;
  testedSourceRevision?: string;
  inputDigest?: string;
  repositoryRevision?: string;
  startedAt: string;
  completedAt?: string;
  summary: string;
  findings: AssessmentFinding[];
  evidenceRefs: EvidenceRef[];
  toolProfile: GsdAssessmentCapability[];
  blockedCapabilities: string[];
  targetUrl?: string;
  failureReason?: string;
  invocationReason: string;
  approval?: { approved: true; approvedAt: string; method: "interactive" | "explicit-command" };
  model?: string;
  provider?: string;
  sourceSnapshot?: unknown;
  sourceDriftPaths: string[];
  policyViolations: string[];
  rawDiagnosticRef?: string;
  projectionPath?: string;
}

export interface AssessmentGateDescriptor {
  gateId: string;
  gateVersion?: string;
  description: string;
  filePath: string;
  source: string;
  invocation: Exclude<GsdSkillInvocation, "auto">;
  lifecycle: GsdSkillLifecycle[];
  capabilities: GsdAssessmentCapability[];
  revisionBinding?: "required" | "optional";
  resultSchema: "gsd.findings/v1";
  effect: "report-only";
  diagnostics: string[];
  healthy: boolean;
}

export interface GateRecommendationDisposition {
  gateId: string;
  scopeId: string;
  status: "accepted" | "declined" | "suppressed";
  recordedAt: string;
}
