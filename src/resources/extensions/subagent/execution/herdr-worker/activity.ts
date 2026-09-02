import { parseJsonlRecord } from "./jsonl.js";
import type { HerdrWorkerActivityV1, HerdrWorkerStatus } from "./artifacts.js";
import { describeHerdrInteractiveInput } from "../../../herdr/interactive-input.js";

const MAX_ACTIVITY_LABEL_CHARS = 180;
const MAX_ARG_VALUE_CHARS = 120;
const MAX_MODEL_OUTPUT_LINE_CHARS = 152;
const MAX_MODEL_OUTPUT_CHARS_PER_KIND = 16_000;

type ModelOutputKind = "thinking" | "assistant";

interface ModelOutputBuffer {
  text: string;
  acceptedChars: number;
  sawDeltaInBlock: boolean;
  truncated: boolean;
  truncationReported: boolean;
}

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
  private readonly pendingInteractiveInputs = new Map<string, string>();
  private readonly modelOutput: Record<ModelOutputKind, ModelOutputBuffer> = {
    thinking: newModelOutputBuffer(),
    assistant: newModelOutputBuffer(),
  };
  private activeModelOutputKind: ModelOutputKind | undefined;

  constructor(options: HerdrWorkerActivityRendererOptions = {}) {
    this.write = options.write ?? ((text) => process.stdout.write(text));
    this.now = options.now ?? (() => new Date());
  }

  consumeLine(line: string): HerdrWorkerProjectedActivity | undefined {
    const record = parseJsonlRecord(line);
    if (!record) return undefined;
    if (record.type === "message_start" && recordValue(record.message)?.role === "assistant") {
      const stale = this.flushAllModelOutput();
      this.resetModelOutput();
      this.writeProjected(stale);
      return stale.at(-1);
    }
    if (record.type === "message_update") {
      const streamed = this.consumeModelOutput(record.assistantMessageEvent);
      this.writeProjected(streamed);
      return streamed.at(-1);
    }

    const projections = shouldFlushModelOutput(record.type)
      ? this.flushAllModelOutput()
      : [];
    let projection = projectHerdrWorkerActivity(record);
    const descriptor = describeHerdrInteractiveInput(stringValue(record.toolName), record.args);
    const toolCallId = stringValue(record.toolCallId) || stringValue(record.id);
    if (projection && descriptor && toolCallId) {
      if (record.type === "tool_execution_start") {
        this.pendingInteractiveInputs.set(toolCallId, descriptor.waitingMessage);
      } else if (record.type === "tool_execution_end") {
        this.pendingInteractiveInputs.delete(toolCallId);
        const remaining = lastMapValue(this.pendingInteractiveInputs);
        if (remaining) {
          projection = projectionWithStatus("blocked", remaining, `? ${remaining}`);
        }
      }
    }
    if (projection) projections.push(projection);
    this.writeProjected(projections);
    if (record.type === "message_end" || record.type === "agent_end") this.resetModelOutput();
    return projections.at(-1);
  }

  private consumeModelOutput(value: unknown): HerdrWorkerProjectedActivity[] {
    const event = recordValue(value);
    const eventType = stringValue(event?.type);
    const kind = modelOutputKind(eventType);
    if (!event || !eventType || !kind) return [];

    const projections: HerdrWorkerProjectedActivity[] = [];
    if (eventType.endsWith("_start")) {
      if (this.activeModelOutputKind && this.activeModelOutputKind !== kind) {
        projections.push(...this.flushModelOutput(this.activeModelOutputKind, true));
      }
      projections.push(...this.flushModelOutput(kind, true));
      this.modelOutput[kind].sawDeltaInBlock = false;
      this.activeModelOutputKind = kind;
      return projections;
    }

    if (this.activeModelOutputKind && this.activeModelOutputKind !== kind) {
      projections.push(...this.flushModelOutput(this.activeModelOutputKind, true));
    }
    this.activeModelOutputKind = kind;
    const state = this.modelOutput[kind];
    if (eventType.endsWith("_delta")) {
      state.sawDeltaInBlock = true;
      this.appendModelOutput(kind, stringValue(event.delta) ?? stringValue(event.text) ?? "");
      projections.push(...this.flushModelOutput(kind, false));
      return projections;
    }

    if (!state.sawDeltaInBlock) {
      this.appendModelOutput(kind, stringValue(event.content) ?? "");
    }
    projections.push(...this.flushModelOutput(kind, true));
    this.activeModelOutputKind = undefined;
    return projections;
  }

  private appendModelOutput(kind: ModelOutputKind, value: string): void {
    if (!value) return;
    const state = this.modelOutput[kind];
    const remaining = MAX_MODEL_OUTPUT_CHARS_PER_KIND - state.acceptedChars;
    if (remaining <= 0) {
      state.truncated = true;
      return;
    }
    const accepted = value.slice(0, remaining);
    state.text += accepted;
    state.acceptedChars += accepted.length;
    if (accepted.length < value.length) state.truncated = true;
  }

  private flushAllModelOutput(): HerdrWorkerProjectedActivity[] {
    const projections = [
      ...this.flushModelOutput("thinking", true),
      ...this.flushModelOutput("assistant", true),
    ];
    this.activeModelOutputKind = undefined;
    return projections;
  }

  private flushModelOutput(kind: ModelOutputKind, force: boolean): HerdrWorkerProjectedActivity[] {
    const state = this.modelOutput[kind];
    const projections: HerdrWorkerProjectedActivity[] = [];
    let flushText = "";
    if (force) {
      flushText = state.text;
      state.text = "";
    } else {
      const newline = state.text.lastIndexOf("\n");
      if (newline >= 0) {
        flushText = state.text.slice(0, newline + 1);
        state.text = state.text.slice(newline + 1);
      }
    }
    for (const line of flushText.split(/\r?\n/)) {
      projections.push(...modelOutputProjections(kind, line));
    }
    if (force && state.truncated && !state.truncationReported) {
      state.truncationReported = true;
      projections.push(projection(
        "status",
        `${kind} output truncated after ${MAX_MODEL_OUTPUT_CHARS_PER_KIND} characters`,
        `… ${kind} output truncated after ${MAX_MODEL_OUTPUT_CHARS_PER_KIND} characters`,
      ));
    }
    return projections;
  }

  private resetModelOutput(): void {
    this.modelOutput.thinking = newModelOutputBuffer();
    this.modelOutput.assistant = newModelOutputBuffer();
    this.activeModelOutputKind = undefined;
  }

  private writeProjected(projections: readonly HerdrWorkerProjectedActivity[]): void {
    for (const projection of projections) {
      const timestamp = this.now().toISOString().slice(11, 19);
      this.write(`[${timestamp}] ${projection.display}\n`);
    }
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
      const interactive = describeHerdrInteractiveInput(stringValue(event.toolName), event.args);
      if (interactive) {
        return projection("status", interactive.waitingMessage, interactive.waitingDisplay, "blocked");
      }
      const toolName = bounded(redactSensitiveText(stringValue(event.toolName) || "tool"), 48);
      const summary = summarizeToolArgs(event.args);
      const label = summary ? `${toolName} ${summary}` : toolName;
      return projection("tool", label, `→ ${label}`);
    }
    case "tool_execution_end": {
      const interactive = describeHerdrInteractiveInput(stringValue(event.toolName));
      if (interactive) {
        return projection("status", interactive.settledMessage, interactive.settledDisplay, "working");
      }
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
    // The stateful renderer coalesces assistant/thinking deltas into bounded
    // human-readable lines. This pure projector must never dump a raw delta.
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

function projectionWithStatus(
  status: HerdrWorkerStatus,
  label: string,
  display: string,
): HerdrWorkerProjectedActivity {
  return {
    activity: { kind: "status", label: bounded(redactSensitiveText(singleLine(label))) },
    display: bounded(redactSensitiveText(singleLine(display))),
    status,
  };
}

function bounded(value: string, max = MAX_ACTIVITY_LABEL_CHARS): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}

