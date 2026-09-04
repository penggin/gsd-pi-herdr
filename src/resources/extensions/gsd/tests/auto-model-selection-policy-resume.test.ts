/**
 * Model-policy resume regressions: worktree/step-mode often has a live session
 * model while getAvailable() is empty or tier-configured primaries do not resolve
 * against the policy-eligible pool (#4959 follow-on).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  ModelPolicyDispatchBlockedError,
  clearToolBaseline,
  selectAndApplyModel,
} from "../auto-model-selection.js";

type RegistryModel = { id: string; provider: string; api: string };

function makeTempProject(): { dir: string; home: string; cleanup: () => void; restoreEnv: () => void } {
  const originalCwd = process.cwd();
  const originalGsdHome = process.env.GSD_HOME;
  const dir = mkdtempSync(join(tmpdir(), "gsd-policy-resume-project-"));
  const home = mkdtempSync(join(tmpdir(), "gsd-policy-resume-home-"));
  mkdirSync(join(dir, ".gsd"), { recursive: true });
  writeFileSync(join(dir, ".gsd", "PREFERENCES.md"), "---\n---\n", "utf-8");
  process.env.GSD_HOME = home;
  process.chdir(dir);
  return {
    dir,
    home,
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    },
    restoreEnv: () => {
      process.chdir(originalCwd);
      if (originalGsdHome === undefined) delete process.env.GSD_HOME;
      else process.env.GSD_HOME = originalGsdHome;
    },
  };
}

function makeRegistryCtx(opts: {
  available: RegistryModel[];
  all: RegistryModel[];
  session: RegistryModel;
  requestReady?: (provider: string) => boolean;
}) {
  return {
    modelRegistry: {
      getAvailable: () => opts.available,
      getAll: () => opts.all,
      isProviderRequestReady: (provider: string) => opts.requestReady?.(provider) ?? true,
    },
    sessionManager: { getSessionId: () => "resume-session" },
    ui: { notify: () => {} },
    model: opts.session,
  } as any;
}

function makePi(setModelCalls: string[]) {
  return {
    setModel: async (model: { provider: string; id: string }) => {
      setModelCalls.push(`${model.provider}/${model.id}`);
      return true;
    },
    emitBeforeModelSelect: async () => undefined,
    getActiveTools: () => [],
    emitAdjustToolSet: async () => undefined,
    setActiveTools: () => {},
    setThinkingLevel: () => {},
  } as any;
}

test("research-slice: empty getAvailable() falls back to live session model", async () => {
  const env = makeTempProject();
  const setModelCalls: string[] = [];
  try {
    writeFileSync(
      join(env.dir, ".gsd", "PREFERENCES.md"),
      [
        "---",
        "dynamic_routing:",
        "  enabled: true",
        "  tier_models:",
        "    heavy: claude-opus-4-6",
        "---",
      ].join("\n"),
      "utf-8",
    );

    const sonnet = { id: "claude-sonnet-4-6", provider: "anthropic", api: "anthropic-messages" };
    const opus = { id: "claude-opus-4-6", provider: "anthropic", api: "anthropic-messages" };
    const pi = makePi(setModelCalls);
    clearToolBaseline(pi);

    const result = await selectAndApplyModel(
      makeRegistryCtx({ available: [], all: [sonnet, opus], session: sonnet }),
      pi,
      "research-slice",
      "M002-mskcfz/S01",
      env.dir,
      undefined,
      false,
      { provider: "anthropic", id: "claude-sonnet-4-6" },
      undefined,
      true,
    );

    assert.equal(result.appliedModel?.provider, "anthropic");
    assert.equal(result.appliedModel?.id, "claude-sonnet-4-6");
    assert.deepEqual(setModelCalls, ["anthropic/claude-sonnet-4-6"]);
  } finally {
    env.restoreEnv();
    env.cleanup();
  }
});

test("research-slice: explicit phase model resolves via getAll() when missing from getAvailable()", async () => {
  const env = makeTempProject();
  const setModelCalls: string[] = [];
  try {
    writeFileSync(
      join(env.dir, ".gsd", "PREFERENCES.md"),
      [
        "---",
        "models:",
        "  research: claude-opus-4-6",
        "dynamic_routing:",
        "  enabled: true",
        "  tier_models:",
        "    heavy: claude-opus-4-6",
        "---",
      ].join("\n"),
      "utf-8",
    );

    const sonnet = { id: "claude-sonnet-4-6", provider: "anthropic", api: "anthropic-messages" };
    const opus = { id: "claude-opus-4-6", provider: "anthropic", api: "anthropic-messages" };
    const pi = makePi(setModelCalls);
    clearToolBaseline(pi);

    const result = await selectAndApplyModel(
      makeRegistryCtx({ available: [sonnet], all: [sonnet, opus], session: sonnet }),
      pi,
      "research-slice",
      "M002-mskcfz/S01",
      env.dir,
      undefined,
      false,
      { provider: "anthropic", id: "claude-sonnet-4-6" },
      undefined,
      true,
    );

    assert.equal(result.appliedModel?.id, "claude-opus-4-6");
    assert.deepEqual(setModelCalls, ["anthropic/claude-opus-4-6"]);
  } finally {
    env.restoreEnv();
    env.cleanup();
  }
});

test("research-slice: MCP-only required tools do not empty the policy pool", async () => {
  const env = makeTempProject();
  const setModelCalls: string[] = [];
  try {
    writeFileSync(
      join(env.dir, ".gsd", "PREFERENCES.md"),
      [
        "---",
        "dynamic_routing:",
        "  enabled: true",
        "  tier_models:",
        "    heavy: anthropic/claude-sonnet-4-6",
        "---",
      ].join("\n"),
      "utf-8",
    );

    const sonnet = { id: "claude-sonnet-4-6", provider: "anthropic", api: "anthropic-messages" };
    const pi = makePi(setModelCalls);
    clearToolBaseline(pi);

    await selectAndApplyModel(
      makeRegistryCtx({ available: [sonnet], all: [sonnet], session: sonnet }),
      pi,
      "research-slice",
      "M002-mskcfz/S01",
      env.dir,
      undefined,
      false,
      { provider: "anthropic", id: "claude-sonnet-4-6" },
      undefined,
      true,
    );

    assert.deepEqual(setModelCalls, ["anthropic/claude-sonnet-4-6"]);
  } finally {
    env.restoreEnv();
    env.cleanup();
  }
});

test("research-slice: unauthenticated registry throws actionable deny reasons", async () => {
  const env = makeTempProject();
  try {
    writeFileSync(
      join(env.dir, ".gsd", "PREFERENCES.md"),
      [
        "---",
        "dynamic_routing:",
        "  enabled: true",
        "  tier_models:",
        "    heavy: claude-opus-4-6",
        "---",
      ].join("\n"),
      "utf-8",
    );

    const sonnet = { id: "claude-sonnet-4-6", provider: "anthropic", api: "anthropic-messages" };
    const pi = makePi([]);

    let thrown: unknown;
    try {
      await selectAndApplyModel(
        makeRegistryCtx({
          available: [],
          all: [sonnet],
          session: sonnet,
          requestReady: () => false,
        }),
        pi,
        "research-slice",
        "M002-mskcfz/S01",
        env.dir,
        undefined,
        false,
        { provider: "anthropic", id: "claude-sonnet-4-6" },
        undefined,
        true,
      );
    } catch (err) {
      thrown = err;
    }

    assert.ok(thrown instanceof ModelPolicyDispatchBlockedError);
    const err = thrown as ModelPolicyDispatchBlockedError;
    assert.ok(err.reasons.length > 0, "deny reasons must not be empty");
    assert.match(err.message, /authenticated providers/i);
  } finally {
    env.restoreEnv();
    env.cleanup();
  }
});

test("strict phase routing ignores a session model pin and applies the configured phase route", async () => {
  const env = makeTempProject();
  const setModelCalls: string[] = [];
  try {
    writeFileSync(
      join(env.dir, ".gsd", "PREFERENCES.md"),
      [
        "---",
        "models:",
        "  execution:",
        "    model: gsd-sonnet/zai/glm-5.3-flash",
        "    fallbacks:",
        "      - gsd-sonnet/gpt-5.6-luna",
        "    thinking: max",
        "uok:",
        "  model_policy:",
        "    enabled: true",
        "    enforce_phase_routes: true",
        "---",
      ].join("\n"),
      "utf-8",
    );

    const sol = { id: "gpt-5.6-sol", provider: "gsd-fable", api: "openai-codex-responses" };
    const glm = { id: "zai/glm-5.3-flash", provider: "gsd-sonnet", api: "openai-codex-responses" };
    const luna = { id: "gpt-5.6-luna", provider: "gsd-sonnet", api: "openai-codex-responses" };
    const pi = makePi(setModelCalls);
    clearToolBaseline(pi);

    const result = await selectAndApplyModel(
      makeRegistryCtx({ available: [sol, glm, luna], all: [sol, glm, luna], session: sol }),
      pi,
      "execute-task",
      "M013/S01/T01",
      env.dir,
      {
        uok: { model_policy: { enabled: true, enforce_phase_routes: true } },
      },
      false,
      { provider: "gsd-fable", id: "gpt-5.6-sol" },
      undefined,
      true,
      { provider: "gsd-fable", id: "gpt-5.6-sol" },
      "max",
    );

    assert.deepEqual(setModelCalls, ["gsd-sonnet/zai/glm-5.3-flash"]);
    assert.equal(result.appliedModel?.provider, "gsd-sonnet");
    assert.equal(result.appliedModel?.id, "zai/glm-5.3-flash");
  } finally {
    env.restoreEnv();
    env.cleanup();
  }
});

test("strict phase routing fails closed instead of using an arbitrary registry model", async () => {
  const env = makeTempProject();
  const setModelCalls: string[] = [];
  try {
    writeFileSync(
      join(env.dir, ".gsd", "PREFERENCES.md"),
      [
        "---",
        "models:",
        "  execution:",
        "    model: missing-provider/missing-primary",
        "    fallbacks:",
        "      - missing-provider/missing-fallback",
        "uok:",
        "  model_policy:",
        "    enabled: true",
        "    enforce_phase_routes: true",
        "---",
      ].join("\n"),
      "utf-8",
    );

    const sol = { id: "gpt-5.6-sol", provider: "gsd-fable", api: "openai-codex-responses" };
    const pi = makePi(setModelCalls);
    clearToolBaseline(pi);

    await assert.rejects(
      selectAndApplyModel(
        makeRegistryCtx({ available: [sol], all: [sol], session: sol }),
        pi,
        "execute-task",
        "M013/S01/T01",
        env.dir,
        { uok: { model_policy: { enabled: true, enforce_phase_routes: true } } },
        false,
        { provider: "gsd-fable", id: "gpt-5.6-sol" },
        undefined,
        true,
        { provider: "gsd-fable", id: "gpt-5.6-sol" },
      ),
      ModelPolicyDispatchBlockedError,
    );
    assert.deepEqual(setModelCalls, []);
  } finally {
    env.restoreEnv();
    env.cleanup();
  }
});
