import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HerdrWorkerActivityRenderer,
  projectHerdrWorkerActivity,
  redactSensitiveText,
} from "../activity.js";

describe("Herdr worker activity projection", () => {
  it("renders bounded tool lifecycle without result payloads or streaming token events", () => {
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

  it("redacts credential-shaped assignments, authorization headers, and query secrets", () => {
    const text = redactSensitiveText("OPENAI_API_KEY=sk-test PASSWORD=hunter2 Authorization: Bearer token123 https://x.test/?api_key=abc&ok=1");
    assert.doesNotMatch(text, /sk-test|hunter2|token123|api_key=abc/);
    assert.match(text, /OPENAI_API_KEY=\[REDACTED\]/);
    assert.match(text, /PASSWORD=\[REDACTED\]/);
  });

  it("renderer ignores malformed/raw updates and writes only projected single-line activity", () => {
    const output: string[] = [];
    const renderer = new HerdrWorkerActivityRenderer({
      write: (text) => output.push(text),
      now: () => new Date("2026-08-30T01:02:03.000Z"),
    });
    assert.equal(renderer.consumeLine("not-json"), undefined);
    assert.equal(renderer.consumeLine(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "raw" } })), undefined);
    renderer.consumeLine(JSON.stringify({ type: "tool_execution_start", toolName: "read", args: { path: "/repo/secret.ts\nnext" } }));
    assert.deepEqual(output, ["[01:02:03] → read /repo/secret.ts next\n"]);
  });
});
