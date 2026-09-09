import { sliceExecText } from "./exec-log-text.js";

export interface ExecExcerpt {
  stream: "stdout" | "stderr";
  start_line: number;
  end_line: number;
  text: string;
  partial_line?: boolean;
  start_column?: number;
  end_column?: number;
}

// These words select evidence locations only. They never determine exit status.
const ERROR = /\b(?:error|failed?|failure|exception|panic|fatal|TypeError|SyntaxError|TS\d{3,})\b/i;
const LOCATION = /(?:[\w./\\-]+\.[a-z0-9]+:\d+|\bat\s+.+:\d+:\d+)/i;

function selectStream(text: string, stream: ExecExcerpt["stream"], failed: boolean, budget: number): ExecExcerpt | undefined {
  if (!text.trim() || budget < 24) return undefined;
  const lines = text.split("\n").map(line => line.endsWith("\r") ? line.slice(0, -1) : line);
  let anchor = lines.length - 1;
  while (anchor > 0 && (!lines[anchor].trim() || /^\[truncated: (stdout|stderr) cap reached\]$/.test(lines[anchor]))) anchor--;
  let best = 0;
  if (failed) {
    for (let i = 0; i < lines.length; i++) {
      const score = (ERROR.test(lines[i]) ? 2 : 0) + (LOCATION.test(lines[i]) ? 1 : 0);
      if (score > best) { best = score; anchor = i; }
    }
  }
  // Reserve the compact coordinate label before selecting neighboring original
  // lines. Never spend the budget on preceding noise while omitting the anchor.
  const bodyBudget = Math.max(0, budget - 35);
  if (bodyBudget === 0) return undefined;
  const line = lines[anchor];
  if (line.length > bodyBudget) {
    const position = failed ? (LOCATION.exec(line)?.index ?? ERROR.exec(line)?.index ?? 0) : Math.max(0, line.length - bodyBudget);
    let start = Math.max(0, Math.min(line.length - bodyBudget, position - 24));
    if (/[\uDC00-\uDFFF]/.test(line[start] ?? "")) start++;
    const piece = sliceExecText(line.slice(start), bodyBudget);
    return { stream, start_line: anchor + 1, end_line: anchor + 1, text: piece, partial_line: true, start_column: start + 1, end_column: start + piece.length };
  }
  let start = anchor, end = anchor, length = line.length;
  for (let distance = 1; distance <= 2; distance++) {
    if (start === anchor - distance + 1 && anchor - distance >= 0 && length + lines[anchor - distance].length + 1 <= bodyBudget) {
      start--; length += lines[start].length + 1;
    }
    if (end === anchor + distance - 1 && anchor + distance < lines.length && length + lines[anchor + distance].length + 1 <= bodyBudget) {
      end++; length += lines[end].length + 1;
    }
  }
  return { stream, start_line: start + 1, end_line: end + 1, text: lines.slice(start, end + 1).join("\n") };
}

export function excerptLabel(excerpt: ExecExcerpt): string {
  return `${excerpt.stream}:L${excerpt.start_line}-${excerpt.end_line}${excerpt.partial_line ? ` C${excerpt.start_column}-${excerpt.end_column} partial` : ""}`;
}

/** One bounded, non-overlapping representative window per retained stream. */
export function selectExecEvidence(stdout: string, stderr: string, failed: boolean, maxChars: number): { digest: string; excerpts: ExecExcerpt[]; output_truncated: boolean } {
  const budget = Math.max(0, Math.min(4000, Math.floor(maxChars)));
  const streams: Array<[ExecExcerpt["stream"], string]> = failed ? [["stderr", stderr], ["stdout", stdout]] : [["stdout", stdout], ["stderr", stderr]];
  const nonempty = streams.filter(([, text]) => text.trim());
  if (!nonempty.length) return { digest: sliceExecText("[no output]", budget), excerpts: [], output_truncated: false };
  const excerpts: ExecExcerpt[] = [];
  let remaining = budget;
  for (let i = 0; i < nonempty.length; i++) {
    const [stream, text] = nonempty[i];
    const allowance = Math.floor(remaining / (nonempty.length - i));
    const excerpt = selectStream(text, stream, failed, allowance);
    if (!excerpt) continue;
    const cost = excerptLabel(excerpt).length + 1 + excerpt.text.length + (excerpts.length ? 1 : 0);
    if (cost > remaining) continue;
    excerpts.push(excerpt); remaining -= cost;
  }
  const digest = excerpts.map(e => `${excerptLabel(e)}\n${e.text}`).join("\n");
  // This is selected evidence, not a claim that all emitted/stored text is shown.
  const shown = excerpts.reduce((n, e) => n + e.text.length, 0);
  return { digest, excerpts, output_truncated: shown < stdout.length + stderr.length };
}
