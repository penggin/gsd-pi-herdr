import { describe, expect, it } from "vitest";
import { isModelsCatalog, isModelsCatalogOverlay } from "../src/model-catalog.ts";

function catalog(api: string, compat?: Record<string, unknown>) {
	return {
		demo: {
			model: {
				id: "model",
				name: "Model",
				api,
				provider: "demo",
				baseUrl: "https://example.com/v1",
				reasoning: true,
				thinkingLevelMap: { low: "low", high: "high", max: "xhigh" },
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 8192,
				...(compat && { compat }),
			},
		},
	};
}

describe("model catalog GPT compatibility", () => {
	it.each(["legacy", "options"])("accepts Responses %s cache retention without changing model metadata", (format) => {
		const models = catalog("openai-responses", {
			supportsTemperature: false,
			promptCacheRetentionFormat: format,
			supportsLongCacheRetention: true,
			supportsMaxOutputTokens: false,
		});
		const before = JSON.stringify(models);
		expect(isModelsCatalog(models)).toBe(true);
		expect(isModelsCatalogOverlay({ version: 1, models })).toBe(true);
		expect(JSON.stringify(models)).toBe(before);
	});

	it.each([true, false])("accepts Codex supportsTemperature=%s with proxy settings", (supportsTemperature) => {
		expect(isModelsCatalog(catalog("openai-codex-responses", {
			supportsTemperature,
			codexAuth: "bearer",
			codexEndpoint: "responses",
		}))).toBe(true);
	});

	for (const api of ["openai-responses", "openai-codex-responses"]) {
		it.each(["false", 0, null, {}])(`${api} rejects non-boolean supportsTemperature=%j`, (supportsTemperature) => {
			expect(isModelsCatalog(catalog(api, { supportsTemperature }))).toBe(false);
		});
	}

	it.each(["vendor", "", true, 0, null, {}])("rejects invalid cache retention format %j", (promptCacheRetentionFormat) => {
		const models = catalog("openai-responses", { promptCacheRetentionFormat });
		expect(isModelsCatalog(models)).toBe(false);
		expect(isModelsCatalogOverlay({ version: 1, models })).toBe(false);
	});

	it("preserves omitted compat defaults and existing extension fields", () => {
		expect(isModelsCatalog(catalog("openai-responses"))).toBe(true);
		expect(isModelsCatalog(catalog("openai-completions", {
			supportsStore: false,
			vendorExtension: { enabled: true },
		}))).toBe(true);
	});
});
