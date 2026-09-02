import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  HerdrClient,
  createHerdrRootSource,
  detectHerdrEnvironment,
  shouldActivateHerdrRoot,
} from "../client.js";

function herdrEnv(socketPath = "/tmp/herdr-test.sock"): NodeJS.ProcessEnv {
  return {
    HERDR_ENV: "1",
    HERDR_SOCKET_PATH: socketPath,
    HERDR_PANE_ID: "w1:p1",
    HERDR_WORKSPACE_ID: "w1",
    HERDR_TAB_ID: "w1:t1",
  };
}

test("detectHerdrEnvironment requires the managed env marker, socket, and pane", () => {
  assert.equal(detectHerdrEnvironment({}).available, false);
  assert.equal(detectHerdrEnvironment(herdrEnv()).available, true);
  assert.equal(detectHerdrEnvironment({ ...herdrEnv(), HERDR_PANE_ID: "  " }).available, false);
});

test("root activation requires opt-in UI authority and excludes subagent children", () => {
  const env = herdrEnv();
  assert.equal(shouldActivateHerdrRoot(true, true, env), true);
  assert.equal(shouldActivateHerdrRoot(false, true, env), false);
  assert.equal(shouldActivateHerdrRoot(true, false, env), false);
  assert.equal(shouldActivateHerdrRoot(true, true, { ...env, GSD_SUBAGENT_CHILD: "1" }), false);
});

test("root source is unique for each loaded extension runtime allocation", () => {
  const first = createHerdrRootSource();
  const second = createHerdrRootSource();
  assert.match(first, /^custom:gsd:[0-9a-f-]{36}$/);
  assert.match(second, /^custom:gsd:[0-9a-f-]{36}$/);
  assert.notEqual(first, second);
});

test("socket client ignores unrelated lines and returns the matching response", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "gsd-herdr-client-"));
  const socketPath = path.join(dir, "herdr.sock");
  const server = net.createServer((socket) => {
    socket.once("data", (chunk) => {
      const request = JSON.parse(chunk.toString("utf8").trim()) as { id: string; method: string };
      socket.write(`${JSON.stringify({ id: "other", result: {} })}\n`);
      socket.write(`${JSON.stringify({ id: request.id, result: { method: request.method } })}\n`);
    });
  });

  await new Promise<void>((resolve, reject) => server.listen(socketPath, resolve).once("error", reject));
  try {
    const client = new HerdrClient("test", {
      env: herdrEnv(socketPath),
      requestTimeoutMs: 100,
      retryTimeoutMs: 100,
    });
    const response = await client.request("pane.get", { pane_id: "w1:p1" });
    assert.deepEqual(response?.result, { method: "pane.get" });
    assert.equal(await client.probePane(), true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("retry reuses one request id so sequenced reports remain idempotent", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "gsd-herdr-retry-"));
  const socketPath = path.join(dir, "herdr.sock");
  const ids: string[] = [];
  let connections = 0;
  const server = net.createServer((socket) => {
    connections += 1;
    socket.once("data", (chunk) => {
      const request = JSON.parse(chunk.toString("utf8").trim()) as { id: string };
      ids.push(request.id);
      if (connections >= 2) socket.end(`${JSON.stringify({ id: request.id, result: {} })}\n`);
    });
  });

  await new Promise<void>((resolve, reject) => server.listen(socketPath, resolve).once("error", reject));
  try {
    const client = new HerdrClient("retry-test", {
      env: herdrEnv(socketPath),
      requestTimeoutMs: 20,
      retryTimeoutMs: 100,
    });
    assert.ok(await client.request("pane.report_agent", { pane_id: "w1:p1", seq: 1 }));
    assert.equal(ids.length, 2);
    assert.equal(ids[0], ids[1]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("notification client sends the v0.8.2 show contract and returns delivery state", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "gsd-herdr-notification-"));
  const socketPath = path.join(dir, "herdr.sock");
  let captured: { method?: string; params?: Record<string, unknown> } = {};
  const server = net.createServer((socket) => {
    socket.once("data", (chunk) => {
      const request = JSON.parse(chunk.toString("utf8").trim()) as {
        id: string;
        method: string;
        params: Record<string, unknown>;
      };
      captured = request;
      socket.end(`${JSON.stringify({
        id: request.id,
        result: { type: "notification_show", shown: true, reason: "shown" },
      })}\n`);
    });
  });

  await new Promise<void>((resolve, reject) => server.listen(socketPath, resolve).once("error", reject));
  try {
    const client = new HerdrClient("notification-test", {
      env: herdrEnv(socketPath),
      requestTimeoutMs: 100,
      retryTimeoutMs: 100,
    });
    assert.equal(await client.showNotification({
      title: "GSD needs attention",
      body: "awaiting user input",
      sound: "request",
    }), true);
    assert.equal(captured.method, "notification.show");
    assert.deepEqual(captured.params, {
      title: "GSD needs attention",
      body: "awaiting user input",
      sound: "request",
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("notification delivery is at-most-once when the socket response is lost", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "gsd-herdr-notification-once-"));
  const socketPath = path.join(dir, "herdr.sock");
  let connections = 0;
  const server = net.createServer((socket) => {
    connections += 1;
    socket.once("data", () => {
      // Simulate a request that may have been processed while its response was
      // lost. The client must not reconnect and show a duplicate toast.
    });
  });

  await new Promise<void>((resolve, reject) => server.listen(socketPath, resolve).once("error", reject));
  try {
    const client = new HerdrClient("notification-once", {
      env: herdrEnv(socketPath),
      requestTimeoutMs: 20,
      retryTimeoutMs: 100,
    });
    assert.equal(await client.showNotification({ title: "GSD finished", sound: "done" }), false);
    assert.equal(connections, 1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
