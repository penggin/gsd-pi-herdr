import assert from "node:assert/strict";
import test from "node:test";
import { HerdrRootReporter } from "../root-state.js";
import { describeHerdrInteractiveInput } from "../interactive-input.js";

class FakeHerdrClient {
  reports: Array<{ state: string; seq: number; message?: string }> = [];
  sessions: Array<{ seq: number; path?: string; id?: string }> = [];
  releases: number[] = [];
  notifications: Array<{ title: string; body?: string; sound?: string }> = [];

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

  async showNotification(notification: { title: string; body?: string; sound?: string }): Promise<boolean> {
    this.notifications.push(notification);
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

test("interactive questions report blocked until every matching tool call settles", async () => {
  const client = new FakeHerdrClient();
  const reporter = new HerdrRootReporter(client, { idleDebounceMs: 1 });
  await reporter.sessionStart({ reason: "startup" }, ctx, "M2/S1 · planning");
  reporter.agentStart(ctx);

  const first = describeHerdrInteractiveInput("ask_user_questions", { questions: [{}] });
  const second = describeHerdrInteractiveInput("mcp__workflow__ask_user_questions", { questions: [{}, {}] });
  assert.ok(first);
  assert.ok(second);
  reporter.interactiveInputStart("question-1", first);
  assert.equal(client.reports.at(-1)?.state, "blocked");
  assert.equal(client.reports.at(-1)?.message, "M2/S1 · planning · awaiting user input · 1 question");
  await delay(0);
  assert.deepEqual(client.notifications, [{
    title: "GSD needs attention",
    body: "M2/S1 · planning · awaiting user input · 1 question",
    sound: "request",
  }]);

  reporter.interactiveInputStart("question-2", second);
  await delay(0);
  assert.equal(client.notifications.length, 1, "one blocked interval must send only one attention notification");
  assert.match(client.reports.at(-1)?.message ?? "", /2 questions/);
  reporter.interactiveInputEnd("question-1");
  assert.equal(client.reports.at(-1)?.state, "blocked");
  assert.match(client.reports.at(-1)?.message ?? "", /2 questions/);

  reporter.interactiveInputEnd("question-2");
  assert.equal(client.reports.at(-1)?.state, "working");
  assert.equal(client.reports.at(-1)?.message, "M2/S1 · planning");
});

test("normal agent completion sends one done notification after the idle debounce", async () => {
  const client = new FakeHerdrClient();
  const reporter = new HerdrRootReporter(client, { idleDebounceMs: 1 });
  await reporter.sessionStart({ reason: "startup" }, ctx, "M3/S2 · validating");
  assert.equal(client.notifications.length, 0, "initial idle state is not task completion");
  reporter.agentStart(ctx);
  reporter.agentEnd(normalEnd);
  await delay(5);
  assert.deepEqual(client.notifications, [{
    title: "GSD finished",
    body: "M3/S2 · validating",
    sound: "done",
  }]);
});

test("duplicate agent_end events send only one completion notification", async () => {
  const client = new FakeHerdrClient();
  const reporter = new HerdrRootReporter(client, { idleDebounceMs: 1 });
  await reporter.sessionStart({ reason: "startup" }, ctx, "M3/S2 · validating");
  reporter.agentStart(ctx);
  reporter.agentEnd(normalEnd);
  await delay(5);
  reporter.agentEnd(normalEnd);
  await delay(5);
  assert.equal(client.notifications.length, 1);
});

test("durable failure sends a redacted attention notification", async () => {
  const client = new FakeHerdrClient();
  const reporter = new HerdrRootReporter(client, { idleDebounceMs: 1 });
  await reporter.sessionStart({ reason: "startup" }, ctx, "M4/S1");
  reporter.agentStart(ctx);
  reporter.agentEnd({
    messages: [{ role: "assistant", stopReason: "error", errorMessage: "API_TOKEN=super-secret provider failed" }],
    willRetry: false,
  });
  await delay(0);
  assert.equal(client.notifications.length, 1);
  assert.equal(client.notifications[0].title, "GSD needs attention");
  assert.equal(client.notifications[0].sound, "request");
  assert.match(client.notifications[0].body ?? "", /API_TOKEN=\[REDACTED\]/);
  assert.doesNotMatch(client.notifications[0].body ?? "", /super-secret/);
});

test("a quickly settled question suppresses its stale blocked notification", async () => {
  let releaseBlockedReport!: () => void;
  const blockedReport = new Promise<void>((resolve) => { releaseBlockedReport = resolve; });
  const notifications: string[] = [];
  const client = {
    async reportAgent(_agent: string, state: string): Promise<boolean> {
      if (state === "blocked") await blockedReport;
      return true;
    },
    async reportAgentSession(): Promise<boolean> { return true; },
    async releaseAgent(): Promise<boolean> { return true; },
    async showNotification({ title }: { title: string }): Promise<boolean> {
      notifications.push(title);
      return true;
    },
  };
  const reporter = new HerdrRootReporter(client);
  await reporter.sessionStart({ reason: "startup" }, ctx);
  reporter.agentStart(ctx);
  const descriptor = describeHerdrInteractiveInput("ask_user_questions", { questions: [{}] });
  assert.ok(descriptor);
  reporter.interactiveInputStart("question-fast", descriptor);
  reporter.interactiveInputEnd("question-fast");
  releaseBlockedReport();
  await delay(0);
  assert.deepEqual(notifications, []);
});

test("agent end clears stale interactive input before returning idle", async () => {
  const client = new FakeHerdrClient();
  const reporter = new HerdrRootReporter(client, { idleDebounceMs: 1 });
  await reporter.sessionStart({ reason: "startup" }, ctx);
  reporter.agentStart(ctx);
  const descriptor = describeHerdrInteractiveInput("secure_env_collect");
  assert.ok(descriptor);
  reporter.interactiveInputStart("secure-1", descriptor);
  assert.equal(client.reports.at(-1)?.state, "blocked");

  reporter.agentEnd(normalEnd);
  await delay(5);
  assert.equal(client.reports.at(-1)?.state, "idle");
  assert.doesNotMatch(client.reports.at(-1)?.message ?? "", /secure input/);
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
