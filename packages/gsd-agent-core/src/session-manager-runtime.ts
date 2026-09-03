import {
	SessionManager,
	type SessionInfo,
	type SessionListProgress,
} from "@gsd/pi-coding-agent/core/session-manager.js";
import {
	type FileSystem,
	JsonlV4SessionRepository,
	type JsonlV4SessionMetadata,
	readJsonlV4Session,
	Session as HarnessSession,
	V4HarnessSessionStorageAdapter,
	type V4HarnessSessionMetadata,
	V4MemorySessionRepository,
} from "@gsd/pi-agent-core";
import {
	createHarnessV4SessionCapabilityAdapter,
	LegacyV3SessionCapabilityAdapter,
	type SessionCapabilityAdapter,
	SessionCapabilityReadSnapshot,
} from "./session-capability-adapter.js";

/**
 * Session storage backend selected by the production composition root.
 *
 * A harness-v4 construction factory exists for parity testing, but production
 * selection remains blocked by AgentSession's lifecycle guard.
 */
export type ProductionSessionBackend = "legacy-v3" | "harness-v4";

export type SessionManagerTarget =
	| {
			kind: "create";
			cwd: string;
			sessionDir?: string;
			parent?: { kind: "legacy-path" | "session-id"; value: string };
	  }
	| { kind: "open"; path: string; sessionDir?: string; cwdOverride?: string }
	| { kind: "continue-recent"; cwd: string; sessionDir?: string }
	| { kind: "memory"; cwd?: string };

export interface SessionCatalogListOptions {
	cwd?: string;
	sessionDir?: string;
	all?: boolean;
	onProgress?: SessionListProgress;
}

/** One coherently prepared session backend and its compatibility surfaces. */
export interface PreparedSessionRuntime {
	readonly backend: ProductionSessionBackend;
	readonly capabilities: SessionCapabilityAdapter;
	readonly snapshot: SessionCapabilityReadSnapshot;
	/** Present only while legacy-v3 remains available to unconverted construction paths. */
	readonly legacyManager?: SessionManager;
	/** Present for harness-v4 runtimes; never exposed as a legacy manager. */
	readonly harnessSession?: HarnessSession<V4HarnessSessionMetadata>;
}

export async function createLegacyPreparedSessionRuntime(manager: SessionManager): Promise<PreparedSessionRuntime> {
	const capabilities = new LegacyV3SessionCapabilityAdapter(manager);
	return {
		backend: "legacy-v3",
		capabilities,
		snapshot: await SessionCapabilityReadSnapshot.create(capabilities),
		legacyManager: manager,
	};
}

export function requireLegacySessionManager(runtime: PreparedSessionRuntime): SessionManager {
	if (!runtime.legacyManager) {
		throw new Error(`Session backend ${runtime.backend} does not expose a legacy SessionManager`);
	}
	return runtime.legacyManager;
}

async function createHarnessPreparedSessionRuntime(
	storage: ConstructorParameters<typeof V4HarnessSessionStorageAdapter>[0],
	cwdOverride?: string,
): Promise<PreparedSessionRuntime> {
	const session = new HarnessSession(
		new V4HarnessSessionStorageAdapter(storage, cwdOverride === undefined ? {} : { cwd: cwdOverride }),
	);
	const capabilities = await createHarnessV4SessionCapabilityAdapter(session);
	return {
		backend: "harness-v4",
		capabilities,
		snapshot: await SessionCapabilityReadSnapshot.create(capabilities),
		harnessSession: session,
	};
}

/**
 * Awaitable construction boundary for production session storage.
 *
 * A backend must finish opening or provisioning durable storage before it
 * returns a manager. Runtime replacement code calls this boundary before
 * tearing down the active session, so an open failure cannot strand the UI in
 * a half-switched state.
 */
export interface SessionManagerRuntimeFactory {
	readonly backend: ProductionSessionBackend;
	prepare(target: SessionManagerTarget): Promise<PreparedSessionRuntime>;
	fork(
		source: PreparedSessionRuntime,
		target: { cwd: string; leafId: string | null },
	): Promise<PreparedSessionRuntime>;
	list(options?: SessionCatalogListOptions): Promise<SessionInfo[]>;
	rename(path: string, name: string): Promise<void>;
}

