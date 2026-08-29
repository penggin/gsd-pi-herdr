import assert from "node:assert/strict";
import test from "node:test";

import { localSubagentBackend } from "../local-backend.js";
import {
	resolveSubagentExecutionBackend,
	resolveSubagentRuntimePreference,
	type SubagentExecutionOperation,
} from "../resolver.js";
import type { SubagentExecutionBackend } from "../types.js";

test("M2 resolver preserves explicit local selection for every operation before external backend migration", () => {
	const operations: SubagentExecutionOperation[] = ["resume", "background", "chain", "parallel", "single"];
	for (const operation of operations) {
		assert.equal(resolveSubagentExecutionBackend(operation), localSubagentBackend);
	}
});

test("resolver accepts an injected local backend so caller routing is testable without process execution", () => {
	const fixture: SubagentExecutionBackend = {
		id: "fixture-local",
		isAvailable: () => true,
		async execute() {
			return { exitCode: 0, aborted: false };
		},
	};

	assert.equal(resolveSubagentExecutionBackend("resume", { local: fixture }), fixture);
});

test("resolver selects an explicitly preferred external backend without changing the local default", () => {
	const preferred: SubagentExecutionBackend = {
		id: "cmux-fixture",
		isAvailable: () => true,
		async execute() {
			return { exitCode: 0, aborted: false };
		},
	};

	assert.equal(resolveSubagentExecutionBackend("parallel", { preferred }), preferred);
	assert.equal(resolveSubagentExecutionBackend("parallel"), localSubagentBackend);
});

test("runtime policy prefers available Herdr over cmux", () => {
	assert.equal(resolveSubagentRuntimePreference({
		herdrEnabled: true,
		herdrRequired: true,
		herdrAvailable: true,
		cmuxSplitsEnabled: true,
	}), "herdr");
});

test("runtime policy keeps required unavailable Herdr selected so dispatch fails visibly", () => {
	assert.equal(resolveSubagentRuntimePreference({
		herdrEnabled: true,
		herdrRequired: true,
		herdrAvailable: false,
		cmuxSplitsEnabled: true,
	}), "herdr");
});

test("runtime policy permits pre-launch fallback only when unavailable Herdr is optional", () => {
	assert.equal(resolveSubagentRuntimePreference({
		herdrEnabled: true,
		herdrRequired: false,
		herdrAvailable: false,
		cmuxSplitsEnabled: true,
	}), "cmux");
	assert.equal(resolveSubagentRuntimePreference({
		herdrEnabled: true,
		herdrRequired: false,
		herdrAvailable: false,
		cmuxSplitsEnabled: false,
	}), "local");
});
