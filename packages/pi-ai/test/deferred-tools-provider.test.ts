import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { streamAnthropic } from "../src/providers/anthropic.ts";
import { streamOpenAICodexResponses } from "../src/providers/openai-codex-responses.ts";
import { streamOpenAIResponses } from "../src/providers/openai-responses.ts";
import type { Api, AssistantMessage, Context, Model, Tool, ToolResultMessage } from "../src/types.ts";

interface CapturedPayload {
	tools?: Array<{ name?: string }>;
	input?: Array<{
		type?: string;
		role?: string;
		call_id?: string;
		tools?: Array<{ name?: string; defer_loading?: boolean }>;
	}>;
}

interface AnthropicPayload {
	tools?: Array<{ name: string; defer_loading?: boolean }>;
	messages: Array<{
		content:
			| string
			| Array<{
					type: string;
					content?: string | Array<{ type: string; tool_name?: string }>;
				}>;
	}>;
}

class PayloadCaptured extends Error {}

function tool(name: string): Tool {
	return { name, description: name, parameters: Type.Object({}) };
}

function assistantToolCall(api: Api, provider: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "toolCall", id: "call-base", name: "base", arguments: {} }],
		api,
		provider,
		model: "test",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse",
		timestamp: 2,
	};
}

function toolResult(): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: "call-base",
		toolName: "base",
		content: [{ type: "text", text: "loaded" }],
		addedToolNames: ["late"],
		isError: false,
		timestamp: 3,
	};
}

function context(api: Api, provider: string): Context {
	return {
		systemPrompt: "test",
		messages: [
			{ role: "user", content: "load", timestamp: 1 },
			assistantToolCall(api, provider),
			toolResult(),
			{ role: "user", content: "continue", timestamp: 4 },
		],
		tools: [tool("base"), tool("late")],
	};
}

function model<TApi extends "openai-responses" | "openai-codex-responses">(
	api: TApi,
	compat: Model<TApi>["compat"],
): Model<TApi> {
	return {
		id: "test",
		name: "test",
		api,
		provider: api === "openai-responses" ? "openai" : "openai-codex",
		baseUrl: "http://127.0.0.1:9/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 8192,
		maxTokens: 1024,
		compat,
	};
}

async function captureResponsesPayload(compat: Model<"openai-responses">["compat"]): Promise<CapturedPayload> {
	let captured: CapturedPayload | undefined;
	const target = model("openai-responses", compat);
	await streamOpenAIResponses(target, context(target.api, target.provider), {
		apiKey: "test-key",
		onPayload(payload) {
			captured = payload as CapturedPayload;
			throw new PayloadCaptured();
		},
	}).result();
	if (!captured) throw new Error("Expected OpenAI Responses payload");
	return captured;
}

async function captureCodexPayload(compat: Model<"openai-codex-responses">["compat"]): Promise<CapturedPayload> {
	let captured: CapturedPayload | undefined;
	const target = model("openai-codex-responses", {
		codexAuth: "bearer",
		codexEndpoint: "responses",
		...compat,
	});
	await streamOpenAICodexResponses(target, context(target.api, target.provider), {
		apiKey: "test-key",
		transport: "sse",
		onPayload(payload) {
			captured = payload as CapturedPayload;
			throw new PayloadCaptured();
		},
	}).result();
	if (!captured) throw new Error("Expected Codex Responses payload");
	return captured;
}

async function captureAnthropicPayload(
	compat: Model<"anthropic-messages">["compat"],
	modelId = "claude-opus-4-6",
	provider = "anthropic",
): Promise<AnthropicPayload> {
	let captured: AnthropicPayload | undefined;
	const target: Model<"anthropic-messages"> = {
		id: modelId,
		name: modelId,
		api: "anthropic-messages",
		provider,
		baseUrl: "http://127.0.0.1:9",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 8192,
		maxTokens: 1024,
		compat,
	};
	await streamAnthropic(target, context(target.api, target.provider), {
		apiKey: "test-key",
		onPayload(payload) {
			captured = payload as AnthropicPayload;
			throw new PayloadCaptured();
		},
	}).result();
	if (!captured) throw new Error("Expected Anthropic payload");
	return captured;
}

function topLevelToolNames(payload: CapturedPayload): string[] {
	return (payload.tools ?? []).flatMap((entry) => (entry.name ? [entry.name] : []));
}

describe("deferred tool provider payloads", () => {
	it("uses message-anchored additional_tools only when explicitly supported", async () => {
		const payload = await captureResponsesPayload({ supportsAdditionalTools: true });
		const addition = payload.input?.find((entry) => entry.type === "additional_tools");

		expect(topLevelToolNames(payload)).toEqual(["base"]);
		expect(addition).toMatchObject({ role: "developer", tools: [{ name: "late" }] });
	});

	it("uses client tool search only when explicitly supported", async () => {
		const payload = await captureResponsesPayload({ supportsToolSearch: true });
		const searchCall = payload.input?.find((entry) => entry.type === "tool_search_call");
		const searchOutput = payload.input?.find((entry) => entry.type === "tool_search_output");

		expect(topLevelToolNames(payload)).toEqual(["base"]);
		expect(searchCall).toMatchObject({ call_id: expect.any(String) });
		expect(searchOutput).toMatchObject({
			call_id: searchCall?.call_id,
			tools: [{ name: "late", defer_loading: true }],
		});
	});

	it("keeps the complete tool prefix for old or unsupported model metadata", async () => {
		const payload = await captureResponsesPayload(undefined);

		expect(topLevelToolNames(payload)).toEqual(["base", "late"]);
		expect(payload.input?.some((entry) => entry.type === "additional_tools" || entry.type === "tool_search_output")).toBe(
			false,
		);
	});

	it("applies the same explicit capability contract to Codex-compatible proxies", async () => {
		const payload = await captureCodexPayload({ supportsAdditionalTools: true });

		expect(topLevelToolNames(payload)).toEqual(["base"]);
		expect(payload.input?.find((entry) => entry.type === "additional_tools")).toMatchObject({
			tools: [{ name: "late" }],
		});
	});

	it("uses Anthropic tool references for capable first-party models", async () => {
		const payload = await captureAnthropicPayload(undefined);
		const resultBlocks = payload.messages
			.flatMap((message) => (typeof message.content === "string" ? [] : message.content))
			.filter((block) => block.type === "tool_result" || block.type === "text");
		const toolResult = resultBlocks.find((block) => block.type === "tool_result");

		expect(payload.tools).toMatchObject([
			{ name: "base" },
			{ name: "late", defer_loading: true },
	]);
		expect(toolResult?.content).toEqual([{ type: "tool_reference", tool_name: "late" }]);
		expect(resultBlocks).toContainEqual({ type: "text", text: "loaded" });
	});

	it("keeps Anthropic-compatible proxies eager unless capability is explicit", async () => {
		const eager = await captureAnthropicPayload(undefined, "claude-opus-4-6", "anthropic-proxy");
		const deferred = await captureAnthropicPayload(
			{ supportsToolReferences: true },
			"claude-opus-4-6",
			"anthropic-proxy",
		);

		expect(eager.tools?.map((entry) => entry.name)).toEqual(["base", "late"]);
		expect(eager.tools?.every((entry) => entry.defer_loading === undefined)).toBe(true);
		expect(deferred.tools).toMatchObject([
			{ name: "base" },
			{ name: "late", defer_loading: true },
		]);
	});
});
