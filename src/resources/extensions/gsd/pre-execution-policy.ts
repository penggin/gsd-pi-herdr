// Project/App: gsd-pi
// File Purpose: One ordered GSD pre-execution policy evaluator shared by the
// native Pi tool hook and external-engine pre-execution adapters.

import { getAutoRuntimeSnapshot, type AutoRuntimeSnapshot } from "./auto-runtime-state.js";
import { canonicalToolName } from "./engine-hook-contract.js";
import { getGuidedUnitContext } from "./guided-unit-context.js";
import { resolveEffectivePlanningToolsPolicy } from "./planning-subagent-policy.js";
import { getIsolationMode, resolveEffectiveUnitIsolationMode } from "./preferences.js";
import { recordUnitHarnessAbort } from "./unit-runtime.js";
import { resolveManifest, type ToolsPolicy } from "./unit-context-manifest.js";
import { BLOCKED_WRITE_ERROR, isBashWriteToStateFile, isBlockedStateFile } from "./write-intercept.js";
import {
  deferApprovalGate,
  shouldBlockDeferredApprovalTool,
  withDepthGateDisplayReason,
} from "./bootstrap/deferred-approval-gate.js";
import { extractSubagentAgentClasses } from "./bootstrap/subagent-input.js";
import { checkToolCallLoop } from "./bootstrap/tool-call-loop-guard.js";
import {
  hostWriteGateAdapter,
  isGateQuestionId,
  shouldBlockContextWriteInSnapshot,
  shouldBlockPendingGateBashInSnapshot,
  shouldBlockPendingGateInSnapshot,
  shouldBlockPlanningUnit,
  shouldBlockQueueExecutionInSnapshot,
  shouldBlockWorktreeBash,
  shouldBlockWorktreeWrite,
  type WriteGateSnapshot,
} from "./bootstrap/write-gate.js";

const EXTERNAL_NATIVE_TOOL_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  Bash: "bash",
  Edit: "edit",
  Glob: "glob",
  Grep: "grep",
  MultiEdit: "multi_edit",
  NotebookEdit: "notebook_edit",
  Read: "read",
  Task: "task",
  WebFetch: "web_fetch",
  WebSearch: "web_search",
  Write: "write",
});

const FILE_WRITE_TOOLS = new Set(["write", "edit", "multi_edit", "notebook_edit"]);

const LOOP_GUARD_INTERACTIVE_INSTRUCTIONS = [
  "Do not retry this tool or call other tools this turn — stop and respond to the user in text.",
  "Do not retry this tool or pivot to other tools this turn — stop and respond to the user in text.",
];
const LOOP_GUARD_AUTO_INSTRUCTION =
  "Do not re-issue this blocked tool. In /gsd auto, stop tool calls for this turn and return control to the auto-mode recovery/replan path.";

export interface GsdPreExecutionToolCall {
  toolName: string;
  input: unknown;
  basePath: string;
}

export interface ResolvedGsdPreExecutionContext {
  basePath: string;
  writeGateBasePath: string;
  planningBasePath: string;
  writeGateSnapshot: WriteGateSnapshot;
  queuePhaseActive: boolean;
  discussionMilestoneId: string | null;
  autoSnapshot: AutoRuntimeSnapshot;
  activeUnitType?: string;
  activeUnitId?: string;
  planningPolicy?: ToolsPolicy | null;
  effectiveIsolationMode: ReturnType<typeof getIsolationMode>;
}

export interface GsdPreExecutionPolicyDecision {
  block: boolean;
  reason?: string;
  displayReason?: string;
  policy?:
    | "loop-guard"
    | "deferred-approval-gate"
    | "pending-approval-gate"
    | "queue-mode"
    | "planning-unit"
    | "worktree-isolation"
    | "authoritative-state"
    | "context-depth";
  deferApprovalGateId?: string;
  pauseForApprovalGate?: boolean;
  loopGuard?: { toolName: string; count?: number; reason?: string };
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
}

export function canonicalGsdPreExecutionToolName(toolName: string): string {
  const canonical = canonicalToolName(toolName);
  return EXTERNAL_NATIVE_TOOL_ALIASES[canonical] ?? canonical;
}

export function extractPreExecutionPath(input: unknown): string {
  const record = asRecord(input);
  for (const key of ["path", "file_path", "notebook_path"] as const) {
    if (typeof record[key] === "string") return record[key];
  }
  return "";
}

