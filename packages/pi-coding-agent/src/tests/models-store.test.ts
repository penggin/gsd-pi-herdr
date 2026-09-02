import { strict as assert } from "node:assert";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Api, Model, ModelsStoreEntry } from "@gsd/pi-ai";
import { FileModelsStore, InMemoryCodingAgentModelsStore } from "../core/models-store.js";

function model(provider: string, id: string): Model<Api> {
	return {
		provider,
		id,
		name: id,
		api: "openai-responses",
		baseUrl: "https://example.invalid/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 8_192,
	};
}

function entry(provider: string, id: string): ModelsStoreEntry {
	return { models: [model(provider, id)], checkedAt: 123, etag: '"catalog-v1"' };
}

test("in-memory models store clones values and honors cancellation", async () => {
	const store = new InMemoryCodingAgentModelsStore();
	const original = entry("demo", "alpha");
	await store.write("demo", original);
	(original.models as Model<Api>[])[0]!.name = "mutated";

	const stored = await store.read("demo");
	assert.equal(stored?.models[0]?.name, "alpha");

	const controller = new AbortController();
	controller.abort(new Error("cancelled"));
	await assert.rejects(store.write("demo", entry("demo", "beta"), { signal: controller.signal }), /cancelled/);
	assert.equal((await store.read("demo"))?.models[0]?.id, "alpha");
});

test("file models store serializes provider updates without losing siblings", async () => {
	const directory = await mkdtemp(join(tmpdir(), "gsd-models-store-"));
	const path = join(directory, "models-store.json");
	const first = new FileModelsStore(path);
	const second = new FileModelsStore(path);

	await Promise.all([
		first.write("provider-a", entry("provider-a", "alpha")),
		second.write("provider-b", entry("provider-b", "beta")),
	]);

	assert.equal((await first.read("provider-a"))?.models[0]?.id, "alpha");
	assert.equal((await first.read("provider-b"))?.models[0]?.id, "beta");
	await first.delete("provider-a");
	assert.equal(await second.read("provider-a"), undefined);
	assert.equal((await second.read("provider-b"))?.etag, '"catalog-v1"');

	const persisted = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
	assert.deepEqual(Object.keys(persisted), ["provider-b"]);
	if (process.platform !== "win32") assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test("file models store rejects an already-aborted mutation before creating storage", async () => {
	const directory = await mkdtemp(join(tmpdir(), "gsd-models-store-abort-"));
	const path = join(directory, "models-store.json");
	const store = new FileModelsStore(path);
	const controller = new AbortController();
	controller.abort(new Error("stop"));

	await assert.rejects(store.write("demo", entry("demo", "alpha"), { signal: controller.signal }), /stop/);
	await assert.rejects(readFile(path), { code: "ENOENT" });
});
