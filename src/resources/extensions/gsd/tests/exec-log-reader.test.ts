import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { queryExecLogs, EXEC_LOG_LIMITS } from "../exec-log-reader.ts";
import { EXEC_DIRECTORY_MAX_ENTRIES, listExecHistory, searchExecHistory, searchExecHistoryWithInfo } from "../exec-history.ts";

function fixture(t: { after(fn: () => void): void }): string {
  const base = mkdtempSync(join(tmpdir(), "gsd-exec-log-reader-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  return base;
}
function run(base: string, id: string, stdout = "", stderr = "", metadata: Record<string, unknown> = {}): string {
  const root = join(base, ".gsd", "exec");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, `${id}.stdout`), stdout);
  writeFileSync(join(root, `${id}.stderr`), stderr);
  writeFileSync(join(root, `${id}.meta.json`), JSON.stringify({
    id, runtime: "bash", purpose: "build", started_at: "2026-09-09T00:00:00.000Z",
    finished_at: "2026-09-09T00:00:00.100Z", duration_ms: 100,
    exit_code: 1, signal: null, timed_out: false, stdout_bytes: Buffer.byteLength(stdout),
    stderr_bytes: Buffer.byteLength(stderr), stdout_truncated: false, stderr_truncated: false,
    ...metadata,
  }));
  return root;
}

test("body search preserves legacy ID/purpose history while finding stdout and stderr literals", async (t) => {
  const base = fixture(t);
  run(base, "legacy-non-uuid", "start\nECONNRESET: connection\nend\n", "Type error: src/a.ts:42\n");
  assert.equal(searchExecHistory(base, { query: "ECONNRESET" }).length, 0);
  assert.equal(searchExecHistory(base, { query: "LEGACY-NON" }).length, 1);
  const stdout = await queryExecLogs(base, { mode: "search", query: "econnreset" });
  assert.equal(stdout.results.length, 1);
  assert.equal(stdout.results[0].stream, "stdout");
  assert.match(stdout.results[0].text, /ECONNRESET/);
  assert.equal(stdout.scope.kind, "project-worktree");
  const stderr = await queryExecLogs(base, { mode: "search", query: "Type error", stream: "stderr", exec_id: "legacy-non-uuid" });
  assert.equal(stderr.results[0].exit_code, 1);
  assert.equal(stderr.results[0].started_at, "2026-09-09T00:00:00.000Z");
  assert.equal(stderr.results[0].stream, "stderr");
  assert.equal(stderr.more_results, false);
});

test("search contexts merge, line coordinates reread verbatim, and LF/CRLF/Unicode survive", async (t) => {
  const base = fixture(t);
  run(base, "lines", "첫 줄\r\n오류 one\r\n중간😀\r\n오류 two\r\n마지막\r\n");
  const found = await queryExecLogs(base, { mode: "search", query: "오류", context_lines: 1 });
  assert.equal(found.results.length, 1);
  const hit = found.results[0];
  assert.equal(hit.start_line, 1); assert.equal(hit.end_line, 5);
  assert.equal(hit.text, "첫 줄\n오류 one\n중간😀\n오류 two\n마지막");
  const reread = await queryExecLogs(base, { mode: "read", exec_id: hit.exec_id, stream: hit.stream, start_line: hit.start_line, line_count: 5 });
  assert.equal(reread.results[0].text, hit.text);
  assert.equal(reread.next_start_line, undefined);
});

test("read pagination supplies exact next line and preserves mechanical exit evidence", async (t) => {
  const base = fixture(t);
  run(base, "states", "1\n2\n3\n", "", { exit_code: null, signal: "SIGKILL", timed_out: true, aborted: true, force_resolved: true });
  const result = await queryExecLogs(base, { mode: "read", exec_id: "states", stream: "stdout", line_count: 2 });
  assert.equal(result.next_start_line, 3);
  assert.equal(result.results[0].text, "1\n2");
  assert.deepEqual([result.results[0].exit_code, result.results[0].signal, result.results[0].timed_out, result.results[0].aborted, result.results[0].force_resolved], [null, "SIGKILL", true, true, true]);
  assert.equal(listExecHistory(base)[0].aborted, true);
});

