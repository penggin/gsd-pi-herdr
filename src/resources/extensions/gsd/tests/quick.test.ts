import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildQuickQualityInstructions, handleQuick, parseQuickArgs } from "../quick.ts";

describe("quick task right-sizing flags", () => {
  test("preserves the lightweight default", () => {
    const options = parseQuickArgs("fix the typo");

    assert.deepEqual(options, {
      description: "fix the typo",
      discuss: false,
      research: false,
      validate: false,
      full: false,
    });
    assert.equal(buildQuickQualityInstructions(options, ".gsd/quick/1-fix-the-typo", 1), "");
  });

  test("strips and composes granular flags", () => {
    const options = parseQuickArgs("--validate fix auth --discuss --research");

    assert.equal(options.description, "fix auth");
    assert.equal(options.discuss, true);
    assert.equal(options.research, true);
    assert.equal(options.validate, true);
    assert.equal(options.full, true);
  });

  test("--full enables every optional stage", () => {
    const options = parseQuickArgs("critical auth fix --full");
    const instructions = buildQuickQualityInstructions(options, ".gsd/quick/2-critical-auth-fix", 2);

    assert.equal(options.description, "critical auth fix");
    assert.equal(options.discuss, true);
    assert.equal(options.research, true);
    assert.equal(options.validate, true);
    assert.equal(options.full, true);
    assert.match(instructions, /### Discussion/);
    assert.match(instructions, /### Research/);
    assert.match(instructions, /reviewer subagent to check that plan/);
    assert.match(instructions, /### Post-execution verification/);
  });

  test("only emits instructions for enabled optional stages", () => {
    const options = parseQuickArgs("--research compare cache clients");
    const instructions = buildQuickQualityInstructions(options, ".gsd/quick/3-cache", 3);

    assert.match(instructions, /### Research/);
    assert.match(instructions, /### Plan/);
    assert.doesNotMatch(instructions, /### Discussion/);
    assert.doesNotMatch(instructions, /Post-execution verification/);
  });
});

test("quick rejects symbol-only descriptions before creating task state or dispatching", async () => {
  const base = mkdtempSync(join(tmpdir(), "gsd-quick-invalid-slug-"));
  const previousCwd = process.cwd();
  const notifications: Array<{ message: string; level?: string }> = [];
  const messages: unknown[] = [];
  try {
    mkdirSync(join(base, ".gsd"));
    process.chdir(base);
    for (const description of ["🔥🔥🔥", "../", "--- !!!", "\u0301"]) {
      await handleQuick(description, {
        ui: { notify: (message: string, level?: string) => notifications.push({ message, level }) },
      } as any, {
        sendMessage: (message: unknown) => messages.push(message),
      } as any);
    }
    assert.equal(notifications.length, 4);
    for (const notification of notifications) {
      assert.equal(notification.level, "error");
      assert.match(notification.message, /at least one (letter or number|alphanumeric character)/i);
    }
    assert.deepEqual(messages, []);
    assert.equal(existsSync(join(base, ".gsd", "quick")), false);
    assert.equal(existsSync(join(base, ".gsd", "runtime")), false);
  } finally {
    process.chdir(previousCwd);
    rmSync(base, { recursive: true, force: true });
  }
});
