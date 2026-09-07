import type { Api, Model } from "../../src/types.ts";
import { roundCost } from "./model-cost.ts";

// Official native API prices, verified 2026-09-07:
// https://developers.openai.com/api/docs/models/gpt-5.6-sol
// https://developers.openai.com/api/docs/models/gpt-5.6-terra
// https://developers.openai.com/api/docs/models/gpt-5.6-luna
// https://developers.openai.com/api/docs/models/gpt-6-astra
// Cache writes cost 1.25x uncached input; >272K input costs 2x input
// (including cache rates) and 1.5x output for the whole request.
// Codex uses these as API-equivalent estimates, not subscription invoices.
const NATIVE_GPT_PRICES: Readonly<Record<string, { input: number; output: number; cacheRead: number }>> = {
	"gpt-5.6-sol": { input: 4, output: 20, cacheRead: 0.4 },
	"gpt-5.6-terra": { input: 2, output: 12, cacheRead: 0.2 },
	"gpt-5.6-luna": { input: 0.2, output: 1.2, cacheRead: 0.02 },
	"gpt-6-astra": { input: 10, output: 50, cacheRead: 1 },
};

/** Override feed prices only for the documented native GPT catalog entries. */
export function applyOpenAIGptPricing(model: Model<Api>): void {
	if (model.provider !== "openai" && model.provider !== "openai-codex") return;
	if (!Object.hasOwn(NATIVE_GPT_PRICES, model.id)) return;
	const prices = NATIVE_GPT_PRICES[model.id];

	model.cost = {
		...prices,
		cacheWrite: roundCost(prices.input * 1.25),
		tiers: [{
			inputTokensAbove: 272_000,
			input: roundCost(prices.input * 2),
			output: roundCost(prices.output * 1.5),
			cacheRead: roundCost(prices.cacheRead * 2),
			cacheWrite: roundCost(prices.input * 2 * 1.25),
		}],
	};
}
