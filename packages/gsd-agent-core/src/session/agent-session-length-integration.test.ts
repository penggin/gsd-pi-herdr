import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Agent, type AgentMessage, type AgentTool } from "@gsd/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider, type AssistantMessage, type FauxModelDefinition } from "@gsd/pi-ai";
import { Type } from "typebox";
import { AuthStorage } from "@gsd/pi-coding-agent/core/auth-storage.js";
import { ModelRegistry } from "@gsd/pi-coding-agent/core/model-registry.js";
import { SessionManager } from "@gsd/pi-coding-agent/core/session-manager.js";
import { SettingsManager, type Settings } from "@gsd/pi-coding-agent/core/settings-manager.js";
import { convertToLlm } from "@gsd/pi-coding-agent/core/messages.js";
import type { ExtensionFactory } from "@gsd/pi-coding-agent/core/extensions/index.js";
import { createEventBus } from "@gsd/pi-coding-agent/core/event-bus.js";
import { createExtensionRuntime, loadExtensionFromFactory } from "@gsd/pi-coding-agent/core/extensions/loader.js";
import { AgentSession, type AgentSessionEvent } from "../agent-session.ts";

async function persistentHarness(t: TestContext, options: {
  models?: FauxModelDefinition[];
  settings?: Partial<Settings>;
  tools?: AgentTool[];
  extensions?: ExtensionFactory[];
} = {}) {
  const base = mkdtempSync(join(tmpdir(), "gsd-length-session-"));
  const auth = AuthStorage.inMemory();
  const registry = ModelRegistry.inMemory(auth);
  // ModelRegistry initialization rebuilds API providers. Register the local
  // fake stream afterward so no real provider or credential path is reachable.
  const faux = registerFauxProvider({ models: options.models });
  const model = faux.getModel();
  auth.setRuntimeApiKey(model.provider, "faux-only-key");
  const agent = new Agent({
    getApiKey: () => "faux-only-key",
    initialState: { model, systemPrompt: "Test assistant", tools: [] },
    convertToLlm,
  });
  const manager = SessionManager.create(base, join(base, "sessions"));
  const runtime = createExtensionRuntime();
  const eventBus = createEventBus();
  const extensions = await Promise.all((options.extensions ?? []).map((factory, index) =>
    loadExtensionFromFactory(factory, base, eventBus, runtime, `<length-test:${index}>`)));
  const session = new AgentSession({
    agent,
    sessionManager: manager,
    settingsManager: SettingsManager.inMemory(options.settings ?? { compaction: { enabled: false }, retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 } }),
    cwd: base,
    modelRegistry: registry,
    resourceLoader: {
      getExtensions: () => ({ extensions, errors: [], runtime }),
      getSkills: () => ({ skills: [], diagnostics: [] }),
      getPrompts: () => ({ prompts: [], diagnostics: [] }),
      getThemes: () => ({ themes: [], diagnostics: [] }),
      getAgentsFiles: () => ({ agentsFiles: [] }),
      getSystemPrompt: () => "Test assistant",
      getAppendSystemPrompt: () => [],
      extendResources() {},
      reload: async () => {},
    },
    baseToolsOverride: Object.fromEntries((options.tools ?? []).map((tool) => [tool.name, tool])),
  });
  const events: AgentSessionEvent[] = [];
  session.subscribe((event) => events.push(event));
  t.after(() => { session.dispose(); faux.unregister(); rmSync(base, { recursive: true, force: true }); });
  const persistedMessages = () => {
    const path = manager.getSessionFile();
    assert.ok(path);
    return readFileSync(path, "utf8").split("\n").filter(Boolean)
      .map((line) => JSON.parse(line)).filter((entry) => entry.type === "message")
      .map((entry) => entry.message as AgentMessage);
  };
  return { session, agent, manager, faux, events, persistedMessages };
}

function assistantMessages(messages: AgentMessage[]): AssistantMessage[] {
  return messages.filter((message): message is AssistantMessage => message.role === "assistant");
}

