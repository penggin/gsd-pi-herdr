// Project/App: gsd-pi
// File Purpose: Process-local same-turn approval-gate state shared by native
// and external-engine pre-execution policy adapters.

import {
  extractDepthVerificationMilestoneId,
  getPendingGate,
  hostWriteGateAdapter,
  isApprovalGateVerifiedInSnapshot,
  isMilestoneDepthVerifiedInSnapshot,
  type WriteGateSnapshot,
} from "./write-gate.js";

const deferredApprovalGates = new Map<string, string>();

export function clearDeferredApprovalGate(basePath?: string): void {
  if (basePath) deferredApprovalGates.delete(basePath);
  else deferredApprovalGates.clear();
}

export function getDeferredApprovalGate(basePath: string): string | undefined {
  return deferredApprovalGates.get(basePath);
}

export function deferApprovalGateFromSnapshot(
  gateId: string,
  basePath: string,
  snapshot: WriteGateSnapshot,
): void {
  if (isApprovalGateVerifiedInSnapshot(snapshot, gateId)) return;
  const milestoneId = extractDepthVerificationMilestoneId(gateId);
  if (milestoneId && isMilestoneDepthVerifiedInSnapshot(snapshot, milestoneId)) return;
  deferredApprovalGates.set(basePath, gateId);
}

export function deferApprovalGate(gateId: string, basePath: string): void {
  deferApprovalGateFromSnapshot(gateId, basePath, hostWriteGateAdapter.readState(basePath));
}

export function activateDeferredApprovalGate(basePath: string): void {
  const gateId = deferredApprovalGates.get(basePath);
  if (gateId === undefined) return;
  deferredApprovalGates.delete(basePath);
  hostWriteGateAdapter.setPending(gateId, basePath);
}

export function isApprovalGateBlocking(basePath: string): boolean {
  return Boolean(getPendingGate(basePath)) || deferredApprovalGates.has(basePath);
}

function isContextDraftSummarySave(toolName: string, input: unknown): boolean {
  if (toolName !== "gsd_summary_save" && toolName !== "summary_save") return false;
  if (!input || typeof input !== "object") return false;
  return (input as { artifact_type?: unknown }).artifact_type === "CONTEXT-DRAFT";
}

export function withDepthGateDisplayReason<T extends { block: boolean; reason?: string }>(
  result: T,
  displayReason = "Depth confirmation is waiting for your answer.",
): T & { displayReason?: string } {
  if (!result.block) return result;
  return { ...result, displayReason };
}

export function shouldBlockDeferredApprovalTool(
  toolName: string,
  input: unknown,
  basePath: string,
): { block: boolean; reason?: string; displayReason?: string } {
  const deferredGateId = deferredApprovalGates.get(basePath);
  if (deferredGateId === undefined) return { block: false };
  if (toolName === "ask_user_questions") return { block: false };
  if (isContextDraftSummarySave(toolName, input)) return { block: false };
  return withDepthGateDisplayReason({
    block: true,
    reason: [
      `HARD BLOCK: Approval question "${deferredGateId}" has been shown to the user.`,
      "Only CONTEXT-DRAFT persistence may finish in this same assistant turn.",
      "Wait for the user's answer before calling additional tools.",
    ].join(" "),
  });
}
