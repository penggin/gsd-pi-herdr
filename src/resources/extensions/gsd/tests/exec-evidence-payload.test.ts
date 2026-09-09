import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { convertMessages } from "../../../../../packages/pi-ai/src/providers/openai-completions.js";
import { convertResponsesMessages } from "../../../../../packages/pi-ai/src/providers/openai-responses-shared.js";
import type { Context, Model, OpenAICompletionsCompat } from "../../../../../packages/pi-ai/src/types.js";
import { registerExecTools } from "../bootstrap/exec-tools.js";
import { clearGSDPreferencesCache } from "../preferences.js";
import { applyProviderPayloadPolicy, type ProviderPayloadPolicyDeps } from "../provider-payload-policy.js";
import type { ToolExecutionResult } from "../tools/context-mode-tool-result.js";

const usage = {
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const compat = {
  supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: true,
  supportsUsageInStreaming: true, maxTokensField: "max_completion_tokens",
  requiresToolResultName: false, requiresAssistantAfterToolResult: false,
  requiresThinkingAsText: false, requiresReasoningContentOnAssistantMessages: false,
  thinkingFormat: "openai", openRouterRouting: {}, vercelGatewayRouting: {}, zaiToolStream: false,
  supportsStrictMode: true, sendSessionAffinityHeaders: false, sessionAffinityFormat: "openai",
  supportsLongCacheRetention: true,
} satisfies Required<Omit<OpenAICompletionsCompat, "cacheControlFormat" | "vllmPriority">>;

type Wire = "messages" | "input";
type RegisteredTool = {
  name: string;
  execute(id: string, params: Record<string, unknown>, signal: AbortSignal | undefined, update: undefined, ctx: unknown): Promise<ToolExecutionResult>;
};

function fixture(t: TestContext, maxChars?: number) {
  const base = mkdtempSync(join(tmpdir(), "gsd-public-exec-payload-"));
  const project = join(base, "project");
  const agentHome = join(base, "home");
  mkdirSync(join(project, ".gsd"), { recursive: true });
  mkdirSync(agentHome, { recursive: true });
  writeFileSync(join(project, ".gsd", "PREFERENCES.md"), [
    "---", "version: 1", "context_mode:", "  exec_digest_chars: 1500",
    ...(maxChars === undefined ? ["context_management: {}"] : ["context_management:", `  tool_result_max_chars: ${maxChars}`]),
    "---", "",
  ].join("\n"));
  const oldHome = process.env.GSD_HOME;
  process.env.GSD_HOME = agentHome;
  clearGSDPreferencesCache();
  t.after(() => {
    if (oldHome === undefined) delete process.env.GSD_HOME;
    else process.env.GSD_HOME = oldHome;
    clearGSDPreferencesCache();
    rmSync(base, { recursive: true, force: true });
  });
  const tools = new Map<string, RegisteredTool>();
  registerExecTools({ registerTool(tool: RegisteredTool) { tools.set(tool.name, tool); } } as any);
  let sessionId = `public-${base}`;
  const ctx = { cwd: project, sessionManager: { getSessionId: () => sessionId } };
  return {
    project, ctx, sessionId,
    setSessionId(value: string) { sessionId = value; },
    async call(name: string, id: string, params: Record<string, unknown>, signal?: AbortSignal) {
      const tool = tools.get(name);
      assert.ok(tool, `public native registration missing ${name}`);
      return tool.execute(id, params, signal, undefined, ctx);
    },
  };
}

function throughProvider(wire: Wire, result: ToolExecutionResult, sessionId: string, callId: string, toolName: string, maxChars?: number): string {
  const model = {
    id: "public-fixture", name: "Public Fixture", api: wire === "messages" ? "openai-completions" : "openai-codex-responses",
    provider: wire === "messages" ? "openai" : "openai-codex", baseUrl: "https://invalid.example",
    reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000, maxTokens: 4096,
  } as Model<"openai-completions"> | Model<"openai-codex-responses">;
  const context: Context = { messages: [
    { role: "user", content: "Run the fixture check", timestamp: 1 },
    {
      role: "assistant", content: [{ type: "toolCall", id: callId, name: toolName, arguments: {} }],
      api: model.api, provider: model.provider, model: model.id, usage, stopReason: "toolUse", timestamp: 2,
    },
    { role: "toolResult", toolCallId: callId, toolName, content: result.content, details: result.details, isError: result.isError === true, timestamp: 3 },
  ] };
  const payload: Record<string, unknown> = wire === "messages"
    ? { messages: convertMessages(model as Model<"openai-completions">, context, compat) }
    : { input: convertResponsesMessages(model as Model<"openai-codex-responses">, context, new Set(["openai", "openai-codex"])) };
  const deps: ProviderPayloadPolicyDeps = {
    isAutoActive: () => false,
    loadContextManagementConfig: () => maxChars === undefined ? {} : { tool_result_max_chars: maxChars },
    renderSourceContextBlock: () => null, getEffectiveServiceTier: () => undefined, supportsServiceTier: () => false,
  };
  applyProviderPayloadPolicy({ payload, sessionId, deps });
  const item = (payload[wire] as Array<Record<string, unknown>>)
    .find(value => wire === "messages" ? value.role === "tool" : value.type === "function_call_output");
  assert.ok(item);
  const value = wire === "messages" ? item.content : item.output;
  assert.equal(typeof value, "string");
  // Private details stay local and are not invented provider API fields.
  assert.equal("details" in item, false);
  return value as string;
}

const ERROR_TEXT = "src/player.ts:42: Type error: incompatible return type " + "retained context ".repeat(180);
const failingScript = `process.stdout.write("Starting build...\\n"); process.stderr.write(${JSON.stringify(ERROR_TEXT)}); process.exitCode = 1;`;

test("public gsd_exec saves stderr evidence and delivers the same >800-character receipt to both providers", async (t) => {
  const f = fixture(t);
  const result = await f.call("gsd_exec", "public-failure", { runtime: "node", script: failingScript, purpose: "compile fixture" });
  const text = result.content[0].text;
  assert.equal(result.isError, true);
  assert.equal(result.details.exit_code, 1);
  assert.match(text, /src\/player\.ts:42: Type error/);
  assert.match(text, /Starting build/);
  assert.ok(text.length > 800 && text.length <= 2000);
  assert.equal(readFileSync(String(result.details.stderr_path), "utf8"), ERROR_TEXT);
  for (const wire of ["messages", "input"] as const) {
    assert.equal(throughProvider(wire, result, f.sessionId, "public-failure", "gsd_exec"), text);
  }
  t.diagnostic(JSON.stringify({ fixture: "stderr-with-stdout", providerTextChars: text.length, providerTextBytes: Buffer.byteLength(text), limitChars: 2000, originalTailOmittedError: true }));
});

test("public saved-log search/read preserve source locators and native budgets through both providers", async (t) => {
  const f = fixture(t);
  const execution = await f.call("gsd_exec", "public-source", { runtime: "node", script: failingScript });
  const execId = String(execution.details.id);
  for (const mode of ["search", "read"] as const) {
    const callId = `public-query-${mode}`;
    const result = await f.call("gsd_exec_search", callId, {
      mode, exec_id: execId, stream: "stderr",
      ...(mode === "search" ? { query: "Type error", context_lines: 0 } : { start_line: 1, line_count: 1 }),
    });
    const text = result.content[0].text;
    assert.ok(text.length > 800 && text.length <= 4000);
    assert.ok(text.includes(execId));
    assert.match(text, /Type error/);
    const hits = result.details.results as Array<{ exec_id: string; stream: string; start_line: number; text: string }>;
    assert.equal(hits[0].exec_id, execId);
    assert.equal(hits[0].stream, "stderr");
    assert.equal(hits[0].start_line, 1);
    assert.ok(ERROR_TEXT.startsWith(hits[0].text));
    for (const wire of ["messages", "input"] as const) {
      assert.equal(throughProvider(wire, result, f.sessionId, callId, "gsd_exec_search"), text);
    }
    const repeated = await f.call("gsd_exec_search", callId + "-repeat", {
      mode, exec_id: execId, stream: "stderr",
      ...(mode === "search" ? { query: "Type error", context_lines: 0 } : { start_line: 1, line_count: 1 }),
    });
    assert.equal(repeated.content[0].text, text);
    t.diagnostic(JSON.stringify({ fixture: mode, providerTextChars: text.length, providerTextBytes: Buffer.byteLength(text), limitChars: 4000, runsScanned: result.details.runs_scanned, bytesRead: result.details.bytes_read, deterministic: true }));
  }
});

test("public explicit 200-character ceiling preserves real UUID, null/signal and timeout/abort/force flags", async (t) => {
  const f = fixture(t, 200);
  const cases = [
    { name: "signal", script: "process.kill(process.pid, 'SIGTERM')", timeout: undefined, abort: false, timedOut: false },
    { name: "timeout", script: "setInterval(() => {}, 1000)", timeout: 1000, abort: false, timedOut: true },
    { name: "abort", script: "setInterval(() => {}, 1000)", timeout: undefined, abort: true, timedOut: false },
  ];
  for (const example of cases) {
    const controller = new AbortController();
    const timer = example.abort ? setTimeout(() => controller.abort(), 200) : undefined;
    let result: ToolExecutionResult;
    try {
      result = await f.call("gsd_exec", `public-${example.name}`, {
        runtime: "node", script: example.script, ...(example.timeout ? { timeout_ms: example.timeout } : {}),
      }, controller.signal);
    } finally { if (timer) clearTimeout(timer); }
    const text = result.content[0].text;
    assert.equal(result.isError, true);
    assert.equal(result.details.exit_code, null);
    assert.equal(typeof result.details.signal, "string");
    assert.equal(result.details.timed_out, example.timedOut);
    assert.equal(result.details.aborted, example.abort);
    assert.equal(result.details.force_resolved, false);
    assert.ok(text.length <= 200);
    assert.ok(text.includes(String(result.details.id)));
    assert.match(text, /exit=null/);
    assert.ok(text.includes(`sig=${result.details.signal}`));
    assert.ok(text.includes(`T${+example.timedOut}A${+example.abort}F0`));
    assert.match(text, /gsd_exec_search read/);
    assert.match(text, /(?:stdout|stderr):L1/);
    for (const wire of ["messages", "input"] as const) {
      assert.equal(throughProvider(wire, result, f.sessionId, `public-${example.name}`, "gsd_exec", 200), text);
    }
  }
});

test("public execution provenance remains bound to its originating session across mid-execution replacement", async (t) => {
  const f = fixture(t);
  const pending = f.call("gsd_exec", "public-replacement", {
    runtime: "node", script: `setTimeout(() => { process.stderr.write(${JSON.stringify(ERROR_TEXT)}); process.exitCode=1; }, 100)`,
  });
  const timer = setTimeout(() => f.setSessionId(`${f.sessionId}-replacement`), 25);
  let result: ToolExecutionResult;
  try { result = await pending; } finally { clearTimeout(timer); }
  const text = result.content[0].text;
  assert.ok(text.length > 800);
  for (const wire of ["messages", "input"] as const) {
    assert.equal(throughProvider(wire, result, f.sessionId, "public-replacement", "gsd_exec"), text);
    assert.match(throughProvider(wire, result, `${f.sessionId}-replacement`, "public-replacement", "gsd_exec"), /\[truncated\]/);
  }
});

test("public UAT execution retains check metadata and protected result attribution", async (t) => {
  const f = fixture(t);
  const identifiers = { milestoneId: "M123", sliceId: "S04", checkId: "UAT-09", intent: "uat-runtime-check" };
  const result = await f.call("gsd_uat_exec", "public-uat", {
    ...identifiers, runtime: "node", script: failingScript, expected: "typecheck exits 0",
  });
  assert.equal(result.details.operation, "gsd_uat_exec");
  for (const [key, value] of Object.entries(identifiers)) assert.equal(result.details[key], value);
  const meta = JSON.parse(readFileSync(String(result.details.meta_path), "utf8"));
  for (const [key, value] of Object.entries(identifiers)) assert.equal(meta.metadata[key], value);
  assert.equal(meta.metadata.expected, "typecheck exits 0");
  assert.equal(meta.metadata.kind, "uat_exec");
  const text = result.content[0].text;
  assert.ok(text.length > 800);
  for (const wire of ["messages", "input"] as const) {
    assert.equal(throughProvider(wire, result, f.sessionId, "public-uat", "gsd_uat_exec"), text);
  }
});
