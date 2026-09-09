import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import * as runtime from "../unit-runtime.ts";

function fixture(t: TestContext): string {
  const base = mkdtempSync(join(tmpdir(), "gsd-harness-abort-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  return base;
}

test("clearing a missing tool-error returns null without creating runtime directories or records", (t) => {
  const base = fixture(t);
  assert.equal(runtime.clearUnitToolErrorHarnessAbort(base, "run-uat", "M001/S01", 123, "gsd_uat_exec"), null);
  assert.deepEqual(readdirSync(base), []);
});

test("tool-error clearing preserves mismatched runs, tools, and stronger abort kinds byte-for-byte", (t) => {
  const base = fixture(t);
  for (const kind of ["tool-error", "turn-abort", "tool-loop-guard"] as const) {
    runtime.recordUnitHarnessAbort(base, "run-uat", "M001/S01", 123, { kind, toolName: "gsd_uat_exec", reason: kind });
    const file = join(base, ".gsd", "runtime", "units", "run-uat-M001-S01.json");
    const before = readFileSync(file, "utf8");
    assert.equal(runtime.clearUnitToolErrorHarnessAbort(base, "run-uat", "M001/S01", 124, "gsd_uat_exec"), null);
    assert.equal(runtime.clearUnitToolErrorHarnessAbort(base, "run-uat", "M001/S01", 123, "gsd_exec"), null);
    if (kind !== "tool-error") assert.equal(runtime.clearUnitToolErrorHarnessAbort(base, "run-uat", "M001/S01", 123, "gsd_uat_exec"), null);
    assert.equal(readFileSync(file, "utf8"), before);
  }
});

test("matching successful retry clears only the tool-error field and preserves runtime progress", (t) => {
  const base = fixture(t);
  runtime.writeUnitRuntimeRecord(base, "run-uat", "M001/S01", 123, { phase: "wrapup-warning-sent", progressCount: 4, recoveryAttempts: 2 });
  runtime.recordUnitHarnessAbort(base, "run-uat", "M001/S01", 123, { kind: "tool-error", toolName: "gsd_uat_exec", reason: "timeout" });
  const cleared = runtime.clearUnitToolErrorHarnessAbort(base, "run-uat", "M001/S01", 123, "gsd_uat_exec");
  assert.equal(cleared?.harnessAbort, undefined);
  assert.equal(cleared?.phase, "wrapup-warning-sent");
  assert.equal(cleared?.progressCount, 4);
  assert.equal(cleared?.recoveryAttempts, 2);
  assert.equal(runtime.readUnitHarnessAbort(base, "run-uat", "M001/S01", 123), null);
  assert.equal(runtime.clearUnitToolErrorHarnessAbort(base, "run-uat", "M001/S01", 123, "gsd_uat_exec"), null);
});

test("tool-error clearing rejects colliding sanitized unit IDs and unit types", (t) => {
  const base = fixture(t);
  runtime.recordUnitHarnessAbort(base, "run-uat", "M001/S01", 123, { kind: "tool-error", toolName: "gsd_exec", reason: "original unit" });
  const file = join(base, ".gsd", "runtime", "units", "run-uat-M001-S01.json");
  const before = readFileSync(file, "utf8");
  assert.equal(runtime.clearUnitToolErrorHarnessAbort(base, "run-uat", "M001-S01", 123, "gsd_exec"), null);
  assert.equal(runtime.clearUnitToolErrorHarnessAbort(base, "run/uat", "M001/S01", 123, "gsd_exec"), null);
  assert.equal(readFileSync(file, "utf8"), before);
  assert.equal(runtime.readUnitHarnessAbort(base, "run-uat", "M001/S01", 123)?.reason, "original unit");
  assert.ok(runtime.clearUnitToolErrorHarnessAbort(base, "run-uat", "M001/S01", 123, "gsd_exec"));
});

test("same-run tool errors cannot replace a turn abort, while a new run can record its own failure", (t) => {
  const base = fixture(t);
  runtime.recordUnitHarnessAbort(base, "run-uat", "M001/S01", 123, { kind: "turn-abort", reason: "cancelled" });
  runtime.recordUnitHarnessAbort(base, "run-uat", "M001/S01", 123, { kind: "tool-error", toolName: "gsd_uat_exec", reason: "late failure" });
  assert.equal(runtime.readUnitHarnessAbort(base, "run-uat", "M001/S01", 123)?.kind, "turn-abort");
  runtime.recordUnitHarnessAbort(base, "run-uat", "M001/S01", 124, { kind: "tool-error", toolName: "gsd_uat_exec", reason: "new run failure" });
  assert.equal(runtime.readUnitHarnessAbort(base, "run-uat", "M001/S01", 124)?.kind, "tool-error");
});
