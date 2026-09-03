// Project/App: gsd-pi
// File Purpose: Replacement-session rebinding regressions for long-lived auto orchestration.

import test from "node:test";
import assert from "node:assert/strict";

import { bindAutoReplacementSession } from "../auto/replacement-session.js";
import { AutoSession } from "../auto/session.js";

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