function continuationMessages(messages: AgentMessage[]): AgentMessage[] {
  return messages.filter((message) => message.role === "user" && JSON.stringify(message.content).includes("previous response was cut off"));
}

test("persistent AgentSession caps output-length calls and records one zero-usage terminal error", async (t) => {
  const h = await persistentHarness(t);
  h.faux.setResponses(Array.from({ length: 5 }, () => fauxAssistantMessage("partial output", { stopReason: "length" })));
  await h.session.prompt("Produce a result");
  assert.equal(h.faux.state.callCount, 4, JSON.stringify(h.session.messages));
  assert.equal(h.faux.getPendingResponseCount(), 1);
  const persisted = h.persistedMessages();
  assert.equal(continuationMessages(persisted).length, 3);
  const assistants = assistantMessages(persisted);
  assert.equal(assistants.filter((message) => message.stopReason === "length").length, 4);
  const terminal = assistants.at(-1)!;
  assert.equal(terminal.stopReason, "error");
  assert.match(terminal.errorMessage ?? "", /^\[length-halt\].*cap/);
  assert.equal(terminal.usage.totalTokens, 0);
  assert.equal(terminal.usage.cost.total, 0);
  assert.equal(h.events.filter((event) => event.type === "auto_retry_start").length, 0);
  assert.equal(h.events.filter((event) => event.type === "compaction_start").length, 0);
  assert.deepEqual(persisted, JSON.parse(JSON.stringify(h.session.messages)));
  assert.equal(h.events.filter((event) => event.type === "message_end").length, persisted.length);
});

test("persistent length continuation keeps tool pairs and refreshed model provenance", async (t) => {
  const tool: AgentTool = {
    name: "inspect", label: "Inspect", description: "Return fixture evidence", parameters: Type.Object({}),
    execute: async () => ({ content: [{ type: "text", text: "fixture evidence" }], details: {} }),
  };
  const h = await persistentHarness(t, { tools: [tool], models: [{ id: "model-a" }, { id: "model-b" }] });
  const providerContexts: AgentMessage[][] = [];
  h.faux.setResponses([
    fauxAssistantMessage([fauxToolCall("inspect", {}, { id: "inspect-1" }), { type: "text", text: "Partial" }], { stopReason: "length" }),
    (context) => { providerContexts.push(structuredClone(context.messages)); return fauxAssistantMessage("partial on new model", { stopReason: "length", errorMessage: "rate limit" }); },
    fauxAssistantMessage("must not retry a terminal length halt"),
  ]);
  h.session.subscribe((event) => {
    if (event.type === "turn_end" && event.message.role === "assistant" && event.message.model === "model-a") {
      h.agent.state.model = h.faux.getModel("model-b")!;
    }
  });
  await h.session.prompt("Inspect the fixture");
  assert.equal(h.faux.state.callCount, 2);
  const persisted = h.persistedMessages();
  const pairIndex = persisted.findIndex((message) => message.role === "assistant" && message.content.some((part) => part.type === "toolCall" && part.id === "inspect-1"));
  assert.equal(persisted[pairIndex + 1].role, "toolResult");
  assert.equal(persisted[pairIndex + 2].role, "user");
  assert.equal(continuationMessages(persisted).length, 1);
  assert.equal(providerContexts.length, 1);
  const providerPair = providerContexts[0].findIndex((message) => message.role === "toolResult");
  assert.equal(providerContexts[0][providerPair + 1].role, "user");
  const terminal = assistantMessages(persisted).at(-1)!;
  assert.equal(terminal.model, "model-b");
  assert.equal(terminal.provider, h.faux.getModel().provider);
  assert.match(terminal.errorMessage ?? "", /^\[length-halt\]/);
  assert.equal(h.session.isRetryableError(terminal), false);
  assert.equal(terminal.usage.output, 0);
  assert.equal(terminal.usage.cost.total, 0);
  assert.equal(h.events.some((event) => event.type === "auto_retry_start"), false);
});

