import { SessionManager } from "@gsd/pi-coding-agent/core/session-manager.js";
import {
	LegacyV3SessionCapabilityAdapter,
	type SessionCapabilityAdapter,
	SessionCapabilityReadSnapshot,
} from "./session-capability-adapter.js";

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

/** One coherently prepared session backend and its compatibility surfaces. */
export interface PreparedSessionRuntime {
	readonly backend: ProductionSessionBackend;
	readonly capabilities: SessionCapabilityAdapter;
	readonly snapshot: SessionCapabilityReadSnapshot;
	/** Present only while legacy-v3 remains available to unconverted construction paths. */
	readonly legacyManager?: SessionManager;
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
}

export function createLegacySessionManagerRuntimeFactory(): SessionManagerRuntimeFactory {
	return {
		backend: "legacy-v3",
		async prepare(target): Promise<PreparedSessionRuntime> {
			switch (target.kind) {
				case "create":
					return createLegacyPreparedSessionRuntime(SessionManager.create(target.cwd, target.sessionDir));
				case "open":
					return createLegacyPreparedSessionRuntime(SessionManager.open(target.path, target.sessionDir, target.cwdOverride));
				case "continue-recent":
					return createLegacyPreparedSessionRuntime(SessionManager.continueRecent(target.cwd, target.sessionDir));
				case "memory":
					return createLegacyPreparedSessionRuntime(SessionManager.inMemory(target.cwd));
			}
		},
	};
}

export const legacySessionManagerRuntimeFactory = createLegacySessionManagerRuntimeFactory();
