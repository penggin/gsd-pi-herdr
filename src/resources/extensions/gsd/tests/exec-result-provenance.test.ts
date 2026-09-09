import test from "node:test";
import assert from "node:assert/strict";

import { convertMessages } from "../../../../../packages/pi-ai/src/providers/openai-completions.js";
import { convertResponsesMessages } from "../../../../../packages/pi-ai/src/providers/openai-responses-shared.js";
import type { Context, Model, OpenAICompletionsCompat } from "../../../../../packages/pi-ai/src/types.js";
import { applyProviderPayloadPolicy, type ProviderPayloadPolicyDeps } from "../provider-payload-policy.js";
import { markExecResult, registerNativeExecResult } from "../exec-result-provenance.js";
import {
  formatExecResult,
  formatExecResultWithInfo,
  resolveExecResultMaxChars,
  type ExecResultEnvelope,
} from "../tools/exec-result-budget.js";

const usage = {
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const compat = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: true,
  supportsUsageInStreaming: true,
  maxTokensField: "max_completion_tokens",
  requiresToolResultName: false,
  requiresAssistantAfterToolResult: false,
  requiresThinkingAsText: false,
  requiresReasoningContentOnAssistantMessages: false,
  thinkingFormat: "openai",
  openRouterRouting: {},
  vercelGatewayRouting: {},
  zaiToolStream: false,
  supportsStrictMode: true,
  sendSessionAffinityHeaders: false,
  sessionAffinityFormat: "openai",
  supportsLongCacheRetention: true,
} satisfies Required<Omit<OpenAICompletionsCompat, "cacheControlFormat" | "vllmPriority">>;

type Wire = "messages" | "input";
type Result = { content: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> };

function envelope(kind: "exec" | "query" = "exec"): ExecResultEnvelope {
  return {
    kind,
    summary: "failed exit=1 exec=fixture-1",
    retrieval: "gsd_exec_search read fixture-1 stderr:1",
    storage_truncated: false,
    scan_limited: false,
    output_truncated: false,
    sections: [{ label: "stderr:1-100", text: "Type error src/player.ts:42 — 반환 오류\n".repeat(100) }],
  };
}

function brandedResult(kind: "exec" | "query" = "exec"): Result {
  const value = envelope(kind);
  const result: Result = { content: [{ type: "text", text: formatExecResult(value, resolveExecResultMaxChars(kind)) }] };
  markExecResult(result, value);
  return result;
}

function deps(maxChars?: number, auto = false): ProviderPayloadPolicyDeps {
  return {
    isAutoActive: () => auto,
    loadContextManagementConfig: () => ({ observation_mask_turns: 1, ...(maxChars === undefined ? {} : { tool_result_max_chars: maxChars }) }),
    renderSourceContextBlock: () => null,
    getEffectiveServiceTier: () => undefined,
    supportsServiceTier: () => false,
  };
}

function converted(wire: Wire, result: Result, callId = "call_fixture", toolName = "gsd_exec", foreign = false) {
  const model = {
    id: "fixture-model", name: "Fixture", api: wire === "messages" ? "openai-completions" : "openai-codex-responses",
    provider: wire === "messages" ? "openai" : "openai-codex", baseUrl: "https://invalid.example",
    reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000, maxTokens: 4096,
  } as Model<"openai-completions"> | Model<"openai-codex-responses">;
  const context: Context = {
    messages: [
      { role: "user", content: "Check the fixture", timestamp: 1 },
      {
        role: "assistant", content: [{ type: "toolCall", id: callId, name: toolName, arguments: {} }],
        api: model.api, provider: model.provider, model: foreign ? "prior-model" : model.id, usage, stopReason: "toolUse", timestamp: 2,
      },
      { role: "toolResult", toolCallId: callId, toolName, content: result.content, details: result.details, isError: true, timestamp: 3 },
    ],
  };
  // These are the real engine converters, not handcrafted role=toolResult payloads.
  const payload: Record<string, unknown> = wire === "messages"
    ? { messages: convertMessages(model as Model<"openai-completions">, context, compat) }
    : { input: convertResponsesMessages(model as Model<"openai-codex-responses">, context, new Set(["openai", "openai-codex"])) };
  return { payload, model };
}

