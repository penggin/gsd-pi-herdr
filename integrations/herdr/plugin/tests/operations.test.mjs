import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  cleanupRetained,
  focusFailedWorker,
  focusWorkers,
  formatStatus,
  reconcileWorkers,
  resolveRuntimeRoot,
  scanWorkers,
} from "../operations.mjs";

function fixture(t, state = {}) {
  const home = mkdtempSync(join(tmpdir(), "gsd-herdr-plugin-"));
  chmodSync(home, 0o700);
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const workerDir = join(home, "runtime", "herdr", "v1", "root-1", "dispatch-1", "child-1");
  mkdirSync(workerDir, { recursive: true, mode: 0o700 });
  for (const path of [
    join(home, "runtime"),
    join(home, "runtime", "herdr"),
    join(home, "runtime", "herdr", "v1"),
    join(home, "runtime", "herdr", "v1", "root-1"),
    join(home, "runtime", "herdr", "v1", "root-1", "dispatch-1"),
    workerDir,
  ]) chmodSync(path, 0o700);
  writeFileSync(join(workerDir, "state.json"), `${JSON.stringify({
    schemaVersion: 1,
    status: "completed",
    updatedAt: "2026-08-30T00:00:00.000Z",
    paneId: "w1:p2",
    ...state,
  })}\n`, { mode: 0o600 });
  return { home, workerDir, runtimeRoot: resolveRuntimeRoot({ GSD_HOME: home }) };
}

async function fakeHerdr(t, snapshot) {
  const dir = mkdtempSync(join(tmpdir(), "gsd-herdr-plugin-socket-"));
  const socketPath = join(dir, "herdr.sock");
  const requests = [];
  const server = net.createServer((socket) => {
    socket.once("data", (chunk) => {
      const request = JSON.parse(chunk.toString("utf8").trim());
      requests.push(request);
      const result = request.method === "session.snapshot"
        ? { type: "session_snapshot", snapshot }
        : { type: "ok" };
      socket.end(`${JSON.stringify({ id: request.id, result })}\n`);
    });
  });
  await new Promise((resolve, reject) => server.listen(socketPath, resolve).once("error", reject));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    env: {
      HERDR_ENV: "1",
      HERDR_SOCKET_PATH: socketPath,
      HERDR_WORKSPACE_ID: "w1",
      HERDR_TAB_ID: "w1:t1",
    },
    requests,
  };
}

function snapshot(panes = []) {
  return {
    version: "0.8.2",
    protocol: 20,
    workspaces: [{ workspace_id: "w1" }],
    tabs: [{ tab_id: "w1:t2", workspace_id: "w1", label: "GSD Workers · abcdef12" }],
    panes,
    layouts: [],
    agents: [],
  };
}

test("scans private worker artifacts and formats bounded diagnostics", (t) => {
  const { runtimeRoot } = fixture(t);
  const records = scanWorkers(runtimeRoot);
  assert.equal(records.length, 1);
  assert.equal(records[0].state.status, "completed");
  assert.match(formatStatus(records, snapshot()), /completed=1/);
  assert.match(formatStatus(records, snapshot()), /pane missing/);
});

test("startup reconciliation marks an active worker orphaned when its pane vanished", async (t) => {
  const { home, runtimeRoot, workerDir } = fixture(t, { status: "working", childPid: 999_999 });
  const herdr = await fakeHerdr(t, snapshot());
  const result = await reconcileWorkers({ env: { ...herdr.env, GSD_HOME: home }, runtimeRoot, now: Date.parse("2026-08-30T00:01:00.000Z") });
  assert.equal(result.orphaned, 1);
  const state = JSON.parse(readFileSync(join(workerDir, "state.json"), "utf8"));
  assert.equal(state.status, "orphaned");
  assert.match(state.lastActivity.label, /pane missing/);
});

test("focus actions target the live worker tab and newest failed pane", async (t) => {
  const { home, runtimeRoot } = fixture(t, { status: "failed" });
  const live = snapshot([{ pane_id: "w1:p2", tab_id: "w1:t2", workspace_id: "w1", agent_status: "blocked" }]);
  const herdr = await fakeHerdr(t, live);
  const env = { ...herdr.env, GSD_HOME: home };
  assert.equal(await focusWorkers({ env }), "w1:t2");
  assert.equal(await focusFailedWorker({ env, runtimeRoot }), "w1:p2");
  assert.deepEqual(herdr.requests.map((item) => item.method), ["session.snapshot", "tab.focus", "session.snapshot", "agent.focus"]);
});

test("cleanup requests release only terminal non-live retained workers", async (t) => {
  const { home, runtimeRoot, workerDir } = fixture(t, { status: "failed" });
  const live = snapshot([{ pane_id: "w1:p2", tab_id: "w1:t2", workspace_id: "w1", agent_status: "blocked" }]);
  const herdr = await fakeHerdr(t, live);
  const cleaned = await cleanupRetained({
    env: { ...herdr.env, GSD_HOME: home },
    runtimeRoot,
    now: Date.parse("2026-08-30T00:02:00.000Z"),
  });
  assert.deepEqual(cleaned, ["w1:p2"]);
  const cleanup = JSON.parse(readFileSync(join(workerDir, "cleanup.json"), "utf8"));
  assert.equal(cleanup.action, "release-retained");
  assert.equal(cleanup.paneId, "w1:p2");
  assert.equal(herdr.requests.at(-1).method, "pane.clear_agent_authority");
});

