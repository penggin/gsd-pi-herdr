import { isDeepStrictEqual } from "node:util";
import { GSD_CONTEXT_MESSAGE_SENTINEL } from "./constants.js";

/**
 * Observation masking for GSD auto-mode sessions.
 *
 * Replaces tool result content older than N turns with a placeholder.
 * Reduces context bloat between compactions with zero LLM overhead.
 * Preserves message ordering, roles, and all assistant/user messages.
 *
 * Operates on provider payloads after convertToLlm:
 *
 * pi-ai Message[] payloads:
 *   - toolResult messages: { role: "toolResult", content: TextContent[] }
 *   - bash results are already converted to: { role: "user", content: [{type:"text",text:"..."}] }
 *     and start with "Ran `" from bashExecutionToText.
 *
 * OpenAI/Codex Responses payloads:
 *   - conversation items live in `input`, not `messages`
 *   - tool results are { type: "function_call_output", output: string | content[] }
 *   - bash results are user items with input_text content starting with "Ran `"
 */

interface MaskableMessage {
  role: string;
  content: unknown;
  type?: string;
  [key: string]: unknown;
}

const MASK_PLACEHOLDER = "[result masked — within summarized history]";
const MASK_CONTENT_BLOCK = [{ type: "text" as const, text: MASK_PLACEHOLDER }];
const RESPONSES_MASK_CONTENT_BLOCK = [{ type: "input_text" as const, text: MASK_PLACEHOLDER }];
const TRUNCATION_MARKER = "\n…[truncated]";

type TextLikeBlock = {
  type?: string;
  text?: unknown;
  [key: string]: unknown;
};

interface ResponsesInputItem {
  role?: string;
  type?: string;
  content?: unknown;
  output?: unknown;
  [key: string]: unknown;
}

function isTextLikeBlock(block: unknown): block is TextLikeBlock {
  return Boolean(block && typeof block === "object" && "text" in block);
}

function firstTextFromContent(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const first = content.find(isTextLikeBlock);
  return typeof first?.text === "string" ? first.text : undefined;
}

function isBashResultText(text: string | undefined): boolean {
  return typeof text === "string" && text.startsWith("Ran `");
}

function findTurnBoundary(messages: MaskableMessage[], keepRecentTurns: number): number {
  let turnsSeen = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    // In the LLM payload, genuine user turns have role "user".
    // Tool results have role "toolResult" and are excluded by this check.
    if (m.role === "user") {
      // Skip bash-result user messages (converted from bashExecution) — these aren't real user turns
      if (isBashResultUserMessage(m)) continue;
      turnsSeen++;
      if (turnsSeen >= keepRecentTurns) return i;
    }
  }
  return 0;
}

function countRealUserTurns(messages: MaskableMessage[]): number {
  let count = 0;
  for (const m of messages) {
    if (m.role === "user" && !isBashResultUserMessage(m)) count++;
  }
  return count;
}

/**
 * Quantizes how many recent turns stay unmasked so the boundary only moves
 * forward once per full block of `keepRecentTurns` new turns, instead of
 * every turn. Keeps the masked prefix byte-stable within a block, which is
 * what lets the LLM provider's prompt cache survive across turns.
 */
function quantizedKeepTurns(totalTurns: number, keepRecentTurns: number): number {
  if (keepRecentTurns <= 0 || totalTurns < 2 * keepRecentTurns) return totalTurns;
  const maskedTurns = Math.floor((totalTurns - keepRecentTurns) / keepRecentTurns) * keepRecentTurns;
  return totalTurns - maskedTurns;
}

/**
 * Detect user messages that originated from bashExecution.
 * After convertToLlm, these are {role: "user", content: [{type:"text", text:"Ran `cmd`\n..."}]}.
 * The bashExecutionToText format always starts with "Ran `".
 */
function isBashResultUserMessage(m: MaskableMessage): boolean {
  if (m.role !== "user") return false;
  return isBashResultText(firstTextFromContent(m.content));
}

function isMaskableMessage(m: MaskableMessage): boolean {
  // Tool result messages (role: "toolResult" in pi-ai format)
  if (m.role === "toolResult") return true;
  // Bash-result user messages (converted from bashExecution by convertToLlm)
  if (isBashResultUserMessage(m)) return true;
  return false;
}

