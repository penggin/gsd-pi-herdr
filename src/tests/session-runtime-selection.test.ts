import assert from "node:assert/strict";
import test from "node:test";

import {
	resolveInternalSessionBackend,
	resolvePublicSessionBackend,
	resolveSessionBackendSelection,
} from "../session-runtime-selection.js";

test("internal session backend defaults to legacy and accepts only the two migration backends", () => {
	assert.equal(resolveInternalSessionBackend(undefined), "legacy-v3");
	assert.equal(resolveInternalSessionBackend("legacy-v3"), "legacy-v3");
	assert.equal(resolveInternalSessionBackend("harness-v4"), "harness-v4");
	assert.throws(
		() => resolveInternalSessionBackend("future-v5"),
		/Unsupported GSD_INTERNAL_SESSION_BACKEND: future-v5/,
	);
});

test("selection precedence is CLI, public environment, internal seam, then legacy default", () => {
	assert.equal(resolveSessionBackendSelection({ environment: {} }), "legacy-v3");
	assert.equal(
		resolveSessionBackendSelection({ environment: { GSD_INTERNAL_SESSION_BACKEND: "harness-v4" } }),
		"harness-v4",
	);
	assert.equal(
		resolveSessionBackendSelection({
			environment: {
				GSD_SESSION_BACKEND: "legacy-v3",
				GSD_INTERNAL_SESSION_BACKEND: "harness-v4",
			},
		}),
		"legacy-v3",
	);
	assert.equal(
		resolveSessionBackendSelection({
			backend: "harness-v4",
			environment: { GSD_SESSION_BACKEND: "legacy-v3" },
		}),
		"harness-v4",
	);
});

test("public session backend selection is strict and names its source", () => {
	assert.equal(resolvePublicSessionBackend("legacy-v3"), "legacy-v3");
	assert.equal(resolvePublicSessionBackend("harness-v4"), "harness-v4");
	assert.throws(
		() => resolvePublicSessionBackend("future-v5"),
		/Unsupported --session-backend: future-v5.*legacy-v3, harness-v4/,
	);
	assert.throws(
		() => resolvePublicSessionBackend("future-v5", "GSD_SESSION_BACKEND"),
		/Unsupported GSD_SESSION_BACKEND: future-v5/,
	);
});
