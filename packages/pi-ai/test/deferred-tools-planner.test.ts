import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import type { AssistantMessage, Context, Tool, ToolResultMessage, UserMessage } from "../src/types.ts";
import { splitDeferredTools } from "../src/utils/deferred-tools.ts";

function tool(name: string): Tool {
	return { name, description: name, parameters: Type.Object({}) };
}

function user(text: string): UserMessage {
	return { role: "user", content: text, timestamp: 1 };
}

function assistantToolCall(name: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "toolCall", id: `call-${name}`, name, arguments: {} }],
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
		stopReason: "toolUse",
		timestamp: 2,
	};
}

function toolResult(toolName: string, addedToolNames: string[]): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: `call-${toolName}`,
		toolName,
		content: [{ type: "text", text: "ok" }],
		addedToolNames,
		isError: false,
		timestamp: 3,
	};
}

function context(tools: Tool[], messages: Context["messages"]): Context {
	return { systemPrompt: "", tools, messages };
}

describe("splitDeferredTools", () => {
	it("keeps every tool immediate when deferred loading is disabled", () => {
		const result = splitDeferredTools(context([tool("base"), tool("late")], [toolResult("base", ["late"])]), false);

		expect(result.immediate.map((entry) => entry.name)).toEqual(["base", "late"]);
		expect(result.deferred.size).toBe(0);
	});

	it("defers a current tool at its append-only transcript boundary", () => {
		const result = splitDeferredTools(
			context([tool("base"), tool("late")], [user("start"), assistantToolCall("base"), toolResult("base", ["late"])]),
			true,
		);

		expect(result.immediate.map((entry) => entry.name)).toEqual(["base"]);
		expect([...result.deferred.keys()]).toEqual(["late"]);
	});

	it("keeps a tool immediate when it was already used before the marker", () => {
		const result = splitDeferredTools(
			context(
				[tool("base"), tool("late")],
				[assistantToolCall("late"), toolResult("late", []), assistantToolCall("base"), toolResult("base", ["late"])],
			),
			true,
		);

		expect(result.immediate.map((entry) => entry.name)).toEqual(["base", "late"]);
		expect(result.deferred.size).toBe(0);
	});

	it("normalizes names and ignores markers for tools no longer in the active set", () => {
		const result = splitDeferredTools(
			context([tool("Read"), tool("base")], [toolResult("base", ["read", "removed"])]),
			true,
			(name) => name.toLowerCase(),
		);

		expect(result.immediate.map((entry) => entry.name)).toEqual(["base"]);
		expect([...result.deferred.keys()]).toEqual(["read"]);
	});

	it("deduplicates active definitions by normalized name", () => {
		const first = tool("Read");
		const replacement = tool("read");
		const result = splitDeferredTools(context([first, replacement], []), true, (name) => name.toLowerCase());

		expect(result.immediate).toEqual([replacement]);
	});
});
