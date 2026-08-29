import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { shellEscape } from "../../cmux/index.js";
import {
	SUBAGENT_CHILD_ENV_VAR,
	SUBAGENT_RUNTIME_CONTRACT_ROOT_ENV_VAR,
} from "../launch.js";
import type {
	SubagentBackendCallbacks,
	SubagentBackendExecutionRequest,
	SubagentBackendExecutionResult,
	SubagentExecutionBackend,
} from "./types.js";

export interface CmuxBackendClient {
	createSplit(direction: "right" | "down" | "left" | "up"): Promise<string | null>;
	sendSurface(surfaceId: string, text: string): Promise<boolean>;
	sendInterrupt(surfaceId: string): Promise<boolean>;
}

export interface CmuxBackendOptions {
	waitTimeoutMs?: number;
	pollIntervalMs?: number;
	interruptGraceMs?: number;
}

const DEFAULT_WAIT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 50;
const DEFAULT_INTERRUPT_GRACE_MS = 5000;
const liveCmuxSubagentExecutions = new Map<string, CmuxBackendClient>();

export function buildCmuxShellEnvAssignments(env: NodeJS.ProcessEnv = process.env): string[] {
	return [SUBAGENT_CHILD_ENV_VAR, SUBAGENT_RUNTIME_CONTRACT_ROOT_ENV_VAR]
		.flatMap((name) => env[name] ? [`${name}=${shellEscape(env[name]!)}`] : []);
}

export function createCmuxSubagentBackend(
	client: CmuxBackendClient,
	directionOrSurfaceId: "right" | "down" | "left" | "up" | string,
	options: CmuxBackendOptions = {},
): SubagentExecutionBackend {
	return {
		id: "cmux",
		isAvailable: () => true,
		execute: (request, callbacks) => executeCmuxSubagent(client, directionOrSurfaceId, request, callbacks, options),
	};
}

async function executeCmuxSubagent(
	client: CmuxBackendClient,
	directionOrSurfaceId: "right" | "down" | "left" | "up" | string,
	request: SubagentBackendExecutionRequest,
	callbacks: SubagentBackendCallbacks,
	options: CmuxBackendOptions,
): Promise<SubagentBackendExecutionResult> {
	const waitTimeoutMs = options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
	const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
	const interruptGraceMs = options.interruptGraceMs ?? DEFAULT_INTERRUPT_GRACE_MS;
	const isDirection = isSplitDirection(directionOrSurfaceId);
	const surfaceId = isDirection
		? await client.createSplit(directionOrSurfaceId)
		: directionOrSurfaceId;

	if (!surfaceId) {
		return {
			exitCode: 1,
			aborted: false,
			runtimeError: "cmux split creation failed before subagent launch; local fallback is disabled",
			metadata: { launchState: "not-started" },
		};
	}

	const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-cmux-"));
	const stdoutPath = path.join(outputDir, "stdout.jsonl");
	const stderrPath = path.join(outputDir, "stderr.log");
	const exitPath = path.join(outputDir, "exit.code");

	try {
		const script = buildCmuxExecutionScript(request, stdoutPath, stderrPath, exitPath);
		const sent = await client.sendSurface(surfaceId, `bash -lc ${shellEscape(script)}`);
		if (!sent) {
			// Submission failure can be ambiguous: the terminal may have accepted a
			// prefix before the CLI timed out. Never launch a second local worker;
			// best-effort interrupt the reserved surface and fail visibly instead.
			try {
				await client.sendInterrupt(surfaceId);
			} catch {
				/* explicit runtimeError below remains authoritative */
			}
			return {
				exitCode: 1,
				aborted: false,
				runtimeError: "cmux command submission failed or was ambiguous; local fallback is disabled",
				handle: { backendId: "cmux", executionId: surfaceId },
				metadata: { surfaceId, launchState: "ambiguous" },
			};
		}
		liveCmuxSubagentExecutions.set(surfaceId, client);

		const finished = await waitForFile(exitPath, request.signal, waitTimeoutMs, pollIntervalMs);
		if (!finished) {
			try {
				await client.sendInterrupt(surfaceId);
			} catch {
				/* best-effort interrupt; evidence below remains explicit */
			}
			await waitForFile(exitPath, undefined, interruptGraceMs, pollIntervalMs);
			forwardCmuxArtifacts(stdoutPath, stderrPath, callbacks);
			const aborted = request.signal?.aborted === true;
			return {
				exitCode: readExitCode(exitPath) ?? 1,
				aborted,
				runtimeError: aborted
					? undefined
					: "cmux subagent execution timed out before exit evidence was produced",
				handle: { backendId: "cmux", executionId: surfaceId },
				metadata: { surfaceId, launchState: "interrupted" },
			};
		}

		forwardCmuxArtifacts(stdoutPath, stderrPath, callbacks);
		return {
			exitCode: readExitCode(exitPath) ?? 1,
			aborted: false,
			handle: { backendId: "cmux", executionId: surfaceId },
			metadata: { surfaceId, launchState: "completed" },
		};
	} finally {
		liveCmuxSubagentExecutions.delete(surfaceId);
		try {
			fs.rmSync(outputDir, { recursive: true, force: true });
		} catch {
			/* best-effort artifact cleanup preserves current ephemeral behavior */
		}
	}
}

