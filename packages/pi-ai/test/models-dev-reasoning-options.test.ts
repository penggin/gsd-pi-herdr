import { describe, expect, it } from "vitest";
import { getEffortThinkingLevelMap } from "../scripts/models-dev-reasoning-options.ts";

describe("models.dev reasoning effort metadata", () => {
	it("exposes only verified GLM-5.3 effort levels", () => {
		expect(getEffortThinkingLevelMap([{ type: "effort", values: ["low", "high", "max"] }])).toEqual({
			off: null,
			minimal: null,
			low: "low",
			medium: null,
			high: "high",
			xhigh: null,
			max: "max",
		});
	});

	it("does not invent levels for toggle-only metadata", () => {
		expect(getEffortThinkingLevelMap([{ type: "toggle" }])).toBeUndefined();
	});
});
