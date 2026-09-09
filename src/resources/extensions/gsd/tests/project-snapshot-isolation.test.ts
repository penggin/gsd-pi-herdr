// Independent acceptance coverage for snapshot isolation and bounded read-only output.

import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { _getAdapter, closeDatabase, insertMilestone, insertSlice, insertTask } from "../gsd-db.ts";
import type { DbAdapter } from "../db-adapter.ts";
import { _setSqliteReadOnlyOpenBoundaryForTest, openSqliteReadOnly } from "../sqlite-readonly.ts";
import {
  MAX_SNAPSHOT_BYTES,
  MAX_SNAPSHOT_MILESTONES,
  MAX_SNAPSHOT_OPEN_ITEMS,
  MAX_SNAPSHOT_TEXT_CHARS,
  projectReadOptionsForTarget,
  readProjectSnapshotFromDb,
} from "../state/project-snapshot.ts";
import { createWorkflowAuthorityFixture, type WorkflowAuthorityFixture } from "./workflow-authority-fixture.ts";

async function fixture(t: TestContext, title: string): Promise<WorkflowAuthorityFixture> {
  const value = await createWorkflowAuthorityFixture();
  t.after(() => value.cleanup());
  _getAdapter()!.prepare("UPDATE milestones SET title = ? WHERE id = 'M001'").run(title);
  return value;
}

function durableRows(db: DbAdapter): unknown {
  return {
    schema: db.prepare("SELECT type, name, sql FROM sqlite_schema ORDER BY type, name").all(),
    migrations: db.prepare("SELECT * FROM schema_version ORDER BY version").all(),
    authority: db.prepare("SELECT * FROM project_authority").all(),
    milestones: db.prepare("SELECT id, title, status, sequence FROM milestones ORDER BY id").all(),
    operations: db.prepare("SELECT * FROM workflow_operations ORDER BY operation_id").all(),
    projections: db.prepare("SELECT * FROM workflow_projection_work ORDER BY projection_work_id").all(),
  };
}

test("snapshot reads of another project preserve the caller's live adapter and prepared statements", async (t) => {
  const a = await fixture(t, "Project A");
  const b = await fixture(t, "Project B");
  a.reopen();
  const caller = _getAdapter()!;
  const statement = caller.prepare("SELECT title FROM milestones WHERE id = 'M001'");
  const original = statement.get();

  const snapshot = await readProjectSnapshotFromDb(b.root);

  assert.ok(snapshot);
  assert.equal(snapshot.current.activeMilestone?.title, "Project B");
  assert.equal(_getAdapter(), caller, "snapshot never swaps the process-wide adapter");
  assert.deepEqual(statement.get(), original, "an already prepared caller statement remains valid");
  assert.equal(statement.get()?.title, "Project A");
});

test("concurrent alternating project snapshots and canonical path aliases do not share state", async (t) => {
  const a = await fixture(t, "Project A");
  const b = await fixture(t, "Project B");
  const alias = join(a.root, "project-b-link");
  symlinkSync(b.root, alias, "dir");
  a.reopen();
  const caller = _getAdapter();
  const requests = [a.root, b.root, alias, a.root, b.root, alias];
  const snapshots = await Promise.all(requests.map((root) => readProjectSnapshotFromDb(root)));

  assert.deepEqual(snapshots.map((snapshot) => snapshot?.current.activeMilestone?.title), [
    "Project A", "Project B", "Project B", "Project A", "Project B", "Project B",
  ]);
  assert.notEqual(snapshots[0]?.authority.projectId, snapshots[1]?.authority.projectId);
  assert.equal(snapshots[1]?.authority.projectId, snapshots[2]?.authority.projectId);
  assert.equal(_getAdapter(), caller);
});

