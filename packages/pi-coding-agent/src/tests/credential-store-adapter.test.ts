import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AuthStorage } from "../core/auth-storage.js";
import { AuthStorageCredentialAdapter } from "../core/credential-store-adapter.js";
import { ModelRegistry } from "../core/model-registry.js";

test("credential adapter exposes metadata and performs locked read-modify-write", async (t) => {
	const directory = mkdtempSync(join(tmpdir(), "gsd-credential-adapter-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const auth = AuthStorage.create(join(directory, "auth.json"));
	auth.set("demo", { type: "api_key", key: "secret-one" });
	const adapter = new AuthStorageCredentialAdapter(auth);

	assert.deepEqual(await adapter.list(), [{ providerId: "demo", type: "api_key" }]);
	assert.equal(JSON.stringify(await adapter.list()).includes("secret-one"), false);
	await adapter.modify("demo", async (current) => ({ ...current!, type: "api_key", key: "secret-two" }));
	assert.equal((await adapter.read("demo"))?.type, "api_key");
	assert.equal(auth.get("demo")?.type === "api_key" ? auth.get("demo")?.key : undefined, "secret-two");

	await adapter.delete("demo");
	assert.equal(await adapter.read("demo"), undefined);
});

test("credential adapter aborts a mutation before committing", async () => {
	const auth = AuthStorage.inMemory({ demo: { type: "api_key", key: "original" } });
	const adapter = new AuthStorageCredentialAdapter(auth);
	const controller = new AbortController();
	controller.abort(new Error("cancel credential update"));

	await assert.rejects(
		adapter.modify("demo", async () => ({ type: "api_key", key: "changed" }), { signal: controller.signal }),
		/cancel credential update/,
	);
	assert.equal(auth.get("demo")?.type === "api_key" ? auth.get("demo")?.key : undefined, "original");
});

test("model registry exposes its canonical credential adapter", async () => {
	const auth = AuthStorage.inMemory({ demo: { type: "api_key", key: "stored" } });
	const registry = ModelRegistry.inMemory(auth);
	assert.equal((await registry.getCredentialStore().read("demo"))?.type, "api_key");
});
