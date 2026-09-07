import type { ResponseStreamEvent } from "openai/resources/responses/responses.js";
import { describe, expect, it } from "vitest";
import { processResponsesStream } from "../src/providers/openai-responses-shared.ts";
import type { AssistantMessage, Model } from "../src/types.ts";
import { AssistantMessageEventStream } from "../src/utils/event-stream.ts";

const model: Model<"openai-responses"> = {
	id: "cache-usage-fixture",
	name: "Cache usage fixture",
	api: "openai-responses",
	provider: "openai",
	baseUrl: "https://example.invalid/v1",
	reasoning: true,
	input: ["text"],
	cost: { input: 2, output: 4, cacheRead: 0.5, cacheWrite: 3 },
	contextWindow: 400_000,
	maxTokens: 16_000,
};

type InputTokenDetails = { cached_tokens?: number; cache_write_tokens?: number };

async function readUsage(
	inputTokens: number,
	details?: InputTokenDetails,
	target = model,
	status: "completed" | "incomplete" = "completed",
	totalTokens = inputTokens + 12,
): Promise<AssistantMessage> {
	const output: AssistantMessage = {
		role: "assistant",
		content: [],
		api: target.api,
		provider: target.provider,
		model: target.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 1,
	};
	async function* events(): AsyncIterable<ResponseStreamEvent> {
		yield {
			type: status === "completed" ? "response.completed" : "response.incomplete",
			sequence_number: 0,
			response: {
				id: "resp_cache_usage",
				status,
				output: [],
				incomplete_details: status === "incomplete" ? { reason: "max_output_tokens" } : undefined,
				usage: {
					input_tokens: inputTokens,
					input_tokens_details: details,
					output_tokens: 12,
					output_tokens_details: { reasoning_tokens: 7 },
					total_tokens: totalTokens,
				},
			},
		} as ResponseStreamEvent;
	}

	await processResponsesStream(events(), output, new AssistantMessageEventStream(), target);
	return output;
}

describe("Responses cache usage accounting", () => {
	it.each([
		{ name: "legacy response without input details", tokens: 30, details: undefined, input: 30, read: 0, write: 0 },
		{ name: "legacy cache read without a write field", tokens: 30, details: { cached_tokens: 5 }, input: 25, read: 5, write: 0 },
		{ name: "explicit zero cache writes", tokens: 30, details: { cached_tokens: 5, cache_write_tokens: 0 }, input: 25, read: 5, write: 0 },
		{ name: "initial full cache write", tokens: 12_000, details: { cached_tokens: 0, cache_write_tokens: 12_000 }, input: 0, read: 0, write: 12_000 },
		{ name: "cached prefix and new cache write", tokens: 15_000, details: { cached_tokens: 12_000, cache_write_tokens: 3_000 }, input: 0, read: 12_000, write: 3_000 },
		{ name: "ordinary input alongside cache reads and writes", tokens: 18_000, details: { cached_tokens: 12_000, cache_write_tokens: 3_000 }, input: 3_000, read: 12_000, write: 3_000 },
		{ name: "fully cached input", tokens: 12_000, details: { cached_tokens: 12_000, cache_write_tokens: 0 }, input: 0, read: 12_000, write: 0 },
	])("keeps disjoint buckets for $name", async ({ tokens, details, input, read, write }) => {
		const { usage } = await readUsage(tokens, details);

		expect(usage).toMatchObject({
			input,
			output: 12,
			cacheRead: read,
			cacheWrite: write,
			reasoning: 7,
			totalTokens: tokens + 12,
		});
		expect(usage.input + usage.cacheRead + usage.cacheWrite).toBe(tokens);
		expect(usage.input + usage.cacheRead + usage.cacheWrite + usage.output).toBe(usage.totalTokens);
		expect(usage.cost.input).toBeCloseTo(input * 2 / 1_000_000, 12);
		expect(usage.cost.output).toBeCloseTo(12 * 4 / 1_000_000, 12);
		expect(usage.cost.cacheRead).toBeCloseTo(read * 0.5 / 1_000_000, 12);
		expect(usage.cost.cacheWrite).toBeCloseTo(write * 3 / 1_000_000, 12);
		expect(usage.cost.total).toBeCloseTo((input * 2 + 12 * 4 + read * 0.5 + write * 3) / 1_000_000, 12);
	});

	it("preserves the provider-reported total without recomputing it", async () => {
		const { usage } = await readUsage(12_000, { cache_write_tokens: 12_000 }, model, "completed", 12_020);

		expect(usage.totalTokens).toBe(12_020);
		expect(usage.input).toBe(0);
		expect(usage.cacheRead).toBe(0);
		expect(usage.cacheWrite).toBe(12_000);
	});

	it("accounts for cache writes on incomplete terminal responses", async () => {
		const output = await readUsage(15_000, { cached_tokens: 12_000, cache_write_tokens: 3_000 }, model, "incomplete");

		expect(output.stopReason).toBe("length");
		expect(output.usage).toMatchObject({ input: 0, cacheRead: 12_000, cacheWrite: 3_000, totalTokens: 15_012 });
	});

	it("preserves an explicitly configured zero cache-write price", async () => {
		const target = { ...model, cost: { ...model.cost, cacheWrite: 0 } };
		const { usage } = await readUsage(12_000, { cached_tokens: 0, cache_write_tokens: 12_000 }, target);

		expect(usage.cacheWrite).toBe(12_000);
		expect(usage.cost.input).toBe(0);
		expect(usage.cost.cacheWrite).toBe(0);
		expect(usage.cost.total).toBeCloseTo(12 * 4 / 1_000_000, 12);
	});
});
