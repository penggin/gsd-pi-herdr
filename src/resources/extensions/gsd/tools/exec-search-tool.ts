// Existing execution history plus bounded, read-only stored log retrieval.
import { searchExecHistoryWithInfo, type ExecHistoryEntry } from "../exec-history.js";
import { queryExecLogs, findExecLiteralMatch, type ExecLogHit, type ExecLogQueryOptions, type ExecLogQueryResult } from "../exec-log-reader.js";
import { isContextModeEnabled, type ContextModeConfig, type ContextManagementConfig } from "../preferences-types.js";
import { redactSecrets } from "../redact-secrets.js";
import { sliceExecText, redactExecDetails } from "../exec-log-text.js";
import { markExecResult } from "../exec-result-provenance.js";
import { formatExecResultWithInfo, resolveExecResultMaxChars, type ExecResultEnvelope } from "./exec-result-budget.js";
import { contextModeDisabledResult, type ToolExecutionResult } from "./context-mode-tool-result.js";

export interface ExecSearchToolParams {
  mode?: "history" | "search" | "read";
  query?: string;
  runtime?: "bash" | "node" | "python";
  failing_only?: boolean;
  limit?: number;
  exec_id?: string;
  stream?: "stdout" | "stderr" | "both";
  context_lines?: number;
  start_line?: number;
  line_count?: number;
  start_column?: number;
}
interface SearchDeps {
  baseDir: string;
  preferences?: { context_mode?: ContextModeConfig; context_management?: ContextManagementConfig } | null;
  signal?: AbortSignal;
}
type ExecState = Pick<ExecHistoryEntry, "exit_code" | "signal" | "timed_out" | "aborted" | "force_resolved">;
function status(e: ExecState): string {
  return `exit=${e.exit_code ?? "null"} sig=${e.signal ?? "-"} T${+e.timed_out}A${+(e.aborted === true)}F${+(e.force_resolved === true)}`;
}
function invalid(error: unknown): ToolExecutionResult {
  const message = sliceExecText(redactSecrets(error instanceof Error ? error.message : String(error)), 1000);
  return { content: [{ type: "text", text: `gsd_exec_search: ${message}` }], details: { operation: "gsd_exec_search", error: "invalid_query", message }, isError: true };
}
function finish(envelope: ExecResultEnvelope, details: Record<string, unknown>, deps: SearchDeps, isError = false): ToolExecutionResult {
  const rendered = formatExecResultWithInfo(envelope, resolveExecResultMaxChars("query", deps.preferences?.context_management));
  const result: ToolExecutionResult = {
    content: [{ type: "text", text: rendered.text }],
    details: { operation: "gsd_exec_search", ...details, storage_truncated: envelope.storage_truncated, scan_limited: envelope.scan_limited, output_truncated: rendered.output_truncated, ...(rendered.metadata_omitted ? { metadata_omitted: true } : {}) },
    ...(isError ? { isError: true } : {}),
  };
  result.details = redactExecDetails(result.details);
  markExecResult(result, { ...envelope, output_truncated: rendered.output_truncated });
  return result;
}

