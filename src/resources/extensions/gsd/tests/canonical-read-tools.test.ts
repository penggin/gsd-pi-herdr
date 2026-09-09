import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";

process.env.GSD_WORKFLOW_EXECUTORS_MODULE = new URL(
  "../tools/workflow-tool-executors.ts",
  import.meta.url,
).pathname;

import { registerDbTools } from "../bootstrap/db-tools.ts";
import { registerWorkflowTools } from "../../../../../packages/mcp-server/src/workflow-tools.ts";
import {
  closeDatabase,
  getDb,
  openDatabase,
} from "../mcp-bridge.ts";
import { insertRequirement, insertMilestone, insertSlice, insertTask, getDbPath } from "../gsd-db.ts";
import { recordSchemaVersion } from "../db-schema-metadata.ts";
import { SCHEMA_VERSION } from "../db/engine.ts";
import { resolveProjectRootDbPath } from "../db-workspace.ts";
import { invalidateAllCaches } from "../cache.ts";

type NativeTool = {
  name: string;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: unknown,
  ) => Promise<Record<string, unknown>>;
};

type McpTool = {
  name: string;
  handler: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

function makeProjectBase(prefix: string): string {
  const base = join(tmpdir(), `${prefix}-${randomUUID()}`);
  mkdirSync(join(base, ".gsd"), { recursive: true });
  return base;
}

function cleanup(basePaths: string[]): void {
  try {
    closeDatabase();
  } catch {
    // noop
  }
  invalidateAllCaches();
  for (const base of basePaths) {
    rmSync(base, { recursive: true, force: true });
  }
}

function makeNativeTools(): NativeTool[] {
  const tools: NativeTool[] = [];
  registerDbTools({
    registerTool(tool: NativeTool) {
      tools.push(tool);
    },
  } as unknown as Parameters<typeof registerDbTools>[0]);
  return tools;
}

function makeMcpTools(): McpTool[] {
  const tools: McpTool[] = [];
  registerWorkflowTools({
    tool(name: string, _description: string, _params: Record<string, unknown>, handler: McpTool["handler"]) {
      tools.push({ name, handler });
    },
  } as Parameters<typeof registerWorkflowTools>[0]);
  return tools;
}

function nativeTool(tools: NativeTool[], name: string): NativeTool {
  const found = tools.find((tool) => tool.name === name);
  assert.ok(found, `${name} should be registered`);
  return found;
}

function mcpTool(tools: McpTool[], name: string): McpTool {
  const found = tools.find((tool) => tool.name === name);
  assert.ok(found, `${name} should be registered`);
  return found;
}

function readError(result: Record<string, unknown>): string | undefined {
  // MCP transports drop the non-standard details field; errors ride on
  // structuredContent (see adaptExecutorResult). Native passes details through.
  const details = (result.structuredContent ?? result.details) as Record<string, unknown> | undefined;
  return typeof details?.error === "string" ? (details.error as string) : undefined;
}

function seedRequirement(id: string, description: string): void {
  insertRequirement({
    id,
    class: "core-capability",
    status: "active",
    description,
    why: "regression",
    source: "test",
    primary_owner: "M001/S01",
    supporting_slices: "",
    validation: "n/a",
    notes: "",
    full_content: `- [ ] **${id}: ${description}**`,
    superseded_by: null,
  });
}

test("canonical snapshot tools reject a missing DB without creating it", async (t) => {
  const base = makeProjectBase("gsd-snapshot-missing");
  t.after(() => cleanup([base]));
  const native = nativeTool(makeNativeTools(), "gsd_project_snapshot");
  const mcp = mcpTool(makeMcpTools(), "gsd_project_snapshot");
  for (const result of [
    await native.execute("snapshot", {}, undefined, undefined, { cwd: base }),
    await mcp.handler({ projectDir: base }),
  ]) {
    assert.equal(result.isError, true);
    assert.equal(readError(result), "db_unavailable");
    assert.equal(existsSync(join(base, ".gsd", "gsd.db")), false);
  }
});

function seedSnapshotProject(base: string, title: string): void {
  openDatabase(resolveProjectRootDbPath(base));
  insertMilestone({ id: "M001", title, status: "active" });
  insertSlice({ id: "S01", milestoneId: "M001", title: "Slice from DB", status: "active", sequence: 1 });
  insertTask({ id: "T01", sliceId: "S01", milestoneId: "M001", title: "Task from DB", status: "pending", sequence: 1 });
}

async function snapshotToolResults(base: string) {
  return [
    await nativeTool(makeNativeTools(), "gsd_project_snapshot").execute("snapshot", {}, undefined, undefined, { cwd: base }),
    await mcpTool(makeMcpTools(), "gsd_project_snapshot").handler({ projectDir: base }),
  ];
}

function snapshotDetails(result: Record<string, unknown>): Record<string, any> {
  return (result.structuredContent ?? result.details) as Record<string, any>;
}

function snapshotPayload(result: Record<string, unknown>): Record<string, any> {
  return JSON.parse((result.content as Array<{ text: string }>)[0].text);
}

test("canonical snapshot native and MCP parity preserves another project's held adapter and queue bytes", async (t) => {
  const baseA = makeProjectBase("gsd-snapshot-a");
  const baseB = makeProjectBase("gsd-snapshot-b");
  t.after(() => cleanup([baseA, baseB]));
  seedSnapshotProject(baseB, "B from DB");
  insertMilestone({ id: "M002", title: "Second", status: "pending" });
  const queuePath = join(baseB, ".gsd", "QUEUE-ORDER.json");
  const queueBytes = '{"order":["M002","M001"]}\n';
  writeFileSync(queuePath, queueBytes);
  writeFileSync(join(baseB, ".gsd", "STATE.md"), "# Stale projection\n**Phase:** complete\n");
  seedSnapshotProject(baseA, "A from DB");
  const adapter = getDb();
  const heldStatement = adapter.prepare("SELECT title FROM milestones WHERE id = 'M001'");
  const globalPath = getDbPath();
  const results = await snapshotToolResults(baseB);
  const snapshots = results.map((result) => {
    assert.equal(result.isError, undefined);
    const details = snapshotDetails(result);
    const snapshot = snapshotPayload(result);
    assert.equal(details.error, undefined);
    assert.equal(details.operation, "read_project_snapshot");
    assert.equal(details.revision, snapshot.authority.revision);
    assert.equal(details.snapshot, undefined, "full snapshot must not be duplicated in transport metadata");
    assert.deepEqual(details.truncation, snapshot.truncation);
    assert.deepEqual(details.consistency, snapshot.consistency);
    assert.equal(snapshot.progress.milestones.total, 2);
    assert.equal(snapshot.progress.tasks.total, 1);
    assert.equal(snapshot.milestones.items[0].title, "B from DB");
    return { ...snapshot, capturedAt: "ignored" };
  });
  assert.deepEqual(snapshots[0], snapshots[1]);
  assert.equal(getDb(), adapter);
  assert.equal(getDbPath(), globalPath);
  assert.equal(heldStatement.get()?.title, "A from DB");
  assert.equal(readFileSync(queuePath, "utf8"), queueBytes);
});

test("canonical snapshot tool resolves worktree context and explicit native project override", async (t) => {
  const base = makeProjectBase("gsd-snapshot-worktree");
  const unrelated = makeProjectBase("gsd-snapshot-context");
  t.after(() => cleanup([base, unrelated]));
  seedSnapshotProject(base, "Canonical root");
  const worktree = join(base, ".gsd-worktrees", "M001");
  mkdirSync(join(worktree, ".gsd"), { recursive: true });
  for (const result of await snapshotToolResults(worktree)) {
    assert.equal(snapshotPayload(result).milestones.items[0].title, "Canonical root");
  }
  const overridden = await nativeTool(makeNativeTools(), "gsd_project_snapshot").execute(
    "snapshot", { projectDir: base }, undefined, undefined, { cwd: unrelated });
  assert.equal(snapshotPayload(overridden).milestones.items[0].title, "Canonical root");
  const relativeOverride = await nativeTool(makeNativeTools(), "gsd_project_snapshot").execute(
    "snapshot", { projectDir: relative(unrelated, base) }, undefined, undefined, { cwd: unrelated });
  assert.equal(relativeOverride.isError, undefined, "relative project paths resolve from the native session directory");
  assert.equal(snapshotPayload(relativeOverride).milestones.items[0].title, "Canonical root");
  assert.equal(existsSync(join(worktree, ".gsd", "gsd.db")), false);
  assert.equal(existsSync(join(unrelated, ".gsd", "gsd.db")), false);
});

for (const fault of ["missing-authority", "newer-schema", "corrupt-query"] as const) {
  test(`canonical snapshot native and MCP return typed ${fault} errors`, async (t) => {
    const base = makeProjectBase(`gsd-snapshot-${fault}`);
    t.after(() => cleanup([base]));
    seedSnapshotProject(base, "Fault fixture");
    if (fault === "missing-authority") getDb().prepare("DELETE FROM project_authority").run();
    if (fault === "newer-schema") recordSchemaVersion(getDb(), SCHEMA_VERSION + 1);
    if (fault === "corrupt-query") getDb().prepare("DROP TABLE workflow_blockers").run();
    const expectedError = fault === "newer-schema" ? "schema_too_new" : "db_unavailable";
    for (const result of await snapshotToolResults(base)) {
      assert.equal(result.isError, true);
      assert.equal(readError(result), expectedError);
      assert.equal(snapshotDetails(result).snapshot, undefined);
      assert.equal(typeof snapshotDetails(result).message, "string");
      assert.ok(!String(snapshotDetails(result).message).includes("\n    at "), "error must not include a raw stack");
    }
  });
}

test("canonical snapshot transports bound the complete escaped UTF-8 result without duplicating the snapshot", async (t) => {
  const base = makeProjectBase("gsd-snapshot-wire-budget");
  t.after(() => cleanup([base]));
  seedSnapshotProject(base, '큰 제목🙂"\\'.repeat(1500));
  for (let index = 2; index <= 65; index++) {
    insertMilestone({ id: `M${String(index).padStart(3, "0")}`, title: '큰 제목🙂"\\'.repeat(1500), status: "pending" });
  }
  for (const result of await snapshotToolResults(base)) {
    assert.equal(result.isError, undefined);
    const snapshot = snapshotPayload(result);
    assert.equal(snapshot.progress.milestones.total, 65);
    assert.equal(snapshot.milestones.truncated, true);
    assert.equal(snapshot.truncation.text, true);
    assert.equal(snapshotDetails(result).snapshot, undefined);
    // A JSON string in tool content may double escaped bytes. The complete
    // wire envelope stays below 540 KiB (2 × 256 KiB plus metadata headroom).
    assert.ok(Buffer.byteLength(JSON.stringify(result), "utf8") < 540 * 1024);
    assert.ok(Buffer.byteLength(JSON.stringify(snapshot, null, 2), "utf8") <= 256 * 1024);
  }
});

test("canonical snapshot tools fail explicitly when an essential identifier exceeds the byte budget", async (t) => {
  const base = makeProjectBase("gsd-snapshot-oversize-id");
  t.after(() => cleanup([base]));
  openDatabase(join(base, ".gsd", "gsd.db"));
  insertMilestone({ id: `M${"x".repeat(262_144)}`, title: "Oversized identifier", status: "active" });
  for (const result of await snapshotToolResults(base)) {
    assert.equal(result.isError, true);
    assert.equal(readError(result), "snapshot_too_large");
    assert.equal(snapshotDetails(result).snapshot, undefined);
    assert.ok(Buffer.byteLength(JSON.stringify(result), "utf8") < 4096);
  }
});

test("canonical snapshot interfaces isolate cross-project scope and retain same-project alias scope", async (t) => {
  const baseA = makeProjectBase("gsd-snapshot-scope-a");
  const baseB = makeProjectBase("gsd-snapshot-scope-b");
  const previousCwd = process.cwd();
  const previousLock = process.env.GSD_MILESTONE_LOCK;
  t.after(() => {
    process.chdir(previousCwd);
    if (previousLock === undefined) delete process.env.GSD_MILESTONE_LOCK;
    else process.env.GSD_MILESTONE_LOCK = previousLock;
    cleanup([baseA, baseB]);
  });
  for (const base of [baseA, baseB]) {
    seedSnapshotProject(base, "Default focus");
    insertMilestone({ id: "M002", title: "Locked focus", status: "active" });
  }
  const aliasA = join(baseA, "alias");
  symlinkSync(baseA, aliasA, "dir");
  process.chdir(baseA);
  process.env.GSD_MILESTONE_LOCK = "M002";
  const native = nativeTool(makeNativeTools(), "gsd_project_snapshot");
  const mcp = mcpTool(makeMcpTools(), "gsd_project_snapshot");
  for (const [target, expected] of [[baseB, "M001"], [aliasA, "M002"]]) {
    for (const result of [
      await native.execute("snapshot", { projectDir: target }, undefined, undefined, { cwd: baseA }),
      await mcp.handler({ projectDir: target }),
    ]) {
      assert.equal(result.isError, undefined);
      assert.equal(snapshotPayload(result).current.activeMilestone.id, expected);
    }
  }
});

test("canonical read tools: missing DB returns db_unavailable and does not create gsd.db", async () => {
  const base = makeProjectBase("gsd-canonical-missing-db");
  try {
    const native = makeNativeTools();
    const mcp = makeMcpTools();
    const dbPath = resolveProjectRootDbPath(base);

    assert.equal(existsSync(dbPath), false, "fixture starts without gsd.db");

    const nativeList = await nativeTool(native, "gsd_requirement_list").execute(
      "call-1",
      {},
      undefined,
      undefined,
      { cwd: base },
    );
    const nativeDetails = (nativeList as { details?: Record<string, unknown> }).details;
    assert.equal(nativeDetails?.error, "db_unavailable");
    assert.equal(existsSync(dbPath), false, "native read should not create gsd.db as side effect");

    const mcpList = await mcpTool(mcp, "gsd_requirement_list").handler({ projectDir: base });
    // MCP transports drop the non-standard details field; the error detail now
    // rides on structuredContent (see adaptExecutorResult).
    const mcpRecord = mcpList as { details?: Record<string, unknown>; structuredContent?: Record<string, unknown> };
    assert.equal(mcpRecord.structuredContent?.error, "db_unavailable");
    assert.equal(existsSync(dbPath), false, "MCP read should not create gsd.db as side effect");
  } finally {
    cleanup([base]);
  }
});

test("canonical read tools: reading project B does not switch global DB handle from project A", async () => {
  const baseA = makeProjectBase("gsd-canonical-global-a");
  const baseB = makeProjectBase("gsd-canonical-global-b");
  try {
    const native = makeNativeTools();
    const mcp = makeMcpTools();

    openDatabase(resolveProjectRootDbPath(baseA));
    seedRequirement("R101", "A requirement");

    openDatabase(resolveProjectRootDbPath(baseB));
    seedRequirement("R201", "B requirement");

    openDatabase(resolveProjectRootDbPath(baseA));
    const before = getDbPath();
    assert.ok(before, "global DB should be open on project A");

    const nativeList = await nativeTool(native, "gsd_requirement_list").execute(
      "call-2",
      { limit: 10 },
      undefined,
      undefined,
      { cwd: baseB },
    );
    const nativeCount = ((nativeList as { details?: { count?: number } }).details?.count ?? -1);
    assert.equal(nativeCount, 1, "native isolated read should query project B rows");
    assert.equal(getDbPath(), before, "native isolated read must keep global DB path unchanged");

    const mcpList = await mcpTool(mcp, "gsd_requirement_list").handler({
      projectDir: baseB,
      limit: 10,
    });
    const mcpCount = ((mcpList as { structuredContent?: { count?: number } }).structuredContent?.count ?? -1);
    assert.equal(mcpCount, 1, "MCP isolated read should query project B rows");
    assert.equal(getDbPath(), before, "MCP isolated read must keep global DB path unchanged");
  } finally {
    cleanup([baseA, baseB]);
  }
});

test("canonical read tools: query_error returns structured error and does not break subsequent isolated reads", async () => {
  const base = makeProjectBase("gsd-canonical-query-error");
  try {
    const native = makeNativeTools();
    const mcp = makeMcpTools();
    const dbPath = resolveProjectRootDbPath(base);

    openDatabase(dbPath);
    const db = (await import("../gsd-db.ts"))._getAdapter();
    assert.ok(db, "adapter should be available");
    db.prepare("DROP TABLE requirements").run();

    const nativeResult = await nativeTool(native, "gsd_requirement_list").execute(
      "call-3",
      {},
      undefined,
      undefined,
      { cwd: base },
    );
    const nativeDetails = (nativeResult as { details?: Record<string, unknown> }).details;
    assert.equal(nativeDetails?.error, "query_error");

    const mcpResult = await mcpTool(mcp, "gsd_requirement_list").handler({ projectDir: base });
    const mcpDetails = (mcpResult as { structuredContent?: Record<string, unknown> }).structuredContent;
    assert.equal(mcpDetails?.error, "query_error");

    const isolated = (await import("../db-workspace.ts")).openWorkflowDatabaseIsolated(dbPath);
    assert.ok(isolated, "isolated open should still work after handled query_error");
    isolated?.close();
  } finally {
    cleanup([base]);
  }
});

test("canonical read tools: native and MCP read the same canonical requirement row", async () => {
  const base = makeProjectBase("gsd-canonical-parity");
  try {
    const native = makeNativeTools();
    const mcp = makeMcpTools();

    openDatabase(resolveProjectRootDbPath(base));
    seedRequirement("R777", "Parity requirement");

    const nativeGet = await nativeTool(native, "gsd_requirement_get").execute(
      "call-4",
      { id: "R777" },
      undefined,
      undefined,
      { cwd: base },
    );
    const nativeRequirement = (nativeGet as { details?: { requirement?: Record<string, unknown> } }).details?.requirement;

    const mcpGet = await mcpTool(mcp, "gsd_requirement_get").handler({
      projectDir: base,
      id: "R777",
    });
    const mcpRequirement = (mcpGet as { structuredContent?: { requirement?: Record<string, unknown> } }).structuredContent?.requirement;

    assert.equal(nativeRequirement?.id, "R777");
    assert.equal(mcpRequirement?.id, "R777");
    assert.equal(nativeRequirement?.description, "Parity requirement");
    assert.equal(mcpRequirement?.description, "Parity requirement");
  } finally {
    cleanup([base]);
  }
});

test("canonical read parity: empty valid DB returns consistent empty list semantics", async () => {
  const base = makeProjectBase("gsd-canonical-empty-db");
  try {
    const native = makeNativeTools();
    const mcp = makeMcpTools();

    assert.ok(openDatabase(resolveProjectRootDbPath(base)), "fixture database should open successfully");

    const nativeList = await nativeTool(native, "gsd_decision_list").execute(
      "call-5",
      { limit: 20 },
      undefined,
      undefined,
      { cwd: base },
    );
    const mcpList = await mcpTool(mcp, "gsd_decision_list").handler({
      projectDir: base,
      limit: 20,
    });

    const nativeDetails = nativeList.details as { count?: number; error?: string } | undefined;
    const mcpDetails = mcpList.structuredContent as { count?: number; error?: string } | undefined;

    assert.equal(nativeDetails?.error, undefined);
    assert.equal(mcpDetails?.error, undefined);
    assert.equal(nativeDetails?.count, 0);
    assert.equal(mcpDetails?.count, 0);
  } finally {
    cleanup([base]);
  }
});

test("canonical read parity: unknown ID returns not_found for native and MCP", async () => {
  const base = makeProjectBase("gsd-canonical-unknown-id");
  try {
    const native = makeNativeTools();
    const mcp = makeMcpTools();

    assert.ok(openDatabase(resolveProjectRootDbPath(base)), "fixture database should open successfully");

    const nativeGet = await nativeTool(native, "gsd_requirement_get").execute(
      "call-6",
      { id: "R999" },
      undefined,
      undefined,
      { cwd: base },
    );
    const mcpGet = await mcpTool(mcp, "gsd_requirement_get").handler({
      projectDir: base,
      id: "R999",
    });

    assert.equal(readError(nativeGet), "not_found");
    assert.equal(readError(mcpGet), "not_found");
  } finally {
    cleanup([base]);
  }
});

test("canonical read parity: corrupt requirements table returns query_error for native and MCP", async () => {
  const base = makeProjectBase("gsd-canonical-query-error-parity");
  try {
    const native = makeNativeTools();
    const mcp = makeMcpTools();

    openDatabase(resolveProjectRootDbPath(base));
    const db = getDb();
    db.prepare("DROP TABLE requirements").run();

    const nativeReqList = await nativeTool(native, "gsd_requirement_list").execute(
      "call-7",
      {},
      undefined,
      undefined,
      { cwd: base },
    );
    const mcpReqList = await mcpTool(mcp, "gsd_requirement_list").handler({ projectDir: base });

    assert.equal(readError(nativeReqList), "query_error");
    assert.equal(readError(mcpReqList), "query_error");
  } finally {
    cleanup([base]);
  }
});
