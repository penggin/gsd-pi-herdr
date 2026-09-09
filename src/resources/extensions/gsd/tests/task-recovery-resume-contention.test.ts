// Real SQLite writer contention between independent recovery processes.
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { _getAdapter } from "../gsd-db.ts";
import { readDomainOperationFence } from "../db/writers/lifecycle-commands.ts";
import { claimTaskAttempt, readLatestTaskAttempt, settleTaskAttempt } from "../task-execution-domain-operation.ts";
import { readPendingTaskRecoveryContext, readTaskRecoveryRoute, recordFailureAndSelectRecovery, resumeTaskRecovery } from "../task-recovery-domain-operation.ts";
import { createWorkflowAuthorityFixture } from "./workflow-authority-fixture.ts";

const TASK = { milestoneId: "M001", sliceId: "S02", taskId: "T01" };

function db() {
  const adapter = _getAdapter();
  assert.ok(adapter);
  return adapter;
}

function invocation(idempotencyKey: string) {
  return { idempotencyKey, sourceTransport: "internal" as const, actorType: "agent" as const };
}

function dispatch(attempt: number): number {
  db().prepare(`
    INSERT INTO unit_dispatches (
      trace_id, turn_id, worker_id, milestone_lease_token,
      milestone_id, slice_id, task_id, unit_type, unit_id,
      status, attempt_n, started_at
    ) VALUES (?, ?, 'fixture-worker', 7, 'M001', 'S02', 'T01',
      'execute-task', 'M001/S02/T01', 'claimed', ?, '2026-09-07T00:00:00.000Z')
  `).run(`trace-${attempt}`, `turn-${attempt}`, attempt);
  return Number(db().prepare("SELECT MAX(id) AS id FROM unit_dispatches").get()?.id);
}

function claim(attempt: number, predecessor?: string) {
  return {
    invocation: invocation(`fixture/claim/${attempt}`),
    task: TASK,
    workerId: "fixture-worker",
    milestoneLeaseToken: 7,
    coordinationDispatchId: dispatch(attempt),
    ...(predecessor ? { retryOfAttemptId: predecessor } : {}),
  };
}

function seedRecovery(action: "abort" | "remediate") {
  db().exec(`
    INSERT INTO workers (
      worker_id, host, pid, started_at, version, last_heartbeat_at, status, project_root_realpath
    ) VALUES ('fixture-worker', 'test-host', 1, '2026-09-07T00:00:00.000Z',
      'test', '2026-09-07T00:00:00.000Z', 'active', '/tmp/fixture');
    INSERT INTO milestone_leases (
      milestone_id, worker_id, fencing_token, acquired_at, expires_at, status
    ) VALUES ('M001', 'fixture-worker', 7, '2026-09-07T00:00:00.000Z',
      '2099-09-07T00:00:00.000Z', 'held');
  `);
  let predecessor: string | undefined;
  const attempts = action === "abort" ? 2 : 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const claimed = claimTaskAttempt(claim(attempt, predecessor));
    const failure = settleTaskAttempt({
      invocation: invocation(`fixture/settle/${attempt}`),
      attemptId: claimed.attemptId,
      outcome: "failed",
      failureClass: "fixture-verification",
      summary: "The verification fixture needs repair.",
      output: {},
    });
    const recovery = recordFailureAndSelectRecovery({
      invocation: invocation(`fixture/route/${attempt}`),
      attemptId: claimed.attemptId,
      resultId: failure.resultId,
      owner: "agent",
      classification: { failureKind: action === "abort" ? "worktree-invalid" : "verification-failed" },
      summary: "The verification fixture needs repair.",
      evidence: { command: "fixture verification", exitCode: 1 },
      rationale: "Repair the fixture before continuing.",
    });
    if (attempt === attempts) {
      assert.equal(recovery.action, action);
      return { attemptId: claimed.attemptId, resultId: failure.resultId, recoveryActionId: recovery.recoveryActionId, attempts };
    }
    assert.equal(recovery.action, "repair");
    predecessor = claimed.attemptId;
  }
  throw new Error("recovery fixture did not route");
}

type Outcome = {
  kind: "receipt" | "error";
  pid: number;
  receipt?: { status: string; operationId: string; workCheckpointId: string; attemptId: string; resultId: string };
  code?: string;
  message?: string;
};

