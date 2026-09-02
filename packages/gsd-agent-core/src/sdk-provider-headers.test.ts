import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import {
	createAssistantMessageEventStream,
	type Model,
	type ProviderHeaders,
	type SimpleStreamOptions,
} from "@gsd/pi-ai";
import { AuthStorage } from "@gsd/pi-coding-agent/core/auth-storage.js";
import { ModelRegistry } from "@gsd/pi-coding-agent/core/model-registry.js";
import { SessionManager } from "@gsd/pi-coding-agent/core/session-manager.js";
import { createAgentSession } from "./sdk.js";

describe("provider header extension bridge", () => {
	const roots: string[] = [];

	afterEach(() => {
		for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
	});

	test("runs before_provider_headers after configured and request headers are assembled", async () => {
		const root = mkdtempSync(join(tmpdir(), "gsd-provider-headers-"));
		roots.push(root);
		const cwd = join(root, "project");
		const agentDir = join(root, "agent");
		mkdirSync(cwd, { recursive: true });
		mkdirSync(join(agentDir, "extensions"), { recursive: true });
		writeFileSync(
			join(agentDir, "extensions", "headers.js"),
			`export default function (pi) {
				pi.on("before_provider_headers", (event) => {
					event.headers["x-hook"] = [
						event.headers["x-provider"],
						event.headers["x-model"],
						event.headers["x-explicit"],
					].join(":");
					event.headers["x-delete"] = null;
				});
			}`,
		);

		const model: Model<"openai-completions"> = {
			id: "capture-model",
			name: "Capture Model",
			api: "openai-completions",
			provider: "capture-provider",
			baseUrl: "https://capture.invalid/v1",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128_000,
			maxTokens: 4096,
			headers: { "x-model": "model", "x-delete": "present" },
		};
		const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
		authStorage.setRuntimeApiKey(model.provider, "test-api-key");
		const modelRegistry = ModelRegistry.create(authStorage, join(agentDir, "models.json"));
		let captured: SimpleStreamOptions | undefined;
		modelRegistry.registerProvider(model.provider, {
			api: model.api,
			apiKey: "test-api-key",
			baseUrl: model.baseUrl,
			headers: { "x-provider": "provider" },
			models: [model],
			streamSimple: (_model, _context, options) => {
				captured = options;
				const stream = createAssistantMessageEventStream();
				stream.end({
					role: "assistant",
					content: [{ type: "text", text: "ok" }],
					api: model.api,
					provider: model.provider,
					model: model.id,
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "stop",
					timestamp: Date.now(),
				});
				return stream;
			},
		});

		const { session } = await createAgentSession({ cwd, agentDir, model, authStorage, modelRegistry });
		try {
			await session.agent.streamFn(model, { messages: [] }, { headers: { "x-explicit": "explicit" } });
			const headers = captured?.headers as ProviderHeaders | undefined;
			assert.deepEqual(headers, {
				"x-model": "model",
				"x-delete": null,
				"x-provider": "provider",
				"x-explicit": "explicit",
				"x-hook": "provider:model:explicit",
			});
		} finally {
			session.dispose();
			modelRegistry.unregisterProvider(model.provider);
		}
	});
});
