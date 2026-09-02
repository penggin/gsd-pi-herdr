import type { AgentTool } from "@gsd/pi-agent-core";
import {
	type AssistantMessage,
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	fauxToolCall,
	type Message,
} from "@gsd/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "../harness.ts";

function withInputUsage(message: AssistantMessage, input: number): AssistantMessage {
	return {
		...message,
		usage: {
			input,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: input,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	};
}

describe("regression #6879: post-tool compaction", () => {
	let harness: Harness | undefined;

	afterEach(() => {
		harness?.cleanup();
		harness = undefined;
	});

	it("compacts a large tool result before the next provider request in the same run", async () => {
		const toolResult = `large-tool-result:${"x".repeat(6800)}`;
		const largeTool: AgentTool = {
			name: "large_result",
			label: "Large result",
			description: "Returns enough content to cross the compaction threshold",
			parameters: Type.Object({}),
			execute: async () => ({ content: [{ type: "text", text: toolResult }], details: {} }),
		};
		const order: string[] = [];
		harness = await createHarness({
			models: [{ id: "faux-1", contextWindow: 2600, maxTokens: 100 }],
			settings: { compaction: { enabled: true, reserveTokens: 400, keepRecentTokens: 1750 } },
			tools: [largeTool],
			extensionFactories: [
				(pi) => {
					pi.on("session_before_compact", (event) => {
						order.push("compaction");
						return {
							compaction: {
								summary: "compacted history",
								firstKeptEntryId: event.preparation.firstKeptEntryId,
								tokensBefore: event.preparation.tokensBefore,
								details: {},
							},
						};
					});
				},
			],
		});
		await harness.session.bindExtensions({});

		type ResponseStep = AssistantMessage | ((messages: Message[]) => AssistantMessage);
		const responses: ResponseStep[] = [
			withInputUsage(fauxAssistantMessage(`old-history:${"a".repeat(800)}`), 400),
			withInputUsage(fauxAssistantMessage(`recent-history:${"b".repeat(800)}`), 800),
			withInputUsage(fauxAssistantMessage(fauxToolCall("large_result", {}), { stopReason: "toolUse" }), 1800),
			(messages) => {
				order.push("provider");
				resumedRequest = JSON.stringify(messages);
				return fauxAssistantMessage("finished after compaction");
			},
		];
		let resumedRequest = "";
		harness.session.agent.streamFn = (model, context) => {
			const stream = createAssistantMessageEventStream();
			queueMicrotask(() => {
				const step = responses.shift();
				if (!step) throw new Error("No response queued");
				const response = typeof step === "function" ? step(context.messages) : step;
				const message = { ...response, api: model.api, provider: model.provider, model: model.id };
				stream.push({ type: "done", reason: message.stopReason, message });
			});
			return stream;
		};

		await harness.session.prompt("seed old history");
		await harness.session.prompt("seed recent history");
		const agentStartsBefore = harness.eventsOfType("agent_start").length;
		await harness.session.prompt("run the large tool");

		expect(order).toEqual(["compaction", "provider"]);
		expect(harness.eventsOfType("agent_start")).toHaveLength(agentStartsBefore + 1);
		expect(harness.eventsOfType("compaction_start")).toEqual([{ type: "compaction_start", reason: "threshold" }]);
		expect(resumedRequest).toContain("compacted history");
		expect(resumedRequest).toContain("large-tool-result");
		expect(harness.session.getLastAssistantText()).toBe("finished after compaction");
	});
});
