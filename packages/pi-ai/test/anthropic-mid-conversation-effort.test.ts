import { describe, expect, it } from "vitest";
import { streamAnthropic } from "../src/providers/anthropic.ts";
import type { AssistantMessage, Context, Model } from "../src/types.ts";

interface WireMessage {
	role: string;
	content: unknown;
	output_config?: { effort?: string };
}

interface CapturedPayload {
	messages: WireMessage[];
	thinking?: {
		type: string;
		display?: string;
		block_binding?: { prefix_mismatch_behavior?: string };
	};
	output_config?: { effort?: string };
}

function managedModel(provider = "anthropic"): Model<"anthropic-messages"> {
	return {
		id: "claude-opus-5",
		name: "Claude Opus 5",
		api: "anthropic-messages",
		provider,
		baseUrl: "http://127.0.0.1:9",
		reasoning: true,
		thinkingLevelMap: { off: null, minimal: "low", low: "low", medium: "medium", high: "high", max: "max" },
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 32_000,
		compat: { forceAdaptiveThinking: true, supportsMidConvoEffort: true },
	};
}

function assistant(model: Model<"anthropic-messages">, level?: string): AssistantMessage {
	return {
		role: "assistant",
		content: [
			{ type: "thinking", thinking: "reasoning", thinkingSignature: "signature" },
			{ type: "text", text: "answer" },
		],
		api: "anthropic-messages",
		provider: model.provider,
		model: model.id,
		...(level === undefined ? {} : { providerThinkingLevel: level }),
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
}

async function capture(
	model: Model<"anthropic-messages">,
	context: Context,
	effort?: "low" | "medium" | "high" | "xhigh" | "max",
): Promise<{ payload: CapturedPayload; message: AssistantMessage }> {
	let payload: CapturedPayload | undefined;
	const result = streamAnthropic(model, context, {
		apiKey: "test-key",
		cacheRetention: "none",
		thinkingEnabled: true,
		effort,
		onPayload: (value) => {
			payload = value as CapturedPayload;
			throw new Error("payload captured");
		},
	});
	const message = await result.result();
	if (!payload) throw new Error("Expected payload capture");
	return { payload, message };
}

const user = (content: string, timestamp: number) => ({ role: "user" as const, content, timestamp });

describe("Anthropic mid-conversation effort", () => {
	it("reconstructs historical effort markers and appends the active effort", async () => {
		const model = managedModel();
		const first = await capture(model, { messages: [user("one", 1)] }, "low");
		const second = await capture(
			model,
			{ messages: [user("one", 1), assistant(model, "low"), user("two", 2)] },
			"high",
		);

		expect(first.payload.messages).toEqual([
			{ role: "user", content: "one" },
			{ role: "system", content: [], output_config: { effort: "low" } },
		]);
		expect(second.payload.messages.slice(0, first.payload.messages.length)).toEqual(first.payload.messages);
		expect(second.payload.messages.at(-1)).toEqual({
			role: "system",
			content: [],
			output_config: { effort: "high" },
		});
		expect(second.payload.thinking).toEqual({
			type: "adaptive",
			display: "summarized",
			block_binding: { prefix_mismatch_behavior: "drop_block" },
		});
		expect(first.message.providerThinkingLevel).toBe("low");
	});

	it("does not invent historical markers for unmanaged responses", async () => {
		const model = managedModel();
		const legacy = assistant(model);
		const otherProvider = { ...assistant(model, "low"), provider: "other-provider" };
		const { payload } = await capture(
			model,
			{ messages: [user("one", 1), legacy, user("two", 2), otherProvider, user("three", 3)] },
			"medium",
		);

		expect(payload.messages.filter((message) => message.role === "system")).toEqual([
			{ role: "system", content: [], output_config: { effort: "medium" } },
		]);
	});

	it("leaves unsupported transports on the legacy top-level effort", async () => {
		const model = managedModel();
		model.compat = { forceAdaptiveThinking: true };
		const { payload, message } = await capture(model, { messages: [user("one", 1)] }, "low");

		expect(payload.messages).toEqual([{ role: "user", content: "one" }]);
		expect(payload.output_config).toEqual({ effort: "low" });
		expect(payload.thinking).toEqual({ type: "adaptive", display: "summarized" });
		expect(message.providerThinkingLevel).toBeUndefined();
	});

	it("sends the mid-conversation effort and thinking-binding beta headers", async () => {
		let betaHeader: string | null = null;
		const originalFetch = globalThis.fetch;
		const events = [
			{
				type: "message_start",
				message: {
					id: "msg_test",
					model: "claude-opus-5",
					input_transformations: [
						{ type: "thinking_dropped", path: "messages.1.content.0", reason: "prefix_mismatch" },
					],
					usage: { input_tokens: 1, output_tokens: 0 },
				},
			},
			{
				type: "message_delta",
				delta: { stop_reason: "end_turn" },
				usage: { input_tokens: 1, output_tokens: 1 },
			},
			{ type: "message_stop" },
		];
		const body = events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
		globalThis.fetch = async (input, init) => {
			const request = input instanceof Request ? input : new Request(input, init);
			betaHeader = request.headers.get("anthropic-beta");
			return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
		};

		try {
			const result = await streamAnthropic(managedModel(), { messages: [user("one", 1)] }, {
				apiKey: "test-key",
				cacheRetention: "none",
				thinkingEnabled: true,
			}).result();

			expect(result.stopReason, result.errorMessage).toBe("stop");
			expect(betaHeader).toContain("mid-conversation-output-config-2026-07-01");
			expect(betaHeader).toContain("thinking-binding-controls-2026-08-01");
			expect(result.diagnostics).toEqual([
				{
					type: "anthropic_input_transformations",
					timestamp: expect.any(Number),
					details: {
						transformations: [
							{
								type: "thinking_dropped",
								path: "messages.1.content.0",
								reason: "prefix_mismatch",
							},
						],
					},
				},
			]);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
