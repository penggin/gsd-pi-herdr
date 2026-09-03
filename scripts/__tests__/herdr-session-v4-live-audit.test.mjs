import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";

import {
  auditSessionV4LiveEvidence,
  evaluateP3V4Continuity,
  evaluateP3V4WorkerMatrix,
  herdrRootRuntimeId,
  P3_V4_MARKERS,
} from "../herdr-integration/session-v4-live-audit.mjs";

function successful(marker, overrides = {}) {
  return {
    dispatchId: "dispatch-single",
    childId: `child-${marker.toLowerCase()}`,
    launchMtimeMs: 2_000,
    assistantText: marker,
    usageTotalTokens: 10,
    state: { status: "completed", paneId: "w1:p2" },
    ownership: { status: "settled", paneId: "w1:p2", affinityKey: marker },
    exit: { exitCode: 0, aborted: false, completedAt: new Date(3_000).toISOString() },
    ...overrides,
  };
}

function validMatrix() {
  const workers = [successful(P3_V4_MARKERS.single)];
  workers.push(successful(P3_V4_MARKERS.affinityOne, {
    dispatchId: "dispatch-chain",
    launchMtimeMs: 4_000,
    ownership: { status: "settled", paneId: "w1:p2", affinityKey: "chain-affinity" },
    exit: { exitCode: 0, aborted: false, completedAt: new Date(5_000).toISOString() },
  }));
  workers.push(successful(P3_V4_MARKERS.affinityTwo, {
    dispatchId: "dispatch-chain",
    launchMtimeMs: 6_000,
    ownership: { status: "settled", paneId: "w1:p2", affinityKey: "chain-affinity" },
    exit: { exitCode: 0, aborted: false, completedAt: new Date(7_000).toISOString() },
  }));
  for (let index = 0; index < 5; index += 1) {
    workers.push(successful(P3_V4_MARKERS.parallel[index], {
      dispatchId: "dispatch-parallel",
      launchMtimeMs: index < 4 ? 10_000 + index : 21_000,
      state: { status: "completed", paneId: `w1:p${index % 4 + 2}` },
      ownership: { status: "settled", paneId: `w1:p${index % 4 + 2}`, affinityKey: `parallel-${index}` },
      exit: { exitCode: 0, aborted: false, completedAt: new Date(20_000 + index).toISOString() },
    }));
  }
  workers.push(successful(P3_V4_MARKERS.afterPaneLoss, {
    dispatchId: "dispatch-recovery",
    ownership: { status: "settled", paneId: "w1:p2", affinityKey: "recovery" },
  }));
  workers.push(successful(P3_V4_MARKERS.afterRestart, {
    dispatchId: "dispatch-restart",
    ownership: { status: "settled", paneId: "w1:p3", affinityKey: "restart" },
  }));
  workers.push({
    ...successful(""),
    childId: "child-aborted",
    assistantText: "",
    usageTotalTokens: 0,
    state: { status: "aborted", paneId: "w1:p4" },
    ownership: { status: "settled", paneId: "w1:p4", affinityKey: "abort" },
    exit: { exitCode: 130, aborted: true, completedAt: new Date(30_000).toISOString() },
  });
  workers.push({
    ...successful(""),
    childId: "child-pane-loss",
    assistantText: "",
    usageTotalTokens: 0,
    state: { status: "working", paneId: "w1:p9" },
    ownership: { status: "running", paneId: "w1:p9", affinityKey: "pane-loss" },
    exit: undefined,
  });
  const markers = [
    P3_V4_MARKERS.single,
    P3_V4_MARKERS.affinityOne,
    P3_V4_MARKERS.affinityTwo,
    ...P3_V4_MARKERS.parallel,
    P3_V4_MARKERS.afterPaneLoss,
    P3_V4_MARKERS.afterRestart,
  ];
  return {
    workers,
    rootAssistantText: `${markers.join(" ")} Operation aborted Herdr worker pane disappeared before final exit evidence was produced`,
    finalSnapshot: { version: "0.8.2", protocol: 20, panes: ["w1:p2", "w1:p3", "w1:p4", "w1:p5"].map((pane_id) => ({ pane_id })) },
    paneReads: ["w1:p2", "w1:p3", "w1:p4", "w1:p5"].map((paneId) => ({ paneId, text: "[12:00:00] working\n[12:00:01] turn settled\n" })),
  };
}

test("derives the same bounded root runtime identity as HerdrBackend", () => {
  assert.equal(herdrRootRuntimeId("session-1"), "root-84097828fc31a8c8d292");
});

test("accepts the complete P3.7 worker, queue, cancellation, pane-loss, and pane-output matrix", () => {
  const result = evaluateP3V4WorkerMatrix(validMatrix());
  assert.equal(result.ready, true, result.errors.join("\n"));
  assert.deepEqual(result.counts, {
    workers: 12,
    successfulMarkers: 10,
    aborted: 1,
    paneLoss: 1,
    parallelPanes: 4,
    paneReads: 4,
  });
});

