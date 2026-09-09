// GSD Exec History — read-side helpers for the exec sandbox.
//
// Pure I/O: scans `.gsd/exec/*.meta.json` under a base directory and
// returns lightweight records. Used by the gsd_exec_search tool and
// any future compaction-snapshot enrichment.

import { closeSync, constants, fstatSync, lstatSync, openSync, opendirSync, readSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { redactSecrets } from "./redact-secrets.js";
import { decodeExecUtf8, redactExecLog } from "./exec-log-text.js";

export const EXEC_META_MAX_BYTES = 64 * 1024;
export const EXEC_DIRECTORY_MAX_ENTRIES = 4096;
const HISTORY_MAX_READ_BYTES = 4 * 1024 * 1024;

/** Historical IDs are not necessarily UUIDs; only filesystem-unsafe IDs are rejected. */
export function isSafeExecId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0 && id.length <= 200
    && !/[\/\\\x00-\x1f\x7f]/.test(id) && id !== "." && id !== "..";
}

/** A shared/worktree .gsd symlink is valid; exec and its files must not be symlinks. */
export function resolveExecHistoryRoot(baseDir: string): string {
  const gsdRoot = realpathSync(resolve(baseDir, ".gsd"));
  const root = join(gsdRoot, "exec");
  if (!lstatSync(root).isDirectory() || realpathSync(root) !== root) {
    throw new Error("Unsafe exec directory: expected a non-symlink directory under .gsd");
  }
  return root;
}

