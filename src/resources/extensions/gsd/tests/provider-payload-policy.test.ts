import test from "node:test";
import assert from "node:assert/strict";

import type { ContextManagementConfig } from "../preferences-types.js";
import type { ProviderPayloadPolicyDeps } from "../provider-payload-policy.js";

import { applyProviderPayloadPolicy } from "../provider-payload-policy.js";

function createDeps(
  overrides: Partial<ProviderPayloadPolicyDeps> & {
    context?: ContextManagementConfig | undefined;
    autoActive?: boolean;
    sourceContextBlock?: string | null;
  } = {},
): ProviderPayloadPolicyDeps {
  return {
    isAutoActive: () => overrides.autoActive ?? false,
    loadContextManagementConfig: () => overrides.context,
    renderSourceContextBlock: () => overrides.sourceContextBlock ?? null,
    getEffectiveServiceTier: () => undefined,
    supportsServiceTier: () => false,
    ...overrides,
  };
}

function textFromMessage(message: { content?: unknown }): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const text = content.find((block): block is { text: string } => {
    return Boolean(block && typeof block === "object" && "text" in block && typeof block.text === "string");
  });
  return text?.text ?? "";
}

test("provider payload policy truncates tool results outside auto-mode without masking", () => {
  const messageText = "m".repeat(50);
  const responsesOutput = "r".repeat(50);
  const payload = {
    messages: [
      { role: "user", content: [{ type: "text", text: "keep me" }] },
      { role: "toolResult", content: [{ type: "text", text: messageText }] },
    ],
    input: [
      { role: "user", content: [{ type: "input_text", text: "keep me" }] },
      { type: "function_call_output", call_id: "call_test", output: responsesOutput },
    ],
  };

  applyProviderPayloadPolicy({
    payload,
    deps: createDeps({ context: { observation_mask_turns: 1, tool_result_max_chars: 10 } }),
  });

  const truncatedMessage = textFromMessage(payload.messages[1]);
  const truncatedResponsesOutput = String(payload.input[1]?.output ?? "");
  assert.match(truncatedMessage, /\[truncated\]/);
  assert.match(truncatedResponsesOutput, /\[truncated\]/);
  assert.doesNotMatch(truncatedMessage, /result masked/);
  assert.doesNotMatch(truncatedResponsesOutput, /result masked/);
});

test("provider payload policy anchors source context after masking and truncation", () => {
  const sourceContextBlock = "## Source Context Block\n\n" + "full source text ".repeat(20);
  const payload = {
    messages: [
      { role: "user", content: [{ type: "text", text: "old turn" }] },
      { role: "toolResult", content: [{ type: "text", text: "old result ".repeat(20) }] },
      { role: "assistant", content: [{ type: "text", text: "ok" }] },
      { role: "user", content: [{ type: "text", text: "new turn" }] },
      { role: "toolResult", content: [{ type: "text", text: "new result ".repeat(20) }] },
    ],
  };

  applyProviderPayloadPolicy({
    payload,
    deps: createDeps({
      autoActive: true,
      context: { observation_mask_turns: 1, tool_result_max_chars: 80 },
      sourceContextBlock,
    }),
  });

  const oldResult = textFromMessage(payload.messages[1]);
  const newResult = textFromMessage(payload.messages[5]);
  const anchoredContext = textFromMessage(payload.messages[4]);

  assert.match(oldResult, /result masked/);
  assert.match(newResult, /\[truncated\]/);
  assert.equal(anchoredContext, sourceContextBlock);
  assert.doesNotMatch(anchoredContext, /\[truncated\]/);
});