test("persistent repeated zero-output length overflow compacts once and preserves historical tool pairs", async (t) => {
  let compactCalls = 0;
  let firstHistoryEntryId: string | undefined;
  let recoveryContext: AgentMessage[] = [];
  const h = await persistentHarness(t, {
    models: [{ id: "overflow-model", contextWindow: 100 }],
    settings: { compaction: { enabled: true, reserveTokens: 10, keepRecentTokens: 20 }, retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 } },
    extensions: [(pi) => {
      pi.on("session_before_compact", (event) => {
        compactCalls++;
        return { compaction: { summary: "Historical fixture evidence summarized", firstKeptEntryId: firstHistoryEntryId ?? event.preparation.firstKeptEntryId, tokensBefore: event.preparation.tokensBefore, details: {} } };
      });
    }],
  });
  const history: AgentMessage[] = [
    { role: "user", content: "Inspect historical fixture", timestamp: 1 },
    fauxAssistantMessage(fauxToolCall("inspect", {}, { id: "historic-tool" }), { stopReason: "toolUse", timestamp: 2 }),
    { role: "toolResult", toolCallId: "historic-tool", toolName: "inspect", content: [{ type: "text", text: "historical evidence" }], isError: false, timestamp: 3 },
    fauxAssistantMessage("Historical completed answer", { timestamp: 4 }),
  ];
  for (const message of history) {
    const entryId = h.manager.appendMessage(message as never);
    firstHistoryEntryId ??= entryId;
  }
  h.agent.state.messages = history;
  h.faux.setResponses([
    fauxAssistantMessage("", { stopReason: "length" }),
    async (context) => {
      recoveryContext = structuredClone(context.messages);
      // Ensure this new provider failure is later than the persisted compaction
      // timestamp, rather than looking like replayed pre-compaction evidence.
      await new Promise((resolve) => setTimeout(resolve, 5));
      return fauxAssistantMessage("", { stopReason: "length" });
    },
    fauxAssistantMessage("unexpected extra provider call"),
  ]);
  await h.session.prompt("x".repeat(800));
  assert.equal(h.faux.state.callCount, 2);
  assert.equal(compactCalls, 1);
  assert.equal(h.manager.getEntries().filter((entry) => entry.type === "compaction").length, 1);
  assert.deepEqual(h.persistedMessages().slice(0, history.length), JSON.parse(JSON.stringify(history)));
  assert.ok(recoveryContext.some((message) => message.role === "assistant" && JSON.stringify(message.content).includes("Historical completed answer")));
  const recoveredToolIndex = recoveryContext.findIndex((message) => message.role === "toolResult" && message.toolCallId === "historic-tool");
  assert.ok(recoveredToolIndex > 0);
  assert.ok(recoveryContext[recoveredToolIndex - 1].role === "assistant");
  assert.equal(assistantMessages(recoveryContext).some((message) => message.stopReason === "length" || message.errorMessage?.startsWith("[length-halt]")), false);
  assert.equal(continuationMessages(h.persistedMessages()).length, 0, "overflow must not create output continuation prompts");
  assert.equal(h.events.some((event) => event.type === "auto_retry_start"), false);
  const terminal = assistantMessages(h.session.messages).at(-1)!;
  assert.equal(terminal.stopReason, "error");
  assert.match(terminal.errorMessage ?? "", /^\[length-halt\].*\[context_length_exceeded\]/);
  assert.ok(h.events.some((event) => event.type === "compaction_end" && /one compact-and-retry attempt/.test(event.errorMessage ?? "")));
});

