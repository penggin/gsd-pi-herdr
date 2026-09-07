import { describe, expect, it } from "vitest";
import { applyOpenAIGptPricing } from "../scripts/lib/openai-gpt-pricing.ts";
import { calculateCost } from "../src/models.ts";
import { MODELS } from "../src/models.generated.ts";
import type { Api, Model, Usage } from "../src/types.ts";

const expectedPrices = [
	{ id: "gpt-5.6-sol", input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5, tierOutput: 30 },
	{ id: "gpt-5.6-terra", input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2.5, tierOutput: 18 },
	{ id: "gpt-5.6-luna", input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25, tierOutput: 1.8 },
	{ id: "gpt-6-astra", input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5, tierOutput: 75 },
] as const;

describe.each(["openai", "openai-codex"] as const)("%s native GPT pricing", (provider) => {
	it.each(expectedPrices)("uses documented prices and cache-write rates for $id", (prices) => {
		const cost = {
			input: prices.input,
			output: prices.output,
			cacheRead: prices.cacheRead,
			cacheWrite: prices.cacheWrite,
			tiers: [{
				inputTokensAbove: 272_000,
				input: prices.input * 2,
				output: prices.tierOutput,
				cacheRead: prices.cacheRead * 2,
				cacheWrite: prices.cacheWrite * 2,
			}],
		};
		const generated = MODELS[provider][prices.id];
		expect(generated).toBeDefined();
		expect(generated.cost).toEqual(cost);

		const fromFeed: Model<Api> = { ...structuredClone(generated), cost: { input: 99, output: 99, cacheRead: 0, cacheWrite: 0 } };
		applyOpenAIGptPricing(fromFeed);
		expect(fromFeed).toEqual({ ...generated, cost });

		const usage: Usage = {
			input: 1,
			output: 1_000,
			cacheRead: 270_000,
			cacheWrite: 2_000,
			totalTokens: 273_001,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		};
		const calculated = calculateCost(generated, usage);
		expect(calculated.cacheWrite).toBeCloseTo(2_000 * prices.cacheWrite * 2 / 1_000_000, 12);
		expect(calculated.total).toBeCloseTo(
			(prices.input * 2 + 1_000 * prices.tierOutput + 270_000 * prices.cacheRead * 2 + 2_000 * prices.cacheWrite * 2) / 1_000_000,
			12,
		);
	});
});

describe("native pricing overlay boundaries", () => {
	it("does not alter other providers, custom routes, or model IDs", () => {
		const native = MODELS.openai["gpt-5.6-sol"];
		for (const variant of [
			{ provider: "github-copilot", id: native.id },
			{ provider: "opencodex", id: native.id },
			{ provider: "custom-openai", id: native.id },
			{ provider: "openai", id: "gpt-5.5" },
			{ provider: "openai", id: "gpt-5.6" },
			{ provider: "custom-openai", id: "gpt-6-astra" },
			{ provider: "openai", id: "constructor" },
		]) {
			const model: Model<Api> = { ...structuredClone(native), ...variant };
			const before = structuredClone(model);
			applyOpenAIGptPricing(model);
			expect(model).toEqual(before);
		}
	});
});