function sessionMessageText(message: unknown): { role?: string; text: string; timestamp?: number } {
	if (typeof message !== "object" || message === null) return { text: "" };
	const candidate = message as { role?: unknown; content?: unknown; timestamp?: unknown };
	const role = typeof candidate.role === "string" ? candidate.role : undefined;
	const timestamp = typeof candidate.timestamp === "number" ? candidate.timestamp : undefined;
	if (typeof candidate.content === "string") return { role, text: candidate.content, timestamp };
	if (!Array.isArray(candidate.content)) return { role, text: "", timestamp };
	const text = candidate.content
		.filter((part): part is { type: "text"; text: string } =>
			typeof part === "object"
			&& part !== null
			&& (part as { type?: unknown }).type === "text"
			&& typeof (part as { text?: unknown }).text === "string")
		.map((part) => part.text)
		.join(" ");
	return { role, text, timestamp };
}

function preparedSessionInfo(runtime: PreparedSessionRuntime, fallbackModifiedAt: number): SessionInfo {
	const entries = runtime.snapshot.getEntries();
	let messageCount = 0;
	let firstMessage = "";
	let lastActivity = 0;
	const allMessages: string[] = [];
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		messageCount += 1;
		const message = sessionMessageText(entry.message);
		if (message.role !== "user" && message.role !== "assistant") continue;
		const entryTimestamp = Date.parse(entry.timestamp);
		const activity = message.timestamp ?? (Number.isNaN(entryTimestamp) ? 0 : entryTimestamp);
		lastActivity = Math.max(lastActivity, activity);
		if (!message.text) continue;
		allMessages.push(message.text);
		if (!firstMessage && message.role === "user") firstMessage = message.text;
	}
	const header = runtime.snapshot.getHeader();
	const sessionName = runtime.snapshot.getSessionName();
	return {
		path: runtime.snapshot.getSessionFile() ?? "",
		id: runtime.snapshot.getSessionId(),
		cwd: runtime.snapshot.getCwd(),
		...(sessionName ? { name: sessionName } : {}),
		...(header.parentSession ? { parentSessionPath: header.parentSession } : {}),
		created: new Date(header.timestamp),
		modified: new Date(lastActivity || fallbackModifiedAt),
		messageCount,
		firstMessage: firstMessage || "(no messages)",
		allMessagesText: allMessages.join(" "),
	};
}

export function createLegacySessionManagerRuntimeFactory(): SessionManagerRuntimeFactory {
	return {
		backend: "legacy-v3",
		async prepare(target): Promise<PreparedSessionRuntime> {
			switch (target.kind) {
				case "create": {
					if (target.parent?.kind === "session-id") {
						throw new Error("legacy-v3 sessions require a legacy-path parent reference");
					}
					const manager = SessionManager.create(target.cwd, target.sessionDir);
					if (target.parent) manager.newSession({ parentSession: target.parent.value });
					return createLegacyPreparedSessionRuntime(manager);
				}
				case "open":
					return createLegacyPreparedSessionRuntime(SessionManager.open(target.path, target.sessionDir, target.cwdOverride));
				case "continue-recent":
					return createLegacyPreparedSessionRuntime(SessionManager.continueRecent(target.cwd, target.sessionDir));
				case "memory":
					return createLegacyPreparedSessionRuntime(SessionManager.inMemory(target.cwd));
			}
		},
		async fork(source, target): Promise<PreparedSessionRuntime> {
			const manager = requireLegacySessionManager(source);
			const sourceFile = source.snapshot.getSessionFile();
			if (target.leafId === null) {
				return this.prepare({
					kind: "create",
					cwd: target.cwd,
					sessionDir: source.snapshot.getSessionDir(),
					...(sourceFile ? { parent: { kind: "legacy-path" as const, value: sourceFile } } : {}),
				});
			}

			const forkManager = sourceFile
				? SessionManager.open(sourceFile, source.snapshot.getSessionDir())
				: manager;
			forkManager.createBranchedSession(target.leafId);
			return createLegacyPreparedSessionRuntime(forkManager);
		},
		list(options = {}): Promise<SessionInfo[]> {
			if (options.all) return SessionManager.listAll(options.onProgress);
			return SessionManager.list(options.cwd ?? process.cwd(), options.sessionDir, options.onProgress);
		},
		async rename(path, name): Promise<void> {
			SessionManager.open(path).appendSessionInfo(name);
		},
	};
}