test("rejects duplicate semantics, early fifth launch, raw pane JSON, and missing pane-loss evidence", () => {
  const matrix = validMatrix();
  matrix.workers[1].assistantText += ` ${P3_V4_MARKERS.single}`;
  const fifth = matrix.workers.find((worker) => worker.assistantText === P3_V4_MARKERS.parallel[4]);
  fifth.launchMtimeMs = 15_000;
  matrix.workers = matrix.workers.filter((worker) => worker.childId !== "child-pane-loss");
  matrix.paneReads[0].text += '{"type":"message_update","usage":{"totalTokens":1}}';
  matrix.finalSnapshot = {};
  const result = evaluateP3V4WorkerMatrix(matrix);
  assert.equal(result.ready, false);
  assert.match(result.errors.join("\n"), /exactly one worker final response/);
  assert.match(result.errors.join("\n"), /Fifth parallel worker launched before/);
  assert.match(result.errors.join("\n"), /No missing-exit worker/);
  assert.match(result.errors.join("\n"), /forbidden raw JSON\/event output/);
  assert.match(result.errors.join("\n"), /Final Herdr snapshot must be v0\.8\.2\/protocol 20/);
});

test("requires stable detach topology and append-only v4 root replacement", () => {
  const snapshot = {
    version: "0.8.2",
    protocol: 20,
    workspaces: [{ workspace_id: "w1" }],
    tabs: [{ tab_id: "w1:t1" }],
    panes: [{ pane_id: "w1:p1" }, { pane_id: "w1:p2" }],
  };
  const before = { schemaVersion: 1, rootSessionId: "session-1", rootRuntimeId: herdrRootRuntimeId("session-1"), instanceId: "instance-1", workspaceId: "w1", tabId: "w1:t1", paneId: "w1:p1", startedAt: new Date(1_000).toISOString() };
  const after = { ...before, instanceId: "instance-2", tabId: "w1:t2", paneId: "w1:p3", startedAt: new Date(2_000).toISOString() };
  const pass = evaluateP3V4Continuity({
    rootSessionId: "session-1",
    rootPaneId: "w1:p3",
    detachBefore: snapshot,
    detachAfter: structuredClone(snapshot),
    restartBeforeRecord: before,
    restartAfterRecord: after,
    sessionBefore: Buffer.from("before\n"),
    sessionAfter: Buffer.from("before\nafter\n"),
  });
  assert.equal(pass.ready, true, pass.errors.join("\n"));

  const fail = evaluateP3V4Continuity({
    rootSessionId: "session-1",
    rootPaneId: "w1:p3",
    detachBefore: snapshot,
    detachAfter: { ...snapshot, panes: [{ pane_id: "w1:p1" }] },
    restartBeforeRecord: before,
    restartAfterRecord: before,
    sessionBefore: Buffer.from("before\n"),
    sessionAfter: Buffer.from("rewritten\n"),
  });
  assert.equal(fail.ready, false);
  assert.match(fail.errors.join("\n"), /changed stable paneIds/);
  assert.match(fail.errors.join("\n"), /did not replace the root instance lease/);
  assert.match(fail.errors.join("\n"), /not an append-only extension/);
  assert.match(fail.errors.join("\n"), /does not match the live Herdr root pane identity/);
});

