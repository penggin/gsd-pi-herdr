// Compact DB-authoritative observation; phase policy is shared with runtime derive.
import type { DbAdapter } from "../db-adapter.js";
import { getAllMilestones, getHierarchyCompletionCounts, getInFlightSliceCount, getMilestoneStatusCounts } from "../db/queries.js";
import { deriveStateFromReader } from "./derive/from-db.js";
import { createStateDerivationReader } from "./derive/reader.js";
import {
  ProjectSnapshotReadError,
  readCanonicalProjectDb,
  type CanonicalProjectReadOptions,
  type ProjectSnapshotAuthority,
} from "./canonical-db-read.js";

export { ProjectSnapshotReadError };
export { projectReadOptionsForTarget } from "./canonical-db-read.js";
export const MAX_SNAPSHOT_MILESTONES = 50;
export const MAX_SNAPSHOT_OPEN_ITEMS = 100;
export const MAX_SNAPSHOT_TEXT_CHARS = 2048;
export const MAX_SNAPSHOT_BYTES = 262_144;
export type ReadProjectSnapshotOptions = CanonicalProjectReadOptions;

export interface OpenBlockerRow {
  blockerId: string;
  blockerKind: string;
  resolutionOwner: string;
  description: string;
  requestedAction: string;
  openedAt: string;
  openedProjectRevision: number;
}
export interface OpenQuestionRow { questionId: string; questionText: string; createdAt: string }
export interface VerificationSummaryCounts {
  assessments: { total: number; pass: number; fail: number };
  evidence: { total: number; passed: number; failed: number };
}
export interface DbProjectSnapshot {
  authority: ProjectSnapshotAuthority;
  current: {
    activeMilestone: { id: string; title: string } | null;
    activeSlice: { id: string; title: string } | null;
    activeTask: { id: string; title: string } | null;
    phase: string;
    nextAction: string;
  };
  progress: {
    milestones: { total: number; done: number; active: number; pending: number; parked: number };
    slices: { total: number; done: number; active: number; pending: number };
    tasks: { total: number; done: number; pending: number };
  };
  blockers: OpenBlockerRow[];
  openQuestions: OpenQuestionRow[];
  verification: VerificationSummaryCounts;
  milestones: { items: Array<{ id: string; title: string; status: string; sequence: number }>; truncated: boolean };
  capturedAt: string;
  truncation: { blockers: boolean; openQuestions: boolean; text: boolean; byteBudget: boolean };
  consistency: { database: "transaction"; auxiliaryFiles: "not-revision-bound" };
}

function verificationSummary(adapter: DbAdapter): VerificationSummaryCounts {
  const result: VerificationSummaryCounts = { assessments: { total: 0, pass: 0, fail: 0 }, evidence: { total: 0, passed: 0, failed: 0 } };
  for (const row of adapter.prepare("SELECT lower(status) AS status, COUNT(*) AS count FROM assessments GROUP BY lower(status)").all()) {
    const count = Number(row.count);
    result.assessments.total += count;
    if (row.status === "pass" || row.status === "passed") result.assessments.pass += count;
    if (row.status === "fail" || row.status === "failed") result.assessments.fail += count;
  }
  for (const row of adapter.prepare("SELECT lower(verdict) AS verdict, COUNT(*) AS count FROM verification_evidence GROUP BY lower(verdict)").all()) {
    const count = Number(row.count);
    result.evidence.total += count;
    if (row.verdict === "pass" || row.verdict === "passed") result.evidence.passed += count;
    if (row.verdict === "fail" || row.verdict === "failed") result.evidence.failed += count;
  }
  return result;
}

function boundPayload(snapshot: DbProjectSnapshot): DbProjectSnapshot {
  // Bound the core payload including pretty formatting. Transport envelopes
  // may add escaping and metadata and must budget their own representation.
  while (Buffer.byteLength(JSON.stringify(snapshot, null, 2)) > MAX_SNAPSHOT_BYTES) {
    snapshot.truncation.byteBudget = true;
    if (snapshot.openQuestions.length) {
      snapshot.openQuestions.pop();
      snapshot.truncation.openQuestions = true;
    } else if (snapshot.blockers.length) {
      snapshot.blockers.pop();
      snapshot.truncation.blockers = true;
    } else if (snapshot.milestones.items.length) {
      snapshot.milestones.items.pop();
      snapshot.milestones.truncated = true;
    } else {
      throw new ProjectSnapshotReadError("snapshot_too_large", "Project snapshot identity fields exceed the output byte limit");
    }
  }
  return snapshot;
}

