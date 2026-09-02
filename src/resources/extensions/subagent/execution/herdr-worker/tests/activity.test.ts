import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HerdrWorkerActivityRenderer,
  projectHerdrWorkerActivity,
  redactSensitiveText,
} from "../activity.js";

describe("Herdr worker activity projection", () => {
  it("renders bounded tool lifecycle without result payloads or raw streaming token events", () => {
    const start = projectHerdrWorkerActivity({
      type: "tool_execution_start",
      toolName: "bash",
      args: { command: "curl 'https://example.test?a=1&token=super-secret' -H 'Authorization: Bearer abc123'" },
    });
    assert.ok(start);
    assert.match(start.display, /^→ bash /);
    assert.doesNotMatch(start.display, /super-secret|abc123/);
    assert.match(start.display, /\[REDACTED\]/);

    const end = projectHerdrWorkerActivity({
      type: "tool_execution_end",
      toolName: "bash",
      result: { giant: "must not appear" },
      isError: false,
    });
    assert.deepEqual(end?.display, "✓ bash");
    assert.doesNotMatch(end?.display ?? "", /must not appear/);
    assert.equal(projectHerdrWorkerActivity({ type: "message_update", assistantMessageEvent: { delta: "secret token stream" } }), undefined);
    assert.equal(projectHerdrWorkerActivity({ type: "tool_execution_update", partialResult: "huge output" }), undefined);
    assert.equal(projectHerdrWorkerActivity({ type: "auto_retry_start", attempt: 2 })?.status, "retrying");
    assert.equal(projectHerdrWorkerActivity({ type: "auto_retry_end", success: true })?.status, "working");
  });

  it("coalesces thinking and assistant deltas into readable redacted lines", () => {
    const output: string[] = [];
    const renderer = new HerdrWorkerActivityRenderer({
      write: (text) => output.push(text),
      now: () => new Date("2026-09-02T01:02:03.000Z"),
    });
    const consume = (assistantMessageEvent: Record<string, unknown>) => renderer.consumeLine(JSON.stringify({
      type: "message_update",
      assistantMessageEvent,
    }));

    renderer.consumeLine(JSON.stringify({ type: "message_start", message: { role: "assistant" } }));
    consume({ type: "thinking_start", contentIndex: 0 });
    consume({ type: "thinking_delta", contentIndex: 0, delta: "Inspecting API_" });
    assert.deepEqual(output, []);
    consume({ type: "thinking_delta", contentIndex: 0, delta: "TOKEN=super-secret\nThen compare state" });
    assert.deepEqual(output, ["[01:02:03] ◇ thinking: Inspecting API_TOKEN=[REDACTED]\n"]);
    consume({ type: "thinking_end", contentIndex: 0, content: "duplicate provider content" });
    consume({ type: "text_start", contentIndex: 1 });
    consume({ type: "text_delta", contentIndex: 1, delta: "The dispatch scope is now correct." });
    consume({ type: "text_end", contentIndex: 1, content: "duplicate provider content" });

    assert.deepEqual(output, [
      "[01:02:03] ◇ thinking: Inspecting API_TOKEN=[REDACTED]\n",
      "[01:02:03] ◇ thinking: Then compare state\n",
      "[01:02:03] › assistant: The dispatch scope is now correct.\n",
    ]);
    assert.doesNotMatch(output.join(""), /super-secret|duplicate provider content|message_update|text_delta/);
  });

  it("does not emit token fragments and strips terminal control sequences", () => {
    const output: string[] = [];
    const renderer = new HerdrWorkerActivityRenderer({
      write: (text) => output.push(text),
      now: () => new Date("2026-09-02T04:05:06.000Z"),
    });
    const consume = (assistantMessageEvent: Record<string, unknown>) => renderer.consumeLine(JSON.stringify({
      type: "message_update",
      assistantMessageEvent,
    }));

    consume({ type: "text_start", contentIndex: 0 });
    consume({ type: "text_delta", contentIndex: 0, delta: "to" });
    consume({ type: "text_delta", contentIndex: 0, delta: "ken \u001b[31mred\u001b[0m" });
    assert.deepEqual(output, []);
    consume({ type: "text_end", contentIndex: 0, content: "ignored duplicate" });
    assert.deepEqual(output, ["[04:05:06] › assistant: token red\n"]);
    assert.doesNotMatch(output[0], /\u001b/);
  });

  it("redacts credential-shaped assignments, authorization headers, and query secrets", () => {
    const text = redactSensitiveText("OPENAI_API_KEY=sk-test PASSWORD=hunter2 Authorization: Bearer token123 https://x.test/?api_key=abc&ok=1");
    assert.doesNotMatch(text, /sk-test|hunter2|token123|api_key=abc/);
    assert.match(text, /OPENAI_API_KEY=\[REDACTED\]/);
    assert.match(text, /PASSWORD=\[REDACTED\]/);
  });

  it("projects interactive questions as blocked without exposing prompt content", () => {
    const start = projectHerdrWorkerActivity({
      type: "tool_execution_start",
      toolCallId: "question-1",
      toolName: "mcp__workflow__ask_user_questions",
      args: { questions: [{ header: "Token", question: "Reveal sk-private?" }] },
    });
    assert.equal(start?.status, "blocked");
    assert.equal(start?.display, "? awaiting user input · 1 question");
    assert.doesNotMatch(JSON.stringify(start), /sk-private|Reveal|Token/);

    const end = projectHerdrWorkerActivity({
      type: "tool_execution_end",
      toolCallId: "question-1",
      toolName: "mcp__workflow__ask_user_questions",
      isError: false,
    });
    assert.equal(end?.status, "working");
    assert.equal(end?.display, "✓ user input settled");
  });

  it("keeps the worker blocked while another interactive request remains pending", () => {
    const output: string[] = [];
    const renderer = new HerdrWorkerActivityRenderer({
      write: (text) => output.push(text),
      now: () => new Date("2026-09-01T01:02:03.000Z"),
    });
    const start = (toolCallId: string) => renderer.consumeLine(JSON.stringify({
      type: "tool_execution_start",
      toolCallId,
      toolName: "ask_user_questions",
      args: { questions: [{}] },
    }));
    const end = (toolCallId: string) => renderer.consumeLine(JSON.stringify({
      type: "tool_execution_end",
      toolCallId,
      toolName: "ask_user_questions",
      isError: false,
    }));

    assert.equal(start("question-1")?.status, "blocked");
    assert.equal(start("question-2")?.status, "blocked");
    assert.equal(end("question-1")?.status, "blocked");
    assert.equal(end("question-2")?.status, "working");
    assert.equal(output.length, 4);
  });

  it("renderer ignores malformed updates and writes only projected single-line activity", () => {
    const output: string[] = [];
    const renderer = new HerdrWorkerActivityRenderer({
      write: (text) => output.push(text),
      now: () => new Date("2026-08-30T01:02:03.000Z"),
    });
    assert.equal(renderer.consumeLine("not-json"), undefined);
    assert.equal(renderer.consumeLine(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "toolcall_delta", delta: "raw" } })), undefined);
    renderer.consumeLine(JSON.stringify({ type: "tool_execution_start", toolName: "read", args: { path: "/repo/secret.ts\nnext" } }));
    assert.deepEqual(output, ["[01:02:03] → read /repo/secret.ts next\n"]);
  });
});
