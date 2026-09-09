/**
 * Ephemeral native-result provenance, never a wire field or a body marker.
 * Old/reloaded history, transformed text and ambiguous IDs use generic limits.
 * This authenticates the producing runtime, NOT instructions inside log text.
 */
import { createHash } from "node:crypto";
import type { ContextManagementConfig } from "./preferences-types.js";
import { formatExecResult, resolveExecResultMaxChars, sliceExecText, type ExecResultEnvelope } from "./tools/exec-result-budget.js";

const TOOL_NAMES = new Set(["gsd_exec", "gsd_uat_exec", "gsd_exec_search"]);
const MAX_ENTRIES = 256;
const MAX_ENVELOPE_CHARS = 16_000;
const markedResults = new WeakMap<object, ExecResultEnvelope>();
interface Entry { sessionId: string; toolCallId: string; toolName: string; hash: string; envelope: ExecResultEnvelope; ambiguous?: boolean }
const entries = new Map<string, Entry>();
const hashText = (text: string) => createHash("sha256").update(text).digest("hex");

export function markExecResult(result: object, envelope: ExecResultEnvelope): void {
  let remaining = MAX_ENVELOPE_CHARS;
  const sections = envelope.sections.slice(0, 20).map(({ label, text }) => {
    const bounded = sliceExecText(text, remaining);
    remaining -= bounded.length;
    return { label: sliceExecText(label, 512), text: bounded };
  });
  markedResults.set(result, {
    ...envelope, summary: sliceExecText(envelope.summary, 2048), retrieval: sliceExecText(envelope.retrieval, 2048), sections,
    compact_summary: envelope.compact_summary === undefined ? undefined : sliceExecText(envelope.compact_summary, 2048),
    compact_retrieval: envelope.compact_retrieval === undefined ? undefined : sliceExecText(envelope.compact_retrieval, 2048),
    output_truncated: envelope.output_truncated || envelope.sections.length > sections.length || envelope.sections.reduce((n, s) => n + s.text.length, 0) > MAX_ENVELOPE_CHARS,
  });
}

/** For the canonical UAT wrapper which adds identifiers without changing content. */
export function copyExecResultMark(from: object, to: object): void {
  const envelope = markedResults.get(from);
  if (envelope) markedResults.set(to, envelope);
}

export function registerNativeExecResult(
  identity: { sessionId: string; toolCallId: string; toolName: string }, result: object,
): void {
  const envelope = markedResults.get(result);
  const content = (result as { content?: unknown }).content;
  if (!envelope || !TOOL_NAMES.has(identity.toolName) || !identity.sessionId || !identity.toolCallId
    || identity.sessionId.length > 512 || identity.toolCallId.length > 512
    || !Array.isArray(content) || content.length !== 1 || content[0]?.type !== "text" || typeof content[0].text !== "string"
    || content[0].text.length > resolveExecResultMaxChars(envelope.kind)) return;
  const key = JSON.stringify([identity.sessionId, identity.toolCallId]);
  const hash = hashText(content[0].text);
  const previous = entries.get(key);
  entries.delete(key);
  entries.set(key, { ...identity, envelope, hash, ambiguous: previous?.ambiguous || Boolean(previous && (previous.hash !== hash || previous.toolName !== identity.toolName)) });
  while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!);
}

/** Only normalizations performed by the existing Responses/Completions converters. */
function wireIdAliases(id: string): Set<string> {
  const base = id.split("|")[0];
  const normalized = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64).replace(/_+$/, "");
  return new Set([id, base, id.slice(0, 40), base.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40), normalized(id), normalized(base)]);
}

export function budgetNativeExecResult(input: {
  sessionId?: string; toolCallId?: unknown; toolName?: unknown; text: string; config?: ContextManagementConfig;
}): string | undefined {
  if (!input.sessionId || typeof input.toolCallId !== "string") return undefined;
  const matches = [...entries.entries()].filter(([, entry]) => entry.sessionId === input.sessionId && wireIdAliases(entry.toolCallId).has(input.toolCallId as string));
  if (matches.length !== 1) return undefined;
  const [key, entry] = matches[0];
  if (entry.ambiguous || (typeof input.toolName === "string" && entry.toolName !== input.toolName) || entry.hash !== hashText(input.text)) return undefined;
  entries.delete(key);
  entries.set(key, entry);
  const maximum = resolveExecResultMaxChars(entry.envelope.kind, input.config);
  return input.text.length <= maximum ? input.text : formatExecResult(entry.envelope, maximum);
}
