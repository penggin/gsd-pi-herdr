import type { ResponseReasoningItem, ResponseStreamEvent } from "openai/resources/responses/responses.js";
import { describe, expect, it } from "vitest";
import { convertResponsesMessages, processResponsesStream } from "../src/providers/openai-responses-shared.ts";
import type { AssistantMessage, Context, Model } from "../src/types.ts";
import { AssistantMessageEventStream } from "../src/utils/event-stream.ts";

function model(): Model<"azure-openai-responses"> {
	return {
		id: "gpt-5-mini",
		name: "GPT-5 Mini",
		api: "azure-openai-responses",
		provider: "azure-openai-responses",
		baseUrl: "https://example.invalid",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 400000,
		maxTokens: 128000,
	};
}

function output(target: Model<"azure-openai-responses">): AssistantMessage {
	return {
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
}

async function* terminalEvent(
	status: "completed" | "incomplete",
	reason?: string,
): AsyncIterable<ResponseStreamEvent> {
	yield {
		type: status === "completed" ? "response.completed" : "response.incomplete",
		sequence_number: 0,
		response: {
			id: `resp_${status}`,
			status,
			incomplete_details: reason ? { reason } : undefined,
			usage: {
				input_tokens: 30,
				output_tokens: 12,
				total_tokens: 42,
				input_tokens_details: { cached_tokens: 5 },
			},
		},
	} as ResponseStreamEvent;
}

describe("OpenAI Responses terminal and reasoning replay", () => {
	it("rejects a stream that ends before a terminal response event", async () => {
		const target = model();
		async function* earlyEof(): AsyncIterable<ResponseStreamEvent> {
			yield {
				type: "response.created",
				sequence_number: 0,
				response: { id: "resp_early_eof" },
			} as ResponseStreamEvent;
		}

		await expect(
			processResponsesStream(earlyEof(), output(target), new AssistantMessageEventStream(), target),
		).rejects.toThrow("OpenAI Responses stream ended before a terminal response event");
	});

	it("finalizes completed and max-output incomplete terminal events", async () => {
		const target = model();
		const completed = output(target);
		await processResponsesStream(
			terminalEvent("completed"),
			completed,
			new AssistantMessageEventStream(),
			target,
		);
		expect(completed).toMatchObject({
			responseId: "resp_completed",
			stopReason: "stop",
			usage: { input: 25, output: 12, cacheRead: 5, totalTokens: 42 },
		});

		const incomplete = output(target);
		await processResponsesStream(
			terminalEvent("incomplete", "max_output_tokens"),
			incomplete,
			new AssistantMessageEventStream(),
			target,
		);
		expect(incomplete).toMatchObject({ responseId: "resp_incomplete", stopReason: "length" });
	});

	it("maps non-length incomplete reasons to explicit errors", async () => {
		const target = model();
		const incomplete = output(target);
		await processResponsesStream(
			terminalEvent("incomplete", "content_filter"),
			incomplete,
			new AssistantMessageEventStream(),
			target,
		);

		expect(incomplete).toMatchObject({
			stopReason: "error",
			errorMessage: "Response incomplete: content_filter",
		});
	});

	it("backfills terminal encrypted reasoning for stateless Azure replay", async () => {
		const target = model();
		const assistant = output(target);
		const doneItem: ResponseReasoningItem = { type: "reasoning", id: "rs_test", summary: [] };
		const terminalItem: ResponseReasoningItem = {
			...doneItem,
			encrypted_content: "from-response-completed",
		};
		async function* events(): AsyncIterable<ResponseStreamEvent> {
			yield {
				type: "response.output_item.added",
				output_index: 0,
				sequence_number: 0,
				item: doneItem,
			} as ResponseStreamEvent;
			yield {
				type: "response.output_item.done",
				output_index: 0,
				sequence_number: 1,
				item: doneItem,
			} as ResponseStreamEvent;
			yield {
				type: "response.completed",
				sequence_number: 2,
				response: { id: "resp_test", status: "completed", output: [terminalItem] },
			} as ResponseStreamEvent;
		}

		await processResponsesStream(events(), assistant, new AssistantMessageEventStream(), target);
		const context: Context = {
			messages: [assistant, { role: "user", content: "continue", timestamp: 2 }],
		};
		const replay = convertResponsesMessages(target, context, new Set(["azure-openai-responses"]));

		expect(replay.find((item) => item.type === "reasoning")).toMatchObject({
			type: "reasoning",
			id: "rs_test",
			encrypted_content: "from-response-completed",
		});
	});
});
