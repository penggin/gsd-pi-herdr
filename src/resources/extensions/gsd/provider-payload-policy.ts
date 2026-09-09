/**
 * Provider Payload Policy - ordered shaping of provider request payloads.
 *
 * The order is intentional:
 * 1. superseded GSD context injections (memory/guided/forensics) are removed,
 *    keeping only the latest, for every mode,
 * 2. observation budgeting masks old tool results in auto-mode,
 * 3. display truncation caps tool-result text for every mode,
 * 4. the protected Source Context Block is appended after truncation,
 * 5. supported models receive the configured service tier.
 */

import type { ContextManagementConfig } from "./preferences-types.js";
import type { ServiceTierSetting } from "./service-tier.js";

import {
  createObservationMask,
  createResponsesInputObservationMask,
  filterSupersededContextInjections,
  filterSupersededResponsesContextInjections,
  truncateContextResultMessages,
  truncateResponsesInputResultItems,
} from "./context-masker.js";
import { getSourceObservationStore, isAutoActive } from "./auto-runtime-state.js";
import { loadEffectiveGSDPreferences } from "./preferences.js";
import { getEffectiveServiceTier, supportsServiceTier } from "./service-tier.js";
import { injectSourceContextBlockIntoPayload } from "./source-observations.js";
import { budgetNativeExecResult } from "./exec-result-provenance.js";
import { DEFAULT_TOOL_RESULT_MAX_CHARS } from "./tools/exec-result-budget.js";

const DEFAULT_OBSERVATION_MASK_TURNS = 8;

type MessagePayload = Parameters<ReturnType<typeof createObservationMask>>[0];
type ResponsesInputPayload = Parameters<ReturnType<typeof createResponsesInputObservationMask>>[0];

export interface ProviderPayloadPolicyDeps {
  isAutoActive(): boolean;
  loadContextManagementConfig(): ContextManagementConfig | undefined;
  renderSourceContextBlock(): string | null;
  getEffectiveServiceTier(): ServiceTierSetting;
  supportsServiceTier(modelId: string): boolean;
}

export interface ProviderPayloadPolicyInput {
  payload: Record<string, unknown>;
  modelId?: string;
  sessionId?: string;
  deps?: Partial<ProviderPayloadPolicyDeps>;
}

export const DEFAULT_PROVIDER_PAYLOAD_POLICY_DEPS: ProviderPayloadPolicyDeps = {
  isAutoActive,
  loadContextManagementConfig: () => loadEffectiveGSDPreferences()?.preferences.context_management,
  renderSourceContextBlock: () => getSourceObservationStore().renderActiveBlock(),
  getEffectiveServiceTier,
  supportsServiceTier,
};

export function applyProviderPayloadPolicy({
  payload,
  modelId,
  sessionId,
  deps: overrides,
}: ProviderPayloadPolicyInput): Record<string, unknown> {
  const deps = { ...DEFAULT_PROVIDER_PAYLOAD_POLICY_DEPS, ...overrides };

  try {
    applyContextManagement(payload, deps, sessionId);
  } catch {
    // Provider payload shaping should not block a request when optional
    // context management preferences or adapters fail.
  }

  try {
    applySourceContextBlock(payload, deps);
  } catch {
    // Source observations are opportunistic; execution can continue without
    // an injected block.
  }

  applyServiceTier(payload, modelId, deps);
  return payload;
}

function applyContextManagement(
  payload: Record<string, unknown>,
  deps: ProviderPayloadPolicyDeps,
  sessionId?: string,
): void {
  const config = deps.loadContextManagementConfig();
  applyContextInjectionFilter(payload);
  applyObservationBudget(payload, config, deps.isAutoActive());
  applyDisplayTruncation(payload, config, sessionId);
}

function applyContextInjectionFilter(payload: Record<string, unknown>): void {
  if (Array.isArray(payload.messages)) {
    payload.messages = filterSupersededContextInjections(payload.messages as MessagePayload);
  }
  if (Array.isArray(payload.input)) {
    payload.input = filterSupersededResponsesContextInjections(payload.input as ResponsesInputPayload);
  }
}

function applyObservationBudget(
  payload: Record<string, unknown>,
  config: ContextManagementConfig | undefined,
  autoActive: boolean,
): void {
  if (!autoActive || config?.observation_masking === false) return;

  const keepTurns = config?.observation_mask_turns ?? DEFAULT_OBSERVATION_MASK_TURNS;
  if (Array.isArray(payload.messages)) {
    payload.messages = createObservationMask(keepTurns)(payload.messages as MessagePayload);
  }
  if (Array.isArray(payload.input)) {
    payload.input = createResponsesInputObservationMask(keepTurns)(payload.input as ResponsesInputPayload);
  }
}

function applyDisplayTruncation(
  payload: Record<string, unknown>,
  config: ContextManagementConfig | undefined,
  sessionId?: string,
): void {
  const maxChars = config?.tool_result_max_chars ?? DEFAULT_TOOL_RESULT_MAX_CHARS;

  // Wire conversions discard details. Authenticate native results through the
  // out-of-band session/call/exact-content record instead; colliding wire calls
  // are ineligible even if a converter shortened their originally distinct IDs.
  const calls = new Map<string, { name: string; count: number }>();
  const recordCall = (id: unknown, name: unknown) => {
    if (typeof id !== "string" || typeof name !== "string") return;
    calls.set(id, { name, count: (calls.get(id)?.count ?? 0) + 1 });
  };
  if (Array.isArray(payload.messages)) for (const message of payload.messages) {
    if (message?.role !== "assistant") continue;
    if (Array.isArray(message.tool_calls)) for (const call of message.tool_calls) recordCall(call?.id, call?.function?.name);
    if (Array.isArray(message.content)) for (const block of message.content) {
      if (block?.type === "tool_use" || block?.type === "toolCall") recordCall(block.id, block.name);
    }
  }
  if (Array.isArray(payload.input)) for (const item of payload.input) {
    if (item?.type === "function_call") recordCall(item.call_id, item.name);
  }
  const nativeBudget = (toolCallId: unknown, toolName: unknown, text: string) => {
    const call = typeof toolCallId === "string" ? calls.get(toolCallId) : undefined;
    if (!call || call.count !== 1 || (typeof toolName === "string" && toolName !== call.name)) return undefined;
    try {
      return budgetNativeExecResult({ sessionId, toolCallId, toolName: call.name, text, config });
    } catch {
      // Damaged/unrecognized native provenance must fall back to the ordinary
      // cap, not escape all truncation through the outer optional-policy catch.
      return undefined;
    }
  };

  if (Array.isArray(payload.messages)) {
    payload.messages = truncateContextResultMessages(payload.messages as MessagePayload, maxChars, nativeBudget);
  }
  if (Array.isArray(payload.input)) {
    payload.input = truncateResponsesInputResultItems(payload.input as ResponsesInputPayload, maxChars, nativeBudget);
  }
}

function applySourceContextBlock(
  payload: Record<string, unknown>,
  deps: ProviderPayloadPolicyDeps,
): void {
  if (!deps.isAutoActive()) return;

  const sourceContextBlock = deps.renderSourceContextBlock();
  if (!sourceContextBlock) return;

  Object.assign(payload, injectSourceContextBlockIntoPayload(payload, sourceContextBlock));
}

function applyServiceTier(
  payload: Record<string, unknown>,
  modelId: string | undefined,
  deps: ProviderPayloadPolicyDeps,
): void {
  if (!modelId) return;

  const tier = deps.getEffectiveServiceTier();
  if (!tier || !deps.supportsServiceTier(modelId)) return;

  payload.service_tier = tier;
}
