import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertStandaloneSessionBackend } from "./standalone-session-backend.js";

describe("standalone agent-modes session backend", () => {
	it("accepts only its explicit legacy backend", () => {
		assert.doesNotThrow(() => assertStandaloneSessionBackend(undefined));
		assert.doesNotThrow(() => assertStandaloneSessionBackend("legacy-v3"));
		assert.throws(
			() => assertStandaloneSessionBackend("harness-v4"),
			/root GSD CLI.*harness-v4/,
		);
		assert.throws(
			() => assertStandaloneSessionBackend("future-v5"),
			/root GSD CLI.*future-v5/,
		);
	});
});
