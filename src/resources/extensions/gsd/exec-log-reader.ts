// Read-only retrieval over the existing project/worktree .gsd/exec artifacts.
// No workflow records are written and a missing log never re-executes a command.
import { closeSync, fstatSync, lstatSync, read } from "node:fs";
import { opendir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { setImmediate as yieldTurn } from "node:timers/promises";
import {
  EXEC_DIRECTORY_MAX_ENTRIES, EXEC_META_MAX_BYTES, isSafeExecId,
  openExecHistoryFile, parseExecHistoryMeta, resolveExecHistoryRoot,
  type ExecHistoryEntry,
} from "./exec-history.js";
import { decodeExecUtf8, redactExecLog } from "./exec-log-text.js";
import { redactSecrets } from "./redact-secrets.js";

const readAsync = promisify(read);
export const EXEC_LOG_LIMITS = Object.freeze({
  runs: 20, bytes: 4 * 1024 * 1024, hits: 20, defaultHits: 5,
  context: 8, defaultContext: 2, lines: 200, defaultLines: 50,
  queryChars: 256, scannedLines: 200_000, hitChars: 8192,
  resultChars: 32_768, elapsedMs: 10_000,
});

export type ExecLogStream = "stdout" | "stderr";
export interface ExecLogQueryOptions {
  mode: "search" | "read";
  exec_id?: string;
  query?: string;
  stream?: ExecLogStream | "both";
  runtime?: string;
  failing_only?: boolean;
  limit?: number;
  context_lines?: number;
  start_line?: number;
  line_count?: number;
  /** One-based UTF-16 column in the redacted line, for very long line continuation. */
  start_column?: number;
  signal?: AbortSignal;
}

export interface ExecLogExecution {
  exec_id: string;
  started_at: string;
  exit_code: number | null;
  signal: string | null;
  timed_out: boolean;
  aborted?: boolean;
  force_resolved?: boolean;
}

export interface ExecLogHit extends ExecLogExecution {
  stream: ExecLogStream;
  start_line: number;
  end_line: number;
  text: string;
  storage_truncated: boolean;
  partial_line?: boolean;
  start_column?: number;
  end_column?: number;
  next_start_line?: number;
  next_start_column?: number;
}

export interface ExecLogQueryResult {
  mode: "search" | "read";
  scope: { kind: "project-worktree"; base_dir: string; exec_root: string };
  results: ExecLogHit[];
  errors: Array<{ exec_id?: string; stream?: ExecLogStream; code: string; message: string }>;
  storage_truncated: boolean;
  scan_limited: boolean;
  output_truncated: boolean;
  /** null means an unscanned or unreadable region may contain further hits. */
  more_results: boolean | null;
  runs_scanned: number;
  bytes_read: number;
  /** Known execution evidence survives an explicit lookup with no matching lines. */
  execution?: ExecLogExecution;
  next_start_line?: number;
  next_start_column?: number;
}

function integer(value: number | undefined, fallback: number, max: number, name: string, min = 1): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return value;
}

function validate(opts: ExecLogQueryOptions): void {
  if (opts.mode !== "search" && opts.mode !== "read") throw new Error("mode must be search or read");
  if (opts.exec_id !== undefined && !isSafeExecId(opts.exec_id)) throw new Error("Invalid exec_id: use a safe existing execution ID, not a file path");
  if (opts.stream !== undefined && !["stdout", "stderr", "both"].includes(opts.stream)) throw new Error("stream must be stdout, stderr, or both");
  if (opts.mode === "read" && (!opts.exec_id || !opts.stream || opts.stream === "both")) throw new Error("read requires exec_id and one stream (stdout or stderr)");
  if (opts.mode === "search" && (typeof opts.query !== "string" || !opts.query.trim() || opts.query.length > EXEC_LOG_LIMITS.queryChars)) {
    throw new Error(`search requires a nonempty literal query of at most ${EXEC_LOG_LIMITS.queryChars} characters`);
  }
  if (opts.mode === "search" && /[\r\n]/.test(opts.query!)) {
    throw new Error("search query must be a single-line literal (CR and LF are not supported)");
  }
  integer(opts.limit, 5, 20, "limit");
  integer(opts.context_lines, 2, 8, "context_lines", 0);
  integer(opts.line_count, 50, 200, "line_count");
  integer(opts.start_line, 1, Number.MAX_SAFE_INTEGER, "start_line");
  integer(opts.start_column, 1, Number.MAX_SAFE_INTEGER, "start_column");
}