export async function stopLiveCmuxSubagentExecutions(): Promise<void> {
	const active = Array.from(liveCmuxSubagentExecutions.entries());
	await Promise.all(
		active.map(async ([surfaceId, client]) => {
			try {
				await client.sendInterrupt(surfaceId);
			} catch {
				/* best-effort shutdown; execution reconciliation remains elsewhere */
			}
		}),
	);
}

/** @internal M2 regression-test visibility only. */
export function getLiveCmuxSubagentExecutionCount(): number {
	return liveCmuxSubagentExecutions.size;
}

export function buildCmuxExecutionScript(
	request: SubagentBackendExecutionRequest,
	stdoutPath: string,
	stderrPath: string,
	exitPath: string,
): string {
	const processArgs = [process.env.GSD_BIN_PATH!, ...request.extensionArgs, ...request.launch.args];
	const bashPath = (value: string) => shellEscape(value.replaceAll("\\", "/"));
	const envPrefix = buildCmuxShellEnvAssignments(request.launch.env).join(" ");
	const commandPrefix = envPrefix ? `${envPrefix} ` : "";

	return [
		`cd ${bashPath(request.launch.cwd)}`,
		`printf '%s\\n' ${shellEscape(`GSD subagent ${request.identity.agent} running`)}`,
		`${commandPrefix}${bashPath(process.execPath)} ${processArgs.map((arg) => bashPath(arg)).join(" ")} > ${bashPath(stdoutPath)} 2> ${bashPath(stderrPath)}`,
		"status=$?",
		`printf '%s' "$status" > ${bashPath(exitPath)}`,
		`printf 'GSD subagent finished (exit %s)\\n' "$status"`,
	].join("; ");
}

function forwardCmuxArtifacts(
	stdoutPath: string,
	stderrPath: string,
	callbacks: SubagentBackendCallbacks,
): void {
	if (fs.existsSync(stdoutPath)) {
		const stdout = fs.readFileSync(stdoutPath, "utf-8");
		for (const line of stdout.split("\n")) callbacks.onStdoutLine(line);
	}
	if (fs.existsSync(stderrPath)) callbacks.onStderr(fs.readFileSync(stderrPath, "utf-8"));
}

function readExitCode(exitPath: string): number | undefined {
	if (!fs.existsSync(exitPath)) return undefined;
	const raw = fs.readFileSync(exitPath, "utf-8").trim();
	if (!raw) return 1;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) ? parsed : 1;
}

function isSplitDirection(value: string): value is "right" | "down" | "left" | "up" {
	return value === "right" || value === "down" || value === "left" || value === "up";
}

async function waitForFile(
	filePath: string,
	signal: AbortSignal | undefined,
	timeoutMs: number,
	pollIntervalMs: number,
): Promise<boolean> {
	if (fs.existsSync(filePath)) return true;
	if (signal?.aborted) return false;

	return new Promise<boolean>((resolve) => {
		let settled = false;
		let interval: ReturnType<typeof setInterval> | undefined;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const finish = (value: boolean) => {
			if (settled) return;
			settled = true;
			if (interval) clearInterval(interval);
			if (timeout) clearTimeout(timeout);
			if (signal) signal.removeEventListener("abort", onAbort);
			resolve(value);
		};
		const onAbort = () => finish(false);
		interval = setInterval(() => {
			if (fs.existsSync(filePath)) finish(true);
		}, pollIntervalMs);
		timeout = setTimeout(() => finish(false), timeoutMs);
		if (signal) signal.addEventListener("abort", onAbort, { once: true });
	});
}
