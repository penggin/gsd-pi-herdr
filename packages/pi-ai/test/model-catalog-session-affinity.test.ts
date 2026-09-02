import { describe, expect, it } from "vitest";
import { isModelsCatalog } from "../src/model-catalog.ts";

function catalog(sessionAffinityFormat: string) {
	return {
		demo: {
			model: {
				id: "model",
				name: "Model",
				api: "openai-responses",
				provider: "demo",
				baseUrl: "https://example.com/v1",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 1000,
				maxTokens: 100,
				compat: { sessionAffinityFormat },
			},
		},
	};
}

describe("model catalog session affinity", () => {
	it.each(["openai", "openai-nosession", "openrouter"])("accepts the %s format", (format) => {
		expect(isModelsCatalog(catalog(format))).toBe(true);
	});

	it("rejects an unknown format", () => {
		expect(isModelsCatalog(catalog("vendor-specific"))).toBe(false);
	});
});
