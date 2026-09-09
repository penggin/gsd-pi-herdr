/**
 * Real-time tool call evidence collector for auto-mode safety harness.
 * Tracks every bash command, file write, and file edit during a unit execution.
 * Evidence is compared against LLM completion claims in evidence-cross-ref.ts.
 *
 * Evidence is persisted to .gsd/safety/evidence-<mid>-<sid>-<tid>.json so it
 * survives session restarts (pause/resume, crash recovery). On unit start,
 * call resetEvidence() then loadEvidenceFromDisk(). On every new tool call,
 * saveEvidenceToDisk() is called automatically by recordToolCall/recordToolResult.
 *
 * Follows the same module-level Map pattern as auto-tool-tracking.ts.
 * Copyright (c) 2026 Jeremy McSpadden <jeremy@fluxlabs.net>
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { randomBytes } from "node:crypto";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BashEvidence {
  kind: "bash";
  toolCallId: string;
  command: string;
  exitCode: number;
  outputSnippet: string;
  timestamp: number;
}

export interface FileWriteEvidence {
  kind: "write";
  toolCallId: string;
  path: string;
  timestamp: number;
}

export interface FileEditEvidence {
  kind: "edit";
  toolCallId: string;
  path: string;
  timestamp: number;
}

export type EvidenceEntry = BashEvidence | FileWriteEvidence | FileEditEvidence;

const EXECUTION_TOOL_NAMES = new Set([
  "async_bash",
  "bash",
  "exec_command",
  "functions.exec_command",
  "gsd_exec",
  "gsd_uat_exec",
  "powershell",
]);
// Log retrieval (gsd_exec_search in every mode) is not execution evidence,
// even when its result contains an earlier successful run.
const MCP_EXECUTION_TOOL_RE = /^mcp__.+__gsd_(?:uat_)?exec$/;

// ─── Module State ───────────────────────────────────────────────────────────

let unitEvidence: EvidenceEntry[] = [];
let lastWritePath: string | null = null;
let lastWriteSig: string | null = null;

// ─── Public API ─────────────────────────────────────────────────────────────

/** Reset all evidence for a new unit. Call at unit start. */
export function resetEvidence(): void {
  unitEvidence = [];
  lastWritePath = null;
  lastWriteSig = null;
}

/** Get a read-only view of all evidence collected for the current unit. */
export function getEvidence(): readonly EvidenceEntry[] {
  return unitEvidence;
}

/** Get only bash evidence entries. */
export function getBashEvidence(): readonly BashEvidence[] {
  return unitEvidence.filter((e): e is BashEvidence => e.kind === "bash");
}

/** Get all file paths touched (write + edit). */
export function getFilePaths(): string[] {
  return unitEvidence
    .filter((e): e is FileWriteEvidence | FileEditEvidence => e.kind === "write" || e.kind === "edit")
    .map(e => e.path);
}

/** True when a tool name represents a shell/command execution surface. */
export function isExecutionToolName(name: unknown): boolean {
  if (typeof name !== "string") return false;
  const normalized = name.trim().toLowerCase();
  return EXECUTION_TOOL_NAMES.has(normalized) || MCP_EXECUTION_TOOL_RE.test(normalized);
}

// ─── Persistence (Bug #4385 — evidence must survive session restarts) ────────

/**
 * Build the path for the evidence JSON file for a given unit.
 * Lives under .gsd/safety/ which is gitignored and session-scoped.
 */
function evidencePath(basePath: string, milestoneId: string, sliceId: string, taskId: string): string {
  return join(basePath, ".gsd", "safety", `evidence-${milestoneId}-${sliceId}-${taskId}.json`);
}

/**
 * Validate that a parsed value is an array of EvidenceEntry objects.
 * Rejects corrupt / schema-mismatch data rather than letting it poison state.
 */
function isEvidenceArray(data: unknown): data is EvidenceEntry[] {
  if (!Array.isArray(data)) return false;
  return data.every((e) => {
    if (e === null || typeof e !== "object") return false;
    const rec = e as Record<string, unknown>;
    if (typeof rec.toolCallId !== "string") return false;
    if (typeof rec.timestamp !== "number") return false;
    if (rec.kind === "bash") {
      return (
        typeof rec.command === "string" &&
        typeof rec.exitCode === "number" &&
        typeof rec.outputSnippet === "string"
      );
    }
    if (rec.kind === "write" || rec.kind === "edit") {
      return typeof rec.path === "string";
    }
    return false;
  });
}

