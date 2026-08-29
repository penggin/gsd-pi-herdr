import {
	closeSync,
	existsSync,
	fstatSync,
	openSync,
	readSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";

import { HerdrClient } from "../../herdr/client.js";
import { herdrRootRuntimeId } from "../../herdr/runtime-records.js";
import { runHerdrCli, type HerdrCliResult } from "../../herdr/cli.js";
import {
	HerdrWorkerPanePool,
	type HerdrPaneReservation,
	type HerdrPaneReservationRequest,
	type HerdrWorkerReleaseOutcome,
} from "./herdr-pane-pool.js";
import {
	createHerdrWorkerLaunchSpec,
	herdrWorkerRuntimeRoot,
	readHerdrWorkerExit,
	readHerdrWorkerHeartbeat,
	readHerdrWorkerState,
	readHerdrWorkerOwnership,
	resolveHerdrWorkerArtifactPaths,
	writeHerdrWorkerLaunchBundle,
	writeHerdrWorkerOwnership,
	writeHerdrWorkerState,
	type HerdrWorkerArtifactPaths,
} from "./herdr-worker/artifacts.js";
import { JsonlLineFramer } from "./herdr-worker/jsonl.js";
import { terminateHerdrWorkerProcessGroup } from "./herdr-worker/runner.js";
import type {
	SubagentBackendCallbacks,
	SubagentBackendExecutionRequest,
	SubagentBackendExecutionResult,
	SubagentExecutionBackend,
} from "./types.js";

const DEFAULT_WAIT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 50;
const DEFAULT_CANCEL_EVIDENCE_TIMEOUT_MS = 15_000;
const DEFAULT_PANE_PROBE_INTERVAL_MS = 1000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 20_000;

export interface HerdrBackendPoolLike {
	reserve(request?: HerdrPaneReservationRequest): Promise<HerdrPaneReservation>;
}

export interface HerdrBackendClientLike {
	getEnvironment(): ReturnType<HerdrClient["getEnvironment"]>;
	request(method: string, params?: Record<string, unknown>): ReturnType<HerdrClient["request"]>;
}

export interface HerdrBackendOptions {
	rootSessionId: string;
	cwd: string;
	gsdHome: string;
	client?: HerdrBackendClientLike;
	pool?: HerdrBackendPoolLike;
	runCli?: (args: readonly string[]) => Promise<HerdrCliResult>;
	gsdBinPath?: string;
	nodeExecutable?: string;
	waitTimeoutMs?: number;
	pollIntervalMs?: number;
	cancelEvidenceTimeoutMs?: number;
	paneProbeIntervalMs?: number;
	heartbeatTimeoutMs?: number;
	terminateProcessTree?: typeof terminateHerdrWorkerProcessGroup;
}

interface LiveHerdrExecution {
	paneId: string;
	client: HerdrBackendClientLike;
}

const sharedPools = new Map<string, HerdrWorkerPanePool>();
const liveHerdrExecutions = new Map<string, LiveHerdrExecution>();

export function createHerdrSubagentBackend(options: HerdrBackendOptions): SubagentExecutionBackend {
	const client = options.client ?? new HerdrClient("custom:gsd-herdr-backend");
	const pool = options.pool ?? resolveSharedPool(client, options);
	const ownerInstanceId = randomUUID();
	return {
		id: "herdr",
		isAvailable: () => client.getEnvironment().available,
		execute: (request, callbacks) => executeHerdrSubagent(client, pool, options, ownerInstanceId, request, callbacks),
		interrupt: async (handle) => {
			const paneId = typeof handle.executionId === "string" ? handle.executionId : undefined;
			if (paneId) await sendPaneInterrupt(client, paneId);
		},
	};
}

async function executeHerdrSubagent(
	client: HerdrBackendClientLike,
	pool: HerdrBackendPoolLike,
	options: HerdrBackendOptions,
	ownerInstanceId: string,
	request: SubagentBackendExecutionRequest,
	callbacks: SubagentBackendCallbacks,
): Promise<SubagentBackendExecutionResult> {
	if (!client.getEnvironment().available) {
		return failure("Herdr backend is selected but the current GSD session is not running in a managed Herdr pane", "not-started");
	}

	const gsdBinPath = options.gsdBinPath ?? process.env.GSD_BIN_PATH;
	if (!gsdBinPath) return failure("Herdr backend cannot resolve the GSD loader path", "not-started");
	const nodeExecutable = options.nodeExecutable ?? process.execPath;
	const affinityKey = backendAffinityKey(request);
	let reservation: HerdrPaneReservation;
	try {
		reservation = await pool.reserve({ affinityKey });
	} catch (error) {
		return failure(`Herdr worker pane reservation failed: ${errorMessage(error)}`, "not-started");
	}

	const executionUuid = randomUUID();
	const artifactIdentity = {
		rootSessionId: herdrRootRuntimeId(options.rootSessionId),
		dispatchId: generatedId("dispatch", request.identity.dispatchId ?? request.identity.runId ?? executionUuid),
		childId: generatedId("child", `${request.identity.childIndex ?? request.identity.step ?? "x"}:${executionUuid}`),
	};
	const paths = resolveHerdrWorkerArtifactPaths(herdrWorkerRuntimeRoot(options.gsdHome), artifactIdentity);
	const realChildArgs = [gsdBinPath, ...request.extensionArgs, ...request.launch.args];

	try {
		createHerdrWorkerLaunchSpec({
			...artifactIdentity,
			agent: request.identity.agent,
			trackingName: request.identity.trackingName,
			taskPreview: request.identity.taskPreview,
			model: request.identity.model,
			thinking: request.identity.thinking,
			cwd: request.launch.cwd,
			executable: nodeExecutable,
			args: realChildArgs,
		}, paths);
		writeHerdrWorkerLaunchBundle(paths, {
			...artifactIdentity,
			agent: request.identity.agent,
			trackingName: request.identity.trackingName,
			taskPreview: request.identity.taskPreview,
			model: request.identity.model,
			thinking: request.identity.thinking,
			cwd: request.launch.cwd,
			executable: nodeExecutable,
			args: realChildArgs,
		}, request.launch.env);
		writeHerdrWorkerOwnership(paths, {
			schemaVersion: 1,
			...artifactIdentity,
			ownerInstanceId,
			paneId: reservation.paneId,
			tabId: reservation.tabId,
			workspaceId: reservation.workspaceId,
			affinityKey,
			status: "reserved",
			updatedAt: new Date().toISOString(),
		});
	} catch (error) {
		reservation.release("failed");
		return failure(`Herdr worker launch bundle creation failed: ${errorMessage(error)}`, "not-started", reservation, paths);
	}

	const cli = options.runCli ?? ((args: readonly string[]) => runHerdrCli(args));
	const submit = await cli([
		"pane",
		"run",
		reservation.paneId,
		nodeExecutable,
		gsdBinPath,
		"__herdr-worker",
		paths.launchPath,
	]);
	if (!submit.ok) {
		updateOwnershipStatus(paths, "orphaned");
		await sendPaneInterrupt(client, reservation.paneId);
		reservation.release("failed");
		return failure(
			`Herdr pane run failed or was ambiguous: ${boundedCliError(submit)}`,
			"ambiguous",
			reservation,
			paths,
		);
	}
	updateOwnershipStatus(paths, "submitted");

	liveHerdrExecutions.set(reservation.paneId, { paneId: reservation.paneId, client });
	try {
		const evidence = await waitForWorkerEvidence(client, reservation, paths, request, callbacks, options);
		updateOwnershipStatus(paths, evidence.runtimeError ? "orphaned" : "settled");
		const outcome: HerdrWorkerReleaseOutcome = evidence.aborted
			? "aborted"
			: evidence.exitCode === 0 && !evidence.runtimeError
				? "completed"
				: "failed";
		reservation.release(outcome);
		return {
			...evidence,
			handle: {
				backendId: "herdr",
				executionId: reservation.paneId,
				metadata: { tabId: reservation.tabId, workspaceId: reservation.workspaceId, workerDir: paths.workerDir },
			},
			metadata: {
				paneId: reservation.paneId,
				tabId: reservation.tabId,
				workspaceId: reservation.workspaceId,
				workerDir: paths.workerDir,
				launchState: evidence.runtimeError ? "interrupted" : "completed",
			},
		};
	} finally {
		liveHerdrExecutions.delete(reservation.paneId);
	}
}

async function waitForWorkerEvidence(
	client: HerdrBackendClientLike,
	reservation: HerdrPaneReservation,
	paths: HerdrWorkerArtifactPaths,
	request: SubagentBackendExecutionRequest,
	callbacks: SubagentBackendCallbacks,
	options: HerdrBackendOptions,
): Promise<Pick<SubagentBackendExecutionResult, "exitCode" | "aborted" | "signal" | "runtimeError">> {
	const waitTimeoutMs = options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
	const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
	const cancelEvidenceTimeoutMs = options.cancelEvidenceTimeoutMs ?? DEFAULT_CANCEL_EVIDENCE_TIMEOUT_MS;
	const paneProbeIntervalMs = options.paneProbeIntervalMs ?? DEFAULT_PANE_PROBE_INTERVAL_MS;
	const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
	const stdout = new JsonlLineFramer({ onLine: callbacks.onStdoutLine });
	const stderrDecoder = new StringDecoder("utf8");
	const stdoutTail = { offset: 0 };
	const stderrTail = { offset: 0 };
	const started = Date.now();
	let interruptSentAt: number | undefined;
	let timeoutTriggered = false;
	let nextPaneProbeAt = Date.now() + paneProbeIntervalMs;
	let relayFinalized = false;
	const finalizeRelays = () => {
		if (relayFinalized) return;
		relayFinalized = true;
		stdout.end();
		const stderrEnd = stderrDecoder.end();
		if (stderrEnd) callbacks.onStderr(stderrEnd);
	};

	while (true) {
		tailFile(paths.stdoutPath, stdoutTail, (chunk) => stdout.push(chunk));
		tailFile(paths.stderrPath, stderrTail, (chunk) => {
			const text = stderrDecoder.write(chunk);
			if (text) callbacks.onStderr(text);
		});

		if (existsSync(paths.exitPath)) {
			try {
				const exit = readHerdrWorkerExit(paths);
				finalizeRelays();
				return {
					exitCode: exit.exitCode,
					aborted: exit.aborted || request.signal?.aborted === true,
					...(exit.signal ? { signal: exit.signal } : {}),
				};
			} catch (error) {
				finalizeRelays();
				return {
					exitCode: 1,
					aborted: request.signal?.aborted === true,
					runtimeError: `Herdr worker produced invalid exit evidence: ${errorMessage(error)}`,
				};
			}
		}

		const now = Date.now();
		if (interruptSentAt === undefined && now >= nextPaneProbeAt) {
			nextPaneProbeAt = now + paneProbeIntervalMs;
			const pane = await probePane(client, reservation.paneId);
			if (!pane) {
				const cleanupError = await terminateDetachedWorkerAfterPaneLoss(paths, options);
				reservation.discard();
				finalizeRelays();
				return {
					exitCode: 1,
					aborted: false,
					runtimeError: `Herdr worker pane disappeared before final exit evidence was produced${cleanupError ? `; detached worker cleanup failed: ${cleanupError}` : ""}`,
				};
			}
			const livenessError = await inspectWorkerLiveness(paths, heartbeatTimeoutMs, options, now);
			if (livenessError) {
				finalizeRelays();
				return { exitCode: 1, aborted: false, runtimeError: livenessError };
			}
		}
		if (request.signal?.aborted && interruptSentAt === undefined) {
			interruptSentAt = now;
			await sendPaneInterrupt(client, reservation.paneId);
		}
		if (!request.signal?.aborted && now - started >= waitTimeoutMs && interruptSentAt === undefined) {
			timeoutTriggered = true;
			interruptSentAt = now;
			await sendPaneInterrupt(client, reservation.paneId);
		}
		if (interruptSentAt !== undefined && now - interruptSentAt >= cancelEvidenceTimeoutMs) {
			finalizeRelays();
			return {
				exitCode: 1,
				aborted: request.signal?.aborted === true,
				runtimeError: request.signal?.aborted
					? "Herdr worker cancellation did not produce exit evidence within the bounded grace period"
					: timeoutTriggered
						? "Herdr worker execution timed out and did not produce exit evidence after interrupt"
						: "Herdr worker did not produce exit evidence",
			};
		}

		await delay(pollIntervalMs);
	}
}

async function inspectWorkerLiveness(
	paths: HerdrWorkerArtifactPaths,
	heartbeatTimeoutMs: number,
	options: HerdrBackendOptions,
	now: number,
): Promise<string | undefined> {
	if (!existsSync(paths.statePath)) return undefined;
	try {
		const state = readHerdrWorkerState(paths);
		if (["completed", "failed", "aborted", "orphaned"].includes(state.status)) return undefined;
		let reason: string | undefined;
		if (state.pid && !isProcessAlive(state.pid)) reason = `Herdr internal worker process ${state.pid} disappeared`;
		if (!reason && existsSync(paths.heartbeatPath)) {
			const heartbeat = readHerdrWorkerHeartbeat(paths);
			if (now - Date.parse(heartbeat.updatedAt) > heartbeatTimeoutMs) reason = "Herdr worker heartbeat became stale";
		}
		if (!reason) return undefined;
		const cleanupError = await terminateDetachedWorkerAfterPaneLoss(paths, options);
		writeHerdrWorkerState(paths, {
			...state,
			status: "orphaned",
			updatedAt: new Date(now).toISOString(),
			lastActivity: { kind: "error", label: reason },
		});
		updateOwnershipStatus(paths, "orphaned");
		return `${reason} before final exit evidence was produced${cleanupError ? `; detached worker cleanup failed: ${cleanupError}` : ""}`;
	} catch (error) {
		return `Herdr worker liveness evidence is invalid: ${errorMessage(error)}`;
	}
}

async function terminateDetachedWorkerAfterPaneLoss(
	paths: HerdrWorkerArtifactPaths,
	options: HerdrBackendOptions,
): Promise<string | undefined> {
	if (!existsSync(paths.statePath)) return undefined;
	try {
		const state = readHerdrWorkerState(paths);
		if (!state.childPid) return undefined;
		const childPid = state.childPid;
		const terminate = options.terminateProcessTree ?? terminateHerdrWorkerProcessGroup;
		await terminate(childPid, () => !isProcessAlive(childPid));
		return isProcessAlive(childPid) ? `process ${childPid} remained alive after bounded termination` : undefined;
	} catch (error) {
		return errorMessage(error);
	}
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

function updateOwnershipStatus(
	paths: HerdrWorkerArtifactPaths,
	status: "submitted" | "settled" | "orphaned",
): void {
	try {
		const ownership = readHerdrWorkerOwnership(paths);
		writeHerdrWorkerOwnership(paths, { ...ownership, status, updatedAt: new Date().toISOString() });
	} catch {
		// State/exit evidence remains authoritative to the common runner. A
		// missing ownership transition is handled conservatively on reload.
	}
}

async function probePane(client: HerdrBackendClientLike, paneId: string): Promise<boolean> {
	try {
		const response = await client.request("pane.get", { pane_id: paneId });
		return response !== null && !response.error;
	} catch {
		return false;
	}
}

function tailFile(path: string, state: { offset: number }, consume: (chunk: Buffer) => void): void {
	if (!existsSync(path)) return;
	let fd: number | undefined;
	try {
		fd = openSync(path, "r");
		const stat = fstatSync(fd);
		if (stat.size <= state.offset) return;
		let remaining = stat.size - state.offset;
		while (remaining > 0) {
			const size = Math.min(64 * 1024, remaining);
			const buffer = Buffer.allocUnsafe(size);
			const read = readSync(fd, buffer, 0, size, state.offset);
			if (read <= 0) break;
			state.offset += read;
			remaining -= read;
			consume(buffer.subarray(0, read));
		}
	} catch {
		// Artifact files may appear between existence/open/stat calls. The next
		// poll retries; final exit validation remains authoritative.
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}

async function sendPaneInterrupt(client: HerdrBackendClientLike, paneId: string): Promise<void> {
	try {
		await client.request("pane.send_keys", { pane_id: paneId, keys: ["ctrl+c"] });
	} catch {
		// The caller receives explicit missing-exit/runtime evidence if the worker
		// cannot be interrupted or has already disappeared.
	}
}

export async function stopLiveHerdrSubagentExecutions(): Promise<void> {
	const active = Array.from(liveHerdrExecutions.values());
	await Promise.all(active.map((execution) => sendPaneInterrupt(execution.client, execution.paneId)));
}

/** @internal M4 regression visibility. */
export function getLiveHerdrSubagentExecutionCount(): number {
	return liveHerdrExecutions.size;
}

function resolveSharedPool(client: HerdrBackendClientLike, options: HerdrBackendOptions): HerdrWorkerPanePool {
	const environment = client.getEnvironment();
	const key = `${environment.workspaceId ?? "unknown"}:${options.rootSessionId}:${options.gsdHome}`;
	const existing = sharedPools.get(key);
	if (existing) return existing;
	const created = new HerdrWorkerPanePool(client, {
		rootSessionId: options.rootSessionId,
		cwd: options.cwd,
		paneEnv: { GSD_HOME: options.gsdHome },
		runtimeRoot: herdrWorkerRuntimeRoot(options.gsdHome),
	});
	sharedPools.set(key, created);
	return created;
}

function backendAffinityKey(request: SubagentBackendExecutionRequest): string {
	if (request.identity.affinityKey) return request.identity.affinityKey;
	return [
		request.identity.dispatchId ?? request.identity.runId ?? "dispatch",
		request.identity.childIndex ?? request.identity.step ?? request.identity.agent,
	].join(":");
}

function generatedId(prefix: string, value: string): string {
	const hash = createHash("sha256").update(value).digest("hex").slice(0, 20);
	return `${prefix}-${hash}`;
}

function failure(
	message: string,
	launchState: string,
	reservation?: HerdrPaneReservation,
	paths?: HerdrWorkerArtifactPaths,
): SubagentBackendExecutionResult {
	return {
		exitCode: 1,
		aborted: false,
		runtimeError: message,
		...(reservation ? { handle: { backendId: "herdr", executionId: reservation.paneId } } : {}),
		metadata: {
			launchState,
			...(reservation ? { paneId: reservation.paneId, tabId: reservation.tabId, workspaceId: reservation.workspaceId } : {}),
			...(paths ? { workerDir: paths.workerDir } : {}),
		},
	};
}

function boundedCliError(result: HerdrCliResult): string {
	const value = (result.stderr || result.stdout || (result.notFound ? "Herdr CLI not found" : "unknown CLI error"))
		.replace(/[\r\n]+/g, " ")
		.trim();
	return value.length <= 180 ? value : `${value.slice(0, 179)}…`;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