for (const outcome of ["return", "throw"] as const) {
  test(`persistent session abort during asynchronous length preparation (${outcome}) makes no extra provider call`, async (t) => {
    const h = await persistentHarness(t);
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const prepare = h.agent.prepareNextTurnWithContext!;
    h.agent.prepareNextTurnWithContext = async (context, signal) => {
      enter();
      await blocked;
      if (outcome === "throw") throw signal?.reason ?? new Error("Aborted preparation");
      return prepare(context, signal);
    };
    h.faux.setResponses([
      fauxAssistantMessage("partial output", { stopReason: "length" }),
      fauxAssistantMessage("must not call after abort"),
    ]);
    const prompted = h.session.prompt("Produce a result");
    await entered;
    const aborted = h.session.abort();
    release();
    await Promise.all([prompted, aborted]);
    assert.equal(h.faux.state.callCount, 1);
    assert.equal(continuationMessages(h.persistedMessages()).length, 0);
    assert.equal(assistantMessages(h.persistedMessages()).at(-1)?.stopReason, "aborted");
    assert.equal(h.events.some((event) => event.type === "auto_retry_start"), false);
    assert.equal(h.events.some((event) => event.type === "compaction_start"), false);
  });
}

test("persistent overflow bridges an assistant-only retained tail once and accepts a later explicit prompt", async (t) => {
  let firstHistoryEntryId: string | undefined;
  let toolExecutions = 0;
  const h = await persistentHarness(t, {
    models: [{ id: "overflow-tail-model", contextWindow: 100 }],
    settings: { compaction: { enabled: true, reserveTokens: 10, keepRecentTokens: 20 }, retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 } },
    tools: [{ name: "inspect", label: "Inspect", description: "Historical fixture tool", parameters: Type.Object({}), execute: async () => {
      toolExecutions++;
      return { content: [{ type: "text", text: "must not rerun" }], details: {} };
    } }],
    extensions: [(pi) => {
      pi.on("session_before_compact", (event) => ({ compaction: {
        summary: "Completed historical evidence retained",
        firstKeptEntryId: firstHistoryEntryId ?? event.preparation.firstKeptEntryId,
        tokensBefore: event.preparation.tokensBefore,
        details: {},
      } }));
    }],
  });
  const history: AgentMessage[] = [
    { role: "user", content: "Inspect historical evidence", timestamp: 1 },
    fauxAssistantMessage(fauxToolCall("inspect", {}, { id: "completed-inspect" }), { stopReason: "toolUse", timestamp: 2 }),
    { role: "toolResult", toolCallId: "completed-inspect", toolName: "inspect", content: [{ type: "text", text: "completed tool evidence" }], isError: false, timestamp: 3 },
    fauxAssistantMessage("Historical completed answer. ".repeat(40), { timestamp: 4 }),
  ];
  for (const message of history) {
    const entryId = h.manager.appendMessage(message as never);
    firstHistoryEntryId ??= entryId;
  }
  h.agent.state.messages = history;
  h.faux.setResponses([
    fauxAssistantMessage("", { stopReason: "length" }),
    fauxAssistantMessage("Recovered continuation"),
  ]);
  await h.session.runAgentPrompt([]);
  assert.equal(h.faux.state.callCount, 2);
  assert.equal(toolExecutions, 0);
  const bridgeMessages = () => h.persistedMessages().filter((message) => message.role === "user" && JSON.stringify(message.content).includes("Preserve completed work"));
  assert.equal(bridgeMessages().length, 1);
  assert.deepEqual(h.persistedMessages().slice(0, history.length), JSON.parse(JSON.stringify(history)));
  assert.ok(JSON.stringify(h.session.messages).includes("Historical completed answer"));
  // The test compactor deliberately retains all history. Give the subsequent
  // independent request sufficient context so it does not simulate a new overflow.
  h.agent.state.model = { ...h.agent.state.model, contextWindow: 10_000 };
  h.faux.appendResponses([fauxAssistantMessage("Fresh explicit response")]);
  await h.session.prompt("A new explicit request");
  assert.equal(h.faux.state.callCount, 3);
  assert.equal(bridgeMessages().length, 1);
  assert.equal(toolExecutions, 0);
  assert.equal(assistantMessages(h.session.messages).at(-1)?.stopReason, "stop");
});
