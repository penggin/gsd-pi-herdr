import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSkills } from "@gsd/pi-coding-agent";
import {
  findAssessmentGate,
  listAssessmentGates,
  listSuggestibleAssessmentGates,
} from "../assessment-gates/registry.ts";
import { buildAssessmentGateSuggestionBlock } from "../assessment-gates/suggestions.ts";

function write(base: string, name: string, frontmatter: string, body: string): void {
  const dir = join(base, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} staging security review\n${frontmatter}---\n${body}\n`);
}

test("gate catalogs separate suggest, manual, ordinary, and invalid metadata", () => {
  const base = mkdtempSync(join(tmpdir(), "gsd-gate-registry-"));
  try {
    const gate = (invocation: string) => [
      "gsd:",
      "  kind: assessment-gate",
      `  invocation: ${invocation}`,
      "  lifecycle: [post-validation]",
      "  effect: report-only",
      "  revisionBinding: required",
      "  resultSchema: gsd.findings/v1",
      "  capabilities: [repository.read]",
      "",
    ].join("\n");
    write(base, "suggest-gate", gate("suggest"), "SUGGEST SECRET BODY");
    write(base, "manual-gate", gate("manual"), "MANUAL SECRET BODY");
    write(base, "ordinary", "", "ordinary body");
    write(base, "invalid-gate", gate("auto"), "invalid body");
    const result = loadSkills({ cwd: base, agentDir: join(base, ".agent"), includeDefaults: false, skillPaths: [base] });

    assert.deepEqual(listAssessmentGates(result.skills).map((entry) => entry.gateId), ["invalid-gate", "manual-gate", "suggest-gate"]);
    assert.deepEqual(listSuggestibleAssessmentGates(result.skills).map((entry) => entry.gateId), ["suggest-gate"]);
    assert.equal(findAssessmentGate("invalid-gate", result.skills)?.healthy, false);
    const suggestion = buildAssessmentGateSuggestionBlock({
      lifecycle: "post-validation",
      scopeId: "M001",
      context: "validation completed and staging security review is needed",
      skills: result.skills,
    });
    assert.match(suggestion, /suggest-gate/);
    assert.doesNotMatch(suggestion, /manual-gate/);
    assert.doesNotMatch(suggestion, /SECRET BODY/);
    assert.match(suggestion, /never run them automatically/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
