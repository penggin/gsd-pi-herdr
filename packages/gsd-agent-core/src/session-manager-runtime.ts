import { SessionManager } from "@gsd/pi-coding-agent/core/session-manager.js";

/**
 * Session storage backend selected by the production composition root.
 *
 * Only the proven legacy backend is selectable today. `harness-v4` is
 * intentionally absent until it can satisfy the same lifecycle contract.
 */
export type ProductionSessionBackend = "legacy-v3";

export type SessionManagerTarget =
	| { kind: "create"; cwd: string; sessionDir?: string }
	| { kind: "open"; path: string; sessionDir?: string; cwdOverride?: string }
	| { kind: "continue-recent"; cwd: string; sessionDir?: string }
	| { kind: "memory"; cwd?: string };

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
	prepare(target: SessionManagerTarget): Promise<SessionManager>;
}

export function createLegacySessionManagerRuntimeFactory(): SessionManagerRuntimeFactory {
	return {
		backend: "legacy-v3",
		async prepare(target): Promise<SessionManager> {
			switch (target.kind) {
				case "create":
					return SessionManager.create(target.cwd, target.sessionDir);
				case "open":
					return SessionManager.open(target.path, target.sessionDir, target.cwdOverride);
				case "continue-recent":
					return SessionManager.continueRecent(target.cwd, target.sessionDir);
				case "memory":
					return SessionManager.inMemory(target.cwd);
			}
		},
	};
}

export const legacySessionManagerRuntimeFactory = createLegacySessionManagerRuntimeFactory();
