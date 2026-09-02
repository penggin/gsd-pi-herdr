import { beforeEach, describe, expect, it, vi } from "vitest";
import { getModel } from "../src/models.ts";
import { streamOpenAICompletions } from "../src/providers/openai-completions.ts";
import type { Model } from "../src/types.ts";

interface CapturedCompletionsPayload {
	priority?: number;
	[key: string]: unknown;
}

const mockState = vi.hoisted(() => ({
	lastParams: undefined as CapturedCompletionsPayload | undefined,
}));

vi.mock("openai", () => {
	class FakeOpenAI {
		chat = {
			completions: {
				create: (params: CapturedCompletionsPayload) => {
					mockState.lastParams = params;
					const stream = {
						async *[Symbol.asyncIterator]() {
							yield {
								choices: [{ delta: {}, finish_reason: "stop" }],
								usage: {
									prompt_tokens: 1,
									completion_tokens: 1,
									prompt_tokens_details: { cached_tokens: 0 },
									completion_tokens_details: { reasoning_tokens: 0 },
								},
							};
						},
					};
					const promise = Promise.resolve(stream) as Promise<typeof stream> & {
						withResponse: () => Promise<{
							data: typeof stream;
							response: { status: number; headers: Headers };
						}>;
					};
					promise.withResponse = async () => ({
						data: stream,
						response: { status: 200, headers: new Headers() },
					});
					return promise;
				},
			},
		};
	}

	return { default: FakeOpenAI };
});

function createModel(priority?: number): Model<"openai-completions"> {
	const baseModel = getModel("openai", "gpt-4o-mini") as Model<"openai-completions">;
	return {
		...baseModel,
		compat: priority === undefined ? baseModel.compat : { ...baseModel.compat, vllmPriority: priority },
	};
}

async function captureRequest(model: Model<"openai-completions">): Promise<CapturedCompletionsPayload | undefined> {
	await streamOpenAICompletions(
		model,
		{
			systemPrompt: "sys",
			messages: [{ role: "user", content: "hi", timestamp: Date.now() }],
		},
		{ apiKey: "test-key" },
	).result();

	return mockState.lastParams;
}

describe("OpenAI Completions vLLM priority", () => {
	beforeEach(() => {
		mockState.lastParams = undefined;
	});

	it("sends compat.vllmPriority as the top-level priority field", async () => {
		const payload = await captureRequest(createModel(10));

		expect(payload?.priority).toBe(10);
	});

	it("omits priority unless the model explicitly opts in", async () => {
		const payload = await captureRequest(createModel());

		expect(payload?.priority).toBeUndefined();
	});
});
