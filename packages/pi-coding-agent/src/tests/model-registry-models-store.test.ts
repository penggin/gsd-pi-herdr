import { strict as assert } from "node:assert";
import { createServer } from "node:http";
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

test("forced discovery revalidates a stored catalog and preserves it on 304", async (t) => {
	let requestPath: string | undefined;
	let requestEtag: string | undefined;
	let requestModified: string | undefined;
	const server = createServer((request, response) => {
		requestPath = request.url;
		requestEtag = request.headers["if-none-match"];
		requestModified = request.headers["if-modified-since"];
		response.writeHead(304).end();
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => server.close());
	const address = server.address();
	assert.ok(address && typeof address === "object");

	const store = new InMemoryCodingAgentModelsStore();
	const lastModified = Date.parse("2026-01-02T03:04:05.000Z");
	await store.write("test-proxy", {
		models: [{ ...discoveredOpenAiModel("stored-model"), provider: "test-proxy" }],
		checkedAt: 1,
		etag: '"catalog-v1"',
		lastModified,
	});
	const registry = ModelRegistry.inMemory(AuthStorage.inMemory(), store);
	registry.registerProvider("test-proxy", {
		api: "openai-responses",
		baseUrl: `http://127.0.0.1:${address.port}/v1`,
		authMode: "none",
		models: [{
			id: "baseline",
			name: "Baseline",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 10_000,
			maxTokens: 1_000,
		}],
	});

	const results = await registry.discoverModels(["test-proxy"], { force: true });
	assert.equal(results[0]?.models[0]?.id, "stored-model");
	assert.equal(requestPath, "/v1/models");
	assert.equal(requestEtag, '"catalog-v1"');
	assert.equal(requestModified, new Date(lastModified).toUTCString());
	assert.ok((await store.read("test-proxy"))!.checkedAt! > 1);
});
