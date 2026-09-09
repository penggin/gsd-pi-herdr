import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runReadCli, type DbSnapshotModuleImporter, type DbSnapshotReader } from "../read-cli.ts";
import { closeDatabase, openDatabase, getDb, getDbPath, insertMilestone, insertSlice, insertTask } from "../resources/extensions/gsd/gsd-db.ts";
import { recordSchemaVersion } from "../resources/extensions/gsd/db-schema-metadata.ts";
import { SCHEMA_VERSION } from "../resources/extensions/gsd/db/engine.ts";

const exec = promisify(execFile);
const repository = fileURLToPath(new URL("../../", import.meta.url));
const realImporter: DbSnapshotModuleImporter = () => import("../resources/extensions/gsd/state/project-snapshot.ts");

function project(t: test.TestContext): string {
  const base = mkdtempSync(join(tmpdir(), "gsd-read-snapshot-"));
  mkdirSync(join(base, ".gsd"));
  writeFileSync(join(base, ".gsd", "STATE.md"), "# Stale state\n**Phase:** complete\n");
  t.after(() => { closeDatabase(); rmSync(base, { recursive: true, force: true }); });
  return base;
}

function seed(base: string, title: string): void {
  assert.equal(openDatabase(join(base, ".gsd", "gsd.db")), true);
  insertMilestone({ id: "M001", title, status: "active" });
  insertSlice({ id: "S01", milestoneId: "M001", title: "Slice", status: "active", sequence: 1 });
  insertTask({ id: "T01", milestoneId: "M001", sliceId: "S01", title: "Task", status: "pending", sequence: 1 });
}

async function capture(base: string, options: { reader?: DbSnapshotReader; importer?: DbSnapshotModuleImporter; json?: boolean } = {}) {
  let stdout = "";
  let stderr = "";
  const previousOut = process.stdout.write;
  const previousErr = process.stderr.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    if (typeof chunk !== "string") return previousOut.call(process.stdout, chunk);
    stdout += chunk; return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    if (typeof chunk !== "string") return previousErr.call(process.stderr, chunk);
    stderr += chunk; return true;
  }) as typeof process.stderr.write;
  try {
    const exitCode = await runReadCli(
      ["node", "gsd", "read", "snapshot", "--project", base, ...(options.json === false ? [] : ["--json"])],
      undefined, undefined, undefined, options.reader, options.importer ?? realImporter,
    );
    return { exitCode, stdout, stderr };
  } finally {
    process.stdout.write = previousOut;
    process.stderr.write = previousErr;
  }
}

test("snapshot CLI serves the real reader from a worktree without switching another project's adapter", async (t) => {
  const base = project(t);
  const other = project(t);
  seed(base, "Canonical DB title");
  seed(other, "Held project");
  const adapter = getDb();
  const statement = adapter.prepare("SELECT title FROM milestones WHERE id = 'M001'");
  const dbPath = getDbPath();
  const worktree = join(base, ".gsd-worktrees", "M001");
  mkdirSync(join(worktree, ".gsd"), { recursive: true });
  const result = await capture(worktree);
  assert.equal(result.exitCode, 0, result.stderr);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.integration_version, 1);
  assert.equal(envelope.kind, "snapshot");
  assert.equal(envelope.projectDir, resolve(worktree));
  assert.equal(envelope.data.milestones.items[0].title, "Canonical DB title");
  assert.equal(envelope.data.progress.tasks.total, 1);
  assert.equal(getDb(), adapter);
  assert.equal(getDbPath(), dbPath);
  assert.equal(statement.get()?.title, "Held project");
  assert.equal(existsSync(join(worktree, ".gsd", "gsd.db")), false);
});

test("gsd read snapshot entry point loads the real DB reader in a separate process", async (t) => {
  const base = project(t);
  seed(base, "CLI child DB");
  closeDatabase();
  const result = await exec(process.execPath, [
    "--import", "./src/resources/extensions/gsd/tests/resolve-ts.mjs", "--experimental-strip-types", "src/cli.ts",
    "read", "snapshot", "--project", base, "--json",
  ], { cwd: repository, env: { ...process.env, GSD_AGENT_DIR: join(base, "test-agent"), GSD_HOME: join(base, "test-home") }, timeout: 30_000, maxBuffer: 300_000 });
  assert.equal(JSON.parse(result.stdout).data.milestones.items[0].title, "CLI child DB");
});