function spawnContender(databasePath: string, recoveryActionId: string, key: string) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const child: ChildProcess = spawn(process.execPath, [
    "--import", fileURLToPath(new URL("./resolve-ts.mjs", import.meta.url)),
    "--experimental-strip-types",
    fileURLToPath(new URL("./fixtures/task-recovery-resume-contender.ts", import.meta.url)),
    databasePath, recoveryActionId, key,
  ], { env, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  let diagnostics = "";
  child.stdout?.on("data", (chunk) => { diagnostics = (diagnostics + chunk).slice(-8192); });
  child.stderr?.on("data", (chunk) => { diagnostics = (diagnostics + chunk).slice(-8192); });
  const waiters = new Map<string, (value: Record<string, unknown>) => void>();
  const messages = new Map<string, Record<string, unknown>>();
  child.on("message", (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const message = value as Record<string, unknown>;
    const kind = String(message.kind);
    messages.set(kind, message);
    waiters.get(kind)?.(message);
  });
  const exited = new Promise<void>((resolve) => child.once("close", () => resolve()));
  let spawnFailure: Error | undefined;
  child.once("error", (error) => { spawnFailure = error; });
  const deadline = setTimeout(() => child.kill("SIGKILL"), 20_000);
  const stop = async () => {
    clearTimeout(deadline);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
  };
  const message = async (kind: string) => {
    const found = messages.get(kind);
    if (found) return found;
    return Promise.race([
      new Promise<Record<string, unknown>>((resolve) => waiters.set(kind, resolve)),
      exited.then(() => {
        throw spawnFailure ?? new Error(`contender ${child.pid} exited before ${kind}: ${diagnostics}`);
      }),
    ]);
  };
  const result = async (): Promise<Outcome> => {
    await exited;
    clearTimeout(deadline);
    assert.equal(child.exitCode, 0, diagnostics);
    const outcome = messages.get("receipt") ?? messages.get("error");
    assert.ok(outcome, diagnostics);
    return outcome as Outcome;
  };
  return { child, message, result, stop, start: () => child.send({ kind: "start" }) };
}

function durableSnapshot() {
  const count = (table: string) => Number(db().prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count);
  return {
    fence: readDomainOperationFence(),
    operations: count("workflow_operations"),
    events: count("workflow_domain_events"),
    checkpoints: count("workflow_work_checkpoints"),
    attempts: count("workflow_execution_attempts"),
    actions: db().prepare("SELECT * FROM workflow_recovery_actions ORDER BY recovery_action_id").all(),
    budgets: db().prepare("SELECT * FROM workflow_recovery_budgets ORDER BY recovery_budget_id").all(),
  };
}

for (const action of ["abort", "remediate"] as const) {
  for (const sameKey of [false, true]) {
    test(`${action} resume from two real processes with ${sameKey ? "same" : "different"} keys creates one grant`, { timeout: 30_000 }, async (t) => {
      const fixture = await createWorkflowAuthorityFixture();
      const workers: ReturnType<typeof spawnContender>[] = [];
      t.after(async () => {
        await Promise.all(workers.map((worker) => worker.stop()));
        fixture.cleanup();
      });
      const recovery = seedRecovery(action);
      const before = durableSnapshot();
      assert.ok(before.budgets.length > 0, "the fixture must contain a durable retry budget");
      for (const suffix of ["a", "b"]) {
        workers.push(spawnContender(fixture.dbPath, recovery.recoveryActionId, `contention/${sameKey ? "same" : suffix}`));
      }
      const ready = await Promise.all(workers.map((worker) => worker.message("ready")));
      assert.equal(new Set(ready.map((value) => value.pid)).size, 2);
      assert.ok(ready.every((value) => value.pid !== process.pid));

      // Both production BEGIN IMMEDIATE calls contend on this held lock.
      // Release only after both children have opened and attempted the write.
      db().exec("BEGIN IMMEDIATE");
      try {
        for (const worker of workers) worker.start();
        await Promise.all(workers.map((worker) => worker.message("attempting")));
      } finally {
        db().exec("ROLLBACK");
      }
      const outcomes = await Promise.all(workers.map((worker) => worker.result()));
      const winner = outcomes.find((value) => value.receipt?.status === "committed");
      assert.ok(winner?.receipt, JSON.stringify(outcomes));
      assert.equal(outcomes.filter((value) => value.receipt?.status === "committed").length, 1);
      if (sameKey) {
        const replay = outcomes.find((value) => value.receipt?.status === "replayed");
        assert.ok(replay?.receipt, JSON.stringify(outcomes));
        assert.equal(replay.receipt.operationId, winner.receipt.operationId);
        assert.equal(replay.receipt.workCheckpointId, winner.receipt.workCheckpointId);
      } else {
        const loser = outcomes.find((value) => value.kind === "error");
        assert.ok(loser, JSON.stringify(outcomes));
        assert.match(loser.message ?? "", /stale project revision|writer contention|already-resumed guard/i);
      }

      const after = durableSnapshot();
      assert.equal(after.fence.revision, before.fence.revision + 1);
      assert.equal(after.operations, before.operations + 1);
      assert.equal(after.events, before.events + 1);
      assert.equal(after.checkpoints, before.checkpoints + 1);
      assert.equal(after.attempts, before.attempts);
      assert.deepEqual(after.actions, before.actions);
      assert.deepEqual(after.budgets, before.budgets);
      assert.equal(winner.receipt.attemptId, recovery.attemptId);
      assert.equal(winner.receipt.resultId, recovery.resultId);
      const pending = readPendingTaskRecoveryContext(TASK);
      assert.equal(pending?.action, "continue");
      assert.equal(pending?.checkpoint.checkpointId, winner.receipt.workCheckpointId);
      assert.equal(pending?.checkpoint.evidenceSummary, '{"command":"fixture verification","exitCode":0}');
      assert.equal(readTaskRecoveryRoute(recovery.attemptId)?.resumeAuthorized, true);

      const successorInput = claim(recovery.attempts + 1, recovery.attemptId);
      const successor = claimTaskAttempt(successorInput);
      const afterClaim = durableSnapshot();
      assert.equal(readLatestTaskAttempt(TASK)?.retryOfAttemptId, recovery.attemptId);
      assert.equal(readTaskRecoveryRoute(recovery.attemptId)?.resumeAuthorized, false);
      assert.equal(readPendingTaskRecoveryContext(TASK), null);
      const replay = claimTaskAttempt(successorInput);
      assert.equal(replay.status, "replayed");
      assert.equal(replay.attemptId, successor.attemptId);
      assert.throws(() => claimTaskAttempt({ ...successorInput, invocation: invocation("contention/duplicate-successor") }), /active running Attempt/);
      assert.throws(() => resumeTaskRecovery({
        invocation: invocation("contention/second-grant"),
        recoveryActionId: recovery.recoveryActionId,
        repairSummary: "Try to reuse the grant.",
        evidence: { command: "fixture verification", exitCode: 0 },
      }), /already-resumed guard/);
      assert.deepEqual(durableSnapshot(), afterClaim);
      assert.equal(afterClaim.attempts, before.attempts + 1);
      assert.deepEqual(afterClaim.budgets, before.budgets);
    });
  }
}
