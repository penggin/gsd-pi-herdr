import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { resolvePath } from "@gsd/pi-coding-agent/utils/paths.js";
import type { AgentSession } from "./agent-session.js";
import type { AgentSessionRuntimeDiagnostic, AgentSessionServices } from "./agent-session-services.js";
import type { ReplacedSessionContext, SessionShutdownEvent, SessionStartEvent } from "@gsd/pi-coding-agent/core/extensions/index.js";
import { emitSessionShutdownEvent } from "@gsd/pi-coding-agent/core/extensions/runner.js";
import type { CreateAgentSessionResult } from "./sdk.js";
import { assertSessionCwdExists } from "@gsd/pi-coding-agent/core/session-cwd.js";
import type { SessionManager } from "@gsd/pi-coding-agent/core/session-manager.js";
import type { SessionInfo, SessionListProgress } from "@gsd/pi-coding-agent/core/session-manager.js";
import {
	createLegacyPreparedSessionRuntime,
	legacySessionManagerRuntimeFactory,
	requireLegacySessionManager,
	type PreparedSessionRuntime,
	type SessionManagerRuntimeFactory,
} from "./session-manager-runtime.js";
import type { SessionCapabilityAdapter, SessionCapabilityReadSnapshot } from "./session-capability-adapter.js";

/**
 * Result returned by runtime creation.
 *
 * The caller gets the created session, its cwd-bound services, and all
 * diagnostics collected during setup.
 */
export interface CreateAgentSessionRuntimeResult extends CreateAgentSessionResult {
	services: AgentSessionServices;
	diagnostics: AgentSessionRuntimeDiagnostic[];
}

/**
 * Creates a full runtime for a target cwd and session manager.
 *
 * The factory closes over process-global fixed inputs, recreates cwd-bound
 * services for the effective cwd, resolves session options against those
 * services, and finally creates the AgentSession.
 */
export type CreateAgentSessionRuntimeFactory = (options: {
	cwd: string;
	agentDir: string;
	sessionManager?: SessionManager;
	sessionCapabilities?: SessionCapabilityAdapter;
	sessionSnapshot?: SessionCapabilityReadSnapshot;
	sessionStartEvent?: SessionStartEvent;
}) => Promise<CreateAgentSessionRuntimeResult>;

/**
 * Thrown when /import references a JSONL file path that does not exist.
 */
export class SessionImportFileNotFoundError extends Error {
	readonly filePath: string;

	constructor(filePath: string) {
		super(`File not found: ${filePath}`);
		this.name = "SessionImportFileNotFoundError";
		this.filePath = filePath;
	}
}

function extractUserMessageText(content: string | Array<{ type: string; text?: string }>): string {
	if (typeof content === "string") {
		return content;
	}

	return content
		.filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("");
}

/**
 * Owns the current AgentSession plus its cwd-bound services.
 *
 * Session replacement methods tear down the current runtime first, then create
 * and apply the next runtime. If creation fails, the error is propagated to the
 * caller. The caller is responsible for user-facing error handling.
 */
export class AgentSessionRuntime {
	private rebindSession?: (session: AgentSession) => Promise<void>;
	private beforeSessionInvalidate?: () => void;
	private _session: AgentSession;
	private _services: AgentSessionServices;
	private readonly createRuntime: CreateAgentSessionRuntimeFactory;
	private readonly sessionManagers: SessionManagerRuntimeFactory;
	private _prepared: PreparedSessionRuntime;
	private _diagnostics: AgentSessionRuntimeDiagnostic[];
	private _modelFallbackMessage?: string;

	constructor(
		_session: AgentSession,
		_services: AgentSessionServices,
		createRuntime: CreateAgentSessionRuntimeFactory,
		_diagnostics: AgentSessionRuntimeDiagnostic[] = [],
		_modelFallbackMessage?: string,
		sessionManagers: SessionManagerRuntimeFactory = legacySessionManagerRuntimeFactory,
		preparedSession?: PreparedSessionRuntime,
	) {
		this._session = _session;
		this._services = _services;
		this.createRuntime = createRuntime;
		this.sessionManagers = sessionManagers;
		this._prepared = preparedSession ?? {
			backend: "legacy-v3",
			capabilities: _session.sessionCapabilities,
			snapshot: _session.sessionView,
			legacyManager: _session.sessionManager,
		};
		this._diagnostics = _diagnostics;
		this._modelFallbackMessage = _modelFallbackMessage;
	}

