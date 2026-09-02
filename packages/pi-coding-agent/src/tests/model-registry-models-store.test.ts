import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { Api, Model } from "@gsd/pi-ai";
import { AuthStorage } from "../core/auth-storage.js";
import { ModelRegistry } from "../core/model-registry.js";
import { InMemoryCodingAgentModelsStore } from "../core/models-store.js";

function discoveredOpenAiModel(id: string): Model<Api> {
	return {
		provider: "openai",
		id,
		name: `Stored ${id}`,
		api: "openai-responses",
		baseUrl: "https://api.openai.com/v1",
		reasoning: true,
		input: ["text"],
		cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 32_000,
	};
}

test("model registry restores a fresh provider catalog from ModelsStore without network access", async () => {
	const store = new InMemoryCodingAgentModelsStore();
	await store.write("openai", {
		models: [discoveredOpenAiModel("stored-model")],
		checkedAt: Date.now(),
		etag: '"v1"',
	});
	const registry = ModelRegistry.inMemory(AuthStorage.inMemory(), store);

	const results = await registry.discoverModels(["openai"]);
	assert.equal(results.length, 1);
	assert.equal(results[0]?.models[0]?.id, "stored-model");
	assert.equal(registry.getAllWithDiscovered().some((model) => model.id === "stored-model"), true);
	assert.equal(registry.getModelsStore(), store);
});

test("model registry propagates discovery cancellation instead of converting it to a provider error", async () => {
	const store = new InMemoryCodingAgentModelsStore();
	const registry = ModelRegistry.inMemory(AuthStorage.inMemory(), store);
	const controller = new AbortController();
	controller.abort(new Error("discovery cancelled"));

	await assert.rejects(registry.discoverModels(["openai"], { signal: controller.signal }), /discovery cancelled/);
});
