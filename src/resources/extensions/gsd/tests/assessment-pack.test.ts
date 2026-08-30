import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSkills } from "@gsd/pi-coding-agent";
import { listAssessmentGates } from "../assessment-gates/registry.ts";

const root = process.cwd();
const pack = join(root, "packages", "gsd-assessment-pack-gstack");

test("optional pilot pack is discovered through existing Pi skill package semantics", () => {
  const loaded = loadSkills({
    cwd: root,
    agentDir: join(root, ".agent"),
    includeDefaults: false,
    skillPaths: [join(pack, "skills")],
  });
  const gates = listAssessmentGates(loaded.skills);
  assert.deepEqual(gates.map((gate) => [gate.gateId, gate.invocation, gate.lifecycle]), [
    ["gstack-design-review", "suggest", ["pre-milestone"]],
    ["gstack-second-opinion", "manual", ["post-validation"]],
  ]);
  assert.ok(gates.every((gate) => gate.healthy && gate.effect === "report-only"));
  assert.ok(gates.every((gate) => gate.skill.disableModelInvocation));
});

test("optional pack is not a core dependency and its adapters have no provider or mutation runtime", () => {
  const rootPackage = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Record<string, unknown>;
  const corePackage = JSON.parse(readFileSync(join(root, "packages", "pi-coding-agent", "package.json"), "utf8")) as Record<string, unknown>;
  assert.doesNotMatch(JSON.stringify(rootPackage), /gsd-assessment-pack-gstack/);
  assert.doesNotMatch(JSON.stringify(corePackage), /gsd-assessment-pack-gstack/);
  for (const name of ["gstack-design-review", "gstack-second-opinion"]) {
    const body = readFileSync(join(pack, "skills", name, "SKILL.md"), "utf8");
    assert.doesNotMatch(body, /allowed-tools:\s*[\s\S]*(?:Bash|Edit|Write)/);
    assert.doesNotMatch(body, /(?:codex|claude)\s+(?:exec|review|--)/i);
    assert.doesNotMatch(body, /\b(?:commit|push|deploy|create a branch)\b/i);
  }
});
