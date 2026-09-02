import type { AssistantMessage, AssistantMessageEvent, Model } from "@gsd/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { streamProxy } from "../src/proxy.ts";

const model: Model<"openai-responses"> = {
	id: "proxy-model",
	name: "Proxy Model",
	api: "openai-responses",
	provider: "openai",
	baseUrl: "https://api.example.invalid/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8192,
	maxTokens: 2048,
};

const usage: AssistantMessage["usage"] = {
	input: 1,
	output: 2,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 3,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

afterEach(() => {
	vi.unstubAllGlobals();
});

async function collect(body: string): Promise<{ events: AssistantMessageEvent[]; result: AssistantMessage }> {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response(body, { status: 200 })),
	);
	const stream = streamProxy(model, { systemPrompt: "", messages: [] }, {
		authToken: "test-token",
		proxyUrl: "https://proxy.example.invalid",
	});
	const events: AssistantMessageEvent[] = [];
	for await (const event of stream) events.push(event);
	return { events, result: await stream.result() };
}

describe("streamProxy EOF settlement", () => {
	it("processes a terminal event that is not newline-terminated", async () => {
		const start = `data: ${JSON.stringify({ type: "start" })}\n\n`;
		const done = `data: ${JSON.stringify({ type: "done", reason: "stop", usage })}`;

		const { events, result } = await collect(start + done);

		expect(events.map(({ type }) => type)).toEqual(["start", "done"]);
		expect(result.stopReason).toBe("stop");
		expect(result.usage).toEqual(usage);
	});

	it("returns an error instead of leaving result pending after a premature EOF", async () => {
		const { events, result } = await collect(`data: ${JSON.stringify({ type: "start" })}\n\n`);

		expect(events.map(({ type }) => type)).toEqual(["start", "error"]);
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toBe("Connection closed by proxy server before the response completed");
	});
});