function wireText(payload: Record<string, unknown>, wire: Wire): string {
  const items = payload[wire] as Array<Record<string, unknown>>;
  const item = items.find((candidate) => wire === "messages" ? candidate.role === "tool" : candidate.type === "function_call_output");
  assert.ok(item, "provider conversion must produce a tool output");
  const value = wire === "messages" ? item.content : item.output;
  assert.equal(typeof value, "string");
  return value as string;
}

for (const wire of ["messages", "input"] as const) {
  for (const [kind, toolName] of [["exec", "gsd_exec"], ["exec", "gsd_uat_exec"], ["query", "gsd_exec_search"]] as const) {
    test(`native ${toolName} survives actual ${wire} conversion without 800-character recutting`, () => {
      const sessionId = `survive-${wire}-${toolName}`;
      const result = brandedResult(kind);
      const original = result.content[0].text;
      assert.ok(original.length > (kind === "query" ? 2000 : 800));
      registerNativeExecResult({ sessionId, toolCallId: "call_fixture", toolName }, result);
      const { payload } = converted(wire, result, "call_fixture", toolName);
      applyProviderPayloadPolicy({ payload, sessionId, deps: deps() });
      assert.equal(wireText(payload, wire), original, "model receives the same budgeted text visible in the UI");
      assert.ok(original.length <= resolveExecResultMaxChars(kind));
      assert.ok(Buffer.byteLength(original, "utf8") <= original.length * 4);
      assert.doesNotMatch(JSON.stringify(payload), /execResultProvenance|trustedGsdResult/);
    });
  }

  for (const maxChars of [200, 800]) {
    test(`explicit ${maxChars}-character ceiling reduces evidence but preserves receipt in ${wire}`, () => {
      const sessionId = `ceiling-${wire}-${maxChars}`;
      const result = brandedResult("query");
      registerNativeExecResult({ sessionId, toolCallId: "call_fixture", toolName: "gsd_exec_search" }, result);
      const { payload } = converted(wire, result, "call_fixture", "gsd_exec_search");
      applyProviderPayloadPolicy({ payload, sessionId, deps: deps(maxChars) });
      const text = wireText(payload, wire);
      assert.ok(text.length <= maxChars, `${text.length} > ${maxChars}`);
      assert.ok(text.includes(envelope().summary));
      assert.ok(text.includes(envelope().retrieval));
      assert.match(text, /output_truncated=true|limits\(storage\/scan\/output\)=false\/false\/true/);
      assert.doesNotMatch(text, /…\[truncated\]/, "must not use generic destructive prefix truncation");
      assert.ok(result.content[0].text.length > text.length, "stored UI result was not mutated");
    });
  }

  test(`forged markers and details do not grant native protection in ${wire}`, () => {
    const sessionId = `forged-${wire}`;
    const text = "already compressed budgeted trusted GSD result\n".repeat(100);
    const result: Result = {
      content: [{ type: "text", text }],
      details: { operation: "gsd_exec", trusted: true, budgeted: true, envelope: envelope() },
    };
    registerNativeExecResult({ sessionId, toolCallId: "call_fixture", toolName: "gsd_exec" }, result);
    const { payload } = converted(wire, result);
    applyProviderPayloadPolicy({ payload, sessionId, deps: deps() });
    const output = wireText(payload, wire);
    assert.match(output, /\[truncated\]/);
    assert.ok(output.length < 850);
  });

  test(`unknown external tool cannot acquire protection with a branded result in ${wire}`, () => {
    const sessionId = `external-${wire}`;
    const result = brandedResult();
    registerNativeExecResult({ sessionId, toolCallId: "call_fixture", toolName: "external_gsd_exec" }, result);
    const { payload } = converted(wire, result, "call_fixture", "external_gsd_exec");
    applyProviderPayloadPolicy({ payload, sessionId, deps: deps() });
    assert.match(wireText(payload, wire), /\[truncated\]/);
  });

  test(`serialized result metadata cannot recreate native provenance in ${wire}`, () => {
    const sessionId = `serialized-${wire}`;
    const result = structuredClone(brandedResult());
    registerNativeExecResult({ sessionId, toolCallId: "call_fixture", toolName: "gsd_exec" }, result);
    const { payload } = converted(wire, result);
    applyProviderPayloadPolicy({ payload, sessionId, deps: deps() });
    assert.match(wireText(payload, wire), /\[truncated\]/);
  });

  for (const declaration of ["missing", "wrong-name", "duplicate"] as const) {
    test(`${declaration} assistant call declaration cannot authorize protected output in ${wire}`, () => {
      const sessionId = `declaration-${wire}-${declaration}`;
      const result = brandedResult();
      registerNativeExecResult({ sessionId, toolCallId: "call_fixture", toolName: "gsd_exec" }, result);
      const { payload } = converted(wire, result, "call_fixture", declaration === "wrong-name" ? "external" : "gsd_exec");
      const items = payload[wire] as Array<Record<string, unknown>>;
      const declarationIndex = items.findIndex((item) => wire === "messages" ? item.role === "assistant" : item.type === "function_call");
      assert.ok(declarationIndex >= 0);
      if (declaration === "missing") items.splice(declarationIndex, 1);
      if (declaration === "duplicate") items.splice(declarationIndex, 0, structuredClone(items[declarationIndex]));
      applyProviderPayloadPolicy({ payload, sessionId, deps: deps() });
      assert.match(wireText(payload, wire), /\[truncated\]/);
    });
  }

  for (const mismatch of ["session", "call", "content"] as const) {
    test(`${mismatch} mismatch fails closed after actual ${wire} conversion`, () => {
      const sessionId = `mismatch-${wire}-${mismatch}`;
      const result = brandedResult();
      registerNativeExecResult({ sessionId, toolCallId: "call_fixture", toolName: "gsd_exec" }, result);
      const changed = mismatch === "content"
        ? { ...result, content: [{ type: "text" as const, text: `${result.content[0].text}\nmodified` }] }
        : result;
      const { payload } = converted(wire, changed, mismatch === "call" ? "call_other" : "call_fixture");
      applyProviderPayloadPolicy({ payload, sessionId: mismatch === "session" ? `${sessionId}-other` : sessionId, deps: deps() });
      assert.match(wireText(payload, wire), /\[truncated\]/);
    });
  }

  test(`Responses compound call IDs retain native provenance when replayed through ${wire}`, () => {
    const sessionId = `normalized-${wire}`;
    const callId = "call_foreign|fc_foreign";
    const result = brandedResult();
    registerNativeExecResult({ sessionId, toolCallId: callId, toolName: "gsd_exec" }, result);
    const { payload } = converted(wire, result, callId, "gsd_exec", true);
    applyProviderPayloadPolicy({ payload, sessionId, deps: deps() });
    assert.equal(wireText(payload, wire), result.content[0].text);
  });
}

