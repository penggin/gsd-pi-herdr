import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAssessmentFindingsJson,
  redactAssessmentSecrets,
  validateAssessmentFindings,
} from "../assessment-gates/findings-schema.ts";

const expected = {
  runId: "GAR-001",
  gateId: "security-review",
  lifecycle: "post-validation",
  testedSourceRevision: "sha256:abc",
};

function document(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: "gsd.findings/v1",
    runId: expected.runId,
    gateId: expected.gateId,
    lifecycle: expected.lifecycle,
    testedSourceRevision: expected.testedSourceRevision,
    verdict: "needs-attention",
    summary: "One issue needs review.",
    findings: [{
      id: "F001",
      severity: "high",
      category: "authorization",
      title: "Policy bypass",
      description: "The route bypasses the policy service.",
      affectedPaths: ["src/route.ts"],
      evidence: [{ kind: "source", ref: "src/route.ts:42", note: "Direct call." }],
      recommendedAction: "Use the policy service.",
    }],
    ...overrides,
  };
}

test("gsd.findings/v1 accepts a bound structured report", () => {
  const result = validateAssessmentFindings(document(), expected);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.document.findings[0]?.severity, "high");
    assert.equal(result.document.testedSourceRevision, expected.testedSourceRevision);
  }
});

test("actionable findings require evidence and severity is closed", () => {
  const missingEvidence = document({ findings: [{
    id: "F001", severity: "high", category: "security", title: "Issue",
    description: "Issue detail", affectedPaths: [], evidence: [],
  }] });
  const invalidSeverity = document({ findings: [{
    id: "F001", severity: "blocker", category: "security", title: "Issue",
    description: "Issue detail", affectedPaths: [], evidence: [{ kind: "source", ref: "a.ts:1" }],
  }] });
  const first = validateAssessmentFindings(missingEvidence, expected);
  const second = validateAssessmentFindings(invalidSeverity, expected);
  assert.equal(first.ok, false);
  assert.equal(second.ok, false);
  if (!first.ok) assert.match(first.errors.join(" "), /require.*evidence/i);
  if (!second.ok) assert.match(second.errors.join(" "), /severity is invalid/i);
});

test("host-owned identity and revision cannot be substituted", () => {
  const result = validateAssessmentFindings(document({
    runId: "GAR-attacker",
    testedSourceRevision: "different",
  }), expected);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.errors.join(" "), /runId does not match/);
    assert.match(result.errors.join(" "), /testedSourceRevision does not match/);
  }
});

test("prose-wrapped JSON is rejected rather than treated as success", () => {
  const result = parseAssessmentFindingsJson(`Here is the report:\n${JSON.stringify(document())}`, expected);
  assert.equal(result.ok, false);
});

test("unknown document, finding, and evidence fields are rejected", () => {
  const base = document();
  const baseFinding = (base.findings as Array<Record<string, unknown>>)[0]!;
  const baseEvidence = (baseFinding.evidence as Array<Record<string, unknown>>)[0]!;
  const documentResult = validateAssessmentFindings({ ...base, extra: true }, expected);
  assert.equal(documentResult.ok, false);
  assert.match(documentResult.ok ? "" : documentResult.errors.join("\n"), /result\.extra is not allowed/);

  const findingResult = validateAssessmentFindings({
    ...base,
    findings: [{ ...baseFinding, extra: true }],
  }, expected);
  assert.equal(findingResult.ok, false);
  assert.match(findingResult.ok ? "" : findingResult.errors.join("\n"), /findings\[0\]\.extra is not allowed/);

  const evidenceResult = validateAssessmentFindings({
    ...base,
    findings: [{
      ...baseFinding,
      evidence: [{ ...baseEvidence, extra: true }],
    }],
  }, expected);
  assert.equal(evidenceResult.ok, false);
  assert.match(evidenceResult.ok ? "" : evidenceResult.errors.join("\n"), /evidence\[0\]\.extra is not allowed/);
});

test("finding text and diagnostics redact common credentials", () => {
  const token = "ghp_abcdefghijklmnopqrstuvwxyz123456";
  const result = validateAssessmentFindings(document({ summary: `token=${token}` }), expected);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.document.summary.includes(token), false);
  assert.equal(redactAssessmentSecrets(`Authorization: Bearer ${token}`).includes(token), false);
});