/** O_NOFOLLOW + inode checks prevent substituting a leaf between stat and open. */
export function openExecHistoryFile(path: string, root: string): number {
  if (dirname(path) !== root || !lstatSync(root).isDirectory() || realpathSync(root) !== root) {
    throw new Error("Unsafe exec file path");
  }
  const rootBefore = lstatSync(root);
  const before = lstatSync(path);
  if (!before.isFile() || realpathSync(path) !== path) throw new Error("Unsafe exec file: not a regular non-symlink file");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = fstatSync(fd);
    const after = lstatSync(path);
    const rootAfter = lstatSync(root);
    if (!opened.isFile() || opened.ino !== before.ino || opened.dev !== before.dev
      || after.ino !== opened.ino || after.dev !== opened.dev || !after.isFile()
      || rootBefore.ino !== rootAfter.ino || rootBefore.dev !== rootAfter.dev
      || !rootAfter.isDirectory() || realpathSync(root) !== root || realpathSync(path) !== path) {
      throw new Error("Exec file changed while opening");
    }
    return fd;
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

export interface ExecHistoryEntry {
  id: string;
  runtime: "bash" | "node" | "python" | string;
  purpose: string | null;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  exit_code: number | null;
  signal: string | null;
  timed_out: boolean;
  aborted?: boolean;
  force_resolved?: boolean;
  stdout_bytes: number;
  stderr_bytes: number;
  stdout_truncated: boolean;
  stderr_truncated: boolean;
  stdout_path: string;
  stderr_path: string;
  meta_path: string;
}

export interface ExecSearchOptions {
  /** Case-insensitive needle matched against purpose. Empty string matches all. */
  query?: string;
  /** Restrict to this runtime. */
  runtime?: ExecHistoryEntry["runtime"];
  /** Include only entries with exit_code !== 0 || timed_out. */
  failing_only?: boolean;
  /** Return at most N entries, most recent first. Default 20, cap 200. */
  limit?: number;
}

export interface ExecSearchHit {
  entry: ExecHistoryEntry;
  /** Redacted stdout tail (up to 300 chars), omitted when safe bounded reading is unavailable. */
  digest_preview?: string;
}

export interface ExecHistorySearchInfo {
  hits: ExecSearchHit[];
  scan_limited: boolean;
  bytes_read: number;
  output_truncated: boolean;
}

function listMetaFiles(baseDir: string, budget: HistoryReadBudget): string[] {
  try {
    const dir = resolveExecHistoryRoot(baseDir);
    const handle = opendirSync(dir);
    const files: string[] = [];
    try {
      for (let count = 0; count < EXEC_DIRECTORY_MAX_ENTRIES; count++) {
        const entry = handle.readSync();
        if (!entry) break;
        if (count === EXEC_DIRECTORY_MAX_ENTRIES - 1) budget.limited = true;
        if (!entry.name.endsWith(".meta.json")) continue;
        if (entry.isFile() && isSafeExecId(entry.name.slice(0, -10))) files.push(join(dir, entry.name));
        else budget.limited = true;
      }
    } finally { handle.closeSync(); }
    return files;
  } catch (error) {
    // An absent scope is the normal empty-history state, not a partial scan.
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") budget.limited = true;
    return [];
  }
}

export function parseExecHistoryMeta(raw: string, path: string): ExecHistoryEntry | null {
  const parsed = JSON.parse(raw) as Partial<ExecHistoryEntry>;
  const id = basename(path).replace(/\.meta\.json$/, "");
  if (!parsed || !isSafeExecId(id) || parsed.id !== id || typeof parsed.runtime !== "string") return null;
  return {
    id: parsed.id,
    runtime: redactSecrets(parsed.runtime),
    purpose: typeof parsed.purpose === "string" ? redactSecrets(parsed.purpose) : null,
    started_at: typeof parsed.started_at === "string" ? redactSecrets(parsed.started_at) : "",
    finished_at: typeof parsed.finished_at === "string" ? redactSecrets(parsed.finished_at) : "",
    duration_ms: typeof parsed.duration_ms === "number" ? parsed.duration_ms : 0,
    exit_code: typeof parsed.exit_code === "number" ? parsed.exit_code : null,
    signal: typeof parsed.signal === "string" ? redactSecrets(parsed.signal) : null,
    timed_out: parsed.timed_out === true,
    ...(typeof parsed.aborted === "boolean" ? { aborted: parsed.aborted } : {}),
    ...(typeof parsed.force_resolved === "boolean" ? { force_resolved: parsed.force_resolved } : {}),
    stdout_bytes: typeof parsed.stdout_bytes === "number" ? parsed.stdout_bytes : 0,
    stderr_bytes: typeof parsed.stderr_bytes === "number" ? parsed.stderr_bytes : 0,
    stdout_truncated: parsed.stdout_truncated === true,
    stderr_truncated: parsed.stderr_truncated === true,
    stdout_path: path.replace(/\.meta\.json$/, ".stdout"),
    stderr_path: path.replace(/\.meta\.json$/, ".stderr"),
    meta_path: path,
  };
}

interface HistoryReadBudget { remaining: number; limited: boolean }

function safeReadMeta(path: string, budget: HistoryReadBudget): ExecHistoryEntry | null {
  let fd: number | undefined;
  try {
    fd = openExecHistoryFile(path, dirname(path));
    const size = fstatSync(fd).size;
    if (size > EXEC_META_MAX_BYTES || size > budget.remaining) { budget.limited = true; return null; }
    const buffer = Buffer.alloc(size);
    const bytesRead = readSync(fd, buffer, 0, size, 0);
    budget.remaining -= bytesRead;
    if (bytesRead < size) budget.limited = true;
    const entry = parseExecHistoryMeta(buffer.subarray(0, bytesRead).toString("utf-8"), path);
    if (!entry) budget.limited = true;
    return entry;
  } catch {
    budget.limited = true;
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function readHistory(baseDir: string, budget: HistoryReadBudget): ExecHistoryEntry[] {
  const metas = listMetaFiles(baseDir, budget)
    .map((path) => {
      let mtime = 0;
      try {
        const stat = lstatSync(path);
        mtime = stat.mtimeMs;
        if (stat.size > EXEC_META_MAX_BYTES) { budget.limited = true; return null; }
      } catch {
        budget.limited = true;
      }
      return { path, mtime };
    })
    .filter((value): value is { path: string; mtime: number } => value !== null);
  metas.sort((a, b) => b.mtime - a.mtime || a.path.localeCompare(b.path));
  // Preserve the legacy lexical path contract (notably /var vs /private/var on macOS).
  return metas.map(({ path }) => safeReadMeta(path, budget))
    .filter((entry): entry is ExecHistoryEntry => entry !== null)
    .map((entry) => ({
      ...entry,
      stdout_path: resolve(baseDir, ".gsd", "exec", `${entry.id}.stdout`),
      stderr_path: resolve(baseDir, ".gsd", "exec", `${entry.id}.stderr`),
      meta_path: resolve(baseDir, ".gsd", "exec", `${entry.id}.meta.json`),
    }));
}

export function listExecHistory(baseDir: string): ExecHistoryEntry[] {
  return readHistory(baseDir, { remaining: HISTORY_MAX_READ_BYTES, limited: false });
}

function matchesFilters(entry: ExecHistoryEntry, opts: ExecSearchOptions): boolean {
  if (opts.runtime && entry.runtime !== opts.runtime) return false;
  if (opts.failing_only) {
    const failed = entry.timed_out || (entry.exit_code !== 0 && entry.exit_code !== null);
    if (!failed) return false;
  }
  const query = (opts.query ?? "").trim().toLowerCase();
  if (!query) return true;
  const haystack = `${entry.id} ${entry.purpose ?? ""}`.toLowerCase();
  return haystack.includes(query);
}

function readDigestPreview(entry: ExecHistoryEntry, maxChars: number, baseDir: string, budget: HistoryReadBudget): string | undefined {
  if (!entry.stdout_path || maxChars <= 0) return undefined;
  try {
    const root = resolveExecHistoryRoot(baseDir);
    const fd = openExecHistoryFile(join(root, `${entry.id}.stdout`), root);
    try {
      const size = fstatSync(fd).size;
      // Reading only a suffix can expose a token or PEM whose marker was cut off.
      // Omit large previews; explicit bounded search/read remains available.
      if (size === 0) return undefined;
      if (size > EXEC_META_MAX_BYTES || size > budget.remaining) { budget.limited = true; return undefined; }
      const buf = Buffer.allocUnsafe(size);
      const bytesRead = readSync(fd, buf, 0, size, 0);
      budget.remaining -= bytesRead;
      if (bytesRead < size) budget.limited = true;
      const text = redactExecLog(decodeExecUtf8(buf.subarray(0, bytesRead), bytesRead === size));
      const trimmed = text.trimEnd();
      let start = Math.max(0, trimmed.length - maxChars);
      if (/[\uDC00-\uDFFF]/.test(trimmed[start] ?? "")) start++;
      return trimmed.slice(start);
    } finally {
      closeSync(fd);
    }
  } catch {
    budget.limited = true;
    return undefined;
  }
}

export function searchExecHistory(
  baseDir: string,
  opts: ExecSearchOptions = {},
): ExecSearchHit[] {
  return searchExecHistoryWithInfo(baseDir, opts).hits;
}

export function searchExecHistoryWithInfo(
  baseDir: string,
  opts: ExecSearchOptions = {},
): ExecHistorySearchInfo {
  const limit = clampLimit(opts.limit, 20, 200);
  const budget: HistoryReadBudget = { remaining: HISTORY_MAX_READ_BYTES, limited: false };
  const entries = readHistory(baseDir, budget);
  const filtered = entries.filter((entry) => matchesFilters(entry, opts));
  const hits = filtered.slice(0, limit).map((entry) => ({
    entry,
    digest_preview: readDigestPreview(entry, 300, baseDir, budget),
  }));
  return {
    hits,
    scan_limited: budget.limited,
    bytes_read: HISTORY_MAX_READ_BYTES - budget.remaining,
    output_truncated: filtered.length > limit,
  };
}

function clampLimit(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  if (value < 1) return 1;
  if (value > max) return max;
  return Math.floor(value);
}