export function createObservationMask(keepRecentTurns: number = 8) {
  return (messages: MaskableMessage[]): MaskableMessage[] => {
    const totalTurns = countRealUserTurns(messages);
    const boundary = findTurnBoundary(messages, quantizedKeepTurns(totalTurns, keepRecentTurns));
    if (boundary === 0) return messages;

    return messages.map((m, i) => {
      if (i >= boundary) return m;
      if (isMaskableMessage(m)) {
        // Content may be string or array of content blocks — always replace with array
        return { ...m, content: MASK_CONTENT_BLOCK };
      }
      return m;
    });
  };
}

function isResponsesBashResultUserItem(item: ResponsesInputItem): boolean {
  if (item.role !== "user") return false;
  return isBashResultText(firstTextFromContent(item.content));
}

function findResponsesTurnBoundary(items: ResponsesInputItem[], keepRecentTurns: number): number {
  let turnsSeen = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.role === "user" && !isResponsesBashResultUserItem(item)) {
      turnsSeen++;
      if (turnsSeen >= keepRecentTurns) return i;
    }
  }
  return 0;
}

function countResponsesRealUserTurns(items: ResponsesInputItem[]): number {
  let count = 0;
  for (const item of items) {
    if (item.role === "user" && !isResponsesBashResultUserItem(item)) count++;
  }
  return count;
}

/**
 * Observation masking for OpenAI/Codex Responses API payloads.
 *
 * Responses payloads store the conversation under `input` instead of
 * `messages`, with tool results as `function_call_output` items. Keep this
 * separate from createObservationMask so each payload shape stays explicit.
 */
export function createResponsesInputObservationMask(keepRecentTurns: number = 8) {
  return (items: ResponsesInputItem[]): ResponsesInputItem[] => {
    const totalTurns = countResponsesRealUserTurns(items);
    const boundary = findResponsesTurnBoundary(items, quantizedKeepTurns(totalTurns, keepRecentTurns));
    if (boundary === 0) return items;

    return items.map((item, i) => {
      if (i >= boundary) return item;
      if (item.type === "function_call_output") {
        return { ...item, output: MASK_PLACEHOLDER };
      }
      if (isResponsesBashResultUserItem(item)) {
        return { ...item, content: RESPONSES_MASK_CONTENT_BLOCK };
      }
      return item;
    });
  };
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + TRUNCATION_MARKER;
}

function truncateTextBlocks(content: unknown, maxChars: number): unknown {
  if (typeof content === "string") {
    return truncateText(content, maxChars);
  }
  if (!Array.isArray(content)) return content;

  let remaining = maxChars;
  let didTruncate = false;
  const nextBlocks: unknown[] = [];

  for (const block of content) {
    if (!isTextLikeBlock(block) || typeof block.text !== "string") {
      nextBlocks.push(block);
      continue;
    }

    if (remaining <= 0) {
      didTruncate = true;
      continue;
    }

    const text = block.text;
    if (text.length <= remaining) {
      nextBlocks.push(block);
      remaining -= text.length;
      continue;
    }

    nextBlocks.push({ ...block, text: truncateText(text, remaining) });
    remaining = 0;
    didTruncate = true;
  }

  return didTruncate ? nextBlocks : content;
}

function normalizedMaxChars(maxChars: number): number {
  return Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : 800;
}

export type NativeResultBudgeter = (toolCallId: unknown, toolName: unknown, text: string) => string | undefined;

function budgetResultContent(content: unknown, maxChars: number, callId: unknown, name: unknown, nativeBudget?: NativeResultBudgeter): unknown {
  // Native execution producers deliberately emit exactly one text block. Never
  // let a matching first block bless appended, unbounded external content.
  if (typeof content === "string") return nativeBudget?.(callId, name, content) ?? truncateTextBlocks(content, maxChars);
  if (Array.isArray(content) && content.length === 1 && isTextLikeBlock(content[0]) && typeof content[0].text === "string") {
    const text = nativeBudget?.(callId, name, content[0].text);
    if (text !== undefined) return text === content[0].text ? content : [{ ...content[0], text }];
  }
  return truncateTextBlocks(content, maxChars);
}

