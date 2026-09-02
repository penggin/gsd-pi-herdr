import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { buildBaseOptions, clampMaxTokensToContext } from "../src/providers/simple-options.ts";
import type { AssistantMessage, Context, Model, ToolResultMessage, Usage } from "../src/types.ts";
import { estimateContextTokens } from "../src/utils/estimate.ts";

function usage(totalTokens: number): Usage {
	return {
		input: totalTokens,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function assistant(totalTokens: number, timestamp: number): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "done" }],
		api: "openai-responses",
		provider: "test",
		model: "test",
		usage: usage(totalTokens),
		stopReason: "stop",
		timestamp,
	};
}

function model(contextWindow = 10_000, maxTokens = 4_000): Model<"openai-responses"> {
	return {
		id: "test",
		name: "test",
		api: "openai-responses",
		provider: "test",
		baseUrl: "http://127.0.0.1:9/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow,
		maxTokens,
	};
}

describe("context-aware output budgeting", () => {
	it("uses the latest applicable provider usage plus trailing messages", () => {
		const context: Context = {
			messages: [assistant(6_000, 1), { role: "user", content: "x".repeat(400), timestamp: 2 }],
		};

		expect(estimateContextTokens(context)).toMatchObject({
			tokens: 6_100,
			usageTokens: 6_000,
			trailingTokens: 100,
			lastUsageIndex: 0,
		});
		expect(clampMaxTokensToContext(model(), context, 4_000)).toBe(1);
	});

	it("ignores stale usage behind a newer inserted prefix message", () => {
		const context: Context = {
			systemPrompt: "s".repeat(400),
			messages: [
				{ role: "user", content: "compacted briefing", timestamp: 100 },
				assistant(9_000, 50),
				{ role: "user", content: "continue", timestamp: 101 },
			],
		};

		const estimate = estimateContextTokens(context);
		expect(estimate.lastUsageIndex).toBeNull();
		expect(estimate.usageTokens).toBe(0);
		expect(estimate.tokens).toBeLessThan(500);
	});

	it("counts tool definitions introduced after the latest usage boundary", () => {
		const result: ToolResultMessage = {
			role: "toolResult",
			toolCallId: "call-1",
			toolName: "loader",
			content: [{ type: "text", text: "ok" }],
			addedToolNames: ["late"],
			isError: false,
			timestamp: 2,
		};
		const base = estimateContextTokens({ messages: [assistant(1_000, 1), result] });
		const withTool = estimateContextTokens({
			messages: [assistant(1_000, 1), result],
			tools: [{ name: "late", description: "x".repeat(400), parameters: Type.Object({}) }],
		});

		expect(withTool.tokens).toBeGreaterThan(base.tokens + 90);
		expect(withTool.trailingTokens).toBeGreaterThan(base.trailingTokens + 90);
	});

	it("clamps default and explicit output budgets while retaining a positive minimum", () => {
		const context: Context = { messages: [{ role: "user", content: "x".repeat(4_000), timestamp: 1 }] };

		expect(buildBaseOptions(model(), context).maxTokens).toBe(4_000);
		expect(buildBaseOptions(model(), context, { maxTokens: 2_000 }).maxTokens).toBe(2_000);
		expect(clampMaxTokensToContext(model(5_000), context, 4_000)).toBe(1);
		expect(clampMaxTokensToContext(model(0), context, -5)).toBe(1);
	});
});