test("storage, scan, and return limits are independent and deterministic", async (t) => {
  const base = fixture(t);
  run(base, "capped", "match\na\nb\nmatch\n", "", { stdout_truncated: true });
  const storage = await queryExecLogs(base, { mode: "search", query: "match", context_lines: 0 });
  assert.equal(storage.storage_truncated, true); assert.equal(storage.scan_limited, false); assert.equal(storage.output_truncated, false);
  const output = await queryExecLogs(base, { mode: "search", query: "match", context_lines: 0, limit: 1 });
  assert.equal(output.output_truncated, true); assert.equal(output.more_results, true); assert.equal(output.scan_limited, false);
  assert.deepEqual(output, await queryExecLogs(base, { mode: "search", query: "match", context_lines: 0, limit: 1 }));
  for (let i = 0; i < 25; i++) {
    const root = run(base, `recent-${i}`, `run ${i}`);
    utimesSync(join(root, `recent-${i}.meta.json`), new Date(i * 1000), new Date(i * 1000));
  }
  const scan = await queryExecLogs(base, { mode: "search", query: "absent" });
  assert.equal(scan.runs_scanned, 20); assert.equal(scan.scan_limited, true); assert.equal(scan.more_results, null);
});

test("total reads include metadata, bounded prefix drops split UTF-8, and no full-file read", async (t) => {
  const base = fixture(t);
  run(base, "huge", "가".repeat(2_000_000));
  const result = await queryExecLogs(base, { mode: "read", exec_id: "huge", stream: "stdout" });
  assert.equal(result.bytes_read, EXEC_LOG_LIMITS.bytes);
  assert.equal(result.scan_limited, true);
  assert.equal(result.storage_truncated, false);
  assert.equal(result.output_truncated, true);
  assert.ok(result.results[0].text.length <= EXEC_LOG_LIMITS.hitChars);
  assert.ok(!result.results[0].text.includes("�"));
});

test("very long line supports bounded anchor excerpts and explicit column continuation", async (t) => {
  const base = fixture(t);
  run(base, "long-line", "x".repeat(30_000) + "Type error" + "😀".repeat(10_000));
  const result = await queryExecLogs(base, { mode: "search", query: "Type error", context_lines: 0 });
  const hit = result.results[0];
  assert.match(hit.text, /Type error/); assert.equal(hit.start_line, 1); assert.equal(hit.end_line, 1);
  assert.ok(hit.start_column! > 1); assert.equal(hit.partial_line, true);
  assert.equal(result.output_truncated, true);
  const next = await queryExecLogs(base, { mode: "read", exec_id: hit.exec_id, stream: hit.stream, start_line: hit.next_start_line, start_column: hit.next_start_column });
  assert.ok(next.results[0].text.startsWith("😀"));
  assert.ok(!/[\uD800-\uDBFF]$/.test(next.results[0].text));
});

test("legacy secrets are redacted before selection including multiline PEM; persisted logs unchanged", async (t) => {
  const base = fixture(t);
  const key = "sk-" + "a".repeat(28);
  const token = "ghp_" + "b".repeat(40);
  const source = `first ${key}\n-----BEGIN RSA PRIVATE KEY-----\nprivate-content\n-----END RSA PRIVATE KEY-----\nlast ${token}\n`;
  const root = run(base, "secrets", source, `Bearer ${"c".repeat(20)}`, { purpose: key });
  const before = statSync(join(root, "secrets.stdout")).mtimeMs;
  const result = await queryExecLogs(base, { mode: "read", exec_id: "secrets", stream: "stdout", start_line: 5 });
  assert.equal(result.results[0].start_line, 5);
  assert.equal(result.results[0].text, "last «redacted»");
  const searched = await queryExecLogs(base, { mode: "search", query: "redacted" });
  const history = searchExecHistory(base);
  for (const value of [result, searched, history]) {
    const serialized = JSON.stringify(value);
    assert.ok(!serialized.includes(key)); assert.ok(!serialized.includes(token)); assert.ok(!serialized.includes("private-content"));
  }
  assert.equal(readFileSync(join(root, "secrets.stdout"), "utf8"), source);
  assert.equal(statSync(join(root, "secrets.stdout")).mtimeMs, before);
  assert.equal(readdirSync(root).length, 3);
});