export function truncateContextResultMessages(messages: MaskableMessage[], maxChars: number = 800, nativeBudget?: NativeResultBudgeter): MaskableMessage[] {
  const limit = normalizedMaxChars(maxChars);
  return messages.map((message) => {
    // Anthropic nests tool_result blocks in user messages. Do not truncate
    // ordinary user text or change the existing observation-mask boundaries.
    if (message.role === "user" && Array.isArray(message.content) && message.content.some((block) => block?.type === "tool_result")) {
      const content = message.content.map((block) => block?.type === "tool_result"
        ? { ...block, content: budgetResultContent(block.content, limit, block.tool_use_id, undefined, nativeBudget) }
        : block);
      return { ...message, content };
    }
    if (!isMaskableMessage(message) && message.role !== "tool") return message;
    const content = message.role === "tool" || message.role === "toolResult"
      ? budgetResultContent(message.content, limit, message.tool_call_id ?? message.toolCallId, message.name ?? message.toolName, nativeBudget)
      : truncateTextBlocks(message.content, limit);
    return content === message.content ? message : { ...message, content };
  });
}

export function truncateResponsesInputResultItems(items: ResponsesInputItem[], maxChars: number = 800, nativeBudget?: NativeResultBudgeter): ResponsesInputItem[] {
  const limit = normalizedMaxChars(maxChars);
  return items.map((item) => {
    if (item.type === "function_call_output") {
      const output = budgetResultContent(item.output, limit, item.call_id, undefined, nativeBudget);
      return output === item.output ? item : { ...item, output };
    }
    if (isResponsesBashResultUserItem(item)) {
      const content = truncateTextBlocks(item.content, limit);
      return content === item.content ? item : { ...item, content };
    }
    return item;
  });
}

// GSD injects at most one context message per turn (memory/guided/forensics —
// see buildContextMessage in bootstrap/system-context.ts), marked with
// GSD_CONTEXT_MESSAGE_SENTINEL. convertToLlm strips the distinguishing
// customType before the payload reaches this hook, so detection is by content
// prefix instead. Pre-sentinel session history lacks the sentinel, so we also
// match the stable *bracketed* GSD block labels those injections begin with,
// letting resumed sessions dedupe older memory/guided blocks.
//
// Only GSD-specific bracketed markers belong here — never generic prose. A
// message is dropped from the payload when it matches, so a natural-language
// prefix (e.g. the forensics prompt "Debug GSD itself.") could silently delete
// a real user message that happens to start the same way. Legacy forensics
// injections without memory are therefore left un-deduped by design; those
// with memory still match via the "[GSD Context Metadata]" wrapper.
const LEGACY_GSD_CONTEXT_INJECTION_PREFIXES = [
  "[GSD Context Metadata]",
  "[MEMORY — Critical and prompt-relevant memories from the GSD memory store]",
  "[GSD Guided Execute Context]",
] as const;

export function isGsdContextInjectionText(text: string | undefined): boolean {
  if (typeof text !== "string") return false;
  if (text.startsWith(GSD_CONTEXT_MESSAGE_SENTINEL)) return true;
  return LEGACY_GSD_CONTEXT_INJECTION_PREFIXES.some((prefix) => text.startsWith(prefix));
}

function isGsdContextInjectionMessage(m: MaskableMessage): boolean {
  if (m.role !== "user") return false;
  return isGsdContextInjectionText(firstTextFromContent(m.content));
}

/**
 * Keep the latest context, reusing the earliest item in its consecutive run
 * of identical injections. Repeated unchanged context then keeps its original
 * prefix position, while changed context (including A -> B -> A) still wins.
 * Compare the entire item so extra blocks, images and metadata are not lost.
 * Stored history is never mutated, only the outgoing payload array.
 */
export function filterSupersededContextInjections(messages: MaskableMessage[]): MaskableMessage[] {
  return filterSupersededInjections(messages, isGsdContextInjectionMessage);
}

function filterSupersededInjections<T>(items: T[], isInjection: (item: T) => boolean): T[] {
  let retainedIndex = -1;
  for (let index = items.length - 1; index >= 0; index--) {
    if (!isInjection(items[index])) continue;
    if (retainedIndex !== -1 && !isDeepStrictEqual(items[index], items[retainedIndex])) break;
    retainedIndex = index;
  }
  if (retainedIndex === -1) return items;
  return items.filter((item, index) => index === retainedIndex || !isInjection(item));
}

function isResponsesGsdContextInjectionItem(item: ResponsesInputItem): boolean {
  if (item.role !== "user") return false;
  return isGsdContextInjectionText(firstTextFromContent(item.content));
}

export function filterSupersededResponsesContextInjections(
  items: ResponsesInputItem[],
): ResponsesInputItem[] {
  return filterSupersededInjections(items, isResponsesGsdContextInjectionItem);
}
