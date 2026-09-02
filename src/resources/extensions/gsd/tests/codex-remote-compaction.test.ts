import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { AssistantMessage, Model } from "@gsd/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionBeforeCompactEvent,
  SessionEntry,
} from "@gsd/pi-coding-agent";

import {
  checkpointMarker,
  createCheckpointDetails,
  fingerprintMessage,
  parseCheckpointDetails,
  projectCheckpointContext,
} from "../codex-compact/checkpoint.ts";
import {
  compactWithCodexRemoteV2,
  keptMessages,
  resolveConfig,
  rewriteActiveCheckpointPayload,
  usesCodexResponsesApi,
} from "../codex-compact/integration.ts";
import {
  appendCompactionTrigger,
  CodexCompactionProtocolError,
  collectCompactionSse,
  rewriteCheckpointMarker,
} from "../codex-compact/protocol.ts";

function encoderStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

function sse(events: unknown[]): Response {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function jwt(): string {
  const payload = Buffer.from(JSON.stringify({
    "https://api.openai.com/auth": { chatgpt_account_id: "acct-test" },
  })).toString("base64url");
  return `header.${payload}.signature`;
}

function usage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function userMessage(text: string, timestamp: number) {
  return { role: "user" as const, content: [{ type: "text" as const, text }], timestamp };
}

function assistantMessage(text: string, timestamp: number): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-codex-responses",
    provider: "openai-codex",
    model: "gpt-5.6-codex",
    usage: usage(),
    stopReason: "stop",
    timestamp,
  };
}

function entry(
  id: string,
  parentId: string | null,
  message: Extract<SessionEntry, { type: "message" }>["message"],
): SessionEntry {
  return { type: "message", id, parentId, timestamp: new Date(message.timestamp).toISOString(), message };
}

function model(): Model<"openai-codex-responses"> {
  return {
    id: "gpt-5.6-codex",
    name: "Codex test",
    api: "openai-codex-responses",
    provider: "openai-codex",
    baseUrl: "https://chatgpt.com/backend-api",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 32_000,
  };
}