interface ReadState { result: ExecLogQueryResult; deadline: number; signal?: AbortSignal; root: string }
function check(state: ReadState): void {
  if (state.signal?.aborted) throw Object.assign(new Error("Log query was cancelled"), { code: "ABORT_ERR" });
  if (Date.now() > state.deadline) throw Object.assign(new Error("Log query time budget exhausted"), { code: "SCAN_LIMIT" });
}

function recordError(state: ReadState, error: unknown, exec_id?: string, stream?: ExecLogStream): void {
  const code = (error as NodeJS.ErrnoException)?.code ?? "LOG_READ_ERROR";
  const message = error instanceof Error ? error.message : String(error);
  if (state.result.errors.length < EXEC_LOG_LIMITS.hits) {
    state.result.errors.push({ ...(exec_id ? { exec_id } : {}), ...(stream ? { stream } : {}), code, message: redactSecrets(message).slice(0, 512) });
  } else state.result.output_truncated = true;
  if (code === "ABORT_ERR" || code === "SCAN_LIMIT") state.result.scan_limited = true;
  state.result.more_results = null;
}

async function boundedRead(state: ReadState, path: string, maxBytes: number): Promise<{ text: string; limited: boolean }> {
  check(state);
  const fd = openExecHistoryFile(path, state.root);
  try {
    const size = fstatSync(fd).size;
    const allowance = Math.min(size, maxBytes, EXEC_LOG_LIMITS.bytes - state.result.bytes_read);
    if (allowance <= 0 && size > 0) throw Object.assign(new Error("Log query byte budget exhausted"), { code: "SCAN_LIMIT" });
    const chunks: Buffer[] = [];
    let position = 0;
    while (position < allowance) {
      check(state);
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, allowance - position));
      const { bytesRead } = await readAsync(fd, buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      chunks.push(buffer.subarray(0, bytesRead));
      position += bytesRead;
      state.result.bytes_read += bytesRead;
    }
    check(state);
    const limited = position < size;
    if (limited) state.result.scan_limited = true;
    return { text: decodeExecUtf8(Buffer.concat(chunks, position), !limited), limited };
  } finally { closeSync(fd); }
}

async function candidates(state: ReadState, id?: string): Promise<string[]> {
  if (id) return [join(state.root, `${id}.meta.json`)];
  const dir = await opendir(state.root);
  const metas: Array<{ name: string; mtime: number }> = [];
  let count = 0;
  try {
    for await (const entry of dir) {
      check(state);
      if (++count > EXEC_DIRECTORY_MAX_ENTRIES) { state.result.scan_limited = true; break; }
      if (!entry.name.endsWith(".meta.json")) continue;
      const id = entry.name.slice(0, -10);
      if (!isSafeExecId(id)) continue;
      try {
        const info = lstatSync(join(state.root, entry.name));
        if (!info.isFile()) { recordError(state, new Error("Metadata is not a regular non-symlink file"), id); continue; }
        metas.push({ name: entry.name, mtime: info.mtimeMs });
      } catch (error) { recordError(state, error, id); }
    }
  } finally { /* for-await closes the bounded directory handle, including on break */ }
  metas.sort((a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name));
  if (metas.length > EXEC_LOG_LIMITS.runs) state.result.scan_limited = true;
  return metas.slice(0, EXEC_LOG_LIMITS.runs).map((entry) => join(state.root, entry.name));
}

interface Lines { text: string; starts: number[]; limited: boolean }
async function indexLines(state: ReadState, text: string): Promise<Lines> {
  const starts = text.length ? [0] : [];
  let offset = 0;
  while ((offset = text.indexOf("\n", offset)) !== -1) {
    offset++;
    if (offset === text.length) break;
    if (starts.length >= EXEC_LOG_LIMITS.scannedLines) return { text: text.slice(0, offset), starts, limited: true };
    starts.push(offset);
    if (starts.length % 4096 === 0) { await yieldTurn(); check(state); }
  }
  return { text, starts, limited: false };
}
function lineText(lines: Lines, index: number): string {
  return lines.text.slice(lines.starts[index], lines.starts[index + 1] ?? lines.text.length).replace(/\r?\n$/, "");
}
function lineForOffset(lines: Lines, offset: number): number {
  let low = 0, high = lines.starts.length;
  while (low + 1 < high) {
    const mid = (low + high) >>> 1;
    if (lines.starts[mid]! <= offset) low = mid; else high = mid;
  }
  return low;
}