test("provider payload policy applies ordering to Responses input payloads", () => {
  const sourceContextBlock = "## Source Context Block\n\n" + "responses source text ".repeat(20);
  const payload = {
    input: [
      { role: "user", content: [{ type: "input_text", text: "old turn" }] },
      { type: "function_call_output", call_id: "call_old", output: "old result ".repeat(20) },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] },
      { role: "user", content: [{ type: "input_text", text: "new turn" }] },
      { type: "function_call_output", call_id: "call_new", output: "new result ".repeat(20) },
    ],
  };

  applyProviderPayloadPolicy({
    payload,
    deps: createDeps({
      autoActive: true,
      context: { observation_mask_turns: 1, tool_result_max_chars: 80 },
      sourceContextBlock,
    }),
  });

  assert.match(String(payload.input[1]?.output ?? ""), /result masked/);
  assert.match(String(payload.input[5]?.output ?? ""), /\[truncated\]/);
  assert.equal(textFromMessage(payload.input[4]), sourceContextBlock);
});

test("provider payload policy replaces existing source context blocks", () => {
  const payload = {
    messages: [
      { role: "user", content: [{ type: "text", text: "keep me" }] },
      { role: "user", content: [{ type: "text", text: "## Source Context Block\n\nstale" }] },
    ],
  };

  applyProviderPayloadPolicy({
    payload,
    deps: createDeps({
      autoActive: true,
      sourceContextBlock: "## Source Context Block\n\nfresh",
    }),
  });

  const sourceMessages = payload.messages.filter((message) => {
    return textFromMessage(message).startsWith("## Source Context Block");
  });
  assert.equal(sourceMessages.length, 1);
  assert.equal(textFromMessage(sourceMessages[0]), "## Source Context Block\n\nfresh");
});

test("provider policy preserves source-prefix bytes across tool iterations and expires with its source store", () => {
  const sourceContextBlock = "## Source Context Block\n\n" + "protected source ".repeat(100);
  const history = [
    { role: "user", content: [{ type: "input_text", text: "verify" }] },
    { role: "user", content: [{ type: "input_text", text: "[GSD Context Injection]\ncontext" }] },
    { type: "function_call", call_id: "call1", name: "read", arguments: "{}" },
    { type: "function_call_output", call_id: "call1", output: "old result ".repeat(50) },
  ];
  const extraItems = [
    { type: "function_call", call_id: "call2", name: "test", arguments: "{}" },
    { type: "function_call_output", call_id: "call2", output: "new result ".repeat(50) },
  ];
  const deps = createDeps({ autoActive: true, context: { tool_result_max_chars: 20 }, sourceContextBlock });
  const first = applyProviderPayloadPolicy({ payload: { input: history }, deps }).input as typeof history;
  const next = applyProviderPayloadPolicy({ payload: { input: [...history, ...extraItems] }, deps }).input as typeof history;
  assert.ok(JSON.stringify(next.slice(0, first.length)) === JSON.stringify(first), "protected source and truncated tool results must retain prefix bytes");
  assert.equal(textFromMessage(first[1]), sourceContextBlock);
  assert.match(first.at(-1)?.output ?? "", /truncated/);
  assert.doesNotMatch(history.at(-1)?.output ?? "", /truncated/);

  const expired = applyProviderPayloadPolicy({
    payload: { input: [...history, ...extraItems] },
    deps: createDeps({ autoActive: true, context: { tool_result_max_chars: 20 } }),
  }).input as typeof history;
  assert.equal(expired.length, history.length + extraItems.length);
  assert.equal(expired.some((item) => textFromMessage(item).startsWith("## Source Context Block")), false);
});

test("provider payload policy sets service tier only for supported models", () => {
  const unsupported = {};
  applyProviderPayloadPolicy({
    payload: unsupported,
    modelId: "claude-opus-4-6",
    deps: createDeps({
      getEffectiveServiceTier: () => "priority",
      supportsServiceTier: (modelId) => modelId === "gpt-5.4",
    }),
  });
  assert.equal("service_tier" in unsupported, false);

  const supported: Record<string, unknown> = {};
  applyProviderPayloadPolicy({
    payload: supported,
    modelId: "gpt-5.4",
    deps: createDeps({
      getEffectiveServiceTier: () => "priority",
      supportsServiceTier: (modelId) => modelId === "gpt-5.4",
    }),
  });
  assert.equal(supported.service_tier, "priority");
});