/**
 * Persist the current in-memory evidence to disk so it survives a session
 * restart. Called from saveEvidenceToDisk after recordToolCall/recordToolResult.
 * Non-fatal — persistence failures must never break unit execution.
 */
export function saveEvidenceToDisk(
  basePath: string,
  milestoneId: string,
  sliceId: string,
  taskId: string,
): void {
  try {
    const path = evidencePath(basePath, milestoneId, sliceId, taskId);
    const body = JSON.stringify(unitEvidence, null, 2) + "\n";
    if (path === lastWritePath && body === lastWriteSig) return;

    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp.${randomBytes(4).toString("hex")}`;
    writeFileSync(tmp, body, "utf-8");
    renameSync(tmp, path);
    lastWritePath = path;
    lastWriteSig = body;
  } catch {
    // Non-fatal — don't let persistence failures break unit execution
  }
}

/**
 * Load persisted evidence from disk into the in-memory array.
 * Call after resetEvidence() on session resume to restore context for a
 * partially-executed unit. If the file does not exist (fresh unit), this
 * is a no-op — getEvidence() will return [] which is correct.
 */
export function loadEvidenceFromDisk(
  basePath: string,
  milestoneId: string,
  sliceId: string,
  taskId: string,
): void {
  try {
    lastWritePath = null;
    lastWriteSig = null;
    const path = evidencePath(basePath, milestoneId, sliceId, taskId);
    if (!existsSync(path)) return;
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    if (isEvidenceArray(parsed)) {
      unitEvidence = parsed;
    }
  } catch {
    // Non-fatal — corrupt / missing file is treated as empty evidence
  }
}

/**
 * Delete the persisted evidence file for a unit after it has been fully
 * processed. Prevents stale evidence from affecting future retries of
 * the same unit ID.
 */
export function clearEvidenceFromDisk(
  basePath: string,
  milestoneId: string,
  sliceId: string,
  taskId: string,
): void {
  try {
    const path = evidencePath(basePath, milestoneId, sliceId, taskId);
    if (existsSync(path)) {
      unlinkSync(path);
    }
    if (path === lastWritePath) {
      lastWritePath = null;
      lastWriteSig = null;
    }
  } catch {
    // Non-fatal
  }
}

// ─── Recording (called from register-hooks.ts) ─────────────────────────────

/**
 * Record a tool call at dispatch time (before execution).
 * Exit codes and output are filled in by recordToolResult after execution.
 */
export function recordToolCall(toolCallId: string, toolName: string, input: Record<string, unknown>): void {
  // Idempotent by toolCallId: native tools reach this via both
  // tool_execution_start and tool_call; external (pre-executed) tools only
  // via tool_execution_start. First recording wins.
  if (unitEvidence.some(e => e.toolCallId === toolCallId)) return;
  if (isExecutionToolName(toolName)) {
    unitEvidence.push({
      kind: "bash",
      toolCallId,
      // gsd_exec / gsd_uat_exec carry the script body in `script` (or `code`);
      // bash-style tools use `command`/`cmd`.
      command: formatExecutionEvidenceCommand(toolName, input),
      exitCode: -1,
      outputSnippet: "",
      timestamp: Date.now(),
    });
  } else if (toolName === "write" || toolName === "Write") {
    unitEvidence.push({
      kind: "write",
      toolCallId,
      path: String(input.file_path ?? input.path ?? ""),
      timestamp: Date.now(),
    });
  } else if (toolName === "edit" || toolName === "Edit") {
    unitEvidence.push({
      kind: "edit",
      toolCallId,
      path: String(input.file_path ?? input.path ?? ""),
      timestamp: Date.now(),
    });
  }
}

function pickString(input: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return "";
}

function canonicalExecutionToolLabel(toolName: string): string {
  const normalized = toolName.trim().toLowerCase();
  const mcpMatch = normalized.match(/^mcp__.+__(gsd_(?:uat_)?exec)$/);
  return mcpMatch?.[1] ?? normalized;
}

function formatExecutionEvidenceCommand(toolName: string, input: Record<string, unknown>): string {
  const body = pickString(input, "command", "script", "cmd", "code");
  const tool = canonicalExecutionToolLabel(toolName);
  const purpose = pickString(input, "purpose");
  const runtime = pickString(input, "runtime").toLowerCase();
  const label = purpose && (tool === "gsd_exec" || tool === "gsd_uat_exec")
    ? `${tool}${runtime ? ` ${runtime}` : ""}: ${purpose}`
    : "";

  if (label && body) return `${label}\n${body}`;
  return body || label;
}

/**
 * Record a tool execution result. Matches the entry by toolCallId (assigned
 * at dispatch time) and fills in exit code + output. Prior versions matched
 * by `kind + empty-string` which corrupted parallel tool calls.
 */
export function recordToolResult(
  toolCallId: string,
  toolName: string,
  result: unknown,
  isError: boolean,
): void {
  const entry = unitEvidence.find(e => e.toolCallId === toolCallId);
  if (!entry) return;

  if (entry.kind === "bash") {
    const text = extractResultText(result);
    entry.outputSnippet = text.slice(0, 500);
    entry.exitCode = resolveStructuredExecExitCode(toolName, result, isError) ?? resolveExitCode(text, isError);
  }
}

/**
 * Current GSD executors carry mechanical state outside the selected log text.
 * MCP mirrors those details into structuredContent. A log can itself print an
 * exit-code marker, so it must never override this matching executor envelope.
 * Text-only historical results retain the existing fallback below.
 */
function resolveStructuredExecExitCode(toolName: string, result: unknown, isError: boolean): number | undefined {
  const operation = canonicalExecutionToolLabel(toolName);
  if (operation !== "gsd_exec" && operation !== "gsd_uat_exec") return undefined;
  if (!result || typeof result !== "object") return undefined;
  const record = result as Record<string, unknown>;
  for (const candidate of [record.details, record.structuredContent]) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const status = candidate as Record<string, unknown>;
    if (status.operation !== operation) continue;
    const code = status.exit_code;
    // -1 is the existing unknown/non-success sentinel, not an invented process
    // exit code. Null/missing state and interrupted exit 0 cannot prove a pass.
    if (typeof code !== "number" || !Number.isSafeInteger(code)) return -1;
    if (code !== 0) return code;
    if (isError || status.timed_out === true || status.aborted === true || status.force_resolved === true
      || (status.signal !== undefined && status.signal !== null)) return -1;
    return 0;
  }
  return undefined;
}

/**
 * Resolve the exit code from a tool result's text. Handles the bash tool's
 * prose marker, the gsd_exec / gsd_uat_exec JSON envelope (`"exit_code": N`),
 * and a last-resort read of the run's persisted `.gsd/exec/<id>.meta.json`
 * (covers truncated result text).
 */
function resolveExitCode(text: string, isError: boolean): number {
  const proseMatch = text.match(/Command exited with code (\d+)/);
  if (proseMatch) return Number(proseMatch[1]);

  const jsonMatch = text.match(/"exit_code"\s*:\s*(-?\d+)/);
  if (jsonMatch) return Number(jsonMatch[1]);

  const metaMatch = text.match(/"meta_path"\s*:\s*"([^"]+)"/);
  if (metaMatch) {
    try {
      const meta = JSON.parse(readFileSync(metaMatch[1], "utf-8")) as Record<string, unknown>;
      if (typeof meta.exit_code === "number") return meta.exit_code;
    } catch {
      // Fall through to the isError heuristic
    }
  }

  return isError ? 1 : 0;
}

// ─── Internals ──────────────────────────────────────────────────────────────

function extractResultText(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (Array.isArray(r.content)) {
      const textBlock = r.content.find(
        (c: unknown) => typeof c === "object" && c !== null && (c as Record<string, unknown>).type === "text",
      ) as Record<string, unknown> | undefined;
      if (textBlock && typeof textBlock.text === "string") return textBlock.text;
    }
    if (typeof r.text === "string") return r.text;
  }
  return String(result ?? "");
}
