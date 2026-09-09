import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { executeExecSearch } from "../tools/exec-search-tool.ts";
import { registerExecTools } from "../bootstrap/exec-tools.ts";

function fixture(t: { after(fn: () => void): void }, stdout: string, stderr = "") {
  const base = mkdtempSync(join(tmpdir(), "gsd-exec-search-tool-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, ".gsd", "exec"); mkdirSync(root, { recursive: true });
  const id = "legacy..run-42";
  writeFileSync(join(root, id + ".stdout"), stdout);
  writeFileSync(join(root, id + ".stderr"), stderr);
  writeFileSync(join(root, id + ".meta.json"), JSON.stringify({ id, runtime: "bash", purpose: "typecheck", started_at: "2026-09-09T00:00:00Z", exit_code: 1, signal: null, timed_out: false, stdout_truncated: false, stderr_truncated: false }));
  return { base, root, id, deps: { baseDir: base, preferences: { context_management: {} } } };
}

test("public search tool preserves history and exposes bounded body search/read without writes", async t => {
  const f = fixture(t, "앞줄\r\nECONNRESET 첫 오류\r\n주변😀\r\nECONNRESET 두 번째\r\n끝\r\n", "src/player.ts:42: Type error\n");
  const snapshot = () => readdirSync(f.root).map(name => [name, readFileSync(join(f.root, name), "utf8")]);
  const before = snapshot();
  assert.equal(executeExecSearch({ query: "ECONNRESET", runtime: "bash", failing_only: true, limit: 10 }, f.deps).details.matches, 0);
  assert.equal(executeExecSearch({ query: "TYPECHECK", limit: 10 }, f.deps).details.matches, 1);
  const result = await executeExecSearch({ mode: "search", query: "econnreset", context_lines: 1 }, f.deps);
  const hits = result.details.results as any[];
  assert.equal(hits.length, 1); assert.equal(hits[0].start_line, 1); assert.equal(hits[0].end_line, 5);
  assert.match(result.content[0].text, /ECONNRESET/);
  const read = await executeExecSearch({ mode: "read", exec_id: hits[0].exec_id, stream: hits[0].stream, start_line: hits[0].start_line, line_count: 5 }, f.deps);
  assert.equal((read.details.results as any[])[0].text, hits[0].text);
  const stderr = await executeExecSearch({ mode: "search", query: "Type error", exec_id: f.id, stream: "stderr" }, f.deps);
  assert.match(stderr.content[0].text, /src\/player.ts:42/);
  assert.deepEqual(snapshot(), before);
  assert.equal(existsSync(join(f.base, ".gsd", "gsd.db")), false);
});

test("final return budget adjusts long-line read cursors without gaps or duplicate text", async t => {
  const source = "한국😀abcdef".repeat(1500);
  const f = fixture(t, source);
  const deps = { ...f.deps, preferences: { context_management: { tool_result_max_chars: 800 } } };
  let column = 1, combined = "";
  for (let i = 0; i < 4; i++) {
    const result = await executeExecSearch({ mode: "read", exec_id: f.id, stream: "stdout", start_line: 1, start_column: column }, deps);
    assert(result.content[0].text.length <= 800);
    const hit = (result.details.results as any[])[0];
    assert(hit?.text.length, "at least one bounded original segment must fit");
    assert(result.content[0].text.includes(hit.text));
    assert.equal(hit.start_column, column);
    combined += hit.text;
    assert.equal(combined, source.slice(0, combined.length));
    const next = result.details.next_start_column as number;
    assert(next > column); assert.equal(next, combined.length + 1); column = next;
    assert.equal(result.details.output_truncated, true);
  }
});

test("budgeted search keeps a far-away literal with accurate Unicode columns", async t => {
  const source = "İ".repeat(10000) + "NEEDLE" + "後".repeat(1000);
  const f = fixture(t, source);
  const result = await executeExecSearch({ mode: "search", query: "needle", exec_id: f.id }, { ...f.deps, preferences: { context_management: { tool_result_max_chars: 800 } } });
  assert(result.content[0].text.length <= 800);
  assert.match(result.content[0].text, /NEEDLE/);
  const hit = (result.details.results as any[])[0];
  assert.equal(source.slice(hit.start_column - 1, hit.end_column), hit.text);
});

test("missing files and invalid queries remain errors, with limits and read identity", async t => {
  const f = fixture(t, "");
  const empty = await executeExecSearch({ mode: "read", exec_id: f.id, stream: "stdout" }, f.deps);
  assert.equal(empty.isError, undefined); assert.match(empty.content[0].text, /exit=1/);
  assert.equal((empty.details.execution as any).exec_id, f.id);
  rmSync(join(f.root, f.id + ".stderr"));
  const missing = await executeExecSearch({ mode: "read", exec_id: f.id, stream: "stderr" }, f.deps);
  assert.equal(missing.isError, true); assert.match(missing.content[0].text, /ENOENT/);
  assert.equal(missing.details.more_results, null);
  for (const query of ["", "\n", "x".repeat(257)]) {
    const bad = await executeExecSearch({ mode: "search", query }, f.deps);
    assert.equal(bad.isError, true);
  }
});

test("registry exposes the same retrieval modes and bounded input fields", () => {
  const tools: any[] = [];
  registerExecTools({ registerTool(tool: unknown) { tools.push(tool); } } as any);
  const fields = tools.find(t => t.name === "gsd_exec_search").parameters.properties;
  assert.deepEqual(fields.mode.enum, ["history", "search", "read"]);
  assert.deepEqual(fields.stream.enum, ["stdout", "stderr", "both"]);
  assert.equal(fields.context_lines.maximum, 8);
  assert.equal(fields.line_count.maximum, 200);
  assert.equal(fields.start_column.minimum, 1);
});

test("200-character real-ID read either advances with text or explicitly explains budget failure", async t => {
  const f = fixture(t, "short evidence line\nnext line\n");
  const id = "00000000-0000-0000-0000-000000000002";
  for (const suffix of ["stdout", "stderr", "meta.json"]) {
    const content = readFileSync(join(f.root, f.id + "." + suffix), "utf8");
    writeFileSync(join(f.root, id + "." + suffix), suffix === "meta.json" ? JSON.stringify({ ...JSON.parse(content), id }) : content);
  }
  const result = await executeExecSearch({ mode: "read", exec_id: id, stream: "stdout", line_count: 1 }, { ...f.deps, preferences: { context_management: { tool_result_max_chars: 200 } } });
  assert(result.content[0].text.length <= 200);
  assert(result.content[0].text.includes(id));
  const hits = result.details.results as any[];
  assert(hits[0]?.text, "normal UUID + short receipt should leave room for evidence at 200 chars");
  assert(result.content[0].text.includes(hits[0].text));
  assert(result.details.next_start_line || result.details.next_start_column);
});

test("synthetic secret-shaped metadata IDs and path strings are masked in outward details", async t => {
  const f = fixture(t, "hello");
  const id = "sk-" + "A".repeat(30);
  for (const suffix of ["stdout", "stderr", "meta.json"]) {
    const content = readFileSync(join(f.root, f.id + "." + suffix), "utf8");
    writeFileSync(join(f.root, id + "." + suffix), suffix === "meta.json" ? JSON.stringify({ ...JSON.parse(content), id }) : content);
  }
  for (const params of [{ mode: "read", exec_id: id, stream: "stdout" }, { mode: "history" }]) {
    const result = await executeExecSearch(params as any, f.deps);
    assert(!JSON.stringify(result).includes(id));
  }
});

test("a projected window ending exactly at newline never reports an end column of zero", async t => {
  const f = fixture(t, "a".repeat(100) + "\n" + "b".repeat(300) + "\nlast");
  for (const cap of [400, 500, 600, 800]) {
    const result = await executeExecSearch({ mode: "read", exec_id: f.id, stream: "stdout" }, { ...f.deps, preferences: { context_management: { tool_result_max_chars: cap } } });
    for (const hit of result.details.results as any[]) {
      assert(hit.end_column === undefined || hit.end_column >= 1);
      assert(hit.end_line >= hit.start_line);
    }
  }
});
