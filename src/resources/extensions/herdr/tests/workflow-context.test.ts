import assert from "node:assert/strict";
import test from "node:test";
import type { GSDState } from "../../gsd/types.js";
import { formatHerdrWorkflowMessage } from "../workflow-context.js";

test("workflow context projects milestone/slice/task and phase into one bounded label", () => {
  const state = {
    activeMilestone: { id: "M001", title: "Root integration" },
    activeSlice: { id: "S02", title: "Reporter" },
    activeTask: { id: "T03", title: "Wire events" },
    phase: "executing",
  } as GSDState;
  assert.equal(formatHerdrWorkflowMessage(state), "M001/S02/T03 · executing");
});

test("workflow context remains useful without an active unit", () => {
  const state = {
    activeMilestone: null,
    activeSlice: null,
    activeTask: null,
    phase: "pre-planning",
  } as GSDState;
  assert.equal(formatHerdrWorkflowMessage(state), "pre-planning");
});
