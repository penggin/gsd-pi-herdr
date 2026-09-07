import { describe, expect, it } from "vitest";
import { calculateCost } from "../src/models.ts";
import type { Model, Usage } from "../src/types.ts";

const model: Model<"openai-codex-responses"> = {
	id: "tiered-cost-fixture",
	name: "Tiered cost fixture",
	api: "openai-codex-responses",
	provider: "openai-codex",
	baseUrl: "https://example.invalid",
	reasoning: true,
	input: ["text"],
	cost: {
		input: 2,
		output: 4,
		cacheRead: 0.5,
		cacheWrite: 3,
		tiers: [{ inputTokensAbove: 100_000, input: 7, output: 14, cacheRead: 2, cacheWrite: 9 }],
	},
	contextWindow: 400_000,
	maxTokens: 16_000,
};

function usage(input: number, cacheRead = 0, cacheWrite = 0, output = 1_000): Usage {
	return {
		input,
		output,
		cacheRead,
		cacheWrite,
		totalTokens: input + cacheRead + cacheWrite + output,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

describe("model cost tiers with cached input", () => {
	it.each([
		{ name: "uncached input", input: 100_001, read: 0, write: 0 },
		{ name: "cache reads", input: 1, read: 100_000, write: 0 },
		{ name: "cache writes", input: 1, read: 0, write: 100_000 },
		{ name: "cache reads and writes", input: 1, read: 60_000, write: 40_000 },
		{ name: "entirely cached input", input: 0, read: 100_001, write: 0 },
	])("selects the higher tier using the full prompt for $name", ({ input, read, write }) => {
		const tokens = usage(input, read, write);
		const cost = calculateCost(model, tokens);

		expect(cost.input).toBeCloseTo(input * 7 / 1_000_000, 12);
		expect(cost.output).toBeCloseTo(1_000 * 14 / 1_000_000, 12);
		expect(cost.cacheRead).toBeCloseTo(read * 2 / 1_000_000, 12);
		expect(cost.cacheWrite).toBeCloseTo(write * 9 / 1_000_000, 12);
		expect(cost.total).toBeCloseTo((input * 7 + 1_000 * 14 + read * 2 + write * 9) / 1_000_000, 12);
		expect(tokens.totalTokens).toBe(101_001);
		expect(cost).toBe(tokens.cost);
	});

	it("keeps base prices exactly at the full-input boundary and excludes output tokens", () => {
		const tokens = usage(1_000, 59_000, 40_000, 200_000);
		const cost = calculateCost(model, tokens);

		expect(cost.input).toBeCloseTo(1_000 * 2 / 1_000_000, 12);
		expect(cost.output).toBeCloseTo(200_000 * 4 / 1_000_000, 12);
		expect(cost.cacheRead).toBeCloseTo(59_000 * 0.5 / 1_000_000, 12);
		expect(cost.cacheWrite).toBeCloseTo(40_000 * 3 / 1_000_000, 12);
	});

	it("selects the highest applicable threshold without mutating model tiers", () => {
		const tiers = [
			{ inputTokensAbove: 200_000, input: 11 },
			{ inputTokensAbove: 100_000, input: 7 },
		];
		const target = { ...model, cost: { ...model.cost, tiers } };
		const cost = calculateCost(target, usage(1_000, 100_000, 100_000));

		expect(cost.input).toBeCloseTo(1_000 * 11 / 1_000_000, 12);
		expect(cost.output).toBeCloseTo(1_000 * model.cost.output / 1_000_000, 12);
		expect(cost.cacheRead).toBeCloseTo(100_000 * model.cost.cacheRead / 1_000_000, 12);
		expect(cost.cacheWrite).toBeCloseTo(100_000 * model.cost.cacheWrite / 1_000_000, 12);
		expect(tiers.map((tier) => tier.inputTokensAbove)).toEqual([200_000, 100_000]);
	});

	it("honors custom zero rates in an applicable tier", () => {
		const target = {
			...model,
			cost: {
				...model.cost,
				tiers: [{ inputTokensAbove: 100_000, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }],
			},
		};

		expect(calculateCost(target, usage(1, 60_000, 40_000))).toEqual({
			input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0,
		});
	});

	it("retains custom base rates when no tiers are configured", () => {
		const target = { ...model, cost: { input: 5, output: 13, cacheRead: 0.75, cacheWrite: 8 } };
		const cost = calculateCost(target, usage(1_000, 100_000, 100_000));

		expect(cost.input).toBeCloseTo(0.005, 12);
		expect(cost.output).toBeCloseTo(0.013, 12);
		expect(cost.cacheRead).toBeCloseTo(0.075, 12);
		expect(cost.cacheWrite).toBeCloseTo(0.8, 12);
		expect(cost.total).toBeCloseTo(0.893, 12);
	});
});
