import type { AssistantMessage } from "../types.js";

function buildProviderErrorPattern(patterns: readonly string[]): RegExp {
	return new RegExp(patterns.join("|"), "i");
}

const NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN = buildProviderErrorPattern([
	"GoUsageLimitError",
	"FreeUsageLimitError",
	"Usage limit reached",
	"Monthly usage limit reached",
	"available balance",
	"insufficient_quota",
	"out of budget",
	"quota exceeded",
	"billing",
]);

const RETRYABLE_PROVIDER_ERROR_PATTERN = buildProviderErrorPattern([
	"overloaded",
	"rate.?limit",
	"too many requests",
	"429",
	"500",
	"502",
	"503",
	"504",
	"524",
	"service.?unavailable",
	"server.?error",
	"internal.?error",
	"provider.?returned.?error",
	"exceeded request buffer limit while retrying upstream",
	"network.?error",
	"connection.?error",
	"connection.?refused",
	"connection.?lost",
	"other side closed",
	"fetch failed",
	"getaddrinfo",
	"ENOTFOUND",
	"EAI_AGAIN",
	"upstream.?connect",
	"reset before headers",
	"socket hang up",
	"socket connection was closed",
	"timed? out",
	"timeout",
	"terminated",
	"websocket.?closed",
	"websocket.?error",
	"ended without",
	"stream ended before message_stop",
	"stream ended before a terminal response event",
	"http2 request did not get a response",
	"retry delay",
	"you can retry your request",
	"try your request again",
	"please retry your request",
	"ResourceExhausted",
]);

/** Bounded exponential-backoff policy for assistant-producing calls. */
export interface RetryPolicy {
	enabled: boolean;
	/** Maximum retries after the initial call. */
	maxRetries: number;
	/** Base backoff in milliseconds; attempt N waits `baseDelayMs * 2^(N - 1)`. */
	baseDelayMs: number;
}

/** Lifecycle callbacks emitted around retry attempts. */
export interface RetryCallbacks {
	onRetryScheduled?: (
		attempt: number,
		maxAttempts: number,
		delayMs: number,
		errorMessage: string,
	) => void | Promise<void>;
	onRetryAttemptStart?: () => void | Promise<void>;
	onRetryFinished?: (success: boolean, attempt: number, finalError?: string) => void | Promise<void>;
}

class RetrySleepAbortError extends Error {
	constructor() {
		super("Aborted");
	}
}

function sleepForRetry(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new RetrySleepAbortError());
			return;
		}
		let settled = false;
		const finish = (callback: () => void) => {
			if (settled) return;
			settled = true;
			signal?.removeEventListener("abort", onAbort);
			callback();
		};
		const timeout = setTimeout(() => finish(resolve), Math.max(0, ms));
		const onAbort = () => {
			clearTimeout(timeout);
			finish(() => reject(new RetrySleepAbortError()));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

/**
 * Retry transient assistant failures without retrying aborts, quota exhaustion,
 * billing failures, or other deterministic errors.
 */
export async function retryAssistantCall(
	produce: () => Promise<AssistantMessage>,
	policy: RetryPolicy | undefined,
	signal: AbortSignal | undefined,
	callbacks?: RetryCallbacks,
): Promise<AssistantMessage> {
	const maxRetries = policy?.enabled ? Math.max(0, Math.floor(policy.maxRetries)) : 0;
	let attempt = 0;
	let lastRetry: { attempt: number; errorMessage: string } | undefined;

	for (;;) {
		const response = await produce();
		if (response.stopReason === "aborted") {
			if (lastRetry) await callbacks?.onRetryFinished?.(false, lastRetry.attempt);
			return response;
		}
		if (response.stopReason !== "error") {
			if (lastRetry) await callbacks?.onRetryFinished?.(true, lastRetry.attempt);
			return response;
		}
		if (attempt >= maxRetries || !isRetryableAssistantError(response)) {
			if (lastRetry) await callbacks?.onRetryFinished?.(false, lastRetry.attempt, response.errorMessage);
			return response;
		}

		attempt += 1;
		const errorMessage = response.errorMessage || "Unknown error";
		lastRetry = { attempt, errorMessage };
		const delayMs = Math.max(0, policy!.baseDelayMs) * 2 ** (attempt - 1);
		await callbacks?.onRetryScheduled?.(attempt, maxRetries, delayMs, errorMessage);
		try {
			await sleepForRetry(delayMs, signal);
		} catch (error) {
			await callbacks?.onRetryFinished?.(false, attempt, errorMessage);
			if (error instanceof RetrySleepAbortError) {
				return { ...response, stopReason: "aborted", errorMessage: undefined };
			}
			throw error;
		}
		await callbacks?.onRetryAttemptStart?.();
	}
}

/** Classify transient provider and transport failures without applying retry policy. */
export function isRetryableAssistantError(message: AssistantMessage): boolean {
	if (message.stopReason !== "error" || !message.errorMessage) return false;
	if (NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN.test(message.errorMessage)) return false;
	return RETRYABLE_PROVIDER_ERROR_PATTERN.test(message.errorMessage);
}
