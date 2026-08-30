// Codex Remote Compaction V2 integration for GSD.
// Protocol/checkpoint mechanics are derived from @narumitw/pi-codex-compact
// under the MIT license in LICENSE.narumitw.

import type { AgentMessage } from "@gsd/pi-agent-core";
import type { Api, Context, Model, Tool } from "@gsd/pi-ai";
import {
  buildSessionContext,
  convertToLlm,
  type ExtensionAPI,
  type ExtensionContext,
  type SessionBeforeCompactEvent,
  type SessionEntry,
} from "@gsd/pi-coding-agent";
import {
  createBranchSummaryMessage,
  createCustomMessage,
} from "@gsd/pi-coding-agent/core/messages.js";
import type { CodexRemoteCompactionConfig } from "../preferences-types.js";
import { loadEffectiveGSDPreferences } from "../preferences.js";
import {
  buildReplacementHistory,
  type CodexCheckpointDetails,
  checkpointMarker,
  createCheckpointDetails,
  fallbackSummary,
  latestCheckpoint,
  projectCheckpointContext,
} from "./checkpoint.js";
import { hasCheckpointMarker, rewriteCheckpointMarker } from "./protocol.js";
import { requestRemoteCompaction } from "./remote.js";

const STATUS_KEY = "codex-compact";

export interface CodexRemoteCompactionSettings {
  enabled: boolean;
  requestTimeoutMs: number;
  maxRetries: number;
  replacementTokenBudget: number;
  notifyOnFallback: boolean;
}

export const DEFAULT_CODEX_REMOTE_COMPACTION_SETTINGS: Readonly<CodexRemoteCompactionSettings> = Object.freeze({
  enabled: true,
  requestTimeoutMs: 300_000,
  maxRetries: 2,
  replacementTokenBudget: 64_000,
  notifyOnFallback: true,
});

const providerWarnings = new Set<string>();

export function resolveCodexRemoteCompactionSettings(basePath: string): CodexRemoteCompactionSettings {
  const config = loadEffectiveGSDPreferences(basePath)?.preferences.context_management?.codex_remote_compaction;
  return resolveConfig(config);
}

export function resolveConfig(config: CodexRemoteCompactionConfig | undefined): CodexRemoteCompactionSettings {
  return {
    enabled: config?.enabled ?? DEFAULT_CODEX_REMOTE_COMPACTION_SETTINGS.enabled,
    requestTimeoutMs: config?.request_timeout_ms ?? DEFAULT_CODEX_REMOTE_COMPACTION_SETTINGS.requestTimeoutMs,
    maxRetries: config?.max_retries ?? DEFAULT_CODEX_REMOTE_COMPACTION_SETTINGS.maxRetries,
    replacementTokenBudget:
      config?.replacement_token_budget ?? DEFAULT_CODEX_REMOTE_COMPACTION_SETTINGS.replacementTokenBudget,
    notifyOnFallback: config?.notify_on_fallback ?? DEFAULT_CODEX_REMOTE_COMPACTION_SETTINGS.notifyOnFallback,
  };
}

export function usesCodexResponsesApi(
  model: Model<Api> | undefined,
): model is Model<"openai-codex-responses"> {
  return model?.api === "openai-codex-responses";
}

function activeCheckpoint(ctx: ExtensionContext) {
  return latestCheckpoint(ctx.sessionManager.getBranch());
}

function isCheckpointCompatible(
  details: CodexCheckpointDetails,
  model: Model<Api> | undefined,
): model is Model<"openai-codex-responses"> {
  return usesCodexResponsesApi(model)
    && model.provider === details.provider
    && model.id === details.modelId;
}

function activePath(entries: readonly SessionEntry[], leafId: string | null): SessionEntry[] {
  if (leafId === null) return [];
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  let current = (leafId ? byId.get(leafId) : undefined) ?? entries.at(-1);
  const path: SessionEntry[] = [];
  while (current) {
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

function entryMessages(entry: SessionEntry): AgentMessage[] {
  if (entry.type === "message") return [entry.message];
  if (entry.type === "custom_message") {
    return [createCustomMessage(entry.customType, entry.content, entry.display, entry.details, entry.timestamp)];
  }
  if (entry.type === "branch_summary" && entry.summary) {
    return [createBranchSummaryMessage(entry.summary, entry.fromId, entry.timestamp)];
  }
  return [];
}

export function keptMessages(event: SessionBeforeCompactEvent): AgentMessage[] {
  const leafId = event.branchEntries.at(-1)?.id ?? null;
  const path = activePath(event.branchEntries, leafId);
  const keptIndex = path.findIndex((entry) => entry.id === event.preparation.firstKeptEntryId);
  if (keptIndex < 0) throw new Error("GSD compaction cut point is not present in the active context");
  return path.slice(keptIndex).flatMap(entryMessages);
}

function activeTools(pi: ExtensionAPI): Tool[] {
  const enabled = new Set(pi.getActiveTools());
  return pi.getAllTools()
    .filter((tool) => enabled.has(tool.name))
    .map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }));
}

function projectedCurrentMessages(
  event: SessionBeforeCompactEvent,
  model: Model<"openai-codex-responses">,
): { messages: AgentMessage[]; prior?: CodexCheckpointDetails } {
  const leafId = event.branchEntries.at(-1)?.id ?? null;
  const session = buildSessionContext(event.branchEntries, leafId);
  const prior = latestCheckpoint(event.branchEntries);
  if (!prior) return { messages: session.messages };
  if (prior.details.modelId !== model.id) {
    throw new Error("The active opaque checkpoint belongs to a different Codex model");
  }
  const projected = projectCheckpointContext(session.messages, prior.details, prior.entry.summary);
  if (!projected) throw new Error("The previous opaque checkpoint could not be projected safely");
  return { messages: projected, prior: prior.details };
}

