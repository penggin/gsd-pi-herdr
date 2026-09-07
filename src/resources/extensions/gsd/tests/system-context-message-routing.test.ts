// Project/App: gsd-pi
// File Purpose: Regression coverage for volatile system-context message routing.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildContextMessage,
  buildSubagentModelInstruction,
  GSD_CONTEXT_MESSAGE_SENTINEL,
  stripVolatileCodebaseMetadata,
} from "../bootstrap/system-context.ts";

const SENTINEL = `${GSD_CONTEXT_MESSAGE_SENTINEL}\n`;

describe("configured interactive subagent model and thinking", () => {
  const cases = [
    {
      name: "inline Astra medium overrides the older high thinking block",
      lines: ["models:", "  subagent:", "    model: gsd-fable/gpt-6-astra", "    thinking: medium", "    fallbacks:", "      - gsd-sonnet/gpt-5.6-luna", "thinking:", "  subagent: high"],
      model: "gsd-fable/gpt-6-astra", thinking: "medium",
    },
    {
      name: "GLM keeps the separately configured max effort",
      lines: ["models:", "  subagent: gsd-sonnet/zai/glm-5.3-flash", "thinking:", "  subagent: max"],
      model: "gsd-sonnet/zai/glm-5.3-flash", thinking: "max",
    },
    {
      name: "model-only settings do not invent an effort",
      lines: ["models:", "  subagent: gsd-sonnet/gpt-5.6-luna"],
      model: "gsd-sonnet/gpt-5.6-luna", thinking: undefined,
    },
    {
      name: "an explicit off effort is preserved",
      lines: ["models:", "  subagent:", "    model: custom/model", "    thinking: off"],
      model: "custom/model", thinking: "off",
    },
    {
      name: "thinking without a model does not add a model instruction",
      lines: ["thinking:", "  subagent: medium"],
      model: undefined, thinking: undefined,
    },
  ];
  for (const fixture of cases) {
    test(fixture.name, () => {
      const originalHome = process.env.GSD_HOME;
      const root = mkdtempSync(join(tmpdir(), "gsd-subagent-instruction-"));
      const project = join(root, "project");
      mkdirSync(join(project, ".gsd"), { recursive: true });
      process.env.GSD_HOME = join(root, "home");
      const preferencesPath = join(project, ".gsd", "PREFERENCES.md");
      const preferences = ["---", "token_profile: burn-max", ...fixture.lines, "---", ""].join("\n");
      writeFileSync(preferencesPath, preferences);
      try {
        const instruction = buildSubagentModelInstruction(project);
        if (fixture.model) assert.ok(instruction.includes(`model: "${fixture.model}"`));
        else assert.equal(instruction, "");
        if (fixture.thinking) assert.ok(instruction.includes(`thinking: "${fixture.thinking}"`), instruction);
        else assert.ok(!instruction.includes("thinking:"));
        assert.ok(!instruction.includes("fallback"), "instructions do not synthesize fallback changes");
        assert.equal(readFileSync(preferencesPath, "utf-8"), preferences);
      } finally {
        if (originalHome === undefined) delete process.env.GSD_HOME;
        else process.env.GSD_HOME = originalHome;
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
});

describe("stripVolatileCodebaseMetadata (#847 — KV cache stability)", () => {
  const map = [
    "# Codebase Map",
    "",
    "Generated: 2026-03-23T14:00:00Z | Files: 3 | Described: 2/3",
    `<!-- gsd:codebase-meta {"generatedAt":"2026-03-23T14:00:00Z","fingerprint":"abc","fileCount":3,"truncated":false} -->`,
    "",
    "### src/",
    "- `a.ts` — does a",
    "- `b.ts`",
  ].join("\n");

  test("removes the Generated timestamp and meta comment lines", () => {
    const stripped = stripVolatileCodebaseMetadata(map);
    assert.ok(!stripped.includes("Generated:"));
    assert.ok(!stripped.includes("gsd:codebase-meta"));
    assert.ok(stripped.includes("- `a.ts` — does a"));
    assert.ok(stripped.includes("### src/"));
  });

  test("is stable across regenerations that only change the timestamp", () => {
    const later = map
      .replace("2026-03-23T14:00:00Z | Files", "2026-03-24T09:30:00Z | Files")
      .replace('"generatedAt":"2026-03-23T14:00:00Z"', '"generatedAt":"2026-03-24T09:30:00Z"');
    assert.equal(stripVolatileCodebaseMetadata(map), stripVolatileCodebaseMetadata(later));
  });
});

describe("buildContextMessage (#5019 — memory routing)", () => {
  const markedMemory = "[GSD Context Metadata]\n- Memory supplied: yes\n\n[MEMORY]\nrule one";

  test("returns null when nothing to inject", () => {
    const result = buildContextMessage({
      memoryBlock: "",
      injection: null,
      forensicsInjection: null,
    });
    assert.equal(result, null);
  });

  test("whitespace-only memoryBlock counts as empty", () => {
    const result = buildContextMessage({
      memoryBlock: "   \n\n   ",
      injection: null,
      forensicsInjection: null,
    });
    assert.equal(result, null);
  });

  test("memory-only path emits gsd-memory message with trimmed content", () => {
    const result = buildContextMessage({
      memoryBlock: "\n\n[MEMORY]\nrule one\nrule two\n\n",
      injection: null,
      forensicsInjection: null,
    });
    assert.ok(result, "expected a context message");
    assert.equal(result.customType, "gsd-memory");
    assert.equal(result.content, `${SENTINEL}[GSD Context Metadata]\n- Memory supplied: yes\n\n[MEMORY]\nrule one\nrule two`);
    assert.equal(result.display, false);
  });

  test("guided-execute injection alone emits gsd-guided-context", () => {
    const result = buildContextMessage({
      memoryBlock: "",
      injection: "[GUIDED]\nexecute T01",
      forensicsInjection: null,
    });
    assert.ok(result);
    assert.equal(result.customType, "gsd-guided-context");
    assert.equal(result.content, `${SENTINEL}[GUIDED]\nexecute T01`);
  });

  test("forensics injection alone emits gsd-forensics", () => {
    const result = buildContextMessage({
      memoryBlock: "",
      injection: null,
      forensicsInjection: "[FORENSICS]\ninvestigation context",
    });
    assert.ok(result);
    assert.equal(result.customType, "gsd-forensics");
    assert.equal(result.content, `${SENTINEL}[FORENSICS]\ninvestigation context`);
  });

  test("memory + guided injection: memory prepended, customType is gsd-guided-context", () => {
    const result = buildContextMessage({
      memoryBlock: "[MEMORY]\nrule one",
      injection: "[GUIDED]\nexecute T01",
      forensicsInjection: null,
    });
    assert.ok(result);
    assert.equal(result.customType, "gsd-guided-context");
    assert.equal(result.content, `${SENTINEL}${markedMemory}\n\n[GUIDED]\nexecute T01`);
  });

  test("memory + forensics: memory prepended, customType is gsd-forensics", () => {
    const result = buildContextMessage({
      memoryBlock: "[MEMORY]\nrule one",
      injection: null,
      forensicsInjection: "[FORENSICS]\ninvestigation context",
    });
    assert.ok(result);
    assert.equal(result.customType, "gsd-forensics");
    assert.equal(result.content, `${SENTINEL}${markedMemory}\n\n[FORENSICS]\ninvestigation context`);
  });

  test("guided takes precedence over forensics when both are somehow present", () => {
    // The caller in buildBeforeAgentStartResult already gates forensics on
    // `!injection`, but the helper's documented priority is guided > forensics.
    // Test the contract directly so a future refactor can't silently flip it.
    const result = buildContextMessage({
      memoryBlock: "",
      injection: "[GUIDED]",
      forensicsInjection: "[FORENSICS]",
    });
    assert.ok(result);
    assert.equal(result.customType, "gsd-guided-context");
    assert.equal(result.content, `${SENTINEL}[GUIDED]`);
  });
});