test("missing/empty/deleted/malformed metadata and unreadable files remain explicit", async (t) => {
  const base = fixture(t);
  const root = run(base, "empty");
  assert.equal((await queryExecLogs(base, { mode: "read", exec_id: "empty", stream: "stdout" })).results.length, 0);
  const missing = await queryExecLogs(base, { mode: "read", exec_id: "not-here", stream: "stdout" });
  assert.equal(missing.errors[0].code, "ENOENT"); assert.equal(missing.more_results, null);
  rmSync(join(root, "empty.stdout"));
  const deleted = await queryExecLogs(base, { mode: "search", exec_id: "empty", query: "anything" });
  assert.equal(deleted.errors[0].stream, "stdout");
  writeFileSync(join(root, "empty.meta.json"), "{nope");
  assert.match((await queryExecLogs(base, { mode: "search", query: "anything" })).errors[0].message, /JSON|property/i);
  run(base, "denied", "private"); chmodSync(join(root, "denied.stdout"), 0);
  try {
    if (process.getuid?.() !== 0) assert.equal((await queryExecLogs(base, { mode: "read", exec_id: "denied", stream: "stdout" })).errors[0].code, "EACCES");
  } finally { chmodSync(join(root, "denied.stdout"), 0o600); }
});

test("paths reject traversal and leaf/exec symlinks but permit canonical shared .gsd", async (t) => {
  const base = fixture(t), outside = fixture(t), shared = fixture(t);
  const root = run(base, "safe", "visible");
  const secretFile = join(outside, "secret"); writeFileSync(secretFile, "DO_NOT_READ");
  for (const exec_id of ["../safe", "a/b", "a\\b", "/tmp/x", "x\0y", "..", "a\nb"]) {
    await assert.rejects(queryExecLogs(base, { mode: "read", exec_id, stream: "stdout" }), /Invalid exec_id/);
  }
  rmSync(join(root, "safe.stdout")); symlinkSync(secretFile, join(root, "safe.stdout"));
  const leaf = await queryExecLogs(base, { mode: "read", exec_id: "safe", stream: "stdout" });
  assert.equal(leaf.results.length, 0); assert.equal(leaf.errors.length, 1); assert.ok(!JSON.stringify(leaf).includes("DO_NOT_READ"));
  symlinkSync(join(base, ".gsd"), join(shared, ".gsd"));
  const permitted = await queryExecLogs(shared, { mode: "read", exec_id: "safe", stream: "stderr" });
  assert.equal(permitted.errors.length, 0); assert.equal(permitted.scope.exec_root, realpathSync(root));
  rmSync(join(root, "safe.meta.json")); symlinkSync(secretFile, join(root, "safe.meta.json"));
  assert.equal((await queryExecLogs(base, { mode: "search", query: "DO_NOT_READ" })).errors.length, 1);
  rmSync(root, { recursive: true }); symlinkSync(outside, root);
  assert.match((await queryExecLogs(base, { mode: "search", query: "secret" })).errors[0].message, /Unsafe exec directory/);
});

test("metadata ID mismatch and embedded paths cannot redirect reads", async (t) => {
  const base = fixture(t);
  run(base, "mismatch", "not visible", "", { id: "different-id" });
  run(base, "safe", "needle", "", { stdout_path: "/etc/passwd", stderr_path: "../../secrets" });
  const result = await queryExecLogs(base, { mode: "search", query: "needle" });
  assert.equal(result.results.length, 1); assert.equal(result.results[0].exec_id, "safe");
  assert.match(result.errors[0].message, /ID mismatch/);
});