for (const fault of ["missing", "missing-authority", "newer-schema", "query"] as const) {
  test(`snapshot CLI reports ${fault} with a typed error and no success data`, async (t) => {
    const base = project(t);
    if (fault !== "missing") seed(base, "Fault fixture");
    if (fault === "missing-authority") getDb().prepare("DELETE FROM project_authority").run();
    if (fault === "newer-schema") recordSchemaVersion(getDb(), SCHEMA_VERSION + 1);
    if (fault === "query") getDb().prepare("DROP TABLE workflow_blockers").run();
    const result = await capture(base);
    assert.equal(result.exitCode, 1);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.kind, "snapshot");
    assert.equal("data" in envelope, false);
    const expected = fault === "newer-schema" ? "schema_too_new" : "db_unavailable";
    assert.equal(envelope.error.code, expected);
    assert.ok(result.stderr.includes(expected));
    assert.equal(result.stderr.includes("\n    at "), false);
    if (fault === "missing") assert.equal(existsSync(join(base, ".gsd", "gsd.db")), false);
  });
}

test("snapshot CLI refuses a stale extension bundle and preserves typed size-limit errors", async (t) => {
  const base = project(t);
  const missing = await capture(base, { importer: async () => ({}) });
  assert.equal(missing.exitCode, 1);
  assert.match(missing.stderr, /synchronize the extension bundle/);
  assert.equal(JSON.parse(missing.stdout).error.code, "query_error");
  const tooLarge = await capture(base, { reader: async () => { throw Object.assign(new Error("Snapshot exceeds byte budget"), { code: "snapshot_too_large" }); } });
  assert.equal(tooLarge.exitCode, 1);
  assert.equal(JSON.parse(tooLarge.stdout).error.code, "snapshot_too_large");
  const unexpected = await capture(base, { reader: async () => { throw new Error("SQL value private-fixture-value should not be echoed"); } });
  assert.equal(JSON.parse(unexpected.stdout).error.code, "query_error");
  assert.equal(`${unexpected.stdout}${unexpected.stderr}`.includes("private-fixture-value"), false);
  const plain = await capture(base, { json: false, reader: async () => null });
  assert.equal(plain.stdout, "");
  assert.equal(plain.exitCode, 1);
});

test("snapshot CLI bounds the complete UTF-8 envelope while preserving project counts", async (t) => {
  const base = project(t);
  seed(base, "Large project");
  for (let index = 2; index <= 65; index++) {
    insertMilestone({ id: `M${String(index).padStart(3, "0")}`, title: '큰 제목🙂"\\'.repeat(1500), status: "pending" });
  }
  const result = await capture(base);
  assert.equal(result.exitCode, 0, result.stderr);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.data.progress.milestones.total, 65);
  assert.equal(envelope.data.milestones.truncated, true);
  assert.equal(envelope.data.truncation.text, true);
  assert.ok(Buffer.byteLength(result.stdout, "utf8") < 270 * 1024);
});

test("snapshot CLI clears a foreign project scope while retaining the current project scope", async (t) => {
  const baseA = project(t);
  const baseB = project(t);
  const previousCwd = process.cwd();
  const previousLock = process.env.GSD_MILESTONE_LOCK;
  t.after(() => {
    process.chdir(previousCwd);
    if (previousLock === undefined) delete process.env.GSD_MILESTONE_LOCK;
    else process.env.GSD_MILESTONE_LOCK = previousLock;
  });
  for (const base of [baseA, baseB]) {
    seed(base, "Default focus");
    insertMilestone({ id: "M002", title: "Locked focus", status: "active" });
  }
  process.chdir(baseA);
  process.env.GSD_MILESTONE_LOCK = "M002";
  assert.equal(JSON.parse((await capture(baseB)).stdout).data.current.activeMilestone.id, "M001");
  assert.equal(JSON.parse((await capture(baseA)).stdout).data.current.activeMilestone.id, "M002");
});

test("snapshot CLI returns a typed size error for an oversized real database identifier", async (t) => {
  const base = project(t);
  openDatabase(join(base, ".gsd", "gsd.db"));
  insertMilestone({ id: `M${"x".repeat(262_144)}`, title: "Oversized identifier", status: "active" });
  const result = await capture(base);
  assert.equal(result.exitCode, 1);
  assert.equal(JSON.parse(result.stdout).error.code, "snapshot_too_large");
  assert.equal("data" in JSON.parse(result.stdout), false);
  assert.ok(Buffer.byteLength(result.stdout, "utf8") < 4096);
});