/** Lowercasing may expand a code point (İ → i + combining dot). Translate the
 * matched lowercased offset back to the original string before excerpting. */
function originalMatchOffset(text: string, foldedOffset: number): number {
  let originalOffset = 0, lowerOffset = 0;
  for (const codePoint of text) {
    const lowerLength = codePoint.toLowerCase().length;
    if (lowerOffset + lowerLength > foldedOffset) return originalOffset;
    lowerOffset += lowerLength;
    originalOffset += codePoint.length;
  }
  return originalOffset;
}

/** Case-insensitive literal match expressed in original UTF-16 coordinates. */
export function findExecLiteralMatch(text: string, query: string): number {
  const foldedMatch = text.toLowerCase().indexOf(query.toLowerCase());
  return foldedMatch < 0 ? -1 : originalMatchOffset(text, foldedMatch);
}

function executionEvidence(entry: ExecHistoryEntry): ExecLogExecution {
  return {
    exec_id: entry.id, started_at: entry.started_at, exit_code: entry.exit_code,
    signal: entry.signal, timed_out: entry.timed_out,
    ...(entry.aborted === undefined ? {} : { aborted: entry.aborted }),
    ...(entry.force_resolved === undefined ? {} : { force_resolved: entry.force_resolved }),
  };
}

function makeHit(entry: ExecHistoryEntry, stream: ExecLogStream, lines: Lines, start: number, end: number, maxChars: number, anchor?: number, column = 1): ExecLogHit {
  let from = Math.min(lines.starts[start]! + column - 1, lines.starts[start + 1] ?? lines.text.length);
  const desiredEnd = lines.starts[end + 1] ?? lines.text.length;
  if (anchor !== undefined && anchor - from >= maxChars) from = Math.max(from, anchor - Math.floor(maxChars / 4));
  // Never return half of a UTF-16 surrogate pair.
  if (from > 0 && /[\uDC00-\uDFFF]/.test(lines.text[from] ?? "")) from++;
  let to = Math.min(desiredEnd, from + maxChars);
  if (to < lines.text.length && /[\uDC00-\uDFFF]/.test(lines.text[to] ?? "")) to--;
  const first = lineForOffset(lines, from);
  const last = lineForOffset(lines, Math.max(from, to - 1));
  const endColumn = to - lines.starts[last]!;
  const nextLine = to < desiredEnd ? lineForOffset(lines, to) : end + 1;
  const text = lines.text.slice(from, to).replace(/\r\n/g, "\n").replace(/\n$/, "");
  return {
    ...executionEvidence(entry),
    stream, start_line: first + 1, end_line: last + 1, text,
    storage_truncated: entry[`${stream}_truncated`],
    ...(from !== lines.starts[start] || to < desiredEnd ? {
      partial_line: true, start_column: from - lines.starts[first]! + 1, end_column: endColumn,
    } : {}),
    ...(to < lines.text.length ? {
      next_start_line: nextLine + 1,
      ...(to < desiredEnd ? { next_start_column: to - lines.starts[nextLine]! + 1 } : {}),
    } : {}),
  };
}

