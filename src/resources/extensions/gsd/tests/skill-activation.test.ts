import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadSkills } from "@gsd/pi-coding-agent";
import {
  buildCompleteSlicePrompt,
  buildPlanMilestonePrompt,
  buildResearchMilestonePrompt,
  buildSkillActivationBlock,
} from "../auto-prompts.js";
import { warnIfManifestHasMissingSkills } from "../skill-manifest.js";
import { _resetLogs, drainLogs, setStderrLoggingEnabled } from "../workflow-logger.js";
import type { GSDPreferences } from "../preferences.js";
import { createWorkspace, scopeMilestone } from "../workspace.js";

function makeTempBase(): string {
  return mkdtempSync(join(tmpdir(), "gsd-skill-activation-"));
}

function cleanup(base: string): void {
  rmSync(base, { recursive: true, force: true });
}

function writeSkill(base: string, name: string, description: string): void {
  const dir = join(base, "skills", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`);
}

function writeGate(
  base: string,
  name: string,
  description: string,
  lifecycle: "pre-milestone" | "post-validation",
): void {
  const dir = join(base, "skills", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    "gsd:",
    "  kind: assessment-gate",
    "  invocation: suggest",
    "  lifecycle:",
    `    - ${lifecycle}`,
    "  effect: report-only",
    `  revisionBinding: ${lifecycle === "post-validation" ? "required" : "optional"}`,
    "  resultSchema: gsd.findings/v1",
    "  capabilities:",
    "    - repository.read",
    "---",
    "",
    "SECRET GATE BODY MUST NOT APPEAR IN NORMAL PROMPTS.",
  ].join("\n"));
}

function loadOnlyTestSkills(base: string): void {
  loadSkills({
    cwd: base,
    agentDir: join(base, ".agent"),
    includeDefaults: false,
    skillPaths: [join(base, "skills")],
  });
}

function writeProjectPreferences(base: string, preferences: string): void {
  mkdirSync(join(base, ".gsd"), { recursive: true });
  writeFileSync(join(base, ".gsd", "PREFERENCES.md"), `---\n${preferences}---\n`);
}

function buildBlock(
  base: string,
  params: Partial<Parameters<typeof buildSkillActivationBlock>[0]> = {},
  preferences: GSDPreferences = {},
): string {
  return buildSkillActivationBlock({
    base,
    milestoneId: "M001",
    sliceId: "S01",
    ...params,
    preferences,
  });
}

function expectedSkillRead(base: string, name: string): string {
  return `Read the skill file at \`${join(base, "skills", name, "SKILL.md")}\``;
}

test("buildSkillActivationBlock does not auto-activate skills via broad context heuristic", () => {
  const base = makeTempBase();
  try {
    writeSkill(base, "react", "Use for React components, hooks, JSX, and frontend UI work.");
    writeSkill(base, "swiftui", "Use for SwiftUI views, iOS layout, and Apple platform UI work.");
    loadOnlyTestSkills(base);

    const result = buildBlock(base, {
      sliceTitle: "Build React dashboard",
      taskId: "T01",
      taskTitle: "Implement React settings panel",
    });

    // Skills should not be activated just because their name appears in task context.
    // Activation requires explicit preference sources (always_use, skill_rules, prefer_skills, skills_used).
    assert.equal(result, "");
  } finally {
    cleanup(base);
  }
});

test("buildSkillActivationBlock activates skills via prefer_skills when context matches", () => {
  const base = makeTempBase();
  try {
    writeSkill(base, "react", "Use for React components, hooks, JSX, and frontend UI work.");
    writeSkill(base, "swiftui", "Use for SwiftUI views, iOS layout, and Apple platform UI work.");
    loadOnlyTestSkills(base);

    const result = buildBlock(base, {
      sliceTitle: "Build React dashboard",
      taskId: "T01",
      taskTitle: "Implement React settings panel",
    }, {
      prefer_skills: ["react"],
    });

    assert.ok(result.includes(expectedSkillRead(base, "react")));
    assert.doesNotMatch(result, /swiftui/);
  } finally {
    cleanup(base);
  }
});

test("buildSkillActivationBlock includes always_use_skills using read-based skill loading", () => {
  const base = makeTempBase();
  try {
    writeSkill(base, "swift-testing", "Use for Swift Testing assertions and verification patterns.");
    loadOnlyTestSkills(base);

    const result = buildBlock(base, { taskTitle: "Unrelated task title" }, {
      always_use_skills: ["swift-testing"],
    });

    assert.equal(
      result,
      `<skill_activation>Read the skill file at \`${join(base, "skills", "swift-testing", "SKILL.md")}\`.</skill_activation>`,
    );
  } finally {
    cleanup(base);
  }
});

test("buildSkillActivationBlock includes skill_rules matches and task-plan skills_used", () => {
  const base = makeTempBase();
  try {
    writeSkill(base, "prisma", "Use for Prisma schema, migrations, and ORM queries.");
    writeSkill(base, "accessibility", "Use for accessibility, aria attributes, and keyboard support.");
    loadOnlyTestSkills(base);

    const taskPlan = [
      "---",
      "skills_used:",
      "  - accessibility",
      "---",
      "# T01: Example",
    ].join("\n");

    const result = buildBlock(base, {
      taskTitle: "Update prisma schema",
      taskPlanContent: taskPlan,
    }, {
      skill_rules: [{ when: "prisma database schema", use: ["prisma"] }],
    });

    assert.ok(result.includes(expectedSkillRead(base, "accessibility")));
    assert.ok(result.includes(expectedSkillRead(base, "prisma")));
  } finally {
    cleanup(base);
  }
});

test("buildSkillActivationBlock matches skill_rules against exact unit type context", () => {
  const base = makeTempBase();
  try {
    writeSkill(base, "complete-slice-policies", "Use for complete-slice closeout policy checks.");
    writeSkill(base, "slice-broad", "Use for broad slice work.");
    loadOnlyTestSkills(base);

    const result = buildBlock(base, {
      unitType: "complete-slice",
    }, {
      skill_rules: [
        { when: "complete-slice", use: ["complete-slice-policies"] },
        { when: "slice", use: ["slice-broad"] },
      ],
    });

    assert.ok(result.includes(expectedSkillRead(base, "complete-slice-policies")));
    assert.doesNotMatch(result, /slice-broad/);
  } finally {
    cleanup(base);
  }
});

test("buildSkillActivationBlock honors avoid_skills against always_use_skills", () => {
  const base = makeTempBase();
  try {
    writeSkill(base, "react", "Use for React components and frontend UI work.");
    loadOnlyTestSkills(base);

    const result = buildBlock(base, {
      taskTitle: "Implement React settings panel",
    }, {
      always_use_skills: ["react"],
      avoid_skills: ["react"],
    });

    assert.equal(result, "");
  } finally {
    cleanup(base);
  }
});

test("buildSkillActivationBlock falls back cleanly when nothing matches", () => {
  const base = makeTempBase();
  try {
    writeSkill(base, "swiftui", "Use for SwiftUI apps.");
    loadOnlyTestSkills(base);

    const result = buildBlock(base, {
      taskTitle: "Plain text docs task",
    });

    assert.equal(result, "");
  } finally {
    cleanup(base);
  }
});

test("buildSkillActivationBlock does not activate skills from extraContext or taskPlanContent body", () => {
  const base = makeTempBase();
  try {
    writeSkill(base, "xcode-build", "Use for Xcode build workflows and iOS compilation.");
    writeSkill(base, "ableton-lom", "Use for Ableton Live Object Model scripting.");
    writeSkill(base, "frontend-design", "Use for frontend design systems and UI components.");
    loadOnlyTestSkills(base);

    const taskPlan = [
      "---",
      "skills_used: []",
      "---",
      "# T01: Build the API endpoint",
      "Use xcode-build patterns and frontend-design tokens.",
    ].join("\n");

    const result = buildBlock(base, {
      taskTitle: "Build REST API",
      extraContext: ["Build workflow for iOS and Ableton integration testing"],
      taskPlanContent: taskPlan,
    });

    // None of these skills should activate — extraContext and taskPlanContent body
    // must not be used for heuristic matching.
    assert.equal(result, "");
  } finally {
    cleanup(base);
  }
});

test("buildSkillActivationBlock rejects skill names with special characters", () => {
  const base = makeTempBase();
  try {
    // Skill names with quotes, braces, or other non-alphanumeric characters are
    // rejected by the SAFE_SKILL_NAME guard to prevent prompt injection.
    writeSkill(base, "my-skill's", "Skill with apostrophe in name.");
    loadOnlyTestSkills(base);

    const result = buildBlock(base, {}, {
      always_use_skills: ["my-skill's"],
    });

    // Unsafe skill name is filtered out — empty result
    assert.equal(result, "");
  } finally {
    cleanup(base);
  }
});

test("buildSkillActivationBlock allows valid skill names and rejects invalid ones", () => {
  const base = makeTempBase();
  try {
    writeSkill(base, "react", "React skill.");
    writeSkill(base, "bad'name", "Injection attempt.");
    writeSkill(base, "good-skill-2", "Another valid skill.");
    loadOnlyTestSkills(base);

    const result = buildBlock(base, {}, {
      always_use_skills: ["react", "bad'name", "good-skill-2"],
    });

    assert.match(result, /skill_activation/);
    assert.ok(result.includes(expectedSkillRead(base, "react")));
    assert.ok(result.includes(expectedSkillRead(base, "good-skill-2")));
    assert.doesNotMatch(result, /bad'name/);
  } finally {
    cleanup(base);
  }
});

// ─── Per-unit-type skill manifest (RFC #4779) ─────────────────────────────────

test("buildSkillActivationBlock: explicit always_use_skills bypass the unit-type manifest", () => {
  const base = makeTempBase();
  try {
    // write-docs is in the research-milestone manifest; swiftui is not.
    // Both are in always_use_skills — a user-explicit source — so BOTH
    // should activate regardless of the manifest. User intent wins over
    // unit-type defaults. See RFC #4779 and skill-manifest.ts rationale.
    writeSkill(base, "write-docs", "Use when writing docs or RFCs.");
    writeSkill(base, "swiftui", "Use for SwiftUI views.");
    loadOnlyTestSkills(base);

    const result = buildBlock(base, { unitType: "research-milestone" }, {
      always_use_skills: ["write-docs", "swiftui"],
    });

    assert.ok(result.includes(expectedSkillRead(base, "write-docs")));
    assert.ok(result.includes(expectedSkillRead(base, "swiftui")));
  } finally {
    cleanup(base);
  }
});

test("buildSkillActivationBlock falls through to all skills for unknown unit type", () => {
  const base = makeTempBase();
  try {
    writeSkill(base, "swiftui", "Use for SwiftUI views.");
    loadOnlyTestSkills(base);

    const result = buildBlock(base, { unitType: "unknown-unit-type" }, {
      always_use_skills: ["swiftui"],
    });

    // Unknown unit type = wildcard fallback (pre-manifest behavior).
    assert.ok(result.includes(expectedSkillRead(base, "swiftui")));
  } finally {
    cleanup(base);
  }
});

test("buildSkillActivationBlock without unitType preserves pre-manifest behavior", () => {
  const base = makeTempBase();
  try {
    writeSkill(base, "swiftui", "Use for SwiftUI views.");
    loadOnlyTestSkills(base);

    // No unitType param — filter should no-op.
    const result = buildBlock(base, {}, {
      always_use_skills: ["swiftui"],
    });

    assert.ok(result.includes(expectedSkillRead(base, "swiftui")));
  } finally {
    cleanup(base);
  }
});

test("milestone prompt builders propagate always_use_skills through buildSkillActivationBlock", async () => {
  const base = makeTempBase();
  try {
    // Both skills are in always_use_skills — explicit user intent bypasses
    // the unit-type manifest, so both activate in both milestone flows.
    writeSkill(base, "write-docs", "Use when writing docs or RFCs.");
    writeSkill(base, "swiftui", "Use for SwiftUI views.");
    writeProjectPreferences(base, "always_use_skills:\n  - write-docs\n  - swiftui\n");
    loadOnlyTestSkills(base);

    const researchPrompt = await buildResearchMilestonePrompt("M001", "Test", base);
    assert.ok(researchPrompt.includes(expectedSkillRead(base, "write-docs")));
    assert.ok(researchPrompt.includes(expectedSkillRead(base, "swiftui")));

    const planPrompt = await buildPlanMilestonePrompt("M001", "Test", base, scopeMilestone(createWorkspace(base), "M001"));
    assert.ok(planPrompt.includes(expectedSkillRead(base, "write-docs")));
    assert.ok(planPrompt.includes(expectedSkillRead(base, "swiftui")));
  } finally {
    cleanup(base);
  }
});

test("complete-slice prompt propagates always_use_skills through buildSkillActivationBlock", async () => {
  const base = makeTempBase();
  try {
    writeSkill(base, "write-docs", "Use when writing docs or RFCs.");
    writeProjectPreferences(base, "always_use_skills:\n  - write-docs\n");
    loadOnlyTestSkills(base);

    const milestoneDir = join(base, ".gsd", "milestones", "M001");
    const sliceDir = join(milestoneDir, "slices", "S01");
    mkdirSync(sliceDir, { recursive: true });
    writeFileSync(
      join(milestoneDir, "M001-ROADMAP.md"),
      [
        "# M001: Test",
        "",
        "## Slices",
        "",
        "- [ ] **S01: Slice** `risk:low` `depends:[]`",
        "",
      ].join("\n"),
    );
    writeFileSync(join(sliceDir, "S01-PLAN.md"), "# S01: Slice\n\n## Tasks\n\n- [x] **T01: Done**\n");

    const prompt = await buildCompleteSlicePrompt("M001", "Test", "S01", "Slice", base);

    assert.ok(prompt.includes(expectedSkillRead(base, "write-docs")));
  } finally {
    cleanup(base);
  }
});

test("skill manifest strict warnings require GSD_SKILL_MANIFEST_STRICT=1", (t) => {
  const previousStrict = process.env.GSD_SKILL_MANIFEST_STRICT;
  const previousStderr = setStderrLoggingEnabled(false);
  t.after(() => {
    if (previousStrict === undefined) {
      delete process.env.GSD_SKILL_MANIFEST_STRICT;
    } else {
      process.env.GSD_SKILL_MANIFEST_STRICT = previousStrict;
    }
    setStderrLoggingEnabled(previousStderr);
    _resetLogs();
  });

  process.env.GSD_SKILL_MANIFEST_STRICT = "0";
  _resetLogs();
  warnIfManifestHasMissingSkills("research-milestone", new Set());
  assert.equal(drainLogs().length, 0, "strict=0 must preserve silent behavior");

  process.env.GSD_SKILL_MANIFEST_STRICT = "1";
  _resetLogs();
  warnIfManifestHasMissingSkills("research-milestone", new Set());
  const logs = drainLogs();
  assert.ok(
    logs.some(log => log.message.includes("skill-manifest: references uninstalled skill")),
    "strict=1 should warn about missing manifest entries",
  );
});

test("structured skill matcher covers the fixed A-E policy scenarios", () => {
  const base = makeTempBase();
  try {
    for (const name of ["systematic-debugging", "conditional-tdd", "verification-discipline", "superpowers"]) {
      writeSkill(base, name, `${name} methodology`);
    }
    writeGate(base, "staging-qa", "Report-only staging QA assessment after validation", "post-validation");
    loadOnlyTestSkills(base);
    const preferences: GSDPreferences = {
      skill_rules: [
        { match: { any: [{ token: "truncated" }, { token: "regression" }] }, use: ["systematic-debugging"] },
        { match: { all: [{ token: "reproducible" }, { token: "regression" }] }, use: ["conditional-tdd"] },
        { match: { any: [{ token: "regression" }] }, use: ["verification-discipline"] },
      ],
    };

    const a = buildBlock(base, { taskTitle: "ytext generated WebM file is sometimes truncated" }, preferences);
    assert.ok(a.includes(expectedSkillRead(base, "systematic-debugging")), "A activates systematic debugging");

    const b = buildBlock(base, { taskTitle: "redesign the landing page" }, preferences);
    assert.equal(b, "", "B does not activate debugging or TDD");

    const c = buildBlock(base, {
      taskTitle: "premium entitlement calculation has a reproducible regression",
    }, preferences);
    assert.ok(c.includes(expectedSkillRead(base, "systematic-debugging")));
    assert.ok(c.includes(expectedSkillRead(base, "conditional-tdd")));
    assert.ok(c.includes(expectedSkillRead(base, "verification-discipline")));

    const d = buildBlock(base, {
      unitType: "complete-milestone",
      milestoneTitle: "validation completed and staging needs QA",
    }, preferences);
    assert.doesNotMatch(d, /superpowers/);
    assert.match(d, /<assessment_gate_suggestions/);
    assert.match(d, /<name>staging-qa<\/name>/);
    assert.doesNotMatch(d, /SECRET GATE BODY/);

    const e = buildBlock(base, { unitType: "quick", taskTitle: "fix one README typo" }, preferences);
    assert.equal(e, "", "E is trivial and activates no specialist skill or gate");
  } finally {
    cleanup(base);
  }
});

test("structured token matcher never uses substring matches", () => {
  const base = makeTempBase();
  try {
    writeSkill(base, "specialist", "A specialist method.");
    loadOnlyTestSkills(base);
    const words = ["media", "remediation", "task", "fix", "test", "deterministic"];
    const preferences: GSDPreferences = {
      skill_rules: words.map((token) => ({ match: { any: [{ token }] }, use: ["specialist"] })),
    };
    for (const title of [
      "multimedia playback",
      "premedication schedule",
      "multitasking layout",
      "prefix parser",
      "contest entry",
      "nondeterministically rendered output",
    ]) {
      assert.equal(buildBlock(base, { taskTitle: title }, preferences), "", title);
    }
    assert.ok(buildBlock(base, { taskTitle: "deterministic output" }, preferences).includes("specialist"));
  } finally {
    cleanup(base);
  }
});

test("structured phrase matcher requires a normalized consecutive word sequence", () => {
  const base = makeTempBase();
  try {
    writeSkill(base, "phrase-policy", "Phrase policy.");
    loadOnlyTestSkills(base);
    const preferences: GSDPreferences = {
      skill_rules: [{ match: { any: [{ phrase: "test media" }] }, use: ["phrase-policy"] }],
    };
    assert.equal(buildBlock(base, { taskTitle: "contest multimedia parser" }, preferences), "");
    assert.ok(buildBlock(base, { taskTitle: "Test-media output" }, preferences).includes("phrase-policy"));
    assert.equal(buildBlock(base, { taskTitle: "test generated media output" }, preferences), "");
  } finally {
    cleanup(base);
  }
});

test("structured matcher supports workspace, unit type, lifecycle, risk and none", () => {
  const base = makeTempBase();
  try {
    writeSkill(base, "targeted-policy", "Targeted policy.");
    loadOnlyTestSkills(base);
    const preferences: GSDPreferences = {
      skill_rules: [{
        match: {
          all: [
            { workspace: "apps/ytext" },
            { unitType: "execute-task" },
            { lifecycle: "implementation" },
            { requirementClass: "security" },
            { riskTag: "high" },
            { phrase: "cross service" },
          ],
          none: [{ token: "documentation" }],
        },
        use: ["targeted-policy"],
      }],
    };
    const match = buildBlock(base, {
      taskTitle: "Fix cross-service authorization",
      workspaces: ["apps/ytext/src"],
      unitType: "execute-task",
      lifecycle: "implementation",
      requirementClasses: ["security"],
      riskTags: ["high"],
    }, preferences);
    assert.ok(match.includes("targeted-policy"));
    const excluded = buildBlock(base, {
      taskTitle: "Documentation for cross-service authorization",
      workspaces: ["apps/ytext"],
      unitType: "execute-task",
      lifecycle: "implementation",
      requirementClasses: ["security"],
      riskTags: ["high"],
    }, preferences);
    assert.equal(excluded, "");
  } finally {
    cleanup(base);
  }
});