	get services(): AgentSessionServices {
		return this._services;
	}

	get session(): AgentSession {
		return this._session;
	}

	get cwd(): string {
		return this._services.cwd;
	}

	get diagnostics(): readonly AgentSessionRuntimeDiagnostic[] {
		return this._diagnostics;
	}

	get modelFallbackMessage(): string | undefined {
		return this._modelFallbackMessage;
	}

	listSessions(options: {
		all?: boolean;
		cwd?: string;
		sessionDir?: string;
		onProgress?: SessionListProgress;
	} = {}): Promise<SessionInfo[]> {
		return this.sessionManagers.list({
			...options,
			cwd: options.cwd ?? this.session.sessionView.getCwd(),
			sessionDir: options.sessionDir ?? this.session.sessionView.getSessionDir(),
		});
	}

	renameSession(path: string, name: string): Promise<void> {
		return this.sessionManagers.rename(path, name);
	}

	setRebindSession(rebindSession?: (session: AgentSession) => Promise<void>): void {
		this.rebindSession = rebindSession;
	}

	/**
	 * Set a synchronous callback that runs after `session_shutdown` handlers finish
	 * but before the current session is invalidated.
	 *
	 * This is for host-owned UI teardown that must not yield to the event loop,
	 * such as detaching extension-provided TUI components before the old extension
	 * context becomes stale.
	 */
	setBeforeSessionInvalidate(beforeSessionInvalidate?: () => void): void {
		this.beforeSessionInvalidate = beforeSessionInvalidate;
	}

	private async emitBeforeSwitch(
		reason: "new" | "resume",
		targetSessionFile?: string,
	): Promise<{ cancelled: boolean }> {
		const runner = this.session.extensionRunner;
		if (!runner.hasHandlers("session_before_switch")) {
			return { cancelled: false };
		}

		const result = await runner.emit({
			type: "session_before_switch",
			reason,
			targetSessionFile,
		});
		return { cancelled: result?.cancel === true };
	}

	private async emitBeforeFork(
		entryId: string,
		options: { position: "before" | "at" },
	): Promise<{ cancelled: boolean }> {
		const runner = this.session.extensionRunner;
		if (!runner.hasHandlers("session_before_fork")) {
			return { cancelled: false };
		}

		const result = await runner.emit({
			type: "session_before_fork",
			entryId,
			...options,
		});
		return { cancelled: result?.cancel === true };
	}

	private async teardownCurrent(reason: SessionShutdownEvent["reason"], targetSessionFile?: string): Promise<void> {
		// Settle any active response first so its aborted tool results remain on
		// the outgoing session instead of racing with the replacement manager.
		await this.session.abort();
		await emitSessionShutdownEvent(this.session.extensionRunner, {
			type: "session_shutdown",
			reason,
			targetSessionFile,
		});
		await this.session.drainSessionMutations();
		this.beforeSessionInvalidate?.();
		this.session.dispose();
	}

	private apply(result: CreateAgentSessionRuntimeResult, prepared: PreparedSessionRuntime): void {
		this._session = result.session;
		this._services = result.services;
		this._prepared = prepared;
		this._diagnostics = result.diagnostics;
		this._modelFallbackMessage = result.modelFallbackMessage;
	}

	private createPreparedRuntime(
		prepared: PreparedSessionRuntime,
		options: { cwd: string; sessionStartEvent: SessionStartEvent },
	): Promise<CreateAgentSessionRuntimeResult> {
		return this.createRuntime({
			cwd: options.cwd,
			agentDir: this.services.agentDir,
			sessionManager: prepared.legacyManager,
			sessionCapabilities: prepared.capabilities,
			sessionSnapshot: prepared.snapshot,
			sessionStartEvent: options.sessionStartEvent,
		});
	}

	private async finishSessionReplacement(withSession?: (ctx: ReplacedSessionContext) => Promise<void>): Promise<void> {
		if (this.rebindSession) {
			await this.rebindSession(this.session);
		}
		if (withSession) {
			await withSession(this.session.createReplacedSessionContext());
		}
	}