test("foreign project reads discard session scope while same-project aliases retain it without changing the environment", async (t) => {
  const a = await fixture(t, "Project A");
  insertMilestone({ id: "M002", title: "Scoped A", status: "active" });
  insertSlice({ id: "S01", milestoneId: "M002", title: "Scoped slice A", status: "pending", risk: "low", depends: [], sequence: 1 });
  insertTask({ id: "T01", milestoneId: "M002", sliceId: "S01", title: "Scoped task A", status: "pending" });
  const b = await fixture(t, "Project B");
  insertMilestone({ id: "M002", title: "Scoped B", status: "active" });
  insertSlice({ id: "S01", milestoneId: "M002", title: "Scoped slice B", status: "pending", risk: "low", depends: [], sequence: 1 });
  insertTask({ id: "T01", milestoneId: "M002", sliceId: "S01", title: "Scoped task B", status: "pending" });
  const alias = join(b.root, "project-a-alias");
  symlinkSync(a.root, alias, "dir");
  a.reopen();
  const keys = ["GSD_MILESTONE_LOCK", "GSD_PARALLEL_WORKER", "GSD_SLICE_LOCK"] as const;
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });
  process.env.GSD_MILESTONE_LOCK = "M002";
  process.env.GSD_PARALLEL_WORKER = "1";
  process.env.GSD_SLICE_LOCK = "S01";
  const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

  const foreignOptions = projectReadOptionsForTarget(b.root, a.root);
  const sameProjectOptions = projectReadOptionsForTarget(alias, a.root);
  const [foreign, sameProject] = await Promise.all([
    readProjectSnapshotFromDb(b.root, foreignOptions),
    readProjectSnapshotFromDb(alias, sameProjectOptions),
  ]);

  assert.deepEqual(foreignOptions.scope, {});
  assert.deepEqual(sameProjectOptions.scope, { milestoneId: "M002", sliceId: "S01" });
  assert.equal(foreign?.current.activeMilestone?.id, "M001");
  assert.equal(foreign?.current.activeMilestone?.title, "Project B");
  assert.equal(foreign?.current.activeSlice?.id, "S02");
  assert.equal(sameProject?.current.activeMilestone?.title, "Scoped A");
  assert.equal(sameProject?.current.activeSlice?.id, "S01");
  assert.equal(sameProject?.progress.milestones.total, 2, "counts stay project-wide under execution scope");
  assert.deepEqual(Object.fromEntries(keys.map((key) => [key, process.env[key]])), before);
});

test("snapshot ignores conflicting queue-order projection without writes or implicit migrations", async (t) => {
  const value = await fixture(t, "Canonical first");
  insertMilestone({ id: "M002", title: "Canonical second", status: "pending" });
  const caller = _getAdapter()!;
  caller.prepare("UPDATE milestones SET sequence = CASE id WHEN 'M001' THEN 1 ELSE 2 END").run();
  const queuePath = join(value.root, ".gsd", "QUEUE-ORDER.json");
  writeFileSync(queuePath, JSON.stringify({ order: ["M002", "M001"], updatedAt: "2099-01-01T00:00:00Z" }));
  const queueBefore = readFileSync(queuePath);
  const before = durableRows(caller);
  const changes = caller.prepare("SELECT total_changes() AS count").get()?.count;
  const readOnly = openSqliteReadOnly(value.dbPath).db;
  t.after(() => readOnly.close());

  const snapshot = await readProjectSnapshotFromDb(value.root, { adapter: readOnly });

  assert.ok(snapshot);
  assert.deepEqual(snapshot.milestones.items.map((item) => item.id), ["M001", "M002"]);
  assert.equal(snapshot.current.activeMilestone?.id, "M001");
  assert.deepEqual(durableRows(caller), before);
  assert.deepEqual(readFileSync(queuePath), queueBefore);
  assert.equal(caller.prepare("SELECT total_changes() AS count").get()?.count, changes);
  assert.equal(readOnly.prepare("SELECT total_changes() AS count").get()?.count, 0);
  assert.equal(readOnly.prepare("PRAGMA query_only").get()?.query_only, 1, "borrowed adapter remains open and read-only");
});

for (const boundary of ["beforeRaw", "afterRaw"] as const) {
  test(`snapshot refuses deletion at ${boundary} and never recreates the missing database`, async (t) => {
    const value = await fixture(t, "Deleted project");
    closeDatabase();
    let removed = false;
    _setSqliteReadOnlyOpenBoundaryForTest({
      [boundary](path: string) {
        if (path !== value.dbPath) return;
        removed = true;
        rmSync(path);
      },
    });
    t.after(() => _setSqliteReadOnlyOpenBoundaryForTest(null));

    assert.equal(await readProjectSnapshotFromDb(value.root), null, "an unavailable read never returns a successful snapshot");

    assert.equal(removed, true, "the test exercised the actual read-only open boundary");
    assert.equal(existsSync(value.dbPath), false);
  });
}

