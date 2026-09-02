import { describe, expect, it } from "vitest";
import { streamSimple } from "../src/stream.ts";
import type { AssistantMessage, Model } from "../src/types.ts";
import { AssistantMessageEventStream } from "../src/utils/event-stream.ts";
import { resetApiProviders, setBedrockProviderModule } from "../src/providers/register-builtins.ts";

describe("lazy provider result forwarding", () => {
	it("preserves an inner final result when the inner stream has no terminal event", async () => {
		const model: Model<"bedrock-converse-stream"> = {
			id: "lazy-result",
			name: "Lazy result",
			api: "bedrock-converse-stream",
			provider: "amazon-bedrock",
			baseUrl: "https://bedrock.invalid",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128_000,
			maxTokens: 4096,
		};
		const finalMessage: AssistantMessage = {
			role: "assistant",
			content: [{ type: "text", text: "preserved" }],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		};
		const createInner = () => {
			const inner = new AssistantMessageEventStream();
			inner.end(finalMessage);
			return inner;
		};
		setBedrockProviderModule({
			streamBedrock: createInner,
			streamSimpleBedrock: createInner,
		});
		resetApiProviders();

		const result = await streamSimple(model, { messages: [] }).result();
		expect(result).toEqual(finalMessage);
	});
});
