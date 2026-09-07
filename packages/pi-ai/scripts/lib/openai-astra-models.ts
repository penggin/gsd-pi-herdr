import type { Api, Model } from "../../src/types.ts";
import { applyOpenAIGptPricing } from "./openai-gpt-pricing.ts";

/** Pinned native entries override feed metadata after provider/model deduplication. */
export function createNativeAstraModels(): Model<Api>[] {
	// API context, output limit, and reasoning levels verified 2026-09-07:
	// https://developers.openai.com/api/docs/models/gpt-6-astra
	// Codex context is independently observed in Codex 0.153.4's installed
	// OpenCodex catalog: Astra context_window/max_context_window are both 872000.
	const targets = [
		{ provider: "openai", api: "openai-responses", baseUrl: "https://api.openai.com/v1", contextWindow: 1_050_000 },
		{ provider: "openai-codex", api: "openai-codex-responses", baseUrl: "https://chatgpt.com/backend-api", contextWindow: 872_000 },
	] as const;
	return targets.map((target) => {
		const model: Model<Api> = {
			id: "gpt-6-astra",
			name: "GPT-6 Astra",
			...target,
			reasoning: true,
			thinkingLevelMap: { off: null, minimal: "low", xhigh: "xhigh", max: "max" },
			input: ["text", "image"],
			cost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
			maxTokens: 128_000,
		};
		applyOpenAIGptPricing(model);
		return model;
	});
}