/** Literal case-insensitive substring search. Lines refer to the redacted stored view. */
export async function queryExecLogs(baseDir: string, opts: ExecLogQueryOptions): Promise<ExecLogQueryResult> {
  validate(opts);
  const result: ExecLogQueryResult = {
    mode: opts.mode, scope: { kind: "project-worktree", base_dir: resolve(baseDir), exec_root: resolve(baseDir, ".gsd", "exec") },
    results: [], errors: [], storage_truncated: false, scan_limited: false,
    output_truncated: false, more_results: false, runs_scanned: 0, bytes_read: 0,
  };
  const state: ReadState = { result, deadline: Date.now() + EXEC_LOG_LIMITS.elapsedMs, signal: opts.signal, root: result.scope.exec_root };
  const limit = opts.limit ?? EXEC_LOG_LIMITS.defaultHits;
  const context = opts.context_lines ?? EXEC_LOG_LIMITS.defaultContext;
  const streams: ExecLogStream[] = opts.stream && opts.stream !== "both" ? [opts.stream] : ["stdout", "stderr"];
  let remainingChars = EXEC_LOG_LIMITS.resultChars;
  try {
    check(state);
    state.root = resolveExecHistoryRoot(baseDir);
    result.scope.exec_root = state.root;
    const paths = await candidates(state, opts.exec_id);
    for (const path of paths) {
      check(state);
      const id = path.slice(state.root.length + 1, -10);
      let entry: ExecHistoryEntry;
      try {
        const meta = await boundedRead(state, path, EXEC_META_MAX_BYTES);
        if (meta.limited) throw new Error("Metadata exceeds the bounded read limit");
        const parsed = parseExecHistoryMeta(meta.text, path);
        if (!parsed) throw new Error("Invalid execution metadata or ID mismatch");
        entry = parsed;
        result.runs_scanned++;
        if (opts.exec_id) result.execution = executionEvidence(entry);
      } catch (error) { recordError(state, error, id); continue; }
      if (opts.runtime && entry.runtime !== opts.runtime) continue;
      if (opts.failing_only && !(entry.timed_out || (entry.exit_code !== 0 && entry.exit_code !== null))) continue;
      for (const stream of streams) {
        check(state);
        result.storage_truncated ||= entry[`${stream}_truncated`];
        try {
          const file = await boundedRead(state, join(state.root, `${entry.id}.${stream}`), EXEC_LOG_LIMITS.bytes);
          const lines = await indexLines(state, redactExecLog(file.text));
          result.scan_limited ||= lines.limited;
          const boundedPrefix = file.limited || lines.limited;
          const prefixLimit = () => Object.assign(new Error(
            "Requested read reached the bounded stored-log view; remaining source was not scanned. No reachable continuation cursor is available within this query's read/line budget.",
          ), { code: "SCAN_LIMIT" });
          if (!lines.starts.length) {
            if (opts.mode === "read" && boundedPrefix) throw prefixLimit();
            continue;
          }
          if (opts.mode === "read") {
            const start = (opts.start_line ?? 1) - 1;
            if (start >= lines.starts.length) {
              if (boundedPrefix) throw prefixLimit();
              continue;
            }
            const requestedColumn = opts.start_column ?? 1;
            // Reaching the end of a scanned prefix is not EOF. In particular,
            // never return the same (line, column) again as a next cursor.
            if (boundedPrefix && start === lines.starts.length - 1
              && requestedColumn >= lineText(lines, start).length + 1) throw prefixLimit();
            if ((opts.start_column ?? 1) > lineText(lines, start).length + 1) {
              throw Object.assign(new Error("start_column is beyond the selected stored line"), { code: "INVALID_RANGE" });
            }
            const end = Math.min(lines.starts.length - 1, start + (opts.line_count ?? EXEC_LOG_LIMITS.defaultLines) - 1);
            const hit = makeHit(entry, stream, lines, start, end, EXEC_LOG_LIMITS.hitChars, undefined, opts.start_column ?? 1);
            result.results.push(hit);
            result.output_truncated ||= hit.partial_line === true;
            result.next_start_line = hit.next_start_line;
            result.next_start_column = hit.next_start_column;
            result.more_results = hit.next_start_line ? true : false;
            if (boundedPrefix && !hit.next_start_line) recordError(state, prefixLimit(), entry.id, stream);
            continue;
          }
          const query = opts.query!;
          const windows: Array<{ start: number; end: number; anchor: number }> = [];
          for (let index = 0; index < lines.starts.length; index++) {
            if (index % 4096 === 0) { await yieldTurn(); check(state); }
            const originalLine = lineText(lines, index);
            const match = findExecLiteralMatch(originalLine, query);
            if (match < 0) continue;
            const start = Math.max(0, index - context), end = Math.min(lines.starts.length - 1, index + context);
            const previous = windows.at(-1);
            if (previous && start <= previous.end + 1) previous.end = Math.max(previous.end, end);
            else {
              if (windows.length + result.results.length >= limit) { result.more_results = true; result.output_truncated = true; break; }
              windows.push({ start, end, anchor: lines.starts[index]! + match });
            }
          }
          for (const window of windows) {
            if (remainingChars <= 0) { result.output_truncated = true; result.more_results = true; break; }
            const hit = makeHit(entry, stream, lines, window.start, window.end, Math.min(EXEC_LOG_LIMITS.hitChars, remainingChars), window.anchor);
            result.results.push(hit);
            remainingChars -= hit.text.length;
            result.output_truncated ||= hit.partial_line === true;
          }
        } catch (error) { recordError(state, error, entry.id, stream); }
      }
    }
  } catch (error) { recordError(state, error, opts.exec_id, opts.stream === "both" ? undefined : opts.stream); }
  if ((result.scan_limited || result.errors.length) && result.more_results !== true) result.more_results = null;
  return result;
}
