import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { _getAdapter, insertMilestone, getAllMilestones, setMilestoneQueueOrder } from "../gsd-db.ts";
import { SCHEMA_VERSION } from "../db/engine.ts";
import { openWorkflowDatabaseIsolated } from "../db-workspace.ts";
import { deriveState, invalidateStateCache } from "../state.ts";
import { readProgressFromDb } from "../state/progress-from-db.ts";
import { readProjectSnapshotFromDb, MAX_SNAPSHOT_BYTES } from "../state/project-snapshot.ts";
import { initNotificationStore, _resetNotificationStore } from "../notification-store.ts";
import { peekLogs } from "../workflow-logger.ts";
import { createWorkflowAuthorityFixture } from "./workflow-authority-fixture.ts";

test("project snapshot returns canonical authority, current focus, and full hierarchy counts", async (t) => {
  const fixture = await createWorkflowAuthorityFixture();
  t.after(() => fixture.cleanup());
  const { readProjectSnapshotFromDb } = await import("../state/project-snapshot.ts");
  const snapshot = await readProjectSnapshotFromDb(fixture.root);
  assert.ok(snapshot);
  assert.ok(snapshot.authority.projectId);
  assert.ok(Number.isSafeInteger(snapshot.authority.revision));
  assert.equal(snapshot.current.activeMilestone?.id, "M001");
  assert.equal(snapshot.current.activeSlice?.id, "S02");
  assert.equal(snapshot.current.activeTask?.id, "T01");
  assert.deepEqual(snapshot.progress, {
    milestones: { total: 1, done: 0, active: 1, pending: 0, parked: 0 },
    slices: { total: 2, done: 1, active: 0, pending: 1 },
    tasks: { total: 2, done: 1, pending: 1 },
  });
  assert.deepEqual(snapshot.consistency, { database: "transaction", auxiliaryFiles: "not-revision-bound" });
  assert.deepEqual(snapshot.truncation, { blockers: false, openQuestions: false, text: false, byteBudget: false });
});

test("stable snapshot fields are deterministic except for capture time", async (t) => {
  const fixture = await createWorkflowAuthorityFixture();
  t.after(() => fixture.cleanup());
  const first = await readProjectSnapshotFromDb(fixture.root);
  const second = await readProjectSnapshotFromDb(fixture.root);
  assert.ok(first && second);
  assert.deepEqual({ ...first, capturedAt: "" }, { ...second, capturedAt: "" });
});

for (const schema of ["older", "newer", "missing-authority"] as const) {
  test(`snapshot refuses ${schema} without migration or database mutations`, async (t) => {
    const fixture = await createWorkflowAuthorityFixture();
    t.after(() => fixture.cleanup());
    const primary = _getAdapter()!;
    if (schema === "older") primary.prepare("DELETE FROM schema_version WHERE version = ?").run(SCHEMA_VERSION);
    if (schema === "newer") primary.prepare("UPDATE schema_version SET version = ? WHERE version = ?").run(SCHEMA_VERSION + 1, SCHEMA_VERSION);
    if (schema === "missing-authority") primary.exec("DELETE FROM project_authority");
    const versions = primary.prepare("SELECT * FROM schema_version ORDER BY version").all();
    const changes = primary.prepare("SELECT total_changes() AS count").get();
    await assert.rejects(readProjectSnapshotFromDb(fixture.root), (error: unknown) => {
      assert.ok(error instanceof Error);
      if (schema === "newer") assert.equal(error.name, "GSDSchemaTooNewError");
      else assert.equal((error as Error & { code: string }).code, "db_unavailable");
      return true;
    });
    assert.equal(_getAdapter(), primary);
    assert.deepEqual(primary.prepare("SELECT * FROM schema_version ORDER BY version").all(), versions);
    assert.deepEqual(primary.prepare("SELECT total_changes() AS count").get(), changes);
    if (schema === "older") {
      await assert.rejects(readProgressFromDb(fixture.root), (error: unknown) =>
        (error as { code?: string }).code === "db_unavailable");
    }
  });
}

test("snapshot rolls back an interrupted query and keeps caller-owned adapter usable", async (t) => {
  const fixture = await createWorkflowAuthorityFixture();
  const adapter = openWorkflowDatabaseIsolated(fixture.dbPath)!;
  t.after(() => { adapter.close(); fixture.cleanup(); });
  const originalPrepare = adapter.prepare.bind(adapter);
  adapter.prepare = (sql: string) => {
    if (sql.includes("FROM workflow_blockers")) throw new Error("private query payload must not be displayed");
    return originalPrepare(sql);
  };
  await assert.rejects(readProjectSnapshotFromDb(fixture.root, { adapter }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal((error as Error & { code: string }).code, "db_unavailable");
    assert.doesNotMatch(error.message, /private query payload/);
    return true;
  });
  adapter.prepare = originalPrepare;
  assert.ok(await readProjectSnapshotFromDb(fixture.root, { adapter }));
  assert.equal(adapter.prepare("SELECT total_changes() AS count").get()?.count, 0);
});

test("snapshot refuses a caller's writable global adapter", async (t) => {
  const fixture = await createWorkflowAuthorityFixture();
  t.after(() => fixture.cleanup());
  const primary = _getAdapter()!;
  await assert.rejects(readProjectSnapshotFromDb(fixture.root, { adapter: primary }), /read-only adapter/);
  assert.equal(primary.prepare("SELECT 1 AS valid").get()?.valid, 1);
});

test("snapshot rejects essential oversized identities instead of truncating an action target", async (t) => {
  const fixture = await createWorkflowAuthorityFixture();
  t.after(() => fixture.cleanup());
  insertMilestone({ id: `M000${"x".repeat(MAX_SNAPSHOT_BYTES)}`, title: "Oversized identity", status: "active" });
  await assert.rejects(readProjectSnapshotFromDb(fixture.root), (error: unknown) =>
    (error as { code?: string }).code === "snapshot_too_large");
});

test("snapshot and progress preserve DB queue order while runtime derivation still repairs it", async (t) => {
  const fixture = await createWorkflowAuthorityFixture();
  t.after(() => fixture.cleanup());
  insertMilestone({ id: "M002", title: "Second", status: "active" });
  setMilestoneQueueOrder(["M002", "M001"]);
  writeFileSync(join(fixture.root, ".gsd", "QUEUE-ORDER.json"), JSON.stringify({ order: ["M001", "M002"] }));
  const snapshot = await readProjectSnapshotFromDb(fixture.root);
  assert.deepEqual(snapshot?.milestones.items.map((m) => m.id), ["M002", "M001"]);
  await readProgressFromDb(fixture.root);
  assert.deepEqual(getAllMilestones().map((m) => m.id), ["M002", "M001"]);
  invalidateStateCache();
  await deriveState(fixture.root);
  assert.deepEqual(getAllMilestones().map((m) => m.id), ["M001", "M002"]);
});

test("observer scope diagnostics do not mutate the session notification store or log buffer", async (t) => {
  const fixture = await createWorkflowAuthorityFixture();
  initNotificationStore(fixture.root);
  t.after(() => { _resetNotificationStore(); fixture.cleanup(); });
  const before = [...peekLogs()];
  const snapshot = await readProjectSnapshotFromDb(fixture.root, { scope: { milestoneId: "M001", sliceId: "S99" } });
  assert.equal(snapshot?.current.phase, "blocked");
  assert.match(snapshot?.current.nextAction ?? "", /Slice lock/);
  assert.deepEqual(peekLogs(), before);
  assert.equal(existsSync(join(fixture.root, ".gsd", "notifications.jsonl")), false);
});
