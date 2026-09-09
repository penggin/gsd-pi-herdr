// Project/App: gsd-pi
// File Purpose: DB-authoritative progress reads for integration surfaces
// (`gsd read progress`, packaged MCP `gsd_progress`). ADR-046: the database
// is the sole workflow authority, so integration reads must not serve
// projection data that can lag it.

import { deriveStateFromReader } from "./derive/from-db.js";
import { createStateDerivationReader } from "./derive/reader.js";
import { readCanonicalProjectDb, type CanonicalProjectReadOptions } from "./canonical-db-read.js";
import type { DbAdapter } from "../db-adapter.js";
import {
  getHierarchyCompletionCounts,
  getInFlightSliceCount,
  getMilestoneStatusCounts,
} from "../gsd-db.js";
import type { GSDState } from "../types.js";
export { projectReadOptionsForTarget } from "./canonical-db-read.js";

/**
 * Structural mirror of `ProgressResult`
 * (packages/mcp-server/src/readers/state.ts). Kept local so the extension
 * bundle does not import from packages/; the exact key set is pinned by
 * tests/progress-from-db.test.ts.
 */
export interface DbProgressResult {
  activeMilestone: { id: string; title: string } | null;
  activeSlice: { id: string; title: string } | null;
  activeTask: { id: string; title: string } | null;
  phase: string;
  milestones: { total: number; done: number; active: number; pending: number; parked: number };
  slices: { total: number; done: number; active: number; pending: number };
  tasks: { total: number; done: number; pending: number };
  requirements: { active: number; validated: number; deferred: number; outOfScope: number } | null;
  blockers: string[];
  nextAction: string;
}

function toRef(value: { id: string; title: string } | null): { id: string; title: string } | null {
  return value ? { id: value.id, title: value.title } : null;
}

interface ProgressHierarchy {
  counts: ReturnType<typeof getHierarchyCompletionCounts>;
  milestones: ReturnType<typeof getMilestoneStatusCounts>;
  slicesActive: number;
}

function readProgressHierarchy(adapter: DbAdapter): ProgressHierarchy {
  return {
    counts: getHierarchyCompletionCounts(adapter),
    milestones: getMilestoneStatusCounts(adapter),
    slicesActive: getInFlightSliceCount(adapter),
  };
}

function buildProgressResult(
  state: GSDState,
  hierarchy: ReturnType<typeof readProgressHierarchy>,
): DbProgressResult {
  const slicesDone = hierarchy.counts.slices;
  const slicesTotal = hierarchy.counts.slicesTotal;
  const tasksDone = hierarchy.counts.tasks;
  const tasksTotal = hierarchy.counts.tasksTotal;

  return {
    activeMilestone: toRef(state.activeMilestone),
    activeSlice: toRef(state.activeSlice),
    activeTask: toRef(state.activeTask),
    phase: state.phase,
    milestones: hierarchy.milestones,
    slices: {
      total: slicesTotal,
      done: slicesDone,
      active: hierarchy.slicesActive,
      pending: slicesTotal - slicesDone - hierarchy.slicesActive,
    },
    tasks: {
      total: tasksTotal,
      done: tasksDone,
      pending: tasksTotal - tasksDone,
    },
    requirements:
      state.requirements && state.requirements.total > 0
        ? {
            active: state.requirements.active,
            validated: state.requirements.validated,
            deferred: state.requirements.deferred,
            outOfScope: state.requirements.outOfScope,
          }
        : null,
    blockers: [...state.blockers],
    nextAction: state.nextAction,
  };
}

/**
 * Project-wide counts and execution-scoped phase share one isolated SQLite
 * read transaction. The runtime's phase policy is reused without migrations,
 * queue-order repair, or global-cache/handle changes. Incompatible databases
 * fail explicitly; no mixed final retry or projection fallback is produced.
 */
export async function readProgressFromDb(basePath: string, options: CanonicalProjectReadOptions = {}): Promise<DbProgressResult | null> {
  return readCanonicalProjectDb(basePath, options, ({ adapter, scope }) => buildProgressResult(
    deriveStateFromReader(basePath, createStateDerivationReader(adapter), scope),
    readProgressHierarchy(adapter),
  ));
}
