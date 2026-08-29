import assert from "node:assert/strict";
import test from "node:test";

import { localSubagentBackend } from "../local-backend.js";
import {
	resolveSubagentExecutionBackend,
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
