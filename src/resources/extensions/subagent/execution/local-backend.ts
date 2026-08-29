import { spawn, type ChildProcess } from "node:child_process";
import type {
	SubagentBackendCallbacks,
	SubagentBackendExecutionRequest,
	SubagentBackendExecutionResult,
	SubagentExecutionBackend,
} from "./types.js";

const liveLocalSubagentProcesses = new Set<ChildProcess>();

/**
 * Direct local child-process backend.
 *
 * M2.3 intentionally contains mechanics only: process creation, stdout line
 * framing, stderr forwarding, local process ownership, and the existing
 * termination behavior. GSD semantic parsing/finalization stays above this
 * backend.
 */
export const localSubagentBackend: SubagentExecutionBackend = {
	id: "local",
	isAvailable: () => true,
	execute: executeLocalSubagent,
};

async function executeLocalSubagent(
	request: SubagentBackendExecutionRequest,
	callbacks: SubagentBackendCallbacks,
): Promise<SubagentBackendExecutionResult> {
	const { launch, extensionArgs, signal } = request;
	let aborted = false;

	return new Promise<SubagentBackendExecutionResult>((resolve) => {
		const proc = spawn(
			process.execPath,
			[process.env.GSD_BIN_PATH!, ...extensionArgs, ...launch.args],
			{ cwd: launch.cwd, env: launch.env, shell: false, stdio: ["ignore", "pipe", "pipe"] },
		);
		liveLocalSubagentProcesses.add(proc);
		let stdoutBuffer = "";

		proc.stdout.on("data", (data) => {
			stdoutBuffer += data.toString();
			const lines = stdoutBuffer.split("\n");
			stdoutBuffer = lines.pop() || "";
			for (const line of lines) callbacks.onStdoutLine(line);
		});

		proc.stderr.on("data", (data) => {
			callbacks.onStderr(data.toString());
		});

		proc.on("close", (code) => {
			liveLocalSubagentProcesses.delete(proc);
			if (stdoutBuffer.trim()) callbacks.onStdoutLine(stdoutBuffer);
			resolve({ exitCode: code ?? 0, aborted });
		});

		proc.on("error", () => {
			liveLocalSubagentProcesses.delete(proc);
			resolve({ exitCode: 1, aborted });
		});

		if (signal) {
			const killProc = () => {
				aborted = true;
				proc.kill("SIGTERM");
				setTimeout(() => {
					// Preserve the pre-M2 local runner behavior exactly. `proc.killed`
					// indicates a signal was sent, not necessarily process exit; the
					// escalation semantics are characterized separately before any fix.
					if (!proc.killed) proc.kill("SIGKILL");
				}, 5000);
			};
			if (signal.aborted) killProc();
			else signal.addEventListener("abort", killProc, { once: true });
		}
	});
}

export async function stopLocalSubagentProcesses(): Promise<void> {
	const active = Array.from(liveLocalSubagentProcesses);
	if (active.length === 0) return;

	for (const proc of active) {
		try {
			proc.kill("SIGTERM");
		} catch {
			/* preserve existing shutdown best-effort behavior */
		}
	}

	await Promise.all(
		active.map(
			(proc) =>
				new Promise<void>((resolve) => {
					const done = () => resolve();
					const timer = setTimeout(done, 500);
					proc.once("exit", () => {
						clearTimeout(timer);
						resolve();
					});
				}),
		),
	);

	for (const proc of active) {
		if (proc.exitCode === null) {
			try {
				proc.kill("SIGKILL");
			} catch {
				/* preserve existing shutdown best-effort behavior */
			}
		}
	}
}

/** @internal M2 parity-test visibility only. */
export function getLiveLocalSubagentProcessCount(): number {
	return liveLocalSubagentProcesses.size;
}
