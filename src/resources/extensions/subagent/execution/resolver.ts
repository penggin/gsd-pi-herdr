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
	preferred?: SubagentExecutionBackend;
}

export interface SubagentRuntimePolicyInput {
	herdrEnabled: boolean;
	herdrRequired: boolean;
	herdrAvailable: boolean;
	cmuxSplitsEnabled: boolean;
}

export type SubagentRuntimePreference = "local" | "cmux" | "herdr";

/**
 * Resolve the configured runtime before any external launch has started.
 * Required Herdr stays selected even when preflight detection fails, making
 * dispatch fail visibly instead of silently becoming cmux/local. Optional
 * unavailable Herdr is the only case that may fall back before launch.
 */
export function resolveSubagentRuntimePreference(
	input: SubagentRuntimePolicyInput,
): SubagentRuntimePreference {
	if (input.herdrEnabled && (input.herdrAvailable || input.herdrRequired)) return "herdr";
	if (input.cmuxSplitsEnabled) return "cmux";
	return "local";
}

/**
 * Resolve the runtime backend for one orchestration operation.
 *
 * Orchestration resolves its preferred external runtime once before calling
 * this function. This seam keeps every operation on the common semantic runner
 * while preserving LocalBackend as the explicit default.
 */
export function resolveSubagentExecutionBackend(
	_operation: SubagentExecutionOperation,
	overrides: SubagentBackendResolverOverrides = {},
): SubagentExecutionBackend {
	return overrides.preferred ?? overrides.local ?? localSubagentBackend;
}