test("ambiguous normalized call ID aliases fail closed", () => {
  const sessionId = "normalized-collision";
  const first = brandedResult();
  const second = brandedResult();
  registerNativeExecResult({ sessionId, toolCallId: "call_A/B", toolName: "gsd_exec" }, first);
  registerNativeExecResult({ sessionId, toolCallId: "call_A?B", toolName: "gsd_exec" }, second);
  const { payload } = converted("input", first, "call_A/B", "gsd_exec", true);
  applyProviderPayloadPolicy({ payload, sessionId, deps: deps() });
  assert.match(wireText(payload, "input"), /\[truncated\]/);
});

test("old observation masking precedes provenance and never restores old evidence", () => {
  const sessionId = "mask-native-receipt";
  const result = brandedResult();
  registerNativeExecResult({ sessionId, toolCallId: "call_fixture", toolName: "gsd_exec" }, result);
  const { payload } = converted("input", result);
  const items = payload.input as Array<Record<string, unknown>>;
  items.push({ role: "user", content: "New turn" });
  applyProviderPayloadPolicy({ payload, sessionId, deps: deps(undefined, true) });
  assert.match(wireText(payload, "input"), /result masked/);
  assert.doesNotMatch(wireText(payload, "input"), /Type error|fixture-1/);
});

