import type { SubagentLaunchPlan } from "../launch.js";
import type { SubagentRunMode } from "../run-store.js";

/**
 * Runtime-neutral identity carried to a backend for observability and handle
 * ownership only. Backends must not derive orchestration policy from it.
 */
export interface SubagentExecutionIdentity {
	runId?: string;
	dispatchId?: string;
	childIndex?: number;
	mode?: SubagentRunMode;
	agent: string;
	trackingName?: string;
	step?: number;
}

/**
 * Minimal context used while resolving/checking a backend. Runtime-specific
 * preference objects intentionally stay outside the generic execution API.
 */
export interface SubagentBackendContext {
	defaultCwd: string;
	env: NodeJS.ProcessEnv;
}

/**
 * Already-resolved launch request. Model selection, session/fork decisions,
 * cwd authority, and child environment are resolved above the backend.
 */
export interface SubagentBackendExecutionRequest {
	launch: SubagentLaunchPlan;
	extensionArgs: readonly string[];
	identity: SubagentExecutionIdentity;
	signal?: AbortSignal;
}

/**
 * Semantic stream sinks owned by the common runner. A backend forwards only
 * complete stdout JSONL records and raw stderr chunks; it does not parse GSD
 * messages or aggregate usage itself.
 */
export interface SubagentBackendCallbacks {
	onStdoutLine(line: string): void;
	onStderr(chunk: string): void;
}

/**
 * Opaque backend-owned execution handle. Local may retain a ChildProcess;
 * cmux/Herdr can retain surface/pane/artifact identities instead.
 */
export interface SubagentBackendExecutionHandle {
	backendId: string;
	executionId?: string;
	native?: unknown;
	metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Process/runtime evidence returned upward for one launch attempt. Mapping
 * this evidence into SingleResult/error/abort semantics belongs to the common
 * runner, not the backend.
 */
export interface SubagentBackendExecutionResult {
	exitCode: number;
	aborted: boolean;
	signal?: NodeJS.Signals | string;
	runtimeError?: string;
	handle?: SubagentBackendExecutionHandle;
	metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Runtime contract shared by Local, Cmux, and future Herdr execution.
 *
 * Retry, chain/parallel orchestration, model selection, JSON parsing, usage
 * aggregation, final-response validation, run-store truth, and isolation
 * merge policy are intentionally excluded.
 */
export interface SubagentExecutionBackend {
	readonly id: string;
	isAvailable(context: SubagentBackendContext): boolean | Promise<boolean>;
	execute(
		request: SubagentBackendExecutionRequest,
		callbacks: SubagentBackendCallbacks,
	): Promise<SubagentBackendExecutionResult>;
	interrupt?(handle: SubagentBackendExecutionHandle): void | Promise<void>;
}
