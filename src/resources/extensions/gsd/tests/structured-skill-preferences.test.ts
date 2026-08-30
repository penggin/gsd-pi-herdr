import test from "node:test";
import assert from "node:assert/strict";
import { validatePreferences } from "../preferences-validation.ts";
import type { GSDPreferences } from "../preferences-types.ts";

test("structured skill matchers validate all supported deterministic dimensions", () => {
  const input: GSDPreferences = {
    skill_rules: [{
      match: {
        all: [{ token: "runtime" }, { phrase: "cross service" }],
        any: [{ workspace: "apps/ytext" }, { unitType: "debug" }],
        none: [{ lifecycle: "documentation" }, { requirementClass: "copy" }, { riskTag: "trivial" }],
      },
      use: ["systematic-debugging"],
    }],
  };
  const validated = validatePreferences(input);
  assert.deepEqual(validated.errors, []);
  assert.deepEqual(validated.preferences.skill_rules, input.skill_rules);
});

test("structured matcher rejects regex, unknown keys, empty atoms and missing actions", () => {
  const invalid = validatePreferences({
    skill_rules: [
      { match: { any: [{ regex: ".*" }] } as any, use: ["bad"] },
      { match: { all: [{ token: "" }] } as any, use: ["bad"] },
      { match: { any: [{ token: "runtime", phrase: "two" }] } as any, use: ["bad"] },
      { match: { any: [{ token: "runtime" }] } },
    ],
  });
  assert.ok(invalid.errors.length >= 4);
  assert.match(invalid.errors.join("\n"), /exactly one supported non-empty matcher/);
  assert.match(invalid.errors.join("\n"), /has no actions/);
});

test("legacy when rules remain accepted without automatic rewrite", () => {
  const input: GSDPreferences = { skill_rules: [{ when: "unit:execute-task fix", use: ["legacy-skill"] }] };
  const validated = validatePreferences(input);
  assert.deepEqual(validated.errors, []);
  assert.deepEqual(validated.preferences.skill_rules, input.skill_rules);
});
