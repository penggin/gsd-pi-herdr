// Project/App: gsd-pi
// File Purpose: Registers Context Mode execution tools.
// gsd-pi — Exec (context-mode) tool registration.
//
// Exposes the Context Mode runtime tools in-process. Default-on; opt out with
// `context_mode.enabled: false` in preferences.

import { Type } from "@sinclair/typebox";
import type { ExtensionAPI } from "@gsd/pi-coding-agent";

import { resolveCtxCwd } from "./dynamic-tools.js";
import { registerNativeExecResult } from "../exec-result-provenance.js";

function sessionId(ctx: { sessionManager?: { getSessionId?(): string } }): string {
  try { return ctx.sessionManager?.getSessionId?.() ?? ""; } catch { return ""; }
}


async function loadContextModePreferences(baseDir: string) {
  const [{ loadEffectiveGSDPreferences }, { logWarning }] = await Promise.all([
    import("../preferences.js"),
    import("../workflow-logger.js"),
  ]);
  try {
    return loadEffectiveGSDPreferences(baseDir)?.preferences ?? null;
  } catch (err) {
    logWarning("tool", `Context Mode tool could not load preferences: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export function registerExecTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "gsd_uat_exec",
    label: "UAT Exec",
    description:
      "Run a UAT-scoped bash/node/python check with milestone/slice/check metadata. " +
      "Uses the same capped .gsd/exec evidence store as gsd_exec, but rejects commands that mutate dependencies, git state, credentials, or destructive files.",
    promptSnippet: "Run one UAT check and save typed evidence under .gsd/exec",
    promptGuidelines: [
      "Use gsd_uat_exec for each automated UAT check.",
      "Every PASS/FAIL check saved by gsd_uat_result_save must reference objective evidence from this tool or another approved GSD evidence path.",
      "Do not install packages, mutate git state, edit source files, or dump credentials during UAT.",
    ],
    parameters: Type.Object({
      milestoneId: Type.String({ description: "Milestone ID (e.g. M001)" }),
      sliceId: Type.String({ description: "Slice ID (e.g. S01)" }),
      checkId: Type.String({ description: "Stable check ID from the UAT spec (e.g. UAT-01)" }),
      intent: Type.String({
        description:
          "UAT command intent. Use one canonical value: uat-artifact-check, uat-runtime-check, " +
          "uat-browser-check, uat-service-start, or uat-log-inspection. Short aliases such as artifact, " +
          "runtime, browser, service-start, and log-inspection are accepted.",
      }),
      runtime: Type.Optional(
        Type.String({
          description:
            "Optional interpreter. Defaults to bash. Supported: bash, node, python; sh/shell, js/nodejs, and py/python3 aliases are accepted.",
        }),
      ),
      script: Type.Optional(Type.String({ description: "Script body. Keep output small (log the finding, not the data)." })),
      command: Type.Optional(Type.String({ description: "Alias for script; defaults to bash when runtime is omitted." })),
      cmd: Type.Optional(Type.String({ description: "Short alias for script." })),
      code: Type.Optional(Type.String({ description: "Alias for script, useful for node/python snippets." })),
      expected: Type.Optional(Type.String({ description: "Expected outcome for this UAT check." })),
      timeout_ms: Type.Optional(
        Type.Number({
          description: "Per-invocation timeout (ms). Capped at 600000. Default from preferences.",
          minimum: 1_000,
          maximum: 600_000,
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const originatingSession = sessionId(_ctx);
      const { executeUatExec } = await import("../tools/exec-tool.js");
      const baseDir = resolveCtxCwd(_ctx);
      const result = await executeUatExec(params as Parameters<typeof executeUatExec>[0], {
        baseDir,
        preferences: await loadContextModePreferences(baseDir),
        signal: _signal,
      });
      registerNativeExecResult({ sessionId: originatingSession, toolCallId: _toolCallId, toolName: "gsd_uat_exec" }, result);
      return result;
    },
  });

  pi.registerTool({
    name: "gsd_exec",
    label: "Exec (Sandboxed)",
    description:
      "Run a short script (bash/node/python) in a subprocess. Capped stdout/stderr and metadata persist to " +
      ".gsd/exec/<id>.{stdout,stderr,meta.json}; only a short digest returns in context. Use " +
      "this instead of reading many files or emitting large tool outputs — e.g. have the script " +
      "count/grep/summarize and log the finding. Enabled by default; opt out via " +
      "preferences.context_mode.enabled=false.",
    promptSnippet:
      "Run a bash/node/python script in a sandbox; capped output is saved to disk and only a digest returns",
    promptGuidelines: [
      "Prefer gsd_exec for analyses that would otherwise read >3 files or produce large tool output.",
      "Write scripts that log the finding (counts, matches, summaries) rather than raw dumps.",
      "The digest selects bounded redacted evidence from stored stdout/stderr; words in logs do not determine success.",
      "Storage is a capped prefix, not necessarily the whole execution tail. Use gsd_exec_search mode=read with exec_id, stream and start_line to retrieve saved lines.",
      "Compact result flags T/A/F mean timed_out/aborted/force_resolved; storage_truncated, scan_limited and output_truncated are distinct limits.",
    ],
    parameters: Type.Object({
      runtime: Type.Optional(
        Type.String({
          description:
            "Optional interpreter. Defaults to bash. Supported: bash, node, python; sh/shell, js/nodejs, and py/python3 aliases are accepted.",
        }),
      ),
      script: Type.Optional(Type.String({ description: "Script body. Keep output small (log the finding, not the data)." })),
      command: Type.Optional(Type.String({ description: "Alias for script; defaults to bash when runtime is omitted." })),
      cmd: Type.Optional(Type.String({ description: "Short alias for script." })),
      code: Type.Optional(Type.String({ description: "Alias for script, useful for node/python snippets." })),
      purpose: Type.Optional(Type.String({ description: "Short label recorded in meta.json for later review." })),
      timeout_ms: Type.Optional(
        Type.Number({
          description: "Per-invocation timeout (ms). Capped at 600000. Default from preferences.",
          minimum: 1_000,
          maximum: 600_000,
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const originatingSession = sessionId(_ctx);
      const { executeGsdExec } = await import("../tools/exec-tool.js");
      const baseDir = resolveCtxCwd(_ctx);
      const result = await executeGsdExec(params as Parameters<typeof executeGsdExec>[0], {
        baseDir,
        preferences: await loadContextModePreferences(baseDir),
        signal: _signal,
      });
      registerNativeExecResult({ sessionId: originatingSession, toolCallId: _toolCallId, toolName: "gsd_exec" }, result);
      return result;
    },
  });

  pi.registerTool({
    name: "gsd_exec_search",
    label: "Execution History / Logs",
    description:
      "Read-only execution history and stored stdout/stderr retrieval. Omit mode (or history) to filter IDs/purpose as before. " +
      "search finds a case-insensitive single-line literal in at most 20 recent runs/4 MiB; read selects an existing ID and line range. Never re-executes commands or certifies current validation.",
    promptSnippet: "Find prior executions or search/read bounded saved stdout/stderr by execution ID",
    promptGuidelines: [
      "Use this before re-running an expensive analysis — the prior run's stdout file may still answer.",
      "history query matches ID/purpose only; search query matches stored log text literally, not regex.",
      "Use mode=read, exec_id, stream=stdout|stderr, start_line and line_count for original redacted lines; use start_column for partial long lines.",
      "storage_truncated means original output was not all saved; scan_limited means this query did not scan everything; output_truncated means only part of the found/read text is returned.",
      "T/A/F are timed_out/aborted/force_resolved. Compact read locators name this tool, execution ID, stream and line; they are not shell commands.",
    ],
    parameters: Type.Object({
      mode: Type.Optional(Type.String({ enum: ["history", "search", "read"], description: "Default history preserves ID/purpose filtering; search/read inspect stored log bodies." })),
      query: Type.Optional(Type.String({ description: "History: ID/purpose substring. Search: nonempty single-line literal, at most 256 chars. Case-insensitive." })),
      exec_id: Type.Optional(Type.String({ maxLength: 200, description: "Existing execution ID, not a path. Required for read; optional for search." })),
      stream: Type.Optional(Type.String({ enum: ["stdout", "stderr", "both"], description: "Search defaults both. Read requires stdout or stderr." })),
      context_lines: Type.Optional(Type.Integer({ minimum: 0, maximum: 8, description: "Search surrounding lines, default 2." })),
      start_line: Type.Optional(Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER, description: "Read starting line, one-based; default 1." })),
      line_count: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, description: "Read line count, default 50." })),
      start_column: Type.Optional(Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER, description: "Read starting UTF-16 column, one-based; for returned partial-line cursors." })),
      runtime: Type.Optional(
        Type.String({
          description: "Restrict to one runtime: bash, node, or python.",
        }),
      ),
      failing_only: Type.Optional(Type.Boolean({ description: "Only non-zero exit codes and timeouts." })),
      limit: Type.Optional(Type.Integer({ description: "History default 20/max 200; search default 5/max 20.", minimum: 1, maximum: 200 })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const originatingSession = sessionId(_ctx);
      const { executeExecSearch } = await import("../tools/exec-search-tool.js");
      const baseDir = resolveCtxCwd(_ctx);
      const result = await executeExecSearch(params as Parameters<typeof executeExecSearch>[0], {
        baseDir,
        preferences: await loadContextModePreferences(baseDir),
        signal: _signal,
      });
      registerNativeExecResult({ sessionId: originatingSession, toolCallId: _toolCallId, toolName: "gsd_exec_search" }, result);
      return result;
    },
  });

  pi.registerTool({
    name: "gsd_resume",
    label: "Resume (Read Snapshot)",
    description:
      "Return the contents of .gsd/last-snapshot.md — a ≤2 KB digest of top memories, recent " +
      "gsd_exec runs, and active context, written automatically on session_before_compact. Use " +
      "this after compaction or session resume to re-orient quickly.",
    promptSnippet: "Read the pre-compaction snapshot to re-orient after context loss",
    promptGuidelines: [
      "Call this right after a session resumes if you feel you've lost durable context.",
      "The snapshot is a summary — use memory_query or gsd_exec_search for detail.",
    ],
    parameters: Type.Object({}),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const { executeResume } = await import("../tools/resume-tool.js");
      const baseDir = resolveCtxCwd(_ctx);
      return executeResume(params as Parameters<typeof executeResume>[0], {
        baseDir,
        preferences: await loadContextModePreferences(baseDir),
      });
    },
  });
}
