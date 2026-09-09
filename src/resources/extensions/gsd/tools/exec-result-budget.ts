import type { ContextManagementConfig } from "../preferences-types.js";
import { redactSecrets } from "../redact-secrets.js";
import { redactExecLog, sliceExecText } from "../exec-log-text.js";
export { sliceExecText } from "../exec-log-text.js";

export type ExecResultKind = "exec" | "query";
export interface ExecResultEnvelope {
  kind: ExecResultKind;
  /** Mechanical execution status or actual query scope, not a log-derived verdict. */
  summary: string;
  /** Compact execution ID / stream / line locator and the existing read tool. */
  retrieval: string;
  /** Optional shorter, still complete mechanical fields for explicit tiny caps. */
  compact_summary?: string;
  compact_retrieval?: string;
  storage_truncated: boolean | "unknown";
  scan_limited: boolean;
  output_truncated: boolean;
  sections: Array<{ label: string; text: string }>;
}

export const EXEC_RESULT_MAX_CHARS = 2000;
export const EXEC_QUERY_MAX_CHARS = 4000;
export const DEFAULT_TOOL_RESULT_MAX_CHARS = 800;

/** The explicit general ceiling wins; omission permits only these named internal budgets. */
export function resolveExecResultMaxChars(kind: ExecResultKind, config?: ContextManagementConfig): number {
  const maximum = kind === "exec" ? EXEC_RESULT_MAX_CHARS : EXEC_QUERY_MAX_CHARS;
  const explicit = config?.tool_result_max_chars;
  return typeof explicit === "number" && Number.isFinite(explicit) && explicit > 0
    ? Math.min(maximum, Math.floor(explicit))
    : maximum;
}

/**
 * A small plain-text envelope rather than clipped JSON. Producers keep the two
 * mandatory lines compact; evidence is reduced first, leaving the read locator.
 * The three flags have independent meanings even when evidence is omitted.
 */
export interface FormattedExecResult {
  text: string;
  output_truncated: boolean;
  /** Whether this render omitted any provided section label or body text. */
  body_truncated: boolean;
  metadata_omitted?: boolean;
}

export function formatExecResult(envelope: ExecResultEnvelope, maxChars: number): string {
  return formatExecResultWithInfo(envelope, maxChars).text;
}

/** The renderer, not log markers, is authoritative for result-budget metadata. */
export function formatExecResultWithInfo(envelope: ExecResultEnvelope, maxChars: number): FormattedExecResult {
  const limit = Math.max(1, Math.min(resolveExecResultMaxChars(envelope.kind), Math.floor(maxChars) || 1));
  const summary = redactSecrets(envelope.summary).replace(/[\r\n]+/g, " ");
  const retrieval = redactSecrets(envelope.retrieval).replace(/[\r\n]+/g, " ");
  const sections = envelope.sections.map(({ label, text }) => ({
    label: redactSecrets(label).replace(/[\r\n]+/g, " "), text: redactExecLog(text),
  }));
  const flags = (truncated: boolean) =>
    `storage_truncated=${envelope.storage_truncated} scan_limited=${envelope.scan_limited} output_truncated=${truncated}`;
  const header = (truncated: boolean) => `${summary}\n${flags(truncated)}\n${retrieval}`;
  const body = sections.map(({ label, text }) => `${label}\n${text}`).join("\n");
  const complete = `${header(envelope.output_truncated)}${body ? `\n${body}` : ""}`;
  if (complete.length <= limit) return { text: complete, output_truncated: envelope.output_truncated, body_truncated: false };

  let required = header(true);
  if (required.length > limit) {
    // At the supported 200-character minimum use explicitly labelled compact
    // flags, retaining the full locator and mechanical summary where possible.
    const compactFlags = `limits(storage/scan/output)=${envelope.storage_truncated}/${envelope.scan_limited}/true`;
    const compactSummary = redactSecrets(envelope.compact_summary ?? summary).replace(/[\r\n]+/g, " ");
    const compactRetrieval = redactSecrets(envelope.compact_retrieval ?? retrieval).replace(/[\r\n]+/g, " ");
    required = `${compactSummary}\n${compactFlags}\n${compactRetrieval}`;
    if (required.length > limit) {
      // Pathological legacy identifiers can exceed the entire budget. Do not
      // cut an identifier into a misleading read target or return broken JSON.
      return {
        text: sliceExecText(`Result omitted: metadata exceeds budget. ${compactFlags}`, limit),
        output_truncated: true,
        body_truncated: sections.length > 0,
        metadata_omitted: true,
      };
    }
  }
  let result = required;
  let includedSections = 0;
  for (const section of sections) {
    const space = limit - result.length - section.label.length - 2;
    if (space < 0) break;
    const selected = sliceExecText(section.text, space);
    result += `\n${section.label}\n${selected}`;
    if (selected.length < section.text.length) break;
    includedSections++;
  }
  return { text: result, output_truncated: true, body_truncated: includedSections < sections.length };
}
