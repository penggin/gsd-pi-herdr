import { afterEach, describe, expect, it } from "vitest";
import { assistantMsg, userMsg } from "../../utilities.ts";
import { createHarness, type Harness } from "../harness.ts";

describe("issue #3688 tree cancellation compaction state", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("clears branch summary state when session_before_tree cancels navigation", async () => {
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("session_before_tree", () => ({ cancel: true }));
				},
			],
		});
		harnesses.push(harness);

		const targetId = harness.sessionManager.appendMessage(userMsg("first"));
		harness.sessionManager.appendMessage(assistantMsg("reply"));
		const currentLeafId = harness.sessionManager.appendMessage(userMsg("second"));

		expect(harness.sessionManager.getLeafId()).toBe(currentLeafId);

		const result = await harness.session.navigateTree(targetId, { summarize: false });

		expect(result).toEqual({ cancelled: true });
		expect(harness.session.isCompacting).toBe(false);
		expect(harness.sessionManager.getLeafId()).toBe(currentLeafId);
	});

	it("persists usage from an extension-provided branch summary", async () => {
		const usage = {
			input: 1,
			output: 2,
			cacheRead: 3,
			cacheWrite: 4,
			totalTokens: 10,
			cost: { input: 0.1, output: 0.2, cacheRead: 0.3, cacheWrite: 0.4, total: 1 },
		};
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("session_before_tree", () => ({ summary: { summary: "branch summary", usage } }));
				},
			],
		});
		harnesses.push(harness);

		const targetId = harness.sessionManager.appendMessage(userMsg("first"));
		harness.sessionManager.appendMessage(assistantMsg("reply"));
		harness.sessionManager.appendMessage(userMsg("second"));

		const result = await harness.session.navigateTree(targetId, { summarize: true });

		expect(result.summaryEntry?.usage).toEqual(usage);
	});
});