test("input bounds and cancellation are controlled without command execution", async (t) => {
  const base = fixture(t); run(base, "abort", "one\n".repeat(400_000));
  for (const query of ["", " ", "x".repeat(257)]) await assert.rejects(queryExecLogs(base, { mode: "search", query }), /nonempty literal query/);
  await assert.rejects(queryExecLogs(base, { mode: "read", exec_id: "abort", stream: "both" }), /read requires/);
  await assert.rejects(queryExecLogs(base, { mode: "search", query: "one", context_lines: 9 }), /context_lines/);
  await assert.rejects(queryExecLogs(base, { mode: "read", exec_id: "abort", stream: "stdout", line_count: 201 }), /line_count/);
  const controller = new AbortController();
  const pending = queryExecLogs(base, { mode: "search", query: "one", signal: controller.signal });
  setTimeout(() => controller.abort(), 0);
  const cancelled = await pending;
  assert.ok(cancelled.errors.some((error) => error.code === "ABORT_ERR"));
  assert.equal(cancelled.scan_limited, true);
  assert.equal(cancelled.more_results, null);
});

test("queries are literal rather than regex and ordering is newest metadata first", async (t) => {
  const base = fixture(t);
  const root = run(base, "older", "literal [x].*\n");
  run(base, "newer", "literal [x].*\n");
  run(base, "not-literal", "xxxxxx\n");
  utimesSync(join(root, "older.meta.json"), new Date(1000), new Date(1000));
  utimesSync(join(root, "newer.meta.json"), new Date(2000), new Date(2000));
  const result = await queryExecLogs(base, { mode: "search", query: "[x].*" });
  assert.deepEqual(result.results.map((hit) => hit.exec_id), ["newer", "older"]);
});

test("line-index budget remains distinct from disk bytes and only claims scanned no-match", async (t) => {
  const base = fixture(t);
  run(base, "many-lines", "line\n".repeat(200_001) + "not-scanned\n");
  const result = await queryExecLogs(base, { mode: "search", query: "not-scanned" });
  assert.equal(result.results.length, 0);
  assert.equal(result.scan_limited, true);
  assert.equal(result.more_results, null);
  assert.ok(result.bytes_read < EXEC_LOG_LIMITS.bytes);
});

test("oversized metadata is bounded and cancelled prefixes do not invent successful completeness", async (t) => {
  const base = fixture(t);
  const root = run(base, "large-meta", "no read");
  writeFileSync(join(root, "large-meta.meta.json"), " ".repeat(80_000));
  const result = await queryExecLogs(base, { mode: "read", exec_id: "large-meta", stream: "stdout" });
  assert.equal(result.bytes_read, 64 * 1024);
  assert.equal(result.results.length, 0);
  assert.equal(result.scan_limited, true);
  assert.equal(result.errors.length, 1);
  assert.equal(result.more_results, null);
});

test("history preview redacts full bounded logs before taking a suffix; large logs omit preview", (t) => {
  const base = fixture(t);
  const secret = "-----BEGIN RSA PRIVATE KEY-----\n" + "sensitive-content\n".repeat(300) + "-----END RSA PRIVATE KEY-----\n";
  run(base, "long-secret", secret, "", { exit_code: 0 });
  run(base, "huge-preview", "a".repeat(100_000));
  const secretHit = searchExecHistory(base, { query: "long-secret" })[0];
  assert.ok(!secretHit.digest_preview?.includes("sensitive-content"));
  assert.equal(searchExecHistory(base, { query: "huge-preview" })[0].digest_preview, undefined);
});

test("historical failing_only null-exit semantics and limits are retained", (t) => {
  const base = fixture(t);
  const root = run(base, "null", "", "", { exit_code: null, aborted: true });
  run(base, "timed", "", "", { exit_code: null, timed_out: true });
  run(base, "failed", "", "", { exit_code: 1 });
  run(base, "ok", "error word", "", { exit_code: 0 });
  utimesSync(join(root, "failed.meta.json"), new Date(9000), new Date(9000));
  utimesSync(join(root, "timed.meta.json"), new Date(8000), new Date(8000));
  assert.deepEqual(searchExecHistory(base, { failing_only: true }).map((hit) => hit.entry.id), ["failed", "timed"]);
  assert.equal(searchExecHistory(base, { limit: 1 }).length, 1);
  assert.equal(searchExecHistory(base, { limit: 0 }).length, 1);
});