test("audits a complete owner-only v4 session and worker artifact tree without copying message text", (t) => {
  const temporary = mkdtempSync(join(tmpdir(), "gsd-p37-live-audit-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const gsdHome = join(temporary, "gsd-home");
  const evidence = join(temporary, "evidence");
  const sessionId = "session-1";
  const runtimeId = herdrRootRuntimeId(sessionId);
  const rootDir = join(gsdHome, "runtime", "herdr", "v1", runtimeId);
  privateDirectory(rootDir);
  privateDirectory(evidence);
  const matrix = validMatrix();
  const headerLine = JSON.stringify({ kind: "header", version: 4, id: sessionId, createdAt: 1, cwd: "/tmp/project" });
  const beforeRestartContent = `${headerLine}\n${JSON.stringify({
    kind: "entry",
    seq: 1,
    lane: "main",
    type: "message",
    id: "message-before",
    parentId: null,
    timestamp: 2,
    message: { role: "assistant", content: [{ type: "text", text: P3_V4_MARKERS.single }], timestamp: 2 },
  })}\n`;
  const afterRestartContent = beforeRestartContent + [
    JSON.stringify({
      kind: "entry",
      seq: 2,
      lane: "main",
      type: "message",
      id: "message-1",
      parentId: "message-before",
      timestamp: 3,
      message: { role: "assistant", content: [{ type: "text", text: matrix.rootAssistantText }], timestamp: 3 },
    }),
  ].join("\n") + "\n";
  const rootSessionFile = join(evidence, "root-session.jsonl");
  privateFile(rootSessionFile, afterRestartContent);
  const rootRecord = {
    schemaVersion: 1,
    rootRuntimeId: runtimeId,
    rootSessionId: sessionId,
    instanceId: "instance-1",
    source: "test",
    pid: process.pid,
    paneId: "w1:p1",
    tabId: "w1:t1",
    workspaceId: "w1",
    cwd: "/tmp/project",
    status: "active",
    startedAt: new Date(1_000).toISOString(),
    updatedAt: new Date(2_000).toISOString(),
  };
  privateFile(join(rootDir, "root.json"), JSON.stringify({ ...rootRecord, instanceId: "instance-2", startedAt: new Date(3_000).toISOString() }));
  for (const worker of matrix.workers) writeWorker(rootDir, runtimeId, worker);
  const finalSnapshotFile = join(evidence, "snapshot.json");
  matrix.finalSnapshot.workspaces = [{ workspace_id: "w1" }];
  matrix.finalSnapshot.tabs = [{ tab_id: "w1:t1" }, { tab_id: "w1:t2" }];
  matrix.finalSnapshot.panes.push({ pane_id: "w1:p1" });
  privateFile(finalSnapshotFile, JSON.stringify(matrix.finalSnapshot));
  const detachBefore = join(evidence, "detach-before.json");
  const detachAfter = join(evidence, "detach-after.json");
  privateFile(detachBefore, JSON.stringify(matrix.finalSnapshot));
  privateFile(detachAfter, JSON.stringify(matrix.finalSnapshot));
  const rootRecordBefore = join(evidence, "root-before.json");
  const rootRecordAfter = join(evidence, "root-after.json");
  privateFile(rootRecordBefore, JSON.stringify(rootRecord));
  privateFile(rootRecordAfter, JSON.stringify({ ...rootRecord, instanceId: "instance-2", startedAt: new Date(3_000).toISOString() }));
  const sessionBefore = join(evidence, "session-before.jsonl");
  const sessionAfter = join(evidence, "session-after.jsonl");
  privateFile(sessionBefore, beforeRestartContent);
  privateFile(sessionAfter, afterRestartContent);
  const paneReads = matrix.paneReads.map((item) => {
    const path = join(evidence, `${item.paneId.replaceAll(":", "-")}.txt`);
    privateFile(path, item.text);
    return { paneId: item.paneId, path };
  });
  const result = auditSessionV4LiveEvidence({
    schemaVersion: 1,
    gsdHome,
    rootSessionFile,
    finalSnapshotFile,
    paneReads,
    detachSnapshots: { before: detachBefore, after: detachAfter },
    restart: { rootRecordBefore, rootRecordAfter, sessionBefore, sessionAfter },
  });
  assert.equal(result.ready, true, result.errors.join("\n"));
  assert.equal(result.root.backend, "harness-v4");
  assert.equal(JSON.stringify(result).includes(matrix.rootAssistantText), false);
});

function privateDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  let current = path;
  while (true) {
    chmodSync(current, 0o700);
    if (basename(current).startsWith("gsd-p37-live-audit-")) break;
    current = dirname(current);
  }
}

function privateFile(path, content) {
  writeFileSync(path, `${content}`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function writeWorker(rootDir, runtimeId, worker) {
  const workerDir = join(rootDir, worker.dispatchId, worker.childId);
  privateDirectory(workerDir);
  const identity = { rootSessionId: runtimeId, dispatchId: worker.dispatchId, childId: worker.childId };
  const launchPath = join(workerDir, "launch.json");
  privateFile(launchPath, JSON.stringify({ schemaVersion: 1, ...identity, agent: "reviewer" }));
  utimesSync(launchPath, worker.launchMtimeMs / 1_000, worker.launchMtimeMs / 1_000);
  privateFile(join(workerDir, "state.json"), JSON.stringify({ schemaVersion: 1, updatedAt: new Date().toISOString(), ...worker.state }));
  privateFile(join(workerDir, "heartbeat.json"), JSON.stringify({ schemaVersion: 1, updatedAt: new Date().toISOString(), pid: process.pid, status: worker.state.status }));
  privateFile(join(workerDir, "ownership.json"), JSON.stringify({ schemaVersion: 1, ...identity, ownerInstanceId: "instance-1", tabId: "w1:t2", workspaceId: "w1", updatedAt: new Date().toISOString(), ...worker.ownership }));
  privateFile(join(workerDir, "stderr.log"), "");
  privateFile(join(workerDir, "stdout.jsonl"), `${JSON.stringify({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: worker.assistantText }], usage: { totalTokens: worker.usageTotalTokens } },
  })}\n`);
  if (worker.exit) privateFile(join(workerDir, "exit.json"), JSON.stringify({ schemaVersion: 1, signal: null, ...worker.exit }));
}