test("Remote V2 protocol requires exactly one bounded opaque compaction item", async () => {
  const item = { type: "compaction", encrypted_content: "opaque-test" };
  const collected = await collectCompactionSse(encoderStream([
    { type: "response.output_item.done", item },
    { type: "response.completed", response: { status: "completed", output: [item] } },
  ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")));
  assert.deepEqual(collected.item, item);

  await assert.rejects(
    collectCompactionSse(encoderStream(`data: ${JSON.stringify({
      type: "response.completed",
      response: { status: "completed", output: [] },
    })}\n\n`)),
    (error: unknown) => error instanceof CodexCompactionProtocolError,
  );
});

test("checkpoint marker rewrite is exact and preserves surrounding provider input", () => {
  const marker = checkpointMarker("checkpoint-1234");
  const payload = {
    model: "gpt-5.6-codex",
    input: [
      { role: "user", content: [{ type: "input_text", text: "before" }] },
      { role: "user", content: [{ type: "input_text", text: marker }] },
      { role: "user", content: [{ type: "input_text", text: "after" }] },
    ],
  };
  const replacement = [{ type: "compaction", encrypted_content: "opaque" }];
  const rewritten = rewriteCheckpointMarker(payload, marker, replacement);
  assert.deepEqual((rewritten.input as unknown[])[1], replacement[0]);
  assert.equal((rewritten.input as unknown[]).length, 3);
  assert.equal((appendCompactionTrigger(rewritten).input as unknown[]).length, 4);
  assert.throws(
    () => rewriteCheckpointMarker({ ...payload, input: [...payload.input, payload.input[1]] }, marker, replacement),
    CodexCompactionProtocolError,
  );
});

test("checkpoint validation and projection fail closed on a changed retained suffix", () => {
  const kept = userMessage("retained", 20);
  const details = createCheckpointDetails({
    provider: "openai-codex",
    modelId: "gpt-5.6-codex",
    checkpointId: "checkpoint-1234",
    replacementHistory: [{ type: "compaction", encrypted_content: "opaque" }],
    keptMessages: [kept],
  });
  assert.ok(parseCheckpointDetails(details));
  const summary = "opaque fallback summary";
  const projected = projectCheckpointContext([
    { role: "compactionSummary", summary, tokensBefore: 50_000, timestamp: 10 },
    kept,
    userMessage("new", 30),
  ], details, summary);
  assert.equal(projected?.[0].role, "user");
  assert.match((projected?.[0] as { content: Array<{ text: string }> }).content[0].text, /GSD_CODEX_REMOTE_CHECKPOINT/);
  assert.equal(projected?.length, 2);
  assert.equal(projectCheckpointContext([
    { role: "compactionSummary", summary, tokensBefore: 50_000, timestamp: 10 },
    userMessage("tampered", 20),
  ], details, summary), undefined);
  assert.equal(details.keptMessageFingerprints[0], fingerprintMessage(kept));
});

test("GSD compaction cut point fingerprints only messages retained by the new compaction", () => {
  const entries: SessionEntry[] = [
    entry("old", null, userMessage("old", 1)),
    {
      type: "compaction",
      id: "prior-compact",
      parentId: "old",
      timestamp: new Date(2).toISOString(),
      summary: "prior",
      firstKeptEntryId: "old",
      tokensBefore: 10,
    },
    entry("kept", "prior-compact", userMessage("kept", 3)),
  ];
  const event = {
    type: "session_before_compact",
    branchEntries: entries,
    reason: "manual",
    willRetry: false,
    signal: new AbortController().signal,
    preparation: {
      firstKeptEntryId: "old",
      messagesToSummarize: [userMessage("old", 1)],
      turnPrefixMessages: [],
      isSplitTurn: false,
      tokensBefore: 10,
      fileOps: { read: new Set(), written: new Set(), edited: new Set() },
      settings: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000 },
    },
  } satisfies SessionBeforeCompactEvent;
  assert.deepEqual(keptMessages(event).map((message) => message.role), ["user", "user"]);
  assert.deepEqual(keptMessages(event).map((message) => (message as { content: Array<{ text: string }> }).content[0].text), [
    "old",
    "kept",
  ]);
});

test("openai-codex-responses compaction submits trigger, persists opaque details, and replays them", async (t) => {
  const basePath = mkdtempSync(join(tmpdir(), "gsd-codex-compact-"));
  t.after(() => rmSync(basePath, { recursive: true, force: true }));
  const entries: SessionEntry[] = [
    entry("old-user", null, userMessage("old request", 1)),
    entry("old-assistant", "old-user", assistantMessage("old answer", 2)),
    entry("kept-user", "old-assistant", userMessage("keep this", 3)),
  ];
  const activeModel = model();
  const statuses: Array<string | undefined> = [];
  const notifications: string[] = [];
  const ctx = {
    cwd: basePath,
    model: activeModel,
    hasUI: true,
    getSystemPrompt: () => "system",
    sessionManager: {
      getSessionId: () => "session-test",
      getBranch: () => entries,
    },
    modelRegistry: {
      getApiKeyAndHeaders: async () => ({ ok: true as const, apiKey: jwt() }),
    },
    ui: {
      setStatus: (_key: string, value: string | undefined) => statuses.push(value),
      notify: (message: string) => notifications.push(message),
    },
  } as unknown as ExtensionContext;
  const pi = {
    getActiveTools: () => [],
    getAllTools: () => [],
  } as unknown as ExtensionAPI;
  const event = {
    type: "session_before_compact",
    branchEntries: entries,
    reason: "manual",
    willRetry: false,
    signal: new AbortController().signal,
    preparation: {
      firstKeptEntryId: "kept-user",
      messagesToSummarize: [userMessage("old request", 1), assistantMessage("old answer", 2)],
      turnPrefixMessages: [],
      isSplitTurn: false,
      tokensBefore: 42_000,
      fileOps: { read: new Set(), written: new Set(), edited: new Set() },
      settings: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000 },
    },
  } satisfies SessionBeforeCompactEvent;
  let submittedBody: Record<string, unknown> | undefined;
  const opaque = { type: "compaction", encrypted_content: "opaque-live-shape" };
  const result = await compactWithCodexRemoteV2(pi, event, ctx, basePath, {
    fetch: async (_input, init) => {
      submittedBody = JSON.parse(String(init?.body));
      return sse([
        { type: "response.output_item.done", item: opaque },
        {
          type: "response.completed",
          response: {
            id: "response-test",
            status: "completed",
            output: [opaque],
            usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 },
          },
        },
      ]);
    },
  });
  assert.equal((submittedBody?.input as Array<{ type?: string }>).at(-1)?.type, "compaction_trigger");
  assert.ok(result?.compaction);
  const details = parseCheckpointDetails(result?.compaction?.details);
  assert.ok(details);
  assert.equal(details.modelId, activeModel.id);
  assert.equal(details.replacementHistory.at(-1)?.encrypted_content, "opaque-live-shape");
  assert.equal(statuses[0], "Codex remote compaction…");
  assert.equal(statuses.at(-1), undefined);
  assert.deepEqual(notifications, []);

  const compactionEntry: SessionEntry = {
    type: "compaction",
    id: "remote-compact",
    parentId: "kept-user",
    timestamp: new Date(4).toISOString(),
    summary: result!.compaction!.summary,
    firstKeptEntryId: "kept-user",
    tokensBefore: 42_000,
    details,
    fromHook: true,
  };
  entries.push(compactionEntry);
  const marker = checkpointMarker(details.checkpointId);
  const replayed = rewriteActiveCheckpointPayload({
    input: [{ role: "user", content: [{ type: "input_text", text: marker }] }],
  }, ctx, basePath) as { input: Array<Record<string, unknown>> };
  assert.equal(replayed.input.at(-1)?.type, "compaction");
  assert.equal(replayed.input.at(-1)?.encrypted_content, "opaque-live-shape");

  const differentRouteCtx = {
    ...ctx,
    model: { ...activeModel, provider: "different-codex-route" },
  } as ExtensionContext;
  assert.equal(rewriteActiveCheckpointPayload({
    input: [{ role: "user", content: [{ type: "input_text", text: marker }] }],
  }, differentRouteCtx, basePath), undefined);

  entries.push(entry("new-user", "remote-compact", userMessage("after first compact", 5)));
  const repeatedEvent = {
    ...event,
    branchEntries: entries,
    preparation: {
      ...event.preparation,
      firstKeptEntryId: "new-user",
      messagesToSummarize: [userMessage("keep this", 3)],
      tokensBefore: 55_000,
    },
  } satisfies SessionBeforeCompactEvent;
  let repeatedBody: Record<string, unknown> | undefined;
  const nextOpaque = { type: "compaction", encrypted_content: "opaque-second" };
  const repeated = await compactWithCodexRemoteV2(pi, repeatedEvent, ctx, basePath, {
    fetch: async (_input, init) => {
      repeatedBody = JSON.parse(String(init?.body));
      return sse([
        { type: "response.output_item.done", item: nextOpaque },
        {
          type: "response.completed",
          response: {
            status: "completed",
            output: [nextOpaque],
            usage: { input_tokens: 120, output_tokens: 10, total_tokens: 130 },
          },
        },
      ]);
    },
  });
  const repeatedInput = repeatedBody?.input as Array<Record<string, unknown>>;
  assert.ok(repeatedInput.some((item) => item.encrypted_content === "opaque-live-shape"));
  assert.equal(repeatedInput.at(-1)?.type, "compaction_trigger");
  assert.equal(
    parseCheckpointDetails(repeated?.compaction?.details)?.replacementHistory.at(-1)?.encrypted_content,
    "opaque-second",
  );
});

