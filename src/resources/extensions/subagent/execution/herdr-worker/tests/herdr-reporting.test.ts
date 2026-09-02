import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { HerdrWorkerLaunchSpecV1 } from "../artifacts.js";
import { HerdrWorkerReporter, mapWorkerStatusToHerdr } from "../herdr-reporting.js";

function spec(): HerdrWorkerLaunchSpecV1 {
  return {
    schemaVersion: 1,
    rootSessionId: "root",
    dispatchId: "dispatch",
    childId: "child",
    agent: "scout",
    trackingName: "falcon",
    model: "provider/model",
    thinking: "high",
    cwd: "/repo",
    executable: "/usr/bin/node",
    args: [],
    stdoutPath: "/runtime/stdout.jsonl",
    stderrPath: "/runtime/stderr.log",
    statePath: "/runtime/state.json",
    heartbeatPath: "/runtime/heartbeat.json",
    exitPath: "/runtime/exit.json",
    envPath: "/runtime/env.json",
  };
}

describe("Herdr worker semantic reporting", () => {
  it("maps worker runtime states to Herdr semantic states", () => {
    assert.equal(mapWorkerStatusToHerdr("working"), "working");
    assert.equal(mapWorkerStatusToHerdr("retrying"), "working");
    assert.equal(mapWorkerStatusToHerdr("failed"), "blocked");
    assert.equal(mapWorkerStatusToHerdr("completed"), "idle");
    assert.equal(mapWorkerStatusToHerdr("orphaned"), "unknown");
  });

  it("reports bounded identity metadata and ordered lifecycle/final metadata", async () => {
    const calls: Array<{ method: string; seq: number; value: unknown }> = [];
    const client = {
      isAvailable: () => true,
      reportAgent: async (_agent: string, state: string, seq: number, message?: string) => {
        calls.push({ method: "agent", seq, value: { state, message } });
        return true;
      },
      reportMetadata: async (seq: number, metadata: Record<string, unknown>) => {
        calls.push({ method: "metadata", seq, value: metadata });
        return true;
      },
    };
    const reporter = new HerdrWorkerReporter(spec(), { client });
    await reporter.initialize();
    await reporter.reportStatus("working", "reading files");
    await reporter.reportFinal("completed");
    assert.deepEqual(calls.map((call) => call.method), ["metadata", "agent", "agent", "metadata"]);
    assert.ok(calls.every((call, index) => index === 0 || call.seq > calls[index - 1].seq));
    assert.equal(((calls[0].value as any).tokens as any).outcome, null);
    assert.deepEqual((calls[1].value as any).state, "working");
    assert.deepEqual((calls[2].value as any).state, "idle");
  });

  it("redacts task-preview secrets before reporting them to Herdr", async () => {
    const messages: string[] = [];
    const reporter = new HerdrWorkerReporter(
      { ...spec(), taskPreview: "inspect API_TOKEN=super-secret" },
      {
        client: {
          isAvailable: () => true,
          reportAgent: async (_agent, _state, _seq, message) => {
            if (message) messages.push(message);
            return true;
          },
          reportMetadata: async () => true,
        },
      },
    );
    await reporter.reportStatus("working", "inspect API_TOKEN=super-secret");
    assert.deepEqual(messages, ["inspect API_TOKEN=[REDACTED]"]);
  });

  it("serializes concurrent activity updates before final metadata publication", async () => {
    const calls: string[] = [];
    const reporter = new HerdrWorkerReporter(spec(), {
      client: {
        isAvailable: () => true,
        reportAgent: async (_agent, state) => {
          await new Promise((resolve) => setTimeout(resolve, state === "working" ? 5 : 0));
          calls.push(`agent:${state}`);
          return true;
        },
        reportMetadata: async (_seq, metadata) => {
          calls.push((metadata.tokens as any)?.outcome ? "metadata:outcome" : "metadata:init");
          return true;
        },
      },
    });
    const first = reporter.reportStatus("working", "one");
    const second = reporter.reportStatus("retrying", "two");
    await reporter.reportFinal("completed");
    await Promise.all([first, second]);
    assert.deepEqual(calls, ["agent:working", "agent:working", "agent:idle", "metadata:outcome"]);
  });

  it("notifies once per blocked interval and once on successful completion", async () => {
    const notifications: Array<{ title: string; body?: string; sound?: string }> = [];
    const reporter = new HerdrWorkerReporter(spec(), {
      client: {
        isAvailable: () => true,
        reportAgent: async () => true,
        reportMetadata: async () => true,
        showNotification: async (notification) => {
          notifications.push(notification);
          return true;
        },
      },
    });

    await reporter.reportStatus("blocked", "awaiting user input");
    await reporter.reportStatus("blocked", "awaiting user input · 2 questions");
    assert.equal(notifications.length, 1);
    assert.deepEqual(notifications[0], {
      title: "GSD worker needs attention",
      body: "falcon / scout · awaiting user input",
      sound: "request",
    });

    await reporter.reportStatus("working", "resumed");
    await reporter.reportStatus("blocked", "secure input required");
    assert.equal(notifications.length, 2);
    await reporter.reportStatus("working", "resumed");
    await reporter.reportFinal("completed");
    assert.deepEqual(notifications.at(-1), {
      title: "GSD worker finished",
      body: "falcon / scout · completed",
      sound: "done",
    });
  });

  it("does not duplicate an attention notification when a blocked worker fails", async () => {
    const notifications: string[] = [];
    const reporter = new HerdrWorkerReporter(spec(), {
      client: {
        isAvailable: () => true,
        reportAgent: async () => true,
        reportMetadata: async () => true,
        showNotification: async ({ title }) => {
          notifications.push(title);
          return true;
        },
      },
    });
    await reporter.reportStatus("blocked", "waiting");
    await reporter.reportFinal("failed");
    assert.deepEqual(notifications, ["GSD worker needs attention"]);
  });

  it("treats notification delivery failure as presentation-only", async () => {
    const calls: string[] = [];
    const reporter = new HerdrWorkerReporter(spec(), {
      client: {
        isAvailable: () => true,
        reportAgent: async () => {
          calls.push("agent");
          return true;
        },
        reportMetadata: async () => {
          calls.push("metadata");
          return true;
        },
        showNotification: async () => {
          throw new Error("no foreground client");
        },
      },
    });
    await assert.doesNotReject(() => reporter.reportFinal("completed"));
    assert.deepEqual(calls, ["agent", "metadata"]);
  });
});