function sessionStillOwned(ctx: ExtensionContext, sessionId: string, signal: AbortSignal): boolean {
  return !signal.aborted && ctx.sessionManager.getSessionId() === sessionId;
}

export async function compactWithCodexRemoteV2(
  pi: ExtensionAPI,
  event: SessionBeforeCompactEvent,
  ctx: ExtensionContext,
  basePath: string,
  options: { fetch?: typeof globalThis.fetch } = {},
) {
  const settings = resolveCodexRemoteCompactionSettings(basePath);
  const model = ctx.model;
  if (!settings.enabled || !usesCodexResponsesApi(model)) return undefined;
  const sessionId = ctx.sessionManager.getSessionId();
  ctx.ui.setStatus(STATUS_KEY, "Codex remote compaction…");
  try {
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!sessionStillOwned(ctx, sessionId, event.signal)) return { cancel: true };
    if (!auth.ok) throw new Error(auth.error);
    const current = projectedCurrentMessages(event, model);
    const context: Context = {
      systemPrompt: ctx.getSystemPrompt(),
      messages: convertToLlm(current.messages),
      tools: activeTools(pi),
    };
    const response = await requestRemoteCompaction({
      model,
      context,
      apiKey: auth.apiKey,
      headers: auth.headers,
      signal: event.signal,
      priorCheckpoint: current.prior
        ? {
            marker: checkpointMarker(current.prior.checkpointId),
            replacementHistory: current.prior.replacementHistory,
          }
        : undefined,
      requestTimeoutMs: settings.requestTimeoutMs,
      maxRetries: settings.maxRetries,
      fetch: options.fetch,
    });
    if (!sessionStillOwned(ctx, sessionId, event.signal)) return { cancel: true };
    const replacementHistory = buildReplacementHistory(response.promptInput, response.item, {
      tokenBudget: settings.replacementTokenBudget,
    });
    const details = createCheckpointDetails({
      provider: model.provider,
      modelId: model.id,
      replacementHistory,
      keptMessages: keptMessages(event),
    });
    return {
      compaction: {
        summary: fallbackSummary(details.checkpointId),
        firstKeptEntryId: event.preparation.firstKeptEntryId,
        tokensBefore: event.preparation.tokensBefore,
        details,
      },
    };
  } catch (error) {
    if (event.signal.aborted || ctx.sessionManager.getSessionId() !== sessionId) return { cancel: true };
    if (ctx.hasUI && settings.notifyOnFallback) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Codex remote compaction failed; using GSD native compaction. ${message}`, "warning");
    }
    return undefined;
  } finally {
    if (ctx.sessionManager.getSessionId() === sessionId) ctx.ui.setStatus(STATUS_KEY, undefined);
  }
}

export function projectActiveCheckpointContext(
  messages: readonly AgentMessage[],
  ctx: ExtensionContext,
  basePath: string,
): AgentMessage[] | undefined {
  if (!resolveCodexRemoteCompactionSettings(basePath).enabled) return undefined;
  const checkpoint = activeCheckpoint(ctx);
  if (!checkpoint || !isCheckpointCompatible(checkpoint.details, ctx.model)) return undefined;
  return projectCheckpointContext(messages, checkpoint.details, checkpoint.entry.summary);
}

export function rewriteActiveCheckpointPayload(
  payload: unknown,
  ctx: ExtensionContext,
  basePath: string,
): unknown | undefined {
  if (!resolveCodexRemoteCompactionSettings(basePath).enabled) return undefined;
  const checkpoint = activeCheckpoint(ctx);
  if (!checkpoint || !isCheckpointCompatible(checkpoint.details, ctx.model)) return undefined;
  const marker = checkpointMarker(checkpoint.details.checkpointId);
  if (!hasCheckpointMarker(payload, marker)) return undefined;
  return rewriteCheckpointMarker(payload, marker, checkpoint.details.replacementHistory);
}

export function warnForIncompatibleCheckpoint(ctx: ExtensionContext, basePath: string): void {
  if (!resolveCodexRemoteCompactionSettings(basePath).enabled) return;
  const checkpoint = activeCheckpoint(ctx);
  if (!checkpoint || isCheckpointCompatible(checkpoint.details, ctx.model)) return;
  const key = `${ctx.sessionManager.getSessionId()}:${ctx.model?.provider ?? "none"}:${ctx.model?.id ?? "none"}`;
  if (providerWarnings.has(key)) return;
  providerWarnings.add(key);
  if (ctx.hasUI) {
    ctx.ui.notify(
      "The active Codex checkpoint cannot replay on this model; only its fallback marker and retained recent messages are available.",
      "warning",
    );
  }
}

export function resetCodexCompactSessionState(sessionId?: string): void {
  if (!sessionId) {
    providerWarnings.clear();
    return;
  }
  for (const key of providerWarnings) {
    if (key.startsWith(`${sessionId}:`)) providerWarnings.delete(key);
  }
}

export function codexRemoteRouteLabel(ctx: ExtensionContext, basePath: string): string {
  const settings = resolveCodexRemoteCompactionSettings(basePath);
  if (!settings.enabled) return "GSD native (Codex Remote V2 disabled)";
  if (!usesCodexResponsesApi(ctx.model)) return "GSD native (active API is not openai-codex-responses)";
  return "Codex Remote Compaction V2";
}
