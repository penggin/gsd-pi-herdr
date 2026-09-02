import { describe, expect, it } from "vitest";
import type { AssistantMessage } from "../src/types.ts";
import { isRetryableAssistantError } from "../src/utils/retry.ts";

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
