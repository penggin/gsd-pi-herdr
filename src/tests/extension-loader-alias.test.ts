import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { createJiti } from "@mariozechner/jiti";
import { getAliases } from "@gsd/pi-coding-agent/core/extensions/loader.js";

test("jiti aliases resolve @gsd/agent-core exact and subpath specifiers", async (t) => {
	const aliases = getAliases();
	const agentCore = aliases["@gsd/agent-core"];
	assert.ok(agentCore, "@gsd/agent-core alias must be defined");

	if (!existsSync(agentCore)) {
		t.skip(`@gsd/agent-core dist not built at ${agentCore}`);
		return;
	}

	const jiti = createJiti(import.meta.url, { alias: aliases });
	const exact = (await jiti.import("@gsd/agent-core")) as Record<string, unknown>;
	assert.equal(typeof exact.prepareLifecycleHooks, "function");
	const subpath = (await jiti.import("@gsd/agent-core/lifecycle-hooks.js")) as Record<string, unknown>;
	assert.equal(typeof subpath.prepareLifecycleHooks, "function");

	const message = "@gsd/agent-core alias must point at the dist directory, not a file";
	assert.equal(statSync(agentCore).isDirectory(), true, message);
	assert.ok(existsSync(`${agentCore}/index.js`));
	assert.ok(existsSync(`${agentCore}/lifecycle-hooks.js`));
});