test("remote protocol failure falls back to native compaction while caller cancellation does not", async (t) => {
  const basePath = mkdtempSync(join(tmpdir(), "gsd-codex-compact-fallback-"));
  t.after(() => rmSync(basePath, { recursive: true, force: true }));
  const entries: SessionEntry[] = [
    entry("old", null, userMessage("old", 1)),
    entry("kept", "old", userMessage("kept", 2)),
  ];
  const notifications: string[] = [];
  const ctx = {
    cwd: basePath,
    model: model(),
    hasUI: true,
    getSystemPrompt: () => "system",
    sessionManager: { getSessionId: () => "fallback-session", getBranch: () => entries },
    modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true as const, apiKey: jwt() }) },
    ui: {
      setStatus: () => undefined,
      notify: (message: string) => notifications.push(message),
    },
  } as unknown as ExtensionContext;
  const pi = { getActiveTools: () => [], getAllTools: () => [] } as unknown as ExtensionAPI;
  const preparation = {
    firstKeptEntryId: "kept",
    messagesToSummarize: [userMessage("old", 1)],
    turnPrefixMessages: [],
    isSplitTurn: false,
    tokensBefore: 42_000,
    fileOps: { read: new Set<string>(), written: new Set<string>(), edited: new Set<string>() },
    settings: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000 },
  };
  const failure = await compactWithCodexRemoteV2(pi, {
    type: "session_before_compact",
    branchEntries: entries,
    reason: "manual",
    willRetry: false,
    signal: new AbortController().signal,
    preparation,
  }, ctx, basePath, {
    fetch: async () => sse([{
      type: "response.completed",
      response: {
        status: "completed",
        output: [],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      },
    }]),
  });
  assert.equal(failure, undefined);
  assert.match(notifications.at(-1) ?? "", /using GSD native compaction/);

  const controller = new AbortController();
  controller.abort();
  let fetchCalled = false;
  const cancelled = await compactWithCodexRemoteV2(pi, {
    type: "session_before_compact",
    branchEntries: entries,
    reason: "manual",
    willRetry: false,
    signal: controller.signal,
    preparation,
  }, ctx, basePath, {
    fetch: async () => {
      fetchCalled = true;
      return new Response();
    },
  });
  assert.deepEqual(cancelled, { cancel: true });
  assert.equal(fetchCalled, false);
});

test("non-Codex APIs remain on native compaction and config defaults are bounded", () => {
  assert.equal(usesCodexResponsesApi({ ...model(), api: "openai-responses" } as Model<"openai-responses">), false);
  assert.deepEqual(resolveConfig(undefined), {
    enabled: true,
    requestTimeoutMs: 300_000,
    maxRetries: 2,
    replacementTokenBudget: 64_000,
    notifyOnFallback: true,
  });
});