export function extractPreExecutionCommand(input: unknown): string {
  const command = asRecord(input).command;
  return typeof command === "string" ? command : "";
}

export function extractPreExecutionGateQuestionId(input: unknown): string | undefined {
  const questions = asRecord(input).questions;
  if (!Array.isArray(questions)) return undefined;
  for (const question of questions) {
    if (!question || typeof question !== "object") continue;
    const id = (question as { id?: unknown }).id;
    if (typeof id === "string" && isGateQuestionId(id)) return id;
  }
  return undefined;
}

export function formatLoopGuardBlockReason(
  reason: string | undefined,
  autoActive: boolean,
): string | undefined {
  if (!reason || !autoActive) return reason;
  return LOOP_GUARD_INTERACTIVE_INSTRUCTIONS.reduce(
    (formatted, instruction) => formatted.replace(instruction, LOOP_GUARD_AUTO_INSTRUCTION),
    reason,
  );
}

export async function resolveGsdPreExecutionContext(
  basePath: string,
): Promise<ResolvedGsdPreExecutionContext> {
  const autoSnapshot = getAutoRuntimeSnapshot();
  const guidedUnit = getGuidedUnitContext(basePath);
  const activeUnitType = autoSnapshot.currentUnit?.type ?? guidedUnit?.unitType;
  const activeUnitId = autoSnapshot.currentUnit?.id;
  const writeGateBasePath = autoSnapshot.basePath || basePath;
  const planningBasePath = autoSnapshot.basePath || guidedUnit?.basePath || basePath;
  const manifest = activeUnitType ? resolveManifest(activeUnitType) : undefined;
  const planningPolicy = activeUnitType
    ? resolveEffectivePlanningToolsPolicy(activeUnitType, manifest?.tools, planningBasePath)
    : undefined;
  const effectiveIsolationMode = resolveEffectiveUnitIsolationMode(
    getIsolationMode(writeGateBasePath),
    autoSnapshot.isolationDegraded,
    autoSnapshot.strandedRecoveryIsolationMode,
  );
  const { getDiscussionMilestoneId } = await import("./guided-flow.js");
  const writeGateSnapshot = hostWriteGateAdapter.readState(basePath);

  return {
    basePath,
    writeGateBasePath,
    planningBasePath,
    writeGateSnapshot,
    queuePhaseActive: writeGateSnapshot.activeQueuePhase,
    discussionMilestoneId: getDiscussionMilestoneId(basePath),
    autoSnapshot,
    activeUnitType,
    activeUnitId,
    planningPolicy,
    effectiveIsolationMode,
  };
}

function blocked(
  policy: NonNullable<GsdPreExecutionPolicyDecision["policy"]>,
  result: { block: boolean; reason?: string; displayReason?: string },
  extra: Partial<GsdPreExecutionPolicyDecision> = {},
): GsdPreExecutionPolicyDecision {
  return { ...result, ...extra, block: true, policy };
}

