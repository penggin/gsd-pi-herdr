import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { AgentSessionRuntime } from "./agent-session-runtime.js";
import { createAgentSession } from "./sdk.js";
import {
	createHarnessV4SessionManagerRuntimeFactory,
	createLegacySessionManagerRuntimeFactory,
	requireLegacySessionManager,
} from "./session-manager-runtime.js";
import { SessionManager } from "@gsd/pi-coding-agent/core/session-manager.js";
import { NodeExecutionEnv } from "../../pi-agent-core/src/harness/env/nodejs.js";

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
		const createdRuntime = await factory.prepare({ kind: "create", cwd: root, sessionDir: sessions });
		const created = requireLegacySessionManager(createdRuntime);
		assert.equal(createdRuntime.capabilities.format, "legacy-v3");
		assert.equal(createdRuntime.snapshot.getSessionId(), created.getSessionId());
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
		const opened = requireLegacySessionManager(await factory.prepare({ kind: "open", path: path!, sessionDir: sessions }));
		assert.equal(opened.getSessionId(), created.getSessionId());
		assert.equal(opened.buildSessionContext().messages.length, 2);

		const recent = requireLegacySessionManager(await factory.prepare({ kind: "continue-recent", cwd: root, sessionDir: sessions }));
		assert.equal(recent.getSessionId(), created.getSessionId());
		await factory.rename(path!, "Legacy catalog");
		const catalog = await factory.list({ cwd: root, sessionDir: sessions });
		assert.equal(catalog.length, 1);
		assert.equal(catalog[0]?.id, created.getSessionId());
		assert.equal(catalog[0]?.name, "Legacy catalog");
		assert.equal(catalog[0]?.firstMessage, "hello");
		assert.equal(catalog[0]?.messageCount, 2);

		const memory = requireLegacySessionManager(await factory.prepare({ kind: "memory", cwd: root }));
		assert.equal(memory.isPersisted(), false);
		assert.equal(memory.getCwd(), root);
	});

	it("keeps the prepared read snapshot current through SDK initialization", async () => {
		const root = makeRoot();
		const cwd = join(root, "project");
		const agentDir = join(root, "agent");
		mkdirSync(cwd, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		const prepared = await createLegacySessionManagerRuntimeFactory().prepare({ kind: "memory", cwd });
		const manager = requireLegacySessionManager(prepared);
		const { session } = await createAgentSession({
			cwd,
			agentDir,
			noTools: "all",
			sessionManager: manager,
			sessionCapabilities: prepared.capabilities,
			sessionSnapshot: prepared.snapshot,
		});
		try {
			assert.deepEqual(session.sessionView.getEntries(), manager.getEntries());
			assert.equal(session.sessionView.getBranch().at(-1)?.type, "thinking_level_change");
		} finally {
			session.dispose();
		}
	});

	it("owns parent creation and persisted fork semantics behind the runtime factory", async () => {
		const root = makeRoot();
		const sessions = join(root, "sessions");
		const factory = createLegacySessionManagerRuntimeFactory();
		const source = await factory.prepare({ kind: "create", cwd: root, sessionDir: sessions });
		const sourceManager = requireLegacySessionManager(source);
		const userId = sourceManager.appendMessage({ role: "user", content: "keep", timestamp: Date.now() });
		sourceManager.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "done" }],
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
		const sourceFile = sourceManager.getSessionFile();
		assert.ok(sourceFile);

		const forked = await factory.fork(source, { cwd: root, leafId: userId });
		assert.notEqual(forked.snapshot.getSessionFile(), sourceFile);
		assert.equal(forked.snapshot.getHeader().parentSession, sourceFile);
		assert.deepEqual(forked.snapshot.getBranch().map((entry) => entry.id), [userId]);
		assert.equal(sourceManager.getBranch().length, 2, "persisted fork must not mutate the active source");

		const emptyFork = await factory.fork(source, { cwd: root, leafId: null });
		assert.equal(emptyFork.snapshot.getHeader().parentSession, sourceFile);
		assert.deepEqual(emptyFork.snapshot.getBranch(), []);
	});

	it("rejects a v4 parent identity at the legacy factory boundary", async () => {
		const root = makeRoot();
		await assert.rejects(
			createLegacySessionManagerRuntimeFactory().prepare({
				kind: "create",
				cwd: root,
				parent: { kind: "session-id", value: "v4-parent" },
			}),
			/legacy-path parent reference/,
		);
	});

	it("prepares and forks harness-v4 JSONL and memory sessions without a legacy manager", async () => {
		const root = makeRoot();
		const cwd = join(root, "project");
		const sessionsRoot = join(root, "sessions-v4");
		mkdirSync(cwd, { recursive: true });
		const factory = createHarnessV4SessionManagerRuntimeFactory({
			fs: new NodeExecutionEnv({ cwd: root }),
			sessionsRoot,
		});
		const source = await factory.prepare({ kind: "create", cwd });
		assert.equal(source.backend, "harness-v4");
		assert.equal(source.legacyManager, undefined);
		assert.ok(source.harnessSession);
		const userId = await source.capabilities.appendMessage({ role: "user", content: "keep", timestamp: 1 });
		await source.capabilities.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "done" }],
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
			timestamp: 2,
		});
		await source.capabilities.appendCustomEntry("assessment-run", { runId: "GAR-001", verdict: "pass" });
		await source.capabilities.appendCustomMessageEntry(
			"workflow-note",
			"persisted custom message",
			true,
			{ owner: "gsd" },
		);
		await source.capabilities.appendCompaction(
			"persisted compaction summary",
			userId,
			42,
			{ checkpoint: "test" },
		);

		const forked = await factory.fork(source, { cwd, leafId: userId });
		assert.deepEqual(forked.snapshot.getBranch().map((entry) => entry.id), [userId]);
		assert.deepEqual((await forked.capabilities.getMetadata()).parent, {
			kind: "session-id",
			value: source.snapshot.getSessionId(),
		});
		const sourcePath = (await source.capabilities.getMetadata()).path;
		assert.ok(sourcePath);
		const opened = await factory.prepare({ kind: "open", path: sourcePath! });
		assert.equal(opened.snapshot.getSessionId(), source.snapshot.getSessionId());
		const reopenedEntries = opened.snapshot.getEntries();
		const assessmentEntry = reopenedEntries.find(
			(entry) => entry.type === "custom" && entry.customType === "assessment-run",
		);
		assert.deepEqual(
			assessmentEntry && {
				type: assessmentEntry.type,
				customType: assessmentEntry.customType,
				data: assessmentEntry.data,
			},
			{ type: "custom", customType: "assessment-run", data: { runId: "GAR-001", verdict: "pass" } },
		);
		assert.match(
			String(reopenedEntries.find((entry) => entry.type === "custom_message")?.content),
			/persisted custom message/,
		);
		assert.equal(
			reopenedEntries.find((entry) => entry.type === "compaction")?.summary,
			"persisted compaction summary",
		);
		const recent = await factory.prepare({ kind: "continue-recent", cwd });
		assert.equal(recent.snapshot.getSessionId(), forked.snapshot.getSessionId());
		await factory.rename(sourcePath!, "V4 catalog");
		const localCatalog = await factory.list({ cwd });
		assert.equal(localCatalog.length, 2);
		const sourceCatalog = localCatalog.find((session) => session.id === source.snapshot.getSessionId());
		assert.equal(sourceCatalog?.name, "V4 catalog");
		assert.equal(sourceCatalog?.firstMessage, "keep");
		assert.equal(sourceCatalog?.messageCount, 2);
		assert.match(sourceCatalog?.allMessagesText ?? "", /keep done/);

		const otherCwd = join(root, "other-project");
		mkdirSync(otherCwd, { recursive: true });
		await factory.prepare({ kind: "create", cwd: otherCwd });
		assert.equal((await factory.list({ cwd })).length, 2);
		assert.equal((await factory.list({ all: true })).length, 3);

		const memory = await factory.prepare({ kind: "memory", cwd });
		const memoryEntryId = await memory.capabilities.appendMessage({ role: "user", content: "memory", timestamp: 3 });
		const memoryFork = await factory.fork(memory, { cwd, leafId: memoryEntryId });
		assert.equal(memoryFork.snapshot.getCwd(), cwd);
		assert.deepEqual(memoryFork.snapshot.getBranch().map((entry) => entry.id), [memoryEntryId]);
	});

	it("honors an explicit harness-v4 sessionDir across create, open, continue, list, fork, and rename", async () => {
		const root = makeRoot();
		const cwd = join(root, "project");
		const defaultRoot = join(root, "default-sessions-v4");
		const customSessionDir = join(root, "custom-sessions");
		mkdirSync(cwd, { recursive: true });
		const factory = createHarnessV4SessionManagerRuntimeFactory({
			fs: new NodeExecutionEnv({ cwd: root }),
			sessionsRoot: defaultRoot,
		});

		const source = await factory.prepare({ kind: "create", cwd, sessionDir: customSessionDir });
		const sourcePath = source.snapshot.getSessionFile();
		assert.ok(sourcePath);
		assert.equal(dirname(sourcePath), customSessionDir);
		assert.equal(readdirSync(customSessionDir, { withFileTypes: true }).every((entry) => entry.isFile()), true);
		const userId = await source.capabilities.appendMessage({ role: "user", content: "custom", timestamp: 1 });

		const recent = await factory.prepare({ kind: "continue-recent", cwd, sessionDir: customSessionDir });
		assert.equal(recent.snapshot.getSessionId(), source.snapshot.getSessionId());
		const opened = await factory.prepare({ kind: "open", path: sourcePath });
		assert.equal(opened.snapshot.getSessionId(), source.snapshot.getSessionId());

		const forked = await factory.fork(source, { cwd, leafId: userId });
		assert.equal(dirname(forked.snapshot.getSessionFile()!), customSessionDir);
		assert.deepEqual(forked.snapshot.getBranch().map((entry) => entry.id), [userId]);
		await factory.rename(sourcePath, "Custom catalog");

		const customCatalog = await factory.list({ cwd, sessionDir: customSessionDir });
		assert.equal(customCatalog.length, 2);
		assert.equal(customCatalog.find(({ path }) => path === sourcePath)?.name, "Custom catalog");

		const defaultSession = await factory.prepare({ kind: "create", cwd });
		assert.notEqual(dirname(defaultSession.snapshot.getSessionFile()!), customSessionDir);
		assert.equal((await factory.list({ cwd })).length, 1);
		assert.equal((await factory.list({ cwd, sessionDir: customSessionDir })).length, 2);
	});

	it("rejects a legacy parent identity at the harness-v4 factory boundary", async () => {
		const root = makeRoot();
		await assert.rejects(
			createHarnessV4SessionManagerRuntimeFactory({
				fs: new NodeExecutionEnv({ cwd: root }),
				sessionsRoot: join(root, "sessions-v4"),
			}).prepare({
				kind: "create",
				cwd: root,
				parent: { kind: "legacy-path", value: "/legacy/session.jsonl" },
			}),
			/session-id parent reference/,
		);
	});

	it("constructs AgentSession on a prepared harness-v4 memory runtime without a legacy manager", async () => {
		const root = makeRoot();
		const cwd = join(root, "project");
		const agentDir = join(root, "agent");
		mkdirSync(cwd, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		const prepared = await createHarnessV4SessionManagerRuntimeFactory({
			fs: new NodeExecutionEnv({ cwd: root }),
			sessionsRoot: join(root, "sessions-v4"),
		}).prepare({ kind: "memory", cwd });
		const { session } = await createAgentSession({
			cwd,
			agentDir,
			noTools: "all",
			sessionCapabilities: prepared.capabilities,
			sessionSnapshot: prepared.snapshot,
		});
		try {
			assert.equal(session.sessionView.getSessionId(), prepared.snapshot.getSessionId());
			assert.equal(session.sessionView.getBranch().at(-1)?.type, "thinking_level_change");
			assert.throws(() => session.sessionManager, /does not expose a legacy SessionManager/);
		} finally {
			session.dispose();
		}
	});

	it("runs AgentSessionRuntime fork and new replacement on harness-v4 and rejects legacy setup before teardown", async () => {
		const root = makeRoot();
		const cwd = join(root, "project");
		const agentDir = join(root, "agent");
		mkdirSync(cwd, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		const factory = createHarnessV4SessionManagerRuntimeFactory({
			fs: new NodeExecutionEnv({ cwd: root }),
			sessionsRoot: join(root, "sessions-v4"),
		});
		const initial = await factory.prepare({ kind: "create", cwd });
		const createRuntime = async (options: Parameters<typeof createAgentSession>[0]) => {
			const result = await createAgentSession({ ...options, cwd, agentDir, noTools: "all" });
			return {
				...result,
				services: { cwd, agentDir, diagnostics: [] },
				diagnostics: [],
			};
		};
		const initialResult = await createRuntime({
			cwd,
			agentDir,
			sessionCapabilities: initial.capabilities,
			sessionSnapshot: initial.snapshot,
		});
		const runtime = new AgentSessionRuntime(
			initialResult.session,
			initialResult.services as never,
			createRuntime as never,
			[],
			undefined,
			factory,
			initial,
		);
		try {
			const userId = await runtime.session.sessionCapabilities.appendMessage({
				role: "user",
				content: "fork me",
				timestamp: 1,
			});
			const sourceId = runtime.session.sessionId;
			const sourcePath = runtime.session.sessionFile;
			assert.ok(sourcePath);
			const forkResult = await runtime.fork(userId, { position: "at" });
			assert.equal(forkResult.cancelled, false);
			assert.notEqual(runtime.session.sessionId, sourceId);
			assert.deepEqual(runtime.session.sessionView.getHeader().parentSession, undefined);
			assert.equal((await runtime.session.sessionCapabilities.getMetadata()).parent?.value, sourceId);
			const switchResult = await runtime.switchSession(sourcePath!);
			assert.equal(switchResult.cancelled, false);
			assert.equal(runtime.session.sessionId, sourceId);

			const beforeRejectedSetup = runtime.session.sessionId;
			await assert.rejects(
				runtime.newSession({ setup: async () => {} }),
				/setup\(sessionManager\) is not available/,
			);
			assert.equal(runtime.session.sessionId, beforeRejectedSetup);

			const newResult = await runtime.newSession();
			assert.equal(newResult.cancelled, false);
			assert.notEqual(runtime.session.sessionId, beforeRejectedSetup);
			assert.equal(runtime.session.sessionView.getBranch().at(-1)?.type, "thinking_level_change");
		} finally {
			await runtime.dispose();
		}
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
		const nextPrepared = await createLegacySessionManagerRuntimeFactory().prepare({ kind: "memory", cwd: "/next" });
		const nextManager = requireLegacySessionManager(nextPrepared);
		const current = {
			sessionFile: undefined,
			sessionManager: currentManager,
			sessionView: { getSessionDir: () => "" },
			extensionRunner: { hasHandlers: () => false },
			abort: async () => events.push("abort"),
			drainSessionMutations: async () => events.push("drain"),
			dispose: () => events.push("dispose"),
		};
		const next = {
			...current,
			sessionManager: nextManager,
			sessionView: nextPrepared.snapshot,
			abort: async () => {},
			dispose: () => {},
		};
		const runtime = new AgentSessionRuntime(
			current as never,
			{ cwd: "/current", agentDir: "/agent" } as never,
			async ({ cwd, sessionManager, sessionCapabilities, sessionSnapshot }) => {
				events.push("create-runtime");
				assert.equal(cwd, "/next");
				assert.equal(sessionManager, nextManager);
				assert.equal(sessionCapabilities, nextPrepared.capabilities);
				assert.equal(sessionSnapshot, nextPrepared.snapshot);
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
					return nextPrepared;
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
