import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { AgentSessionRuntime } from "./agent-session-runtime.js";
import { createLegacySessionManagerRuntimeFactory } from "./session-manager-runtime.js";
import { SessionManager } from "@gsd/pi-coding-agent/core/session-manager.js";

describe("production session-manager runtime factory", () => {
	const roots: string[] = [];

	afterEach(() => {
		for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
	});

	function makeRoot(): string {
		const root = join(tmpdir(), `gsd-session-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(root, { recursive: true });
		roots.push(root);
		return root;
	}

	it("prepares create, open, continue, and memory targets through one awaitable boundary", async () => {
		const root = makeRoot();
		const sessions = join(root, "sessions");
		const factory = createLegacySessionManagerRuntimeFactory();

		assert.equal(factory.backend, "legacy-v3");
		const created = await factory.prepare({ kind: "create", cwd: root, sessionDir: sessions });
		created.appendMessage({ role: "user", content: "hello", timestamp: Date.now() });
		created.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "world" }],
			api: "test",
			provider: "test",
			model: "test",
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

		const path = created.getSessionFile();
		assert.ok(path);
		const opened = await factory.prepare({ kind: "open", path: path!, sessionDir: sessions });
		assert.equal(opened.getSessionId(), created.getSessionId());
		assert.equal(opened.buildSessionContext().messages.length, 2);

		const recent = await factory.prepare({ kind: "continue-recent", cwd: root, sessionDir: sessions });
		assert.equal(recent.getSessionId(), created.getSessionId());

		const memory = await factory.prepare({ kind: "memory", cwd: root });
		assert.equal(memory.isPersisted(), false);
		assert.equal(memory.getCwd(), root);
	});

	it("rejects harness-v4 input instead of silently creating an empty legacy session", async () => {
		const root = makeRoot();
		const path = join(root, "v4.jsonl");
		writeFileSync(
			path,
			`${JSON.stringify({ kind: "header", version: 4, id: "v4", timestamp: new Date().toISOString(), cwd: root })}\n`,
		);

		const factory = createLegacySessionManagerRuntimeFactory();
		await assert.rejects(
			factory.prepare({ kind: "open", path }),
			/harness-v4 sessions are recognized but not readable/,
		);
	});

	it("prepares a replacement before tearing down the active session", async () => {
		let aborted = false;
		let disposed = false;
		const current = {
			sessionFile: "/current.jsonl",
			extensionRunner: { hasHandlers: () => false },
			abort: async () => {
				aborted = true;
			},
			dispose: () => {
				disposed = true;
			},
		};
		const runtime = new AgentSessionRuntime(
			current as never,
			{ cwd: "/repo", agentDir: "/agent" } as never,
			async () => {
				throw new Error("must not create a replacement runtime");
			},
			[],
			undefined,
			{
				backend: "legacy-v3",
				prepare: async () => {
					throw new Error("open failed");
				},
			},
		);

		await assert.rejects(runtime.switchSession("/missing.jsonl"), /open failed/);
		assert.equal(aborted, false);
		assert.equal(disposed, false);
	});

	it("replaces the owned runtime in teardown-create-rebind order for a new workspace", async () => {
		const events: string[] = [];
		const currentManager = SessionManager.inMemory("/current");
		const nextManager = SessionManager.inMemory("/next");
		const current = {
			sessionFile: undefined,
			sessionManager: currentManager,
			extensionRunner: { hasHandlers: () => false },
			abort: async () => events.push("abort"),
			drainSessionMutations: async () => events.push("drain"),
			dispose: () => events.push("dispose"),
		};
		const next = {
			...current,
			sessionManager: nextManager,
			abort: async () => {},
			dispose: () => {},
		};
		const runtime = new AgentSessionRuntime(
			current as never,
			{ cwd: "/current", agentDir: "/agent" } as never,
			async ({ cwd, sessionManager }) => {
				events.push("create-runtime");
				assert.equal(cwd, "/next");
				assert.equal(sessionManager, nextManager);
				return {
					session: next,
					services: { cwd, agentDir: "/agent", diagnostics: [] },
					diagnostics: [],
					extensionsResult: { errors: [], extensions: [] },
				} as never;
			},
			[],
			undefined,
			{
				backend: "legacy-v3",
				prepare: async (target) => {
					events.push("prepare");
					assert.deepEqual(target, { kind: "create", cwd: "/next", sessionDir: "" });
					return nextManager;
				},
			},
		);
		runtime.setBeforeSessionInvalidate(() => events.push("before-invalidate"));
		runtime.setRebindSession(async (session) => {
			events.push("rebind");
			assert.equal(session, next);
		});

		const result = await runtime.newSession({ workspaceRoot: "/next" });

		assert.deepEqual(result, { cancelled: false });
		assert.equal(runtime.session, next);
		assert.equal(runtime.cwd, "/next");
		assert.deepEqual(events, [
			"prepare",
			"abort",
			"drain",
			"before-invalidate",
			"dispose",
			"create-runtime",
			"rebind",
		]);
	});
});