export function evaluateResolvedGsdPreExecutionPolicy(
  call: Omit<GsdPreExecutionToolCall, "basePath">,
  context: ResolvedGsdPreExecutionContext,
): GsdPreExecutionPolicyDecision {
  const toolName = canonicalGsdPreExecutionToolName(call.toolName);
  const input = asRecord(call.input);
  const path = extractPreExecutionPath(input);
  const command = extractPreExecutionCommand(input);

  const deferredGateGuard = shouldBlockDeferredApprovalTool(toolName, input, context.basePath);
  if (deferredGateGuard.block) {
    return blocked("deferred-approval-gate", deferredGateGuard, { pauseForApprovalGate: true });
  }

  const deferApprovalGateId = toolName === "ask_user_questions"
    ? extractPreExecutionGateQuestionId(input)
    : undefined;

  if (context.writeGateSnapshot.pendingGateId) {
    const gateGuard = toolName === "bash"
      ? shouldBlockPendingGateBashInSnapshot(
          context.writeGateSnapshot,
          command,
          context.discussionMilestoneId,
          context.queuePhaseActive,
        )
      : shouldBlockPendingGateInSnapshot(
          context.writeGateSnapshot,
          toolName,
          context.discussionMilestoneId,
          context.queuePhaseActive,
        );
    if (gateGuard.block) {
      return blocked("pending-approval-gate", withDepthGateDisplayReason(gateGuard), {
        deferApprovalGateId,
        pauseForApprovalGate: true,
      });
    }
  }

  if (context.queuePhaseActive) {
    const queueInput = toolName === "bash" ? command : path;
    const queueGuard = shouldBlockQueueExecutionInSnapshot(
      context.writeGateSnapshot,
      toolName,
      queueInput,
      true,
    );
    if (queueGuard.block) return blocked("queue-mode", queueGuard, { deferApprovalGateId });
  }

  if (context.activeUnitType) {
    const planningInput = toolName === "bash" ? command : path;
    const agentClasses = toolName === "subagent" || toolName === "task"
      ? extractSubagentAgentClasses(input)
      : undefined;
    const planningGuard = shouldBlockPlanningUnit(
      toolName,
      planningInput,
      context.planningBasePath,
      context.activeUnitType,
      context.planningPolicy,
      agentClasses,
      input,
      context.activeUnitId,
    );
    if (planningGuard.block) return blocked("planning-unit", planningGuard, { deferApprovalGateId });
  }

  if (toolName === "bash") {
    const worktreeGuard = shouldBlockWorktreeBash(
      command,
      context.writeGateBasePath,
      context.autoSnapshot.active,
      context.activeUnitType,
      context.effectiveIsolationMode,
    );
    if (worktreeGuard.block) return blocked("worktree-isolation", worktreeGuard, { deferApprovalGateId });
  } else if (FILE_WRITE_TOOLS.has(toolName)) {
    const worktreeGuard = shouldBlockWorktreeWrite(
      toolName,
      path,
      context.writeGateBasePath,
      context.autoSnapshot.active,
      context.activeUnitType,
      context.effectiveIsolationMode,
    );
    if (worktreeGuard.block) return blocked("worktree-isolation", worktreeGuard, { deferApprovalGateId });
  }

  if (FILE_WRITE_TOOLS.has(toolName) && path && isBlockedStateFile(path)) {
    return blocked("authoritative-state", { block: true, reason: BLOCKED_WRITE_ERROR }, { deferApprovalGateId });
  }
  if (toolName === "bash" && isBashWriteToStateFile(command)) {
    return blocked("authoritative-state", { block: true, reason: BLOCKED_WRITE_ERROR }, { deferApprovalGateId });
  }

  if (toolName === "write") {
    const contextGuard = shouldBlockContextWriteInSnapshot(
      context.writeGateSnapshot,
      toolName,
      path,
      context.discussionMilestoneId,
    );
    if (contextGuard.block) {
      return blocked(
        "context-depth",
        withDepthGateDisplayReason(contextGuard, "Depth check required before writing milestone context."),
        { deferApprovalGateId },
      );
    }
  }

  return { block: false, deferApprovalGateId };
}

export async function evaluateGsdPreExecutionPolicy(
  call: GsdPreExecutionToolCall,
): Promise<GsdPreExecutionPolicyDecision> {
  const toolName = canonicalGsdPreExecutionToolName(call.toolName);
  const input = asRecord(call.input);
  const loopCheck = checkToolCallLoop(toolName, input);
  if (loopCheck.block) {
    const autoActive = getAutoRuntimeSnapshot().active;
    return {
      block: true,
      reason: formatLoopGuardBlockReason(loopCheck.reason, autoActive),
      policy: "loop-guard",
      loopGuard: { toolName, count: loopCheck.count, reason: loopCheck.reason },
    };
  }
  return evaluateResolvedGsdPreExecutionPolicy(call, await resolveGsdPreExecutionContext(call.basePath));
}

/** Apply only the host-owned effects described by a decision, exactly once. */
export function applyGsdPreExecutionPolicyEffects(
  decision: GsdPreExecutionPolicyDecision,
  basePath: string,
): void {
  if (decision.deferApprovalGateId) {
    deferApprovalGate(decision.deferApprovalGateId, basePath);
  }
  if (!decision.loopGuard) return;
  const snapshot = getAutoRuntimeSnapshot();
  if (!snapshot.active || !snapshot.basePath || !snapshot.currentUnit) return;
  recordUnitHarnessAbort(
    snapshot.basePath,
    snapshot.currentUnit.type,
    snapshot.currentUnit.id,
    snapshot.currentUnit.startedAt,
    {
      kind: "tool-loop-guard",
      reason: decision.loopGuard.reason ?? "Tool-call loop guard blocked a repeated tool call.",
      toolName: decision.loopGuard.toolName,
      count: decision.loopGuard.count,
    },
  );
}