test("Unicode lowercase expansion maps match offsets back to the stored original", async (t) => {
  const base = fixture(t);
  const source = "İ".repeat(10_000) + "needle";
  run(base, "unicode-fold", source);
  const result = await queryExecLogs(base, { mode: "search", query: "NEEDLE", context_lines: 0 });
  assert.equal(result.results.length, 1);
  const hit = result.results[0];
  assert.ok(hit.text.endsWith("needle"));
  assert.ok(hit.start_column! <= hit.end_column!);
  assert.equal(source.slice(hit.start_column! - 1, hit.end_column), hit.text);
  const reread = await queryExecLogs(base, { mode: "read", exec_id: hit.exec_id, stream: hit.stream, start_line: hit.start_line, start_column: hit.start_column });
  assert.equal(reread.results[0].text, hit.text);
});

test("safe IDs with internal dots retain history and explicit lookup compatibility", async (t) => {
  const base = fixture(t);
  run(base, "build..check", "needle");
  assert.equal(searchExecHistory(base, { query: "build..check" })[0].entry.id, "build..check");
  const result = await queryExecLogs(base, { mode: "read", exec_id: "build..check", stream: "stdout" });
  assert.equal(result.results[0].text, "needle");
});

test("multiline search is rejected explicitly and empty explicit reads retain execution evidence", async (t) => {
  const base = fixture(t);
  run(base, "empty-evidence", "", "", { exit_code: null, signal: "SIGTERM", aborted: true });
  for (const query of ["one\ntwo", "one\rtwo", "one\r\ntwo"]) {
    await assert.rejects(queryExecLogs(base, { mode: "search", query }), /single-line literal/);
  }
  const result = await queryExecLogs(base, { mode: "read", exec_id: "empty-evidence", stream: "stdout" });
  assert.equal(result.results.length, 0);
  assert.equal(result.execution?.exec_id, "empty-evidence");
  assert.equal(result.execution?.exit_code, null);
  assert.equal(result.execution?.signal, "SIGTERM");
  assert.equal(result.execution?.aborted, true);
  assert.equal(result.execution?.started_at, "2026-09-09T00:00:00.000Z");
});

test("read-budget boundary never publishes an unreachable repeating long-line cursor", async (t) => {
  const base = fixture(t);
  run(base, "ceiling", "x".repeat(5 * 1024 * 1024));
  const first = await queryExecLogs(base, { mode: "read", exec_id: "ceiling", stream: "stdout" });
  const metaBytes = Buffer.byteLength(readFileSync(join(base, ".gsd", "exec", "ceiling.meta.json")));
  const lastVisibleColumn = EXEC_LOG_LIMITS.bytes - metaBytes;
  const nearEnd = await queryExecLogs(base, {
    mode: "read", exec_id: "ceiling", stream: "stdout", start_column: lastVisibleColumn - 147,
  });
  assert.equal(nearEnd.results[0].text.length, 148);
  assert.equal(nearEnd.scan_limited, true);
  assert.equal(nearEnd.more_results, null);
  assert.equal(nearEnd.next_start_line, undefined);
  assert.equal(nearEnd.next_start_column, undefined);
  assert.equal(nearEnd.results[0].next_start_line, undefined);
  assert.equal(nearEnd.errors[0].code, "SCAN_LIMIT");
  assert.match(nearEnd.errors[0].message, /No reachable continuation cursor/);
  const exhausted = await queryExecLogs(base, {
    mode: "read", exec_id: "ceiling", stream: "stdout", start_column: lastVisibleColumn + 1,
  });
  assert.equal(exhausted.results.length, 0);
  assert.equal(exhausted.errors[0].code, "SCAN_LIMIT");
  assert.equal(exhausted.next_start_line, undefined);
  assert.equal(exhausted.next_start_column, undefined);
  assert.ok(first.next_start_column! < lastVisibleColumn);
});

