import { describe, expect, it } from "vitest";
import type { AssistantMessage } from "../src/types.ts";
import { isRetryableAssistantError, retryAssistantCall } from "../src/utils/retry.ts";

function assistantError(errorMessage: string, stopReason: AssistantMessage["stopReason"] = "error"): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "openai-responses",
		provider: "test",
		model: "test",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		errorMessage,
		timestamp: 1,
	};
}

describe("provider retry classification", () => {
	it.each([
		"HTTP 524: upstream timed out",
		"ResourceExhausted: concurrent request limit",
		"The socket connection was closed unexpectedly",
		"getaddrinfo EAI_AGAIN provider.example",
		"Stream ended before a terminal response event",
		"Please retry your request in a few seconds",
	])("classifies transient failure: %s", (message) => {
		expect(isRetryableAssistantError(assistantError(message))).toBe(true);
	});

	it.each([
		"429 insufficient_quota: add billing details",
		"429 GoUsageLimitError",
		"429 Provider error 429: Usage limit reached for 5 hour. Your limit will reset soon",
		"Monthly usage limit reached; enable available balance",
		"quota exceeded for this account",
		"invalid_api_key",
	])("does not retry terminal account failure: %s", (message) => {
		expect(isRetryableAssistantError(assistantError(message))).toBe(false);
	});

	it("requires an error terminal message", () => {
		expect(isRetryableAssistantError(assistantError("HTTP 524", "stop"))).toBe(false);
	});
});

describe("retryAssistantCall", () => {
	it("retries transient failures with bounded lifecycle callbacks", async () => {
		const events: string[] = [];
		let calls = 0;
		const response = await retryAssistantCall(
			async () => {
				calls += 1;
				return calls < 3 ? assistantError("HTTP 503 overloaded") : assistantError("done", "stop");
			},
			{ enabled: true, maxRetries: 3, baseDelayMs: 0 },
			undefined,
			{
				onRetryScheduled: (attempt, maxAttempts, delayMs, errorMessage) => {
					events.push(`scheduled:${attempt}/${maxAttempts}:${delayMs}:${errorMessage}`);
				},
				onRetryAttemptStart: () => events.push("started"),
				onRetryFinished: (success, attempt, finalError) =>
					events.push(`finished:${success}:${attempt}:${finalError ?? ""}`),
			},
		);

		expect(response.stopReason).toBe("stop");
		expect(calls).toBe(3);
		expect(events).toEqual([
			"scheduled:1/3:0:HTTP 503 overloaded",
			"started",
			"scheduled:2/3:0:HTTP 503 overloaded",
			"started",
			"finished:true:2:",
		]);
	});

	it("does not retry terminal account failures or disabled policies", async () => {
		let quotaCalls = 0;
		const quota = await retryAssistantCall(
			async () => {
				quotaCalls += 1;
				return assistantError("429 insufficient_quota: add billing details");
			},
			{ enabled: true, maxRetries: 5, baseDelayMs: 0 },
			undefined,
		);
		let disabledCalls = 0;
		await retryAssistantCall(
			async () => {
				disabledCalls += 1;
				return assistantError("HTTP 503 overloaded");
			},
			{ enabled: false, maxRetries: 5, baseDelayMs: 0 },
			undefined,
		);

		expect(quota.stopReason).toBe("error");
		expect(quotaCalls).toBe(1);
		expect(disabledCalls).toBe(1);
	});

	it("reports exhausted retries with the final error", async () => {
		const finished: Array<[boolean, number, string | undefined]> = [];
		let calls = 0;
		const response = await retryAssistantCall(
			async () => {
				calls += 1;
				return assistantError(`HTTP 503 attempt ${calls}`);
			},
			{ enabled: true, maxRetries: 2, baseDelayMs: 0 },
			undefined,
			{ onRetryFinished: (...args) => finished.push(args) },
		);

		expect(calls).toBe(3);
		expect(response.errorMessage).toBe("HTTP 503 attempt 3");
		expect(finished).toEqual([[false, 2, "HTTP 503 attempt 3"]]);
	});

	it("normalizes cancellation during backoff to an aborted response", async () => {
		const controller = new AbortController();
		const finished: Array<[boolean, number, string | undefined]> = [];
		let calls = 0;
		const response = await retryAssistantCall(
			async () => {
				calls += 1;
				return assistantError("HTTP 503 overloaded");
			},
			{ enabled: true, maxRetries: 2, baseDelayMs: 60_000 },
			controller.signal,
			{
				onRetryScheduled: () => controller.abort(),
				onRetryFinished: (...args) => finished.push(args),
			},
		);

		expect(calls).toBe(1);
		expect(response.stopReason).toBe("aborted");
		expect(response.errorMessage).toBeUndefined();
		expect(finished).toEqual([[false, 1, "HTTP 503 overloaded"]]);
	});
});
