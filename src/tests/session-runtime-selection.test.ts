import assert from "node:assert/strict";
import test from "node:test";

import { resolveInternalSessionBackend } from "../session-runtime-selection.js";

test("internal session backend defaults to legacy and accepts only the two migration backends", () => {
	assert.equal(resolveInternalSessionBackend(undefined), "legacy-v3");
	assert.equal(resolveInternalSessionBackend("legacy-v3"), "legacy-v3");
	assert.equal(resolveInternalSessionBackend("harness-v4"), "harness-v4");
	assert.throws(
		() => resolveInternalSessionBackend("future-v5"),
		/Unsupported GSD_INTERNAL_SESSION_BACKEND: future-v5/,
	);
});
