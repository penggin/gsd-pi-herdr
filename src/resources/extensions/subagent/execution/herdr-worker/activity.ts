import { parseJsonlRecord } from "./jsonl.js";
import type { HerdrWorkerActivityV1, HerdrWorkerStatus } from "./artifacts.js";

const MAX_ACTIVITY_LABEL_CHARS = 180;
const MAX_ARG_VALUE_CHARS = 120;

export interface HerdrWorkerProjectedActivity {
  activity: HerdrWorkerActivityV1;
  display: string;
  status?: HerdrWorkerStatus;
}

export interface HerdrWorkerActivityRendererOptions {
  write?: (text: string) => void;
  now?: () => Date;
}

export class HerdrWorkerActivityRenderer {
  private readonly write: (text: string) => void;
  private readonly now: () => Date;

  constructor(options: HerdrWorkerActivityRendererOptions = {}) {
    this.write = options.write ?? ((text) => process.stdout.write(text));
    this.now = options.now ?? (() => new Date());
  }

  consumeLine(line: string): HerdrWorkerProjectedActivity | undefined {
    const record = parseJsonlRecord(line);
    if (!record) return undefined;
    const projection = projectHerdrWorkerActivity(record);
    if (!projection) return undefined;
    const timestamp = this.now().toISOString().slice(11, 19);
    this.write(`[${timestamp}] ${projection.display}\n`);
    return projection;
  }
}

export function projectHerdrWorkerActivity(
  event: Record<string, unknown>,
): HerdrWorkerProjectedActivity | undefined {
  const type = typeof event.type === "string" ? event.type : "";
  switch (type) {
    case "agent_start":
      return projection("status", "agent started", "working", "working");
    case "agent_end":
      return projection("status", "agent turn settled", "turn settled");
    case "tool_execution_start": {
      const toolName = bounded(redactSensitiveText(stringValue(event.toolName) || "tool"), 48);
      const summary = summarizeToolArgs(event.args);
      const label = summary ? `${toolName} ${summary}` : toolName;
      return projection("tool", label, `→ ${label}`);
    }
    case "tool_execution_end": {
      const toolName = bounded(redactSensitiveText(stringValue(event.toolName) || "tool"), 48);
      const failed = event.isError === true;
      return projection(failed ? "error" : "tool", `${toolName} ${failed ? "failed" : "done"}`, `${failed ? "✗" : "✓"} ${toolName}`);
    }
    case "message_end": {
      const message = recordValue(event.message);
      if (!message || message.role !== "assistant") return undefined;
      if (message.stopReason === "error") {
        const error = bounded(redactSensitiveText(stringValue(message.errorMessage) || "assistant error"));
        return projection("error", error, `! ${error}`);
      }
      if (message.stopReason === "aborted") return projection("status", "assistant aborted", "assistant aborted");
      return undefined;
    }
    case "auto_retry_start": {
      const attempt = numberValue(event.attempt);
      const label = attempt ? `retry attempt ${attempt}` : "retrying";
      return projection("retry", label, `↻ ${label}`, "retrying");
    }
    case "auto_retry_end":
      return projection(
        event.success === false ? "error" : "retry",
        event.success === false ? "retry failed" : "retry recovered",
        event.success === false ? "✗ retry failed" : "✓ retry recovered",
        event.success === false ? "retrying" : "working",
      );
    // Streaming/token and tool-result updates are intentionally not projected.
    case "message_start":
    case "message_update":
    case "tool_execution_update":
    case "tool_result_end":
    case "turn_start":
    case "turn_end":
    case "session":
      return undefined;
    default:
      return undefined;
  }
}

export function redactSensitiveText(value: string): string {
  let output = value;
  output = output.replace(/(authorization\s*[:=]\s*(?:bearer\s+)?)[^\s,;]+/gi, "$1[REDACTED]");
  output = output.replace(/\b([A-Z0-9_]*(?:API[_-]?KEY|TOKEN|PASSWORD|PASSWD|SECRET|AUTH)[A-Z0-9_]*)\s*=\s*([^\s,;]+)/gi, "$1=[REDACTED]");
  output = output.replace(/([?&](?:api[_-]?key|token|password|secret|auth)=)[^&#\s]+/gi, "$1[REDACTED]");
  return output;
}

function summarizeToolArgs(value: unknown): string {
  const args = recordValue(value);
  if (!args) return "";
  const preferredKeys = ["command", "path", "file_path", "filePath", "query", "pattern", "url"];
  for (const key of preferredKeys) {
    const item = args[key];
    if (typeof item === "string" && item.trim()) {
      return bounded(redactSensitiveText(singleLine(item)), MAX_ARG_VALUE_CHARS);
    }
  }
  return "";
}

function projection(
  kind: HerdrWorkerActivityV1["kind"],
  label: string,
  display: string,
  status?: HerdrWorkerStatus,
): HerdrWorkerProjectedActivity {
  const safeLabel = bounded(redactSensitiveText(singleLine(label)));
  return {
    activity: { kind, label: safeLabel },
    display: bounded(redactSensitiveText(singleLine(display))),
    ...(status ? { status } : {}),
  };
}

function bounded(value: string, max = MAX_ACTIVITY_LABEL_CHARS): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}

function singleLine(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
