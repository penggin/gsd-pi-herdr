import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { getModels, type Api, type Model } from "@gsd/pi-ai";
import { AuthStorage } from "../core/auth-storage.js";
import { ModelRegistry } from "../core/model-registry.js";
import { applyExtensionProviderModels, mergeProviderConfig } from "../core/provider-composer.js";

function tempRegistry(t: TestContext): { registry: ModelRegistry; target: Model<Api>; directory: string } {
	const directory = mkdtempSync(join(tmpdir(), "gsd-provider-composition-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const target = (getModels("anthropic") as Model<Api>[])[0]!;
	writeFileSync(
		join(directory, "models.json"),
		JSON.stringify({ providers: { anthropic: { baseUrl: "https://models-json.invalid/v1" } } }),
	);
	return {
		registry: ModelRegistry.create(AuthStorage.create(join(directory, "auth.json")), join(directory, "models.json")),
		target,
		directory,
	};
}

test("provider composition keeps models.json below repeatable extension overrides", async (t) => {
	const { registry, target } = tempRegistry(t);
	assert.equal(registry.find("anthropic", target.id)?.baseUrl, "https://models-json.invalid/v1");

	registry.registerProvider("anthropic", {
		baseUrl: "https://extension.invalid/v1",
		headers: { "x-extension": "enabled" },
	});
	registry.registerProvider("anthropic", { name: "Extension Anthropic" });

	const composed = registry.find("anthropic", target.id);
	assert.equal(composed?.baseUrl, "https://extension.invalid/v1");
	assert.equal(registry.getProviderDisplayName("anthropic"), "Extension Anthropic");
	const request = await registry.getApiKeyAndHeaders(composed!);
	assert.equal(request.ok, true);
	if (request.ok) assert.equal(request.headers?.["x-extension"], "enabled");

	registry.unregisterProvider("anthropic");
	assert.equal(registry.find("anthropic", target.id)?.baseUrl, "https://models-json.invalid/v1");
});

test("extension model replacement is a pure final composition layer", () => {
	const base = (getModels("anthropic") as Model<Api>[]).slice(0, 2);
	const config = mergeProviderConfig(undefined, {
		api: "anthropic-messages",
		baseUrl: "https://extension.invalid/v1",
		authMode: "none",
		models: [
			{
				id: "extension-only",
				name: "Extension only",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 32_000,
				maxTokens: 4_096,
			},
		],
	});
	const composed = applyExtensionProviderModels(base, "anthropic", config);

	assert.deepEqual(base.map((model) => model.id), (getModels("anthropic") as Model<Api>[]).slice(0, 2).map((model) => model.id));
	assert.deepEqual(composed.filter((model) => model.provider === "anthropic").map((model) => model.id), ["extension-only"]);
});
