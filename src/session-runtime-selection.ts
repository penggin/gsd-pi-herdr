import type { SessionManagerRuntimeFactory } from "@gsd/agent-core";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export type InternalSessionBackend = "legacy-v3" | "harness-v4";

export function resolveInternalSessionBackend(value: string | undefined): InternalSessionBackend {
	if (value === undefined || value === "legacy-v3") return "legacy-v3";
	if (value === "harness-v4") return value;
	throw new Error(`Unsupported GSD_INTERNAL_SESSION_BACKEND: ${value}`);
}

/** Internal composition seam; this is deliberately not a user preference. */
export async function createSelectedSessionRuntimeFactory(options: {
	cwd: string;
	sessionsRoot: string;
	backend?: string;
}): Promise<SessionManagerRuntimeFactory> {
	const backend = resolveInternalSessionBackend(options.backend ?? process.env.GSD_INTERNAL_SESSION_BACKEND);
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