test("snapshot refuses a replacement database at the open boundary", async (t) => {
  const original = await fixture(t, "Original identity");
  const replacement = await fixture(t, "Replacement identity");
  closeDatabase();
  const replacementBytes = readFileSync(replacement.dbPath);
  let replaced = false;
  _setSqliteReadOnlyOpenBoundaryForTest({
    afterRaw(path) {
      if (path !== original.dbPath) return;
      replaced = true;
      renameSync(replacement.dbPath, original.dbPath);
    },
  });
  t.after(() => _setSqliteReadOnlyOpenBoundaryForTest(null));

  await assert.rejects(() => readProjectSnapshotFromDb(original.root), { code: "db_unavailable" });

  assert.equal(replaced, true);
  assert.deepEqual(readFileSync(original.dbPath), replacementBytes, "failed read does not rewrite the replacement");
});

test("one snapshot retains a consistent authority and title while an external writer keeps committing", async (t) => {
  const value = await fixture(t, "Initial generation");
  const caller = _getAdapter()!;
  const originalRevision = Number(caller.prepare("SELECT revision FROM project_authority").get()?.revision);
  caller.prepare("UPDATE milestones SET title = ? WHERE id = 'M001'").run(`Generation ${originalRevision}`);
  const writer = new DatabaseSync(value.dbPath);
  t.after(() => writer.close());
  const connection = openSqliteReadOnly(value.dbPath).db;
  t.after(() => connection.close());
  let inTransaction = false;
  let writes = 0;
  const adapter: DbAdapter = {
    close: () => connection.close(),
    exec(sql) {
      connection.exec(sql);
      if (/^BEGIN\b/i.test(sql.trim())) inTransaction = true;
      if (/^(?:COMMIT|ROLLBACK)\b/i.test(sql.trim())) inTransaction = false;
    },
    prepare(sql) {
      const statement = connection.prepare(sql);
      function afterRead<T>(result: T): T {
        if (inTransaction && writes < 12 && /^SELECT\b/i.test(sql.trim())) {
          writes += 1;
          writer.exec("BEGIN IMMEDIATE");
          writer.prepare("UPDATE project_authority SET revision = revision + 1 WHERE singleton = 1").run();
          writer.prepare("UPDATE milestones SET title = ? WHERE id = 'M001'").run(`Generation ${originalRevision + writes}`);
          writer.exec("COMMIT");
        }
        return result;
      }
      return {
        run: (...params) => statement.run(...params),
        get: (...params) => afterRead(statement.get(...params)),
        all: (...params) => afterRead(statement.all(...params)),
      };
    },
  };

  const snapshot = await readProjectSnapshotFromDb(value.root, { adapter });

  assert.ok(snapshot);
  assert.ok(writes >= 3, "multiple external commits overlapped the snapshot reads");
  assert.equal(snapshot.authority.revision, originalRevision);
  assert.equal(snapshot.current.activeMilestone?.title, `Generation ${originalRevision}`);
  assert.equal(snapshot.milestones.items[0]?.title, `Generation ${originalRevision}`);
  assert.equal(snapshot.consistency.database, "transaction");
  assert.equal(snapshot.consistency.auxiliaryFiles, "not-revision-bound");
  assert.equal(Number(writer.prepare("SELECT revision FROM project_authority").get()?.revision), originalRevision + writes);
  assert.equal(_getAdapter(), caller);
});

