import { describe, expect, it } from "vitest";
import { createNativeAstraModels } from "../scripts/lib/openai-astra-models.ts";
import { getModels, getSupportedThinkingLevels } from "../src/models.ts";
import { MODELS } from "../src/models.generated.ts";

describe("native GPT-6 Astra model metadata", () => {
	it.each([
		{ provider: "openai", api: "openai-responses", contextWindow: 1_050_000, baseUrl: "https://api.openai.com/v1" },
		{ provider: "openai-codex", api: "openai-codex-responses", contextWindow: 872_000, baseUrl: "https://chatgpt.com/backend-api" },
	] as const)("makes Astra discoverable through $provider with verified metadata", ({ provider, api, contextWindow, baseUrl }) => {
		const astra = getModels(provider).find((model) => model.id === "gpt-6-astra");
		expect(astra).toBeDefined();
		expect(astra).toMatchObject({
			id: "gpt-6-astra",
			name: "GPT-6 Astra",
			provider,
			api,
			baseUrl,
			reasoning: true,
			input: ["text", "image"],
			contextWindow,
			maxTokens: 128_000,
			thinkingLevelMap: { off: null, minimal: "low", xhigh: "xhigh", max: "max" },
		});
		expect(getSupportedThinkingLevels(astra!)).toEqual(["minimal", "low", "medium", "high", "xhigh", "max"]);
		expect(astra!.thinkingLevelMap?.medium).toBeUndefined();
	});

	it("recreates the pinned entries for offline generator refreshes", () => {
		const models = createNativeAstraModels();
		expect(models).toHaveLength(2);
		for (const model of models) {
			const generated = model.provider === "openai" ? MODELS.openai : MODELS["openai-codex"];
			expect(model).toEqual(generated["gpt-6-astra"]);
		}
		models[0].cost.input = 999;
		expect(createNativeAstraModels()[0].cost.input).toBe(10);
	});

	it("limits the new entries to native providers and retains the existing Sol and Luna entries", () => {
		const astraProviders = Object.entries(MODELS)
			.filter(([, models]) => Object.hasOwn(models, "gpt-6-astra"))
			.map(([provider]) => provider);
		expect(astraProviders).toEqual(["openai", "openai-codex"]);
		for (const provider of ["openai", "openai-codex"] as const) {
			for (const id of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"] as const) {
				expect(MODELS[provider][id]).toBeDefined();
			}
		}
	});
});
