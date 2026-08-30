// Derived from @narumitw/pi-codex-compact (MIT). See LICENSE.narumitw.

import {
  stream,
  type Context,
  type Model,
  type ProviderStreamOptions,
  type Usage,
} from "@gsd/pi-ai";
import {
  CodexCompactionProtocolError,
  type CollectedCompaction,
  collectCompactionSse,
  type JsonObject,
  prepareRemoteCompactionPayload,
} from "./protocol.js";

interface PriorCheckpointPayload {
  marker: string;
  replacementHistory: readonly unknown[];
}

export interface RemoteCompactionRequest {
  model: Model<"openai-codex-responses">;
  context: Context;
  apiKey?: string;
  headers?: Record<string, string>;
  signal: AbortSignal;
  priorCheckpoint?: PriorCheckpointPayload;
  requestTimeoutMs?: number;
  maxRetries?: number;
  fetch?: typeof globalThis.fetch;
}

export interface RemoteCompactionResponse {
  item: JsonObject;
  promptInput: JsonObject[];
  usage: Usage;
}

const EMPTY_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function abortError(): DOMException {
  return new DOMException("Compaction aborted", "AbortError");
}

function createRequestSignal(parent: AbortSignal, timeoutMs: number): {
  signal: AbortSignal;
  timedOut: () => boolean;
  dispose: () => void;
} {
  const controller = new AbortController();
  let timeoutFired = false;
  const onParentAbort = () => controller.abort(parent.reason);
  parent.addEventListener("abort", onParentAbort, { once: true });
  const timer = setTimeout(() => {
    timeoutFired = true;
    controller.abort(new DOMException("Codex remote compaction timed out", "TimeoutError"));
  }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => timeoutFired,
    dispose: () => {
      clearTimeout(timer);
      parent.removeEventListener("abort", onParentAbort);
    },
  };
}

export async function requestRemoteCompaction(
  request: RemoteCompactionRequest,
): Promise<RemoteCompactionResponse> {
  if (request.signal.aborted) throw abortError();
  const requestSignal = createRequestSignal(request.signal, request.requestTimeoutMs ?? 5 * 60 * 1000);
  let sentInput: JsonObject[] | undefined;
  const inspections: Promise<
    { ok: true; value: CollectedCompaction } | { ok: false; error: unknown }
  >[] = [];
  const baseFetch = request.fetch ?? globalThis.fetch;
  const inspectedFetch: typeof globalThis.fetch = async (input, init) => {
    const response = await baseFetch(input, init);
    if (!response.ok || !response.body) return response;
    const [providerBody, inspectionBody] = response.body.tee();
    const inspection = collectCompactionSse(inspectionBody, { signal: requestSignal.signal }).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    inspections.push(inspection);
    return new Response(providerBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };

  try {
    const providerStream = stream(request.model, request.context, {
      apiKey: request.apiKey,
      headers: request.headers,
      signal: requestSignal.signal,
      transport: "sse",
      cacheRetention: "none",
      maxRetries: request.maxRetries ?? 2,
      fetch: inspectedFetch,
      onPayload: (payload: unknown) => {
        const prepared = prepareRemoteCompactionPayload(payload, request.priorCheckpoint);
        if (!Array.isArray(prepared.input) || !prepared.input.every(isObject)) {
          throw new CodexCompactionProtocolError("Prepared compaction payload has invalid input items");
        }
        sentInput = structuredClone(prepared.input.slice(0, -1)) as JsonObject[];
        return prepared;
      },
    } as ProviderStreamOptions);

    let usage = EMPTY_USAGE;
    for await (const event of providerStream) {
      if (request.signal.aborted) throw abortError();
      if (requestSignal.timedOut()) throw new Error("Codex remote compaction request timed out");
      if (event.type === "error") {
        throw new Error(event.error.errorMessage ?? "Codex remote compaction request failed");
      }
      if (event.type === "done") usage = event.message.usage;
    }
    if (request.signal.aborted) throw abortError();
    if (requestSignal.timedOut()) throw new Error("Codex remote compaction request timed out");
    if (!sentInput) throw new CodexCompactionProtocolError("Provider did not expose a request payload");
    if (inspections.length === 0) {
      throw new CodexCompactionProtocolError("Provider response did not expose an SSE body");
    }
    const inspection = await inspections.at(-1);
    if (request.signal.aborted) throw abortError();
    if (!inspection?.ok) throw inspection?.error ?? new Error("Remote compaction inspection failed");
    return { item: inspection.value.item, promptInput: sentInput, usage };
  } finally {
    requestSignal.dispose();
  }
}
