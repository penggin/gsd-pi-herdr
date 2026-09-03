import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import {
  applyGsdPreExecutionPolicyEffects,
  canonicalGsdPreExecutionToolName,
  evaluateResolvedGsdPreExecutionPolicy,
  type ResolvedGsdPreExecutionContext,
} from "../pre-execution-policy.ts";
import {
  clearDeferredApprovalGate,
} from "../bootstrap/deferred-approval-gate.ts";

const roots: string[] = [];

afterEach(() => {
  clearDeferredApprovalGate();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function makeContext(
  overrides: Partial<ResolvedGsdPreExecutionContext> = {},
): ResolvedGsdPreExecutionContext {
  const basePath = mkdtempSync(join(tmpdir(), "gsd-pre-execution-policy-"));
  roots.push(basePath);
  return {
    basePath,
    writeGateBasePath: basePath,
    planningBasePath: basePath,
    writeGateSnapshot: {
      verifiedDepthMilestones: [],
      verifiedApprovalGates: [],
      activeQueuePhase: false,
      pendingGateId: null,
    },
    queuePhaseActive: false,
    discussionMilestoneId: null,
    autoSnapshot: {
      active: false,
      paused: false,
      currentUnit: null,
      basePath: "",
      isolationDegraded: false,
      strandedRecoveryIsolationMode: null,
      toolSurface: null,
    },
    effectiveIsolationMode: "none",
    ...overrides,
  };
}

function decide(
  toolName: string,
  input: Record<string, unknown>,
  context: ResolvedGsdPreExecutionContext,
) {
  return evaluateResolvedGsdPreExecutionPolicy({ toolName, input }, context);
}

test("normalizes Claude native tool names without changing workflow MCP identities", () => {
  assert.equal(canonicalGsdPreExecutionToolName("Write"), "write");
  assert.equal(canonicalGsdPreExecutionToolName("NotebookEdit"), "notebook_edit");
  assert.equal(canonicalGsdPreExecutionToolName("mcp__gsd-workflow__gsd_summary_save"), "gsd_summary_save");
});

test("native and Claude shapes have identical queue, pending-gate, and state-write decisions", () => {
  const queueContext = makeContext({
    queuePhaseActive: true,
    writeGateSnapshot: {
      verifiedDepthMilestones: [],
      activeQueuePhase: true,
      pendingGateId: null,
    },
  });
  const nativeQueue = decide("write", { path: "src/index.ts" }, queueContext);
  const claudeQueue = decide("Write", { file_path: "src/index.ts" }, queueContext);
  assert.equal(nativeQueue.policy, "queue-mode");
  assert.deepEqual(claudeQueue, nativeQueue);

  const pendingContext = makeContext({
    writeGateSnapshot: {
      verifiedDepthMilestones: [],
      activeQueuePhase: false,
      pendingGateId: "depth_verification_M001_confirm",
    },
  });
  const nativePending = decide("bash", { command: "git status" }, pendingContext);
  const claudePending = decide("Bash", { command: "git status" }, pendingContext);
  assert.equal(nativePending.policy, "pending-approval-gate");
  assert.deepEqual(claudePending, nativePending);

  const ordinaryContext = makeContext();
  const nativeState = decide("edit", { path: ".gsd/gsd.db" }, ordinaryContext);
  const claudeState = decide("Edit", { file_path: ".gsd/gsd.db" }, ordinaryContext);
  assert.equal(nativeState.policy, "authoritative-state");
  assert.deepEqual(claudeState, nativeState);
});

test("planning, worktree, and context-depth guards apply to external native tool names", () => {
  const planningContext = makeContext({
    activeUnitType: "discuss-milestone",
    planningPolicy: { mode: "planning" },
  });
  const nativePlanning = decide("write", { path: "src/feature.ts" }, planningContext);
  const claudePlanning = decide("Write", { file_path: "src/feature.ts" }, planningContext);
  assert.equal(nativePlanning.policy, "planning-unit");
  assert.deepEqual(claudePlanning, nativePlanning);

  const worktreeContext = makeContext({ effectiveIsolationMode: "worktree" });
  const nativeWorktree = decide("edit", { path: "notebooks/report.ipynb" }, worktreeContext);
  const claudeWorktree = decide("NotebookEdit", { notebook_path: "notebooks/report.ipynb" }, worktreeContext);
  assert.equal(nativeWorktree.policy, "worktree-isolation");
  assert.deepEqual(claudeWorktree, nativeWorktree);

  const contextPath = ".gsd/milestones/M001/M001-CONTEXT.md";
  const depthContext = makeContext({ discussionMilestoneId: "M001" });
  const nativeDepth = decide("write", { path: contextPath }, depthContext);
  const claudeDepth = decide("Write", { file_path: contextPath }, depthContext);
  assert.equal(nativeDepth.policy, "context-depth");
  assert.deepEqual(claudeDepth, nativeDepth);

  const verifiedContext = makeContext({
    discussionMilestoneId: "M001",
    writeGateSnapshot: {
      verifiedDepthMilestones: ["M001"],
      activeQueuePhase: false,
      pendingGateId: null,
    },
  });
  assert.equal(decide("Write", { file_path: contextPath }, verifiedContext).block, false);
});

test("approval question effect is shared and blocks later same-turn external tools", () => {
  const context = makeContext();
  const question = decide("ask_user_questions", {
    questions: [{ id: "depth_verification_M002_confirm" }],
  }, context);
  assert.equal(question.block, false);
  assert.equal(question.deferApprovalGateId, "depth_verification_M002_confirm");
  applyGsdPreExecutionPolicyEffects(question, context.basePath);

  const laterTool = decide("Read", { file_path: "README.md" }, context);
  assert.equal(laterTool.block, true);
  assert.equal(laterTool.policy, "deferred-approval-gate");
  assert.equal(laterTool.pauseForApprovalGate, true);
});