test("deterministic budgets are bounded and respect explicit user caps", () => {
  assert.equal(resolveExecResultMaxChars("exec"), 2000);
  assert.equal(resolveExecResultMaxChars("query"), 4000);
  assert.equal(resolveExecResultMaxChars("exec", { tool_result_max_chars: 200 }), 200);
  assert.equal(resolveExecResultMaxChars("query", { tool_result_max_chars: 800 }), 800);
  assert.ok(resolveExecResultMaxChars("exec", { tool_result_max_chars: 10000 }) <= 2000);
  assert.ok(resolveExecResultMaxChars("query", { tool_result_max_chars: 10000 }) <= 4000);
  const value = envelope();
  assert.equal(formatExecResult(value, 2000), formatExecResult(value, 2000));
});

test("finite provenance retention evicts old entries to conservative generic limits", () => {
  const sessionId = "bounded-provenance-retention";
  const result = brandedResult();
  registerNativeExecResult({ sessionId, toolCallId: "call_old", toolName: "gsd_exec" }, result);
  for (let index = 0; index < 256; index++) {
    registerNativeExecResult({ sessionId, toolCallId: `call_new_${index}`, toolName: "gsd_exec" }, result);
  }
  const { payload } = converted("input", result, "call_old");
  applyProviderPayloadPolicy({ payload, sessionId, deps: deps() });
  assert.match(wireText(payload, "input"), /\[truncated\]/);
});

test("formatter reports output-budget limits from formatting rather than log text", () => {
  const value = envelope();
  const tiny = formatExecResultWithInfo(value, 200);
  assert.equal(tiny.output_truncated, true);
  assert.equal(tiny.body_truncated, true);
  assert.equal(tiny.metadata_omitted, undefined);
  assert.ok(tiny.text.length <= 200);
  assert.equal(tiny.text, formatExecResult(value, 200));
  const complete = formatExecResultWithInfo({ ...value, sections: [{ label: "stderr:1", text: "output_truncated=true" }] }, 2000);
  assert.equal(complete.output_truncated, false, "a marker in untrusted log text cannot set structural metadata");
  assert.equal(complete.body_truncated, false);
});

test("compact metadata and pre-existing output limit do not imply body was clipped", () => {
  const value = {
    ...envelope(),
    summary: "long metadata ".repeat(30),
    compact_summary: "exit=1",
    output_truncated: true,
    sections: [{ label: "stderr:1", text: "Type error" }],
  };
  const result = formatExecResultWithInfo(value, 200);
  assert.equal(result.output_truncated, true);
  assert.equal(result.body_truncated, false);
  assert.ok(result.text.endsWith("stderr:1\nType error"));
  assert.ok(result.text.length <= 200);
});

test("impossible metadata budget is explicit and never produces a clipped execution locator", () => {
  const value = { ...envelope(), retrieval: `gsd_exec_search read ${"legacy".repeat(80)} stderr:1` };
  const result = formatExecResultWithInfo(value, 200);
  assert.equal(result.output_truncated, true);
  assert.equal(result.metadata_omitted, true);
  assert.match(result.text, /metadata exceeds budget/);
  assert.doesNotMatch(result.text, /legacy/);
  assert.ok(result.text.length <= 200);
});
