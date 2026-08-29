import { localSubagentBackend } from "./local-backend.js";
import type { SubagentExecutionBackend } from "./types.js";

export type SubagentExecutionOperation =
	| "resume"
	| "background"
	| "chain"
	| "parallel"
	| "single";

export interface SubagentBackendResolverOverrides {
	local?: SubagentExecutionBackend;
}

/**
 * Resolve the runtime backend for one orchestration operation.
 *
 * M2.5 introduces the seam without changing selection behavior. Until cmux is
 * extracted into the common backend contract and Herdr worker execution exists,
 * every operation resolved here is explicitly local. Existing cmux single /
 * parallel branches remain outside this resolver until their M2 migration.
 */
export function resolveSubagentExecutionBackend(
	_operation: SubagentExecutionOperation,
	overrides: SubagentBackendResolverOverrides = {},
): SubagentExecutionBackend {
	return overrides.local ?? localSubagentBackend;
}
