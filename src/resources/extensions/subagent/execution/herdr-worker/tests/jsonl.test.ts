import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JsonlLineFramer, parseJsonlRecord } from "../jsonl.js";

describe("Herdr worker JSONL framing", () => {
  it("preserves UTF-8 characters split across chunk boundaries and flushes a final unterminated line", () => {
    const lines: string[] = [];
    const framer = new JsonlLineFramer({ onLine: (line) => lines.push(line) });
    const payload = Buffer.from('{"text":"한글"}\n{"text":"tail"}', "utf8");
    const split = payload.indexOf(Buffer.from("한", "utf8")) + 1;
    framer.push(payload.subarray(0, split));
    framer.push(payload.subarray(split));
    framer.end();
    assert.deepEqual(lines, ['{"text":"한글"}', '{"text":"tail"}']);
  });

  it("ignores empty relay lines while malformed JSON remains non-fatal", () => {
    const lines: string[] = [];
    const framer = new JsonlLineFramer({ onLine: (line) => lines.push(line) });
    framer.push("\nnot-json\r\n{\"ok\":true}\n");
    framer.end();
    assert.deepEqual(lines, ["not-json", '{"ok":true}']);
    assert.equal(parseJsonlRecord(lines[0]), undefined);
    assert.deepEqual(parseJsonlRecord(lines[1]), { ok: true });
  });
});
