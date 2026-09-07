import { afterEach, describe, expect, it, vi } from "vitest";
import { streamOpenAICodexResponses } from "../src/providers/openai-codex-responses.ts";
import { convertResponsesMessages } from "../src/providers/openai-responses-shared.ts";
import { streamOpenAIResponses } from "../src/providers/openai-responses.ts";
import type { AssistantMessage, Context, Model } from "../src/types.ts";

afterEach(() => vi.restoreAllMocks());

describe("OpenAI Responses assistant phase replay", () => {
	it.each(["openai-responses", "openai-codex-responses"] as const)(
		"preserves phases through SSE and transcript serialization, with an append-stable %s history",
		async (api) => {
			const model: Model<typeof api> = {
				id: "gpt-5.6-sol",
				name: "GPT-5.6 Sol",
				api,
				provider: api === "openai-responses" ? "openai" : "openai-codex",
				baseUrl: "https://proxy.example/v1",
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 100000,
				maxTokens: 1000,
			};
			const items = ["commentary", "final_answer"].map((phase, index) => ({
				type: "message",
				role: "assistant",
				id: `msg_${index}`,
				phase,
				status: "completed",
				content: [{ type: "output_text", text: `${phase} text`, annotations: [] }],
			}));
			const events = items.flatMap((item, output_index) => [
				{
					type: "response.output_item.added",
					output_index,
					item: { ...item, status: "in_progress", content: [] },
				},
				{ type: "response.output_item.done", output_index, item },
			]);
			const terminal = {
				type: "response.completed",
				response: { id: "resp_phases", status: "completed", output: items },
			};
			const sse = [...events, terminal].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
			vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(sse, {
				status: 200,
				headers: { "content-type": "text/event-stream" },
			}));

			const context: Context = {
				systemPrompt: "A stable instruction prefix.",
				messages: [{ role: "user", content: "Complete the task.", timestamp: 1 }],
			};
			const options = { apiKey: "opaque-test-token", transport: "sse" as const };
			const result = await (api === "openai-responses"
				? streamOpenAIResponses(model as Model<"openai-responses">, context, options)
				: streamOpenAICodexResponses(model as Model<"openai-codex-responses">, context, options)
			).result();
			expect(result.stopReason).toBe("stop");

			// Sessions persist JSON, so verify metadata survives that boundary too.
			const persisted = JSON.parse(JSON.stringify(result)) as AssistantMessage;
			const history: Context = { ...context, messages: [...context.messages, persisted] };
			const providers = new Set(["openai", "openai-codex"]);
			const replay = convertResponsesMessages(model, history, providers);
			expect(replay.filter((item) => item.type === "message")).toEqual(items);

			const next = convertResponsesMessages(model, {
				...history,
				messages: [...history.messages, { role: "user", content: "Continue.", timestamp: result.timestamp + 1 }],
			}, providers);
			expect(next).toHaveLength(replay.length + 1);
			expect(JSON.stringify(next.slice(0, replay.length))).toBe(JSON.stringify(replay));
		},
	);
});
