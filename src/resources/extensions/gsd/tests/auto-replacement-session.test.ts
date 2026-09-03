// Project/App: gsd-pi
// File Purpose: Replacement-session rebinding regressions for long-lived auto orchestration.

import test from "node:test";
import assert from "node:assert/strict";

import { bindAutoReplacementSession } from "../auto/replacement-session.js";
import { AutoSession } from "../auto/session.js";
import { clearHookEmitter, emitUnitStart } from "../hook-emitter.js";

test("replacement session rebinds the live auto orchestrator before closeout continues", () => {
  const session = new AutoSession();
  const calls: Array<{ ctx: unknown; pi: unknown }> = [];
  session.orchestration = {
    rebindSessionContext(ctx: unknown, pi: unknown) {
      calls.push({ ctx, pi });
    },
  } as never;

  const freshCtx = {
    ui: { notify() {} },
    sendMessage() {},
  } as never;
  const events = { emit() {} };
  const previousPi = { events } as never;

  const rebound = bindAutoReplacementSession(session, freshCtx, previousPi);

  assert.equal(session.cmdCtx, freshCtx);
  assert.equal(rebound.ctx, freshCtx);
  assert.equal(rebound.pi, freshCtx);
  assert.equal((rebound.pi as { events: unknown }).events, events);
  assert.deepEqual(calls, [{ ctx: freshCtx, pi: rebound.pi }]);
});

test("replacement session preserves model-selection hooks and rebinds lifecycle emission", async () => {
  const session = new AutoSession();
  const hookCalls: string[] = [];
  const freshCtx = {
    ui: { notify() {} },
    sendMessage() {},
    emitBeforeModelSelect: async () => {
      hookCalls.push("before-model-select");
      return undefined;
    },
    emitAdjustToolSet: async () => {
      hookCalls.push("adjust-tool-set");
      return undefined;
    },
    emitExtensionEvent: async () => {
      hookCalls.push("extension-event");
      return undefined;
    },
  } as never;
  const stalePi = {
    events: { emit() {} },
    emitExtensionEvent: async () => {
      throw new Error("stale extension emitter");
    },
  } as never;

  try {
    const { pi } = bindAutoReplacementSession(session, freshCtx, stalePi);
    await pi.emitBeforeModelSelect({} as never);
    await pi.emitAdjustToolSet({} as never);
    await emitUnitStart({ unitType: "complete-slice", unitId: "M013/S03", cwd: "/tmp/project" });
    assert.deepEqual(hookCalls, ["before-model-select", "adjust-tool-set", "extension-event"]);
  } finally {
    clearHookEmitter();
  }
});