test("line-index ceiling is an explicit partial view rather than false EOF or a next-line loop", async (t) => {
  const base = fixture(t);
  run(base, "line-ceiling", "x\n".repeat(EXEC_LOG_LIMITS.scannedLines + 1));
  const last = await queryExecLogs(base, {
    mode: "read", exec_id: "line-ceiling", stream: "stdout", start_line: EXEC_LOG_LIMITS.scannedLines,
  });
  assert.equal(last.results[0].text, "x");
  assert.equal(last.next_start_line, undefined);
  assert.equal(last.more_results, null);
  assert.equal(last.errors[0].code, "SCAN_LIMIT");
  const outside = await queryExecLogs(base, {
    mode: "read", exec_id: "line-ceiling", stream: "stdout", start_line: EXEC_LOG_LIMITS.scannedLines + 1,
  });
  assert.equal(outside.results.length, 0);
  assert.equal(outside.errors[0].code, "SCAN_LIMIT");
  assert.equal(outside.next_start_line, undefined);
});

test("history info distinguishes absent/complete scope from output and scan limits", (t) => {
  const base = fixture(t);
  assert.deepEqual(searchExecHistoryWithInfo(base), { hits: [], scan_limited: false, output_truncated: false, bytes_read: 0 });
  const root = run(base, "one", "stdout");
  run(base, "two", "stdout");
  const complete = searchExecHistoryWithInfo(base);
  assert.equal(complete.scan_limited, false);
  assert.equal(complete.output_truncated, false);
  assert.equal(complete.bytes_read,
    statSync(join(root, "one.meta.json")).size + statSync(join(root, "two.meta.json")).size + 12);
  assert.deepEqual(complete.hits, searchExecHistory(base));
  const short = searchExecHistoryWithInfo(base, { limit: 1 });
  assert.equal(short.scan_limited, false);
  assert.equal(short.output_truncated, true);
  writeFileSync(join(root, "two.stdout"), "x".repeat(70_000));
  assert.equal(searchExecHistoryWithInfo(base).scan_limited, true);
});

test("history info reports unsafe/malformed/oversized metadata and omitted unreadable previews", (t) => {
  const base = fixture(t), outside = fixture(t);
  const root = run(base, "good", "normal");
  writeFileSync(join(root, "bad.meta.json"), "{");
  assert.equal(searchExecHistoryWithInfo(base).scan_limited, true);
  rmSync(join(root, "bad.meta.json"));
  writeFileSync(join(root, "large.meta.json"), "x".repeat(70_000));
  assert.equal(searchExecHistoryWithInfo(base).scan_limited, true);
  rmSync(join(root, "large.meta.json"));
  const otherFile = join(outside, "metadata"); writeFileSync(otherFile, "{}");
  symlinkSync(otherFile, join(root, "unsafe.meta.json"));
  assert.equal(searchExecHistoryWithInfo(base).scan_limited, true);
  rmSync(join(root, "unsafe.meta.json"));
  rmSync(join(root, "good.stdout"));
  assert.equal(searchExecHistoryWithInfo(base).scan_limited, true);
});

test("history directory enumeration is bounded and its limitation is visible", (t) => {
  const base = fixture(t);
  const root = run(base, "one", "");
  for (let index = 0; index < EXEC_DIRECTORY_MAX_ENTRIES; index++) writeFileSync(join(root, `irrelevant-${index}`), "");
  const result = searchExecHistoryWithInfo(base);
  assert.equal(result.scan_limited, true);
  assert.ok(result.bytes_read <= EXEC_LOG_LIMITS.bytes);
});

test("history aggregate metadata and preview reads share a finite byte budget", (t) => {
  const base = fixture(t);
  for (let index = 0; index < 75; index++) run(base, `meta-${index}`, "preview", "", { purpose: "p".repeat(60_000) });
  const result = searchExecHistoryWithInfo(base, { limit: 200 });
  assert.equal(result.scan_limited, true);
  assert.ok(result.bytes_read <= EXEC_LOG_LIMITS.bytes);
  assert.ok(result.hits.length < 75);
});