export function createHarnessV4SessionManagerRuntimeFactory(options: {
	fs: FileSystem;
	sessionsRoot: string;
}): SessionManagerRuntimeFactory {
	const jsonl = new JsonlV4SessionRepository(options);
	const memory = new V4MemorySessionRepository();

	return {
		backend: "harness-v4",
		async prepare(target): Promise<PreparedSessionRuntime> {
			switch (target.kind) {
				case "create": {
					if (target.parent?.kind === "legacy-path") {
						throw new Error("harness-v4 sessions require a session-id parent reference");
					}
					return createHarnessPreparedSessionRuntime(
						await jsonl.create({
							cwd: target.cwd,
							...(target.parent ? { parentSessionId: target.parent.value } : {}),
						}),
					);
				}
				case "open": {
					const metadata = (await readJsonlV4Session(options.fs, target.path, {
						sessionsRoot: options.sessionsRoot,
					})).metadata;
					const source = await jsonl.open(metadata);
					return createHarnessPreparedSessionRuntime(source, target.cwdOverride);
				}
				case "continue-recent": {
					const recent = (await jsonl.list({ cwd: target.cwd }))[0];
					return recent
						? createHarnessPreparedSessionRuntime(await jsonl.open(recent))
						: createHarnessPreparedSessionRuntime(await jsonl.create({ cwd: target.cwd }));
				}
				case "memory":
					return createHarnessPreparedSessionRuntime(memory.create(), target.cwd);
			}
		},
		async fork(source, target): Promise<PreparedSessionRuntime> {
			if (!source.harnessSession) {
				throw new Error(`Session backend ${source.backend} does not expose a harness-v4 session`);
			}
			const metadata = await source.harnessSession.getMetadata();
			if (target.leafId === null) {
				return metadata.path
					? createHarnessPreparedSessionRuntime(
							await jsonl.create({ cwd: target.cwd, parentSessionId: metadata.id }),
						  )
					: createHarnessPreparedSessionRuntime(
							memory.create({ parentSessionId: metadata.id }),
							target.cwd,
						  );
			}
			if (metadata.path) {
				const raw = (await readJsonlV4Session(options.fs, metadata.path, {
					sessionsRoot: options.sessionsRoot,
				})).metadata as JsonlV4SessionMetadata;
				return createHarnessPreparedSessionRuntime(
					await jsonl.fork(raw, { cwd: target.cwd, entryId: target.leafId, position: "at" }),
				);
			}
			return createHarnessPreparedSessionRuntime(
				memory.fork(
					{
						id: metadata.id,
						createdAt: Date.parse(metadata.createdAt),
						...(metadata.parentSessionId ? { parentSessionId: metadata.parentSessionId } : {}),
					},
					{ entryId: target.leafId, position: "at" },
				),
				target.cwd,
			);
		},
		async list(listOptions = {}): Promise<SessionInfo[]> {
			const metadata = await jsonl.list({ cwd: listOptions.all ? undefined : listOptions.cwd ?? process.cwd() });
			let loaded = 0;
			const sessions = await Promise.all(metadata.map(async (item) => {
				try {
					const prepared = await createHarnessPreparedSessionRuntime(await jsonl.open(item));
					return preparedSessionInfo(prepared, item.modifiedAt);
				} finally {
					loaded += 1;
					listOptions.onProgress?.(loaded, metadata.length);
				}
			}));
			return sessions.sort((left, right) => right.modified.getTime() - left.modified.getTime());
		},
		async rename(path, name): Promise<void> {
			const metadata = (await readJsonlV4Session(options.fs, path, {
				sessionsRoot: options.sessionsRoot,
			})).metadata;
			const prepared = await createHarnessPreparedSessionRuntime(await jsonl.open(metadata));
			await prepared.capabilities.appendSessionName(name);
		},
	};
}

export const legacySessionManagerRuntimeFactory = createLegacySessionManagerRuntimeFactory();
