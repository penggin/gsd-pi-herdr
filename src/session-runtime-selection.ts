import type { SessionManagerRuntimeFactory } from "@gsd/agent-core";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export type InternalSessionBackend = "legacy-v3" | "harness-v4";
export type SessionBackend = InternalSessionBackend;

export const SESSION_BACKENDS: readonly SessionBackend[] = ["legacy-v3", "harness-v4"];

export function resolvePublicSessionBackend(value: string, source = "--session-backend"): SessionBackend {
	if (value === "legacy-v3" || value === "harness-v4") return value;
	throw new Error(`Unsupported ${source}: ${value}. Expected one of: ${SESSION_BACKENDS.join(", ")}`);
}

export function resolveInternalSessionBackend(value: string | undefined): InternalSessionBackend {
	if (value === undefined || value === "legacy-v3") return "legacy-v3";
	if (value === "harness-v4") return value;
	throw new Error(`Unsupported GSD_INTERNAL_SESSION_BACKEND: ${value}`);
}

export function resolveSessionBackendSelection(options: {
	backend?: string;
	environment?: NodeJS.ProcessEnv;
} = {}): SessionBackend {
	const environment = options.environment ?? process.env;
	if (options.backend !== undefined) return resolvePublicSessionBackend(options.backend);
	if (environment.GSD_SESSION_BACKEND !== undefined) {
		return resolvePublicSessionBackend(environment.GSD_SESSION_BACKEND, "GSD_SESSION_BACKEND");
	}
	return resolveInternalSessionBackend(environment.GSD_INTERNAL_SESSION_BACKEND);
}

/**
 * Select the root session runtime. Public CLI selection wins, followed by the
 * documented environment setting, then the retained internal validation seam.
 * An unset selection always preserves the deployed legacy-v3 default.
 */
export async function createSelectedSessionRuntimeFactory(options: {
	cwd: string;
	sessionsRoot: string;
	backend?: string;
}): Promise<SessionManagerRuntimeFactory> {
	const backend = resolveSessionBackendSelection({ backend: options.backend });
	const core = await import("@gsd/agent-core");
	if (backend === "legacy-v3") return core.legacySessionManagerRuntimeFactory;
	const nodeModulePath = resolve(
		dirname(fileURLToPath(import.meta.url)),
		"../packages/pi-agent-core/dist/node.js",
	);
	const { NodeExecutionEnv } = await import(pathToFileURL(nodeModulePath).href) as typeof import("@gsd/pi-agent-core/node");
	return core.createHarnessV4SessionManagerRuntimeFactory({
		fs: new NodeExecutionEnv({ cwd: options.cwd }),
		sessionsRoot: options.sessionsRoot,
	});
}