	async switchSession(
		sessionPath: string,
		options?: { cwdOverride?: string; withSession?: (ctx: ReplacedSessionContext) => Promise<void> },
	): Promise<{ cancelled: boolean }> {
		const beforeResult = await this.emitBeforeSwitch("resume", sessionPath);
		if (beforeResult.cancelled) {
			return beforeResult;
		}

		const previousSessionFile = this.session.sessionFile;
		const prepared = await this.sessionManagers.prepare({
			kind: "open",
			path: sessionPath,
			cwdOverride: options?.cwdOverride,
		});
		assertSessionCwdExists(prepared.snapshot, this.cwd);
		await this.teardownCurrent("resume", prepared.snapshot.getSessionFile());
		this.apply(
			await this.createPreparedRuntime(prepared, {
				cwd: prepared.snapshot.getCwd(),
				sessionStartEvent: { type: "session_start", reason: "resume", previousSessionFile },
			}),
			prepared,
		);
		await this.finishSessionReplacement(options?.withSession);
		return { cancelled: false };
	}

	async newSession(options?: {
		parentSession?: string;
		setup?: (sessionManager: SessionManager) => Promise<void>;
		withSession?: (ctx: ReplacedSessionContext) => Promise<void>;
		workspaceRoot?: string;
		abortSignal?: AbortSignal;
	}): Promise<{ cancelled: boolean }> {
		const beforeResult = await this.emitBeforeSwitch("new");
		if (beforeResult.cancelled) {
			return beforeResult;
		}

		if (options?.abortSignal?.aborted) return { cancelled: true };
		const previousSessionFile = this.session.sessionFile;
		const sessionDir = this.session.sessionView.getSessionDir();
		const targetCwd = options?.workspaceRoot ?? this.cwd;
		const prepared = await this.sessionManagers.prepare({
			kind: "create",
			cwd: targetCwd,
			sessionDir,
			...(options?.parentSession
				? { parent: { kind: "legacy-path" as const, value: options.parentSession } }
				: {}),
		});
		if (options?.abortSignal?.aborted) return { cancelled: true };
		if (options?.setup && !prepared.legacyManager) {
			throw new Error("newSession setup(sessionManager) is not available for the harness-v4 backend");
		}

		await this.teardownCurrent("new", prepared.snapshot.getSessionFile());
		this.apply(
			await this.createPreparedRuntime(prepared, {
				cwd: targetCwd,
				sessionStartEvent: { type: "session_start", reason: "new", previousSessionFile },
			}),
			prepared,
		);
		if (options?.setup) {
			const sessionManager = requireLegacySessionManager(prepared);
			await options.setup(sessionManager);
			this.session.sessionView.refreshLegacy(sessionManager);
			this.session.agent.state.messages = this.session.sessionView.buildSessionContext().messages;
		}
		await this.finishSessionReplacement(options?.withSession);
		return { cancelled: false };
	}

	async fork(
		entryId: string,
		options?: { position?: "before" | "at"; withSession?: (ctx: ReplacedSessionContext) => Promise<void> },
	): Promise<{ cancelled: boolean; selectedText?: string }> {
		const position = options?.position ?? "before";
		const beforeResult = await this.emitBeforeFork(entryId, { position });
		if (beforeResult.cancelled) {
			return { cancelled: true };
		}
		let targetLeafId: string | null;
		let selectedText: string | undefined;

		const selectedEntry = this.session.sessionView.getEntry(entryId);
		if (!selectedEntry) {
			throw new Error("Invalid entry ID for forking");
		}

		if (position === "at") {
			targetLeafId = selectedEntry.id;
		} else {
			if (selectedEntry.type !== "message" || selectedEntry.message.role !== "user") {
				throw new Error("Invalid entry ID for forking");
			}
			targetLeafId = selectedEntry.parentId;
			selectedText = extractUserMessageText(selectedEntry.message.content);
		}

		const previousSessionFile = this.session.sessionFile;
		let prepared: PreparedSessionRuntime;
		if (this._prepared.snapshot.getSessionFile()) {
			prepared = await this.sessionManagers.fork(this._prepared, {
				cwd: this.cwd,
				leafId: targetLeafId,
			});
			await this.teardownCurrent("fork", prepared.snapshot.getSessionFile());
		} else {
			// Legacy in-memory forks reuse their manager. Preserve the established
			// shutdown view by invalidating the outgoing runtime before mutation.
			await this.teardownCurrent("fork", undefined);
			prepared = await this.sessionManagers.fork(this._prepared, {
				cwd: this.cwd,
				leafId: targetLeafId,
			});
		}
		this.apply(
			await this.createPreparedRuntime(prepared, {
				cwd: prepared.snapshot.getCwd(),
				sessionStartEvent: { type: "session_start", reason: "fork", previousSessionFile },
			}),
			prepared,
		);
		await this.finishSessionReplacement(options?.withSession);
		return { cancelled: false, selectedText };
	}