function seedLargeOpenItems(db: DbAdapter, count: number, text: string): void {
  const projectId = String(db.prepare("SELECT project_id FROM project_authority").get()?.project_id);
  db.prepare(`INSERT INTO workflow_operations (
    operation_id, project_id, operation_type, idempotency_key, expected_revision, resulting_revision,
    expected_authority_epoch, resulting_authority_epoch, actor_type, actor_id, source_transport, request_hash, created_at
  ) VALUES ('snapshot-bounds', ?, 'snapshot-test', 'snapshot-bounds', 900000, 900001, 0, 0, 'agent', 'test', 'test', 'test-hash', '2026-01-01T00:00:00Z')`).run(projectId);
  db.prepare(`INSERT INTO workflow_item_lifecycles (
    lifecycle_id, project_id, item_kind, milestone_id, lifecycle_status, created_at, updated_at,
    last_operation_id, last_project_revision, last_authority_epoch
  ) VALUES ('snapshot-bounds-life', ?, 'milestone', 'M001', 'in_progress', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'snapshot-bounds', 900001, 0)`).run(projectId);
  for (let index = 0; index < count; index += 1) {
    const suffix = String(index).padStart(4, "0");
    db.prepare(`INSERT INTO workflow_blockers (
      blocker_id, project_id, lifecycle_id, blocker_kind, resolution_owner, blocker_status,
      description, requested_action, opened_at, opened_operation_id, opened_project_revision, opened_authority_epoch
    ) VALUES (?, ?, 'snapshot-bounds-life', 'ambiguous_intent', 'user', 'open', ?, ?, '2026-01-01T00:00:00Z', 'snapshot-bounds', 900001, 0)`)
      .run(`B-${suffix}`, projectId, text, text);
    db.prepare(`INSERT INTO workflow_open_questions (
      question_id, project_id, lifecycle_id, question_text, question_status, state_version,
      created_at, updated_at, created_operation_id, created_project_revision, created_authority_epoch,
      last_operation_id, last_project_revision, last_authority_epoch
    ) VALUES (?, ?, 'snapshot-bounds-life', ?, 'open', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'snapshot-bounds', 900001, 0, 'snapshot-bounds', 900001, 0)`)
      .run(`Q-${suffix}`, projectId, text);
  }
}

test("multibyte titles and open items obey byte and collection caps with explicit truncation", async (t) => {
  const longText = "🚀".repeat(MAX_SNAPSHOT_TEXT_CHARS);
  const value = await fixture(t, longText);
  seedLargeOpenItems(_getAdapter()!, MAX_SNAPSHOT_OPEN_ITEMS + 1, longText);
  for (let index = 2; index <= MAX_SNAPSHOT_MILESTONES + 1; index += 1) {
    insertMilestone({ id: `M${String(index).padStart(3, "0")}`, title: longText, status: "pending" });
  }

  const snapshot = await readProjectSnapshotFromDb(value.root);

  assert.ok(snapshot);
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot, null, 2), "utf8") <= MAX_SNAPSHOT_BYTES);
  assert.ok(snapshot.milestones.items.length <= MAX_SNAPSHOT_MILESTONES);
  assert.ok(snapshot.blockers.length <= MAX_SNAPSHOT_OPEN_ITEMS);
  assert.ok(snapshot.openQuestions.length <= MAX_SNAPSHOT_OPEN_ITEMS);
  assert.equal(snapshot.progress.milestones.total, MAX_SNAPSHOT_MILESTONES + 1);
  assert.equal(snapshot.milestones.truncated, true);
  assert.equal(snapshot.truncation.blockers, true);
  assert.equal(snapshot.truncation.openQuestions, true);
  assert.equal(snapshot.truncation.text, true);
  assert.equal(snapshot.truncation.byteBudget, true, "the item/text caps alone exceed the byte budget");
  assert.ok(snapshot.current.activeMilestone!.title.length <= MAX_SNAPSHOT_TEXT_CHARS);
  assert.doesNotMatch(snapshot.current.activeMilestone!.title, /[\uD800-\uDFFF]/u, "text truncation does not split Unicode surrogate pairs");
  assert.ok(snapshot.milestones.items.every((item) => item.title.length <= MAX_SNAPSHOT_TEXT_CHARS));
  assert.ok(snapshot.blockers.every((item) => item.description.length <= MAX_SNAPSHOT_TEXT_CHARS && item.requestedAction.length <= MAX_SNAPSHOT_TEXT_CHARS));
  assert.ok(snapshot.openQuestions.every((item) => item.questionText.length <= MAX_SNAPSHOT_TEXT_CHARS));
});