function singleLine(value: string): string {
  return value
    .replace(/\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\)?)/g, "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function shouldFlushModelOutput(type: unknown): boolean {
  return type === "tool_execution_start"
    || type === "message_end"
    || type === "turn_end"
    || type === "agent_end";
}

function modelOutputKind(type: string | undefined): ModelOutputKind | undefined {
  if (type === "thinking_start" || type === "thinking_delta" || type === "thinking_end") return "thinking";
  if (type === "text_start" || type === "text_delta" || type === "text_end") return "assistant";
  return undefined;
}

function modelOutputProjections(
  kind: ModelOutputKind,
  value: string,
): HerdrWorkerProjectedActivity[] {
  const safe = redactSensitiveText(singleLine(value));
  if (!safe) return [];
  const prefix = kind === "thinking" ? "◇ thinking:" : "› assistant:";
  return wrapBounded(safe, MAX_MODEL_OUTPUT_LINE_CHARS).map((chunk) => projection(
    "status",
    `${kind}: ${chunk}`,
    `${prefix} ${chunk}`,
  ));
}

function wrapBounded(value: string, max: number): string[] {
  const chunks: string[] = [];
  let remaining = value;
  while (remaining.length > max) {
    const candidate = remaining.slice(0, max + 1);
    const whitespace = candidate.lastIndexOf(" ");
    const splitAt = whitespace > Math.floor(max / 2) ? whitespace : max;
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function newModelOutputBuffer(): ModelOutputBuffer {
  return {
    text: "",
    acceptedChars: 0,
    sawDeltaInBlock: false,
    truncated: false,
    truncationReported: false,
  };
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

function lastMapValue<K, V>(values: ReadonlyMap<K, V>): V | undefined {
  let result: V | undefined;
  for (const value of values.values()) result = value;
  return result;
}
