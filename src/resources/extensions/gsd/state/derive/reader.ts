// Explicit database readers shared by runtime derivation and isolated observers.
import type { DbAdapter } from "../../db-adapter.js";
import * as queries from "../../db/queries.js";
import { queryDecisions, queryDecisionsFromMemories } from "../../context-store.js";
import { summarizeRequirementsCoverage } from "../../requirements-backlog.js";
import { readMilestoneValidationVerdict } from "../../milestone-validation-verdict.js";
import { logWarning } from "../../workflow-logger.js";

export function createStateDerivationReader(adapter?: DbAdapter) {
  return {
    warn: (message: string) => { if (!adapter) logWarning("state", message); },
    getAllMilestones: () => queries.getAllMilestones(adapter),
    getArtifact: (path: string) => queries.getArtifact(path, adapter),
    getMilestoneScopedArtifacts: (id: string) => queries.getMilestoneScopedArtifacts(id, adapter),
    getPlanMilestoneRecoveryBlock: (id: string) => queries.getPlanMilestoneRecoveryBlock(id, adapter),
    getPendingGateCountForTurn: (mid: string, sid: string, turn: Parameters<typeof queries.getPendingGateCountForTurn>[2]) => queries.getPendingGateCountForTurn(mid, sid, turn, adapter),
    getReplanHistory: (mid: string, sid: string) => queries.getReplanHistory(mid, sid, adapter),
    getRequirementCounts: () => queries.getRequirementCounts(adapter),
    getSlice: (mid: string, sid: string) => queries.getSlice(mid, sid, adapter),
    getSliceTasks: (mid: string, sid: string) => queries.getSliceTasks(mid, sid, adapter),
    getSlicesByMilestoneIds: (ids: readonly string[]) => queries.getSlicesByMilestoneIds(ids, adapter),
    countUnmappedActiveRequirements: () => summarizeRequirementsCoverage(queries.getActiveRequirements(adapter)).unmappedActiveRequirements.length,
    readMilestoneValidationVerdict: (mid: string) => readMilestoneValidationVerdict(mid, adapter),
    recentDecisions: (): string[] => {
      // Snapshot/progress omit decisions; avoid unrelated context-store queries
      // on their isolated adapter. Runtime keeps its established presentation.
      if (adapter) return [];
      const fromMemories = queryDecisionsFromMemories();
      const rows = fromMemories.length > 0 ? fromMemories : queryDecisions();
      return rows.slice(-5).map((d) => `${d.id} (${d.when_context}): ${d.decision} -> ${d.choice}`);
    },
  };
}

export type StateDerivationReader = ReturnType<typeof createStateDerivationReader>;

export interface StateDerivationScope {
  milestoneId?: string;
  sliceId?: string;
}

export function captureStateDerivationScope(): StateDerivationScope {
  return {
    milestoneId: process.env.GSD_MILESTONE_LOCK?.trim() || undefined,
    sliceId: process.env.GSD_PARALLEL_WORKER ? process.env.GSD_SLICE_LOCK : undefined,
  };
}