	/**
	 * Import a session JSONL file and switch runtime state to the imported session.
	 *
	 * @returns `{ cancelled: true }` when cancelled by `session_before_switch`, otherwise `{ cancelled: false }`.
	 * @throws {SessionImportFileNotFoundError} When the input path does not exist.
	 * @throws {MissingSessionCwdError} When the imported session cwd cannot be resolved and no override is provided.
	 */
	async importFromJsonl(inputPath: string, cwdOverride?: string): Promise<{ cancelled: boolean }> {
		const resolvedPath = resolvePath(inputPath);
		if (!existsSync(resolvedPath)) {
			throw new SessionImportFileNotFoundError(resolvedPath);
		}

		const sessionDir = this.session.sessionView.getSessionDir();
		if (!existsSync(sessionDir)) {
			mkdirSync(sessionDir, { recursive: true });
		}

		const destinationPath = join(sessionDir, basename(resolvedPath));
		const beforeResult = await this.emitBeforeSwitch("resume", destinationPath);
		if (beforeResult.cancelled) {
			return beforeResult;
		}

		const previousSessionFile = this.session.sessionFile;
		if (resolve(destinationPath) !== resolvedPath) {
			copyFileSync(resolvedPath, destinationPath);
		}

		const prepared = await this.sessionManagers.prepare({
			kind: "open",
			path: destinationPath,
			sessionDir,
			cwdOverride,
		});
		assertSessionCwdExists(prepared.snapshot, this.cwd);
		await this.teardownCurrent("resume", prepared.snapshot.getSessionFile());
		this.apply(
			await this.createPreparedRuntime(prepared, {
				cwd: prepared.snapshot.getCwd(),
				sessionStartEvent: { type: "session_start", reason: "resume", previousSessionFile },
			}),
			prepared,
		);
		await this.finishSessionReplacement();
		return { cancelled: false };
	}

	async dispose(): Promise<void> {
		await emitSessionShutdownEvent(this.session.extensionRunner, {
			type: "session_shutdown",
			reason: "quit",
		});
		await this.session.drainSessionMutations();
		this.beforeSessionInvalidate?.();
		this.session.dispose();
	}
}

/**
 * Create the initial runtime from a runtime factory and initial session target.
 *
 * The same factory is stored on the returned AgentSessionRuntime and reused for
 * later /new, /resume, /fork, and import flows.
 */
export async function createAgentSessionRuntime(
	createRuntime: CreateAgentSessionRuntimeFactory,
	options: {
		cwd: string;
		agentDir: string;
		sessionManager?: SessionManager;
		preparedSession?: PreparedSessionRuntime;
		sessionStartEvent?: SessionStartEvent;
		sessionManagers?: SessionManagerRuntimeFactory;
	},
): Promise<AgentSessionRuntime> {
	if (!options.preparedSession && !options.sessionManager) {
		throw new Error("createAgentSessionRuntime requires preparedSession or a legacy SessionManager");
	}
	const prepared = options.preparedSession ?? await createLegacyPreparedSessionRuntime(options.sessionManager!);
	assertSessionCwdExists(prepared.snapshot, options.cwd);
	const result = await createRuntime({
		...options,
		sessionCapabilities: prepared.capabilities,
		sessionSnapshot: prepared.snapshot,
	});
	return new AgentSessionRuntime(
		result.session,
		result.services,
		createRuntime,
		result.diagnostics,
		result.modelFallbackMessage,
		options.sessionManagers,
		prepared,
	);
}

export {
	type AgentSessionRuntimeDiagnostic,
	type AgentSessionServices,
	type CreateAgentSessionFromServicesOptions,
	type CreateAgentSessionServicesOptions,
	createAgentSessionFromServices,
	createAgentSessionServices,
} from "./agent-session-services.js";