// Preserve the synchronous legacy helper contract as well as its filter/order.
export function executeExecSearch(params: ExecSearchToolParams & { mode: "search" | "read" }, deps: SearchDeps): Promise<ToolExecutionResult>;
export function executeExecSearch(params: ExecSearchToolParams & { mode?: "history" }, deps: SearchDeps): ToolExecutionResult;
export function executeExecSearch(params: ExecSearchToolParams, deps: SearchDeps): ToolExecutionResult | Promise<ToolExecutionResult>;
export function executeExecSearch(params: ExecSearchToolParams, deps: SearchDeps): ToolExecutionResult | Promise<ToolExecutionResult> {
  if (!isContextModeEnabled(deps.preferences)) return contextModeDisabledResult("gsd_exec_search");
  if (params.mode === "search" || params.mode === "read") return retrieve(params, deps);
  if (params.mode !== undefined && params.mode !== "history") return invalid("mode must be history, search, or read");
  if (deps.signal?.aborted) return invalid("Log query was cancelled");
  const history = searchExecHistoryWithInfo(deps.baseDir, {
    query: typeof params.query === "string" ? params.query : undefined,
    runtime: params.runtime, failing_only: params.failing_only === true,
    limit: typeof params.limit === "number" ? params.limit : undefined,
  });
  const hits = history.hits;
  const envelope: ExecResultEnvelope = {
    kind: "query",
    summary: hits.length ? `Found ${hits.length} exec run(s), most recent first; scope=current project/worktree .gsd/exec` : "No prior gsd_exec runs match those filters; scope=current project/worktree .gsd/exec",
    compact_summary: `history matches=${hits.length} scope=cwd/.gsd/exec`,
    retrieval: "gsd_exec_search mode=read exec_id=<id> stream=stdout start_line=1",
    compact_retrieval: "gsd_exec_search read <id> stdout:L1",
    storage_truncated: hits.some(h => h.entry.stdout_truncated || h.entry.stderr_truncated),
    scan_limited: history.scan_limited, output_truncated: history.output_truncated,
    sections: hits.map(({ entry: e, digest_preview }) => ({
      label: `[${e.id}] ${e.runtime} ${status(e)} at=${e.started_at}`,
      text: `${e.purpose ? `${e.purpose}\n` : ""}stdout: ${e.stdout_path}${digest_preview ? `\npreview (stored prefix):\n${digest_preview}` : ""}`,
    })),
  };
  return finish(envelope, {
    mode: "history", matches: hits.length, bytes_read: history.bytes_read,
    scope: { kind: "project-worktree", base_dir: deps.baseDir, exec_root: `${deps.baseDir}/.gsd/exec` },
    results: hits.map(({ entry: e }) => ({ id: e.id, runtime: e.runtime, exit_code: e.exit_code, timed_out: e.timed_out, signal: e.signal, aborted: e.aborted, force_resolved: e.force_resolved, duration_ms: e.duration_ms, purpose: e.purpose, stdout_path: e.stdout_path, stderr_path: e.stderr_path, meta_path: e.meta_path })),
  }, deps);
}

