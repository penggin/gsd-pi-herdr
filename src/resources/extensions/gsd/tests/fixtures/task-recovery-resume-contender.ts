import assert from "node:assert/strict";
import { _getAdapter, closeDatabase, openDatabase } from "../../gsd-db.ts";
import { resumeTaskRecovery } from "../../task-recovery-domain-operation.ts";

const [databasePath, recoveryActionId, idempotencyKey] = process.argv.slice(2);
assert.ok(databasePath && recoveryActionId && idempotencyKey);
assert.equal(openDatabase(databasePath), true);
const adapter = _getAdapter();
assert.ok(adapter);
const exec = adapter.exec.bind(adapter);
let announcedAttempt = false;
// Observe the actual write-lock attempt without altering SQL or lock behavior.
// The parent holds a writer lock until both children reach this boundary.
adapter.exec = (sql: string) => {
  if (!announcedAttempt && /^BEGIN IMMEDIATE$/i.test(sql.trim())) {
    announcedAttempt = true;
    process.send?.({ kind: "attempting", pid: process.pid });
  }
  return exec(sql);
};
const start = new Promise<void>((resolve) => process.once("message", () => resolve()));
process.send?.({ kind: "ready", pid: process.pid });
await start;
let outcome: unknown;
try {
  const receipt = resumeTaskRecovery({
    invocation: {
      idempotencyKey,
      sourceTransport: "internal",
      actorType: "agent",
      actorId: "recovery-contention",
    },
    recoveryActionId,
    repairSummary: "Repaired the shared verification fixture and confirmed it passes.",
    evidence: { command: "fixture verification", exitCode: 0 },
  });
  outcome = { kind: "receipt", pid: process.pid, receipt };
} catch (error) {
  outcome = {
    kind: "error",
    pid: process.pid,
    code: String((error as { code?: unknown }).code ?? "UNKNOWN"),
    message: error instanceof Error ? error.message : String(error),
  };
} finally {
  closeDatabase();
}
process.send?.(outcome, () => process.disconnect());