export async function readProjectSnapshotFromDb(
  basePath: string,
  options: ReadProjectSnapshotOptions = {},
): Promise<DbProjectSnapshot | null> {
  return readCanonicalProjectDb(basePath, options, ({ adapter, authority, scope }) => {
    const truncation = { blockers: false, openQuestions: false, text: false, byteBudget: false };
    const text = (value: unknown): string => {
      const valueText = String(value ?? "");
      if (valueText.length <= MAX_SNAPSHOT_TEXT_CHARS) return valueText;
      truncation.text = true;
      let clipped = valueText.slice(0, MAX_SNAPSHOT_TEXT_CHARS - 1);
      const last = clipped.charCodeAt(clipped.length - 1);
      if (last >= 0xD800 && last <= 0xDBFF) clipped = clipped.slice(0, -1);
      return clipped + "…";
    };
    const state = deriveStateFromReader(basePath, createStateDerivationReader(adapter), scope);
    const ref = (value: { id: string; title: string } | null) => value ? { id: value.id, title: text(value.title) } : null;
    const counts = getHierarchyCompletionCounts(adapter);
    const activeSlices = getInFlightSliceCount(adapter);
    const milestones = getAllMilestones(adapter, MAX_SNAPSHOT_MILESTONES + 1);
    const blockers = adapter.prepare(`
      SELECT blocker_id, blocker_kind, resolution_owner,
        substr(description, 1, :text_limit) AS description,
        substr(requested_action, 1, :text_limit) AS requested_action,
        opened_at, opened_project_revision
      FROM workflow_blockers WHERE blocker_status = 'open'
      ORDER BY opened_project_revision, blocker_id LIMIT :item_limit
    `).all({ ":text_limit": MAX_SNAPSHOT_TEXT_CHARS + 1, ":item_limit": MAX_SNAPSHOT_OPEN_ITEMS + 1 });
    const questions = adapter.prepare(`
      SELECT question_id, substr(question_text, 1, :text_limit) AS question_text, created_at
      FROM workflow_open_questions WHERE question_status = 'open'
      ORDER BY created_at, question_id LIMIT :item_limit
    `).all({ ":text_limit": MAX_SNAPSHOT_TEXT_CHARS + 1, ":item_limit": MAX_SNAPSHOT_OPEN_ITEMS + 1 });
    truncation.blockers = blockers.length > MAX_SNAPSHOT_OPEN_ITEMS;
    truncation.openQuestions = questions.length > MAX_SNAPSHOT_OPEN_ITEMS;
    return boundPayload({
      authority,
      current: {
        activeMilestone: ref(state.activeMilestone),
        activeSlice: ref(state.activeSlice),
        activeTask: ref(state.activeTask),
        phase: state.phase,
        nextAction: text(state.nextAction),
      },
      progress: {
        milestones: getMilestoneStatusCounts(adapter),
        slices: { total: counts.slicesTotal, done: counts.slices, active: activeSlices, pending: counts.slicesTotal - counts.slices - activeSlices },
        tasks: { total: counts.tasksTotal, done: counts.tasks, pending: counts.tasksTotal - counts.tasks },
      },
      blockers: blockers.slice(0, MAX_SNAPSHOT_OPEN_ITEMS).map((row) => ({
        blockerId: String(row.blocker_id), blockerKind: String(row.blocker_kind), resolutionOwner: String(row.resolution_owner),
        description: text(row.description), requestedAction: text(row.requested_action),
        openedAt: String(row.opened_at), openedProjectRevision: Number(row.opened_project_revision),
      })),
      openQuestions: questions.slice(0, MAX_SNAPSHOT_OPEN_ITEMS).map((row) => ({
        questionId: String(row.question_id), questionText: text(row.question_text), createdAt: String(row.created_at),
      })),
      verification: verificationSummary(adapter),
      milestones: {
        items: milestones.slice(0, MAX_SNAPSHOT_MILESTONES).map((m) => ({ id: m.id, title: text(m.title), status: m.status, sequence: m.sequence })),
        truncated: milestones.length > MAX_SNAPSHOT_MILESTONES,
      },
      capturedAt: new Date().toISOString(),
      truncation,
      consistency: { database: "transaction", auxiliaryFiles: "not-revision-bound" },
    });
  });
}