/** Crop a window and project actual coordinates, not a pre-budget 8K cursor. */
function cropHit(hit: ExecLogHit, maxChars: number, query?: string): ExecLogHit {
  const original = hit.text;
  const match = query ? findExecLiteralMatch(original, query) : -1;
  let from = match >= maxChars ? Math.max(0, match - Math.floor(maxChars / 4)) : 0;
  if (/[\uDC00-\uDFFF]/.test(original[from] ?? "")) from++;
  const text = sliceExecText(original.slice(from), maxChars);
  const position = (offset: number) => {
    const prefix = original.slice(0, offset);
    const breaks = prefix.split("\n").length - 1;
    return { line: hit.start_line + breaks, column: breaks ? offset - prefix.lastIndexOf("\n") : (hit.start_column ?? 1) + offset };
  };
  const start = position(from), end = position(from + text.length);
  const last = position(Math.max(from, from + text.length - 1));
  return {
    ...hit, text, start_line: start.line, end_line: last.line, start_column: start.column,
    end_column: last.column, partial_line: true,
    ...(from + text.length < original.length ? { next_start_line: end.line, next_start_column: end.column } : {}),
  };
}
function queryEnvelope(data: ExecLogQueryResult, hits: ExecLogHit[], params: ExecSearchToolParams, truncated: boolean): ExecResultEnvelope {
  const first = hits[0] ?? data.results[0];
  const execution = first ?? data.execution;
  const id = execution?.exec_id ?? params.exec_id;
  const stream = first?.stream ?? (params.stream === "stderr" ? "stderr" : "stdout");
  const line = first?.start_line ?? params.start_line ?? 1;
  const column = first?.start_column ?? params.start_column ?? 1;
  const locator = id ? `exec_id=${id} stream=${stream} start_line=${line}${column > 1 ? ` start_column=${column}` : ""}` : "exec_id=<id> stream=stdout start_line=1";
  const sections = hits.flatMap(hit => {
    const parts = [{
      label: `${hits.length === 1 ? "" : `[${hit.exec_id}] ${status(hit)} at=${hit.started_at} `}${hit.stream}:L${hit.start_line}-${hit.end_line}${hit.partial_line ? ` C${hit.start_column ?? 1}-${hit.end_column ?? "?"} partial` : ""}`,
      text: hit.text,
    }];
    if (hit.next_start_line) parts.push({ label: `next=L${hit.next_start_line}${hit.next_start_column ? `:C${hit.next_start_column}` : ""}`, text: "" });
    return parts;
  });
  sections.unshift(...data.errors.slice(0, 20).map(e => ({ label: `error ${e.code} ${e.exec_id ?? ""} ${e.stream ?? ""}`, text: e.message })));
  return {
    kind: "query",
    summary: `${data.mode} scope=current project/worktree .gsd/exec runs=${data.runs_scanned} bytes=${data.bytes_read} matches=${data.results.length} shown=${hits.length} errors=${data.errors.length}${execution ? ` ${status(execution)} at=${execution.started_at}` : ""}${data.errors.length ? " — stored evidence incomplete" : !data.results.length ? " — no matching stored lines in the scanned range" : ""}`,
    compact_summary: `${data.mode} cwd/.gsd/exec ${execution ? status(execution) : `matches=${data.results.length}`}${data.errors.length ? ` errors=${data.errors.length}` : ""}`,
    retrieval: `gsd_exec_search mode=read ${locator}`,
    compact_retrieval: `gsd_exec_search read ${id ?? "<id>"} ${stream}:L${line}${column > 1 ? ` C${column}` : ""}`,
    storage_truncated: data.storage_truncated, scan_limited: data.scan_limited,
    output_truncated: data.output_truncated || truncated, sections,
  };
}
async function retrieve(params: ExecSearchToolParams, deps: SearchDeps): Promise<ToolExecutionResult> {
  try {
    const data = await queryExecLogs(deps.baseDir, { ...params, mode: params.mode as "search" | "read", signal: deps.signal } as ExecLogQueryOptions);
    const budget = resolveExecResultMaxChars("query", deps.preferences?.context_management);
    const hits = data.results.map(hit => ({ ...hit }));
    let truncated = false;
    let envelope = queryEnvelope(data, hits, params, truncated);
    // Every step halves a bounded hit or drops one: finite work, even at tiny caps.
    for (let i = 0; i < 400; i++) {
      const rendered = formatExecResultWithInfo(envelope, budget);
      if (!rendered.body_truncated) break;
      const index = hits.reduce((best, hit, at) => hit.text.length > (hits[best]?.text.length ?? 0) ? at : best, 0);
      if (hits[index]?.text.length > 1) hits[index] = cropHit(hits[index], Math.floor(hits[index].text.length / 2), data.mode === "search" ? params.query : undefined);
      else if (hits.length) hits.pop();
      else break;
      truncated = true;
      envelope = queryEnvelope(data, hits, params, truncated);
    }
    if (data.results.length > 0 && !hits.length && !data.errors.length) {
      data.errors.push({ code: "RESULT_BUDGET", message: "No original log text fits this tool_result_max_chars ceiling; increase it to read evidence. Retrying the same query unchanged will not advance." });
      envelope = queryEnvelope(data, hits, params, true);
    }
    const next = data.mode === "read" ? hits[0] : undefined;
    const { next_start_line: _oldLine, next_start_column: _oldColumn, ...rest } = data;
    return finish(envelope, {
      ...rest, results: hits, matches: data.results.length,
      errors: data.errors.slice(0, 20), errors_omitted: Math.max(0, data.errors.length - 20),
      ...(next?.next_start_line ? { next_start_line: next.next_start_line } : {}),
      ...(next?.next_start_column ? { next_start_column: next.next_start_column } : {}),
      more_results: !hits.length && data.results.length ? null : truncated && data.results.length ? true : data.more_results,
    }, deps, data.errors.length > 0);
  } catch (error) { return invalid(error); }
}
