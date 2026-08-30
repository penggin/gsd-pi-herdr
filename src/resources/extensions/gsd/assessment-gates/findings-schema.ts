import type {
  AssessmentEvidenceKind,
  AssessmentFinding,
  AssessmentFindingsDocument,
  AssessmentSeverity,
} from "./types.js";

const SEVERITIES = new Set<AssessmentSeverity>(["critical", "high", "medium", "low", "info"]);
const EVIDENCE_KINDS = new Set<AssessmentEvidenceKind>([
  "source", "diff", "command", "browser", "screenshot", "network",
  "console", "artifact", "runtime-log",
]);
const VERDICTS = new Set(["pass", "needs-attention", "inconclusive"]);
const DOCUMENT_KEYS = new Set([
  "schemaVersion", "runId", "gateId", "lifecycle", "testedSourceRevision",
  "inputDigest", "verdict", "summary", "findings",
]);
const FINDING_KEYS = new Set([
  "id", "severity", "category", "title", "description", "affectedPaths",
  "evidence", "recommendedAction",
]);
const EVIDENCE_KEYS = new Set(["kind", "ref", "note"]);
const SECRET_PATTERNS = [
  /\b(?:sk|rk|pk)-[a-z0-9_-]{16,}\b/gi,
  /\bgh[opsu]_[a-z0-9]{20,}\b/gi,
  /\b(?:bearer|authorization)\s*[:=]\s*[^\s,;]+/gi,
  /\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi,
];

export function redactAssessmentSecrets(value: string): string {
  return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, "[REDACTED]"), value);
}

function object(value: unknown, path: string, errors: string[]): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  errors: string[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${path}.${key} is not allowed`);
  }
}

function string(value: unknown, path: string, errors: string[], required = true): string | undefined {
  if (typeof value !== "string" || (required && value.trim().length === 0)) {
    errors.push(`${path} must be a non-empty string`);
    return undefined;
  }
  return redactAssessmentSecrets(value);
}

function finding(value: unknown, index: number, errors: string[]): AssessmentFinding | undefined {
  const path = `findings[${index}]`;
  const raw = object(value, path, errors);
  if (!raw) return undefined;
  rejectUnknownKeys(raw, FINDING_KEYS, path, errors);
  const id = string(raw.id, `${path}.id`, errors);
  const severity = raw.severity;
  if (typeof severity !== "string" || !SEVERITIES.has(severity as AssessmentSeverity)) {
    errors.push(`${path}.severity is invalid`);
  }
  const category = string(raw.category, `${path}.category`, errors);
  const title = string(raw.title, `${path}.title`, errors);
  const description = string(raw.description, `${path}.description`, errors);
  if (!Array.isArray(raw.affectedPaths) || raw.affectedPaths.some((entry) => typeof entry !== "string")) {
    errors.push(`${path}.affectedPaths must be a string array`);
  }
  if (!Array.isArray(raw.evidence)) {
    errors.push(`${path}.evidence must be an array`);
  }
  const evidence = Array.isArray(raw.evidence) ? raw.evidence.flatMap((item, evidenceIndex) => {
    const evidenceRaw = object(item, `${path}.evidence[${evidenceIndex}]`, errors);
    if (!evidenceRaw) return [];
    rejectUnknownKeys(evidenceRaw, EVIDENCE_KEYS, `${path}.evidence[${evidenceIndex}]`, errors);
    const kind = evidenceRaw.kind;
    if (typeof kind !== "string" || !EVIDENCE_KINDS.has(kind as AssessmentEvidenceKind)) {
      errors.push(`${path}.evidence[${evidenceIndex}].kind is invalid`);
      return [];
    }
    const ref = string(evidenceRaw.ref, `${path}.evidence[${evidenceIndex}].ref`, errors);
    const note = evidenceRaw.note === undefined
      ? undefined
      : string(evidenceRaw.note, `${path}.evidence[${evidenceIndex}].note`, errors);
    return ref ? [{ kind: kind as AssessmentEvidenceKind, ref, ...(note ? { note } : {}) }] : [];
  }) : [];
  if (severity !== "info" && evidence.length === 0) {
    errors.push(`${path} actionable findings require at least one evidence reference`);
  }
  const recommendedAction = raw.recommendedAction === undefined
    ? undefined
    : string(raw.recommendedAction, `${path}.recommendedAction`, errors);
  if (!id || !SEVERITIES.has(severity as AssessmentSeverity) || !category || !title || !description) return undefined;
  return {
    id,
    severity: severity as AssessmentSeverity,
    category,
    title,
    description,
    affectedPaths: Array.isArray(raw.affectedPaths)
      ? raw.affectedPaths.map((entry) => redactAssessmentSecrets(String(entry)))
      : [],
    evidence,
    ...(recommendedAction ? { recommendedAction } : {}),
  };
}

export type FindingsValidationResult =
  | { ok: true; document: AssessmentFindingsDocument }
  | { ok: false; errors: string[] };

export function validateAssessmentFindings(
  value: unknown,
  expected: { runId: string; gateId: string; lifecycle: string; testedSourceRevision?: string; inputDigest?: string },
): FindingsValidationResult {
  const errors: string[] = [];
  const raw = object(value, "result", errors);
  if (!raw) return { ok: false, errors };
  rejectUnknownKeys(raw, DOCUMENT_KEYS, "result", errors);
  if (raw.schemaVersion !== "gsd.findings/v1") errors.push("schemaVersion must be gsd.findings/v1");
  if (raw.runId !== expected.runId) errors.push("runId does not match the host-owned run");
  if (raw.gateId !== expected.gateId) errors.push("gateId does not match the selected gate");
  if (raw.lifecycle !== expected.lifecycle) errors.push("lifecycle does not match the approved placement");
  if (expected.testedSourceRevision && raw.testedSourceRevision !== expected.testedSourceRevision) {
    errors.push("testedSourceRevision does not match the validated source revision");
  }
  if (expected.inputDigest && raw.inputDigest !== expected.inputDigest) {
    errors.push("inputDigest does not match the host-owned input digest");
  }
  if (typeof raw.verdict !== "string" || !VERDICTS.has(raw.verdict)) errors.push("verdict is invalid");
  const summary = string(raw.summary, "summary", errors);
  if (!Array.isArray(raw.findings)) errors.push("findings must be an array");
  const findings = Array.isArray(raw.findings)
    ? raw.findings.flatMap((entry, index) => finding(entry, index, errors) ?? [])
    : [];
  if (errors.length > 0 || !summary) return { ok: false, errors };
  return {
    ok: true,
    document: {
      schemaVersion: "gsd.findings/v1",
      runId: expected.runId,
      gateId: expected.gateId,
      lifecycle: expected.lifecycle as AssessmentFindingsDocument["lifecycle"],
      ...(expected.testedSourceRevision ? { testedSourceRevision: expected.testedSourceRevision } : {}),
      ...(expected.inputDigest ? { inputDigest: expected.inputDigest } : {}),
      verdict: raw.verdict as AssessmentFindingsDocument["verdict"],
      summary,
      findings,
    },
  };
}

export function parseAssessmentFindingsJson(
  output: string,
  expected: Parameters<typeof validateAssessmentFindings>[1],
): FindingsValidationResult {
  try {
    return validateAssessmentFindings(JSON.parse(output), expected);
  } catch (error) {
    return { ok: false, errors: [`output is not valid JSON: ${error instanceof Error ? error.message : String(error)}`] };
  }
}
