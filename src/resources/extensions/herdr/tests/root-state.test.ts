import assert from "node:assert/strict";
import test from "node:test";
import { HerdrRootReporter } from "../root-state.js";

class FakeHerdrClient {
  reports: Array<{ state: string; seq: number; message?: string }> = [];
  sessions: Array<{ seq: number; path?: string; id?: string }> = [];
  releases: number[] = [];

  async reportAgent(_agent: string, state: string, seq: number, message?: string): Promise<boolean> {
    this.reports.push({ state, seq, message });
    return true;
  }

  async reportAgentSession(
    _agent: string,
    seq: number,
    sessionRef: { agentSessionId?: string; agentSessionPath?: string },
  ): Promise<boolean> {
    this.sessions.push({ seq, path: sessionRef.agentSessionPath, id: sessionRef.agentSessionId });
    return true;
  }

  async releaseAgent(_agent: string, seq: number): Promise<boolean> {
    this.releases.push(seq);
    return true;
  }
}

const ctx = {
  isIdle: () => true,
  sessionManager: {
    getSessionFile: () => "/tmp/gsd-session.jsonl",
    getSessionId: () => "session-id",
  },
};

const normalEnd = { messages: [{ role: "assistant", stopReason: "stop" }] };
const errorEnd = { messages: [{ role: "assistant", stopReason: "error", errorMessage: "provider failed" }] };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("root reporter publishes session identity and idle → working → idle with monotonic seq", async () => {
  const client = new FakeHerdrClient();
  const reporter = new HerdrRootReporter(client, { idleDebounceMs: 5, errorGraceMs: 10 });

  await reporter.sessionStart({ reason: "startup" }, ctx, "M1/S1 · executing");
  assert.equal(client.sessions.length, 1);
  assert.equal(client.sessions[0].path, "/tmp/gsd-session.jsonl");
  assert.equal(client.reports.at(-1)?.state, "idle");

  reporter.agentStart(ctx);
  assert.equal(client.reports.at(-1)?.state, "working");
  reporter.agentEnd(normalEnd);
  await delay(10);
  assert.equal(client.reports.at(-1)?.state, "idle");

  const seqs = [...client.sessions.map((item) => item.seq), ...client.reports.map((item) => item.seq)]
    .sort((a, b) => a - b);
  assert.equal(new Set(seqs).size, seqs.length);

  await reporter.shutdown();
  assert.equal(client.releases.length, 1);
  assert.ok(client.releases[0] > Math.max(...seqs));
});

test("explicit non-retry errors become blocked without an idle flash", async () => {
  const client = new FakeHerdrClient();
  const reporter = new HerdrRootReporter(client, { idleDebounceMs: 1, errorGraceMs: 50 });
  await reporter.sessionStart({ reason: "startup" }, ctx, "M1/S3");
  reporter.agentStart(ctx);
  reporter.agentEnd({ ...errorEnd, willRetry: false });

  assert.equal(client.reports.at(-1)?.state, "blocked");
  assert.match(client.reports.at(-1)?.message ?? "", /provider failed/);
});

test("explicit retry remains working and a replacement start clears the failure", async () => {
  const client = new FakeHerdrClient();
  const reporter = new HerdrRootReporter(client, { idleDebounceMs: 1, errorGraceMs: 5 });
  await reporter.sessionStart({ reason: "startup" }, ctx, "M1/S3");
  reporter.agentStart(ctx);
  reporter.agentEnd({ ...errorEnd, willRetry: true });
  assert.equal(client.reports.at(-1)?.state, "working");
  assert.match(client.reports.at(-1)?.message ?? "", /retrying/);

  reporter.agentStart(ctx);
  assert.equal(client.reports.at(-1)?.state, "working");
  assert.doesNotMatch(client.reports.at(-1)?.message ?? "", /provider failed|retrying/);
});

test("unknown retry intent uses bounded grace then reports blocked", async () => {
  const client = new FakeHerdrClient();
  const reporter = new HerdrRootReporter(client, { idleDebounceMs: 1, errorGraceMs: 5 });
  await reporter.sessionStart({ reason: "startup" }, ctx);
  reporter.agentStart(ctx);
  reporter.agentEnd(errorEnd);
  assert.equal(client.reports.at(-1)?.state, "working");
  await delay(10);
  assert.equal(client.reports.at(-1)?.state, "blocked");
});

test("shutdown during session identity reporting cannot republish state after release", async () => {
  let unblockSession!: () => void;
  const sessionGate = new Promise<void>((resolve) => { unblockSession = resolve; });
  const events: string[] = [];

  const client = {
    async reportAgent(): Promise<boolean> {
      events.push("report-agent");
      return true;
    },
    async reportAgentSession(): Promise<boolean> {
      events.push("report-session:start");
      await sessionGate;
      events.push("report-session:end");
      return true;
    },
    async releaseAgent(): Promise<boolean> {
      events.push("release");
      return true;
    },
  };

  const reporter = new HerdrRootReporter(client);
  const start = reporter.sessionStart({ reason: "reload" }, ctx);
  await delay(0);
  await reporter.shutdown();
  unblockSession();
  await start;

  assert.deepEqual(events, ["report-session:start", "release", "report-session:end"]);
});

test("reporter replacements can share one monotonic sequence allocator", async () => {
  const client = new FakeHerdrClient();
  let seq = 0;
  const nextSequence = () => ++seq;

  const first = new HerdrRootReporter(client, { nextSequence });
  await first.sessionStart({ reason: "startup" }, ctx);
  await first.shutdown();

  const second = new HerdrRootReporter(client, { nextSequence });
  await second.sessionStart({ reason: "new" }, ctx);

  const emitted = [
    ...client.sessions.map((item) => item.seq),
    ...client.reports.map((item) => item.seq),
    ...client.releases,
  ].sort((a, b) => a - b);
  assert.deepEqual(emitted, [1, 2, 3, 4, 5]);
});
