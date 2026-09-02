import type { ProviderEnv } from "../types.js";

let procEnvCache: Map<string, string> | null = null;

function getBunSandboxEnvValue(name: string): string | undefined {
	if (typeof process === "undefined" || !process.versions?.bun || Object.keys(process.env).length > 0) {
		return undefined;
	}

	if (procEnvCache === null) {
		procEnvCache = new Map();
		try {
			const { readFileSync } = require("node:fs") as typeof import("node:fs");
			const data = readFileSync("/proc/self/environ", "utf-8");
			for (const entry of data.split("\0")) {
				const separator = entry.indexOf("=");
				if (separator > 0) procEnvCache.set(entry.slice(0, separator), entry.slice(separator + 1));
			}
		} catch {
			// /proc/self/environ may not exist or may not be readable.
		}
	}

	return procEnvCache.get(name);
}

/** Resolve a provider-scoped override before ambient process environment values. */
export function getProviderEnvValue(name: string, env?: ProviderEnv): string | undefined {
	return (
		env?.[name]
		|| (typeof process !== "undefined" ? process.env[name] : undefined)
		|| getBunSandboxEnvValue(name)
		|| undefined
	);
}
