import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import {
	buildCmuxExecutionScript,
	buildCmuxShellEnvAssignments,
	createCmuxSubagentBackend,
	getLiveCmuxSubagentExecutionCount,
	stopLiveCmuxSubagentExecutions,
	type CmuxBackendClient,
} from "../cmux-backend.js";
import {
	SUBAGENT_CHILD_ENV_VAR,
	SUBAGENT_CHILD_ENV_VALUE,
	SUBAGENT_RUNTIME_CONTRACT_ROOT_ENV_VAR,
} from "../../launch.js";

function resolveBashSkipReason(): string | undefined {
	if (process.platform === "win32") return "bash is not available on Windows";
	try {
		execFileSync("bash", ["-c", "true"], { stdio: "ignore" });
		return undefined;
	} catch {
		return "bash binary is not available";
	}
}

const BASH_SKIP_REASON = resolveBashSkipReason();

function request(cwd: string) {
	process.env.GSD_BIN_PATH ??= join(cwd, "fixture-child.mjs");
	return {
		launch: {
			args: [],
			env: {
				...process.env,
				[SUBAGENT_CHILD_ENV_VAR]: SUBAGENT_CHILD_ENV_VALUE,
			},
			cwd,
			session: { mode: "fresh" as const },
		},
		extensionArgs: [],
		identity: { agent: "fixture" },
	};
}

class ShellFixtureClient implements CmuxBackendClient {
	sent = "";
	interrupts = 0;

	async createSplit(): Promise<string> {
		return "surface:42";
	}

	async sendSurface(_surfaceId: string, text: string): Promise<boolean> {
		this.sent = text;
		void new Promise<void>((resolve) => {
			execFile("bash", ["-lc", text], () => resolve());
		});
		return true;
	}

	async sendInterrupt(): Promise<boolean> {
		this.interrupts += 1;
		return true;
	}
}

describe("CmuxBackend", () => {
	let dir: string | undefined;
	const previousBinPath = process.env.GSD_BIN_PATH;

	afterEach(() => {
		if (previousBinPath === undefined) delete process.env.GSD_BIN_PATH;
		else process.env.GSD_BIN_PATH = previousBinPath;
		if (dir) rmSync(dir, { recursive: true, force: true });
		dir = undefined;
	});

	it("owns cmux-only shell environment escaping outside the general launch layer", { skip: BASH_SKIP_REASON }, () => {
		dir = mkdtempSync(join(tmpdir(), "gsd-cmux-env-"));
		const marker = join(dir, "injected");
		const projectRoot = `space $HOME $(touch ${marker}) \`touch ${marker}\` 'quote'\nnext`;
		const assignments = buildCmuxShellEnvAssignments({
			[SUBAGENT_CHILD_ENV_VAR]: SUBAGENT_CHILD_ENV_VALUE,
			[SUBAGENT_RUNTIME_CONTRACT_ROOT_ENV_VAR]: projectRoot,
		});
		const output = execFileSync(
			"bash",
			["-lc", `env ${assignments.join(" ")} printenv ${SUBAGENT_RUNTIME_CONTRACT_ROOT_ENV_VAR}`],
			{ encoding: "utf-8" },
		);

		assert.equal(output, `${projectRoot}\n`);
		assert.equal(existsSync(marker), false);
	});

	it("builds a bounded pane command that redirects raw JSON instead of teeing it into the surface", () => {
		dir = mkdtempSync(join(tmpdir(), "gsd-cmux-script-"));
		process.env.GSD_BIN_PATH = join(dir, "child.mjs");
		const script = buildCmuxExecutionScript(
			request(dir),
			join(dir, "stdout.jsonl"),
			join(dir, "stderr.log"),
			join(dir, "exit.code"),
		);

		assert.doesNotMatch(script, /\btee\b/);
		assert.match(script, /> .*stdout\.jsonl/);
		assert.match(script, /2> .*stderr\.log/);
		assert.match(script, /GSD subagent fixture running/);
		assert.match(script, /GSD subagent finished/);
	});

	it("executes through a real bash fixture and returns only runtime evidence while forwarding artifacts", { skip: BASH_SKIP_REASON }, async () => {
		dir = mkdtempSync(join(tmpdir(), "gsd-cmux-execute-"));
		const childPath = join(dir, "child.mjs");
		writeFileSync(
			childPath,
			`process.stdout.write(JSON.stringify({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'cmux final'}],usage:{input:1,output:2,cacheRead:0,cacheWrite:0,totalTokens:3,cost:{total:0.1}}}})+'\\n'); process.stderr.write('cmux warning\\n');`,
			"utf8",
		);
		process.env.GSD_BIN_PATH = childPath;
		const client = new ShellFixtureClient();
		const stdout: string[] = [];
		const stderr: string[] = [];
		const backend = createCmuxSubagentBackend(client, "right", {
			waitTimeoutMs: 2000,
			pollIntervalMs: 5,
			interruptGraceMs: 50,
		});

		const evidence = await backend.execute(request(dir), {
			onStdoutLine: (line) => stdout.push(line),
			onStderr: (chunk) => stderr.push(chunk),
		});

		assert.equal(evidence.exitCode, 0);
		assert.equal(evidence.aborted, false);
		assert.equal(evidence.handle?.backendId, "cmux");
		assert.equal(evidence.handle?.executionId, "surface:42");
		assert.equal(stdout.length, 2); // JSON record + trailing empty split record.
		assert.match(stdout[0], /cmux final/);
		assert.equal(stderr.join(""), "cmux warning\n");
		assert.doesNotMatch(client.sent, /\btee\b/);
		assert.equal(getLiveCmuxSubagentExecutionCount(), 0);
	});

	it("fails visibly instead of silently selecting local when split creation fails", async () => {
		dir = mkdtempSync(join(tmpdir(), "gsd-cmux-create-fail-"));
		const client: CmuxBackendClient = {
			createSplit: async () => null,
			sendSurface: async () => true,
			sendInterrupt: async () => true,
		};
		const evidence = await createCmuxSubagentBackend(client, "right").execute(request(dir), {
			onStdoutLine: () => {},
			onStderr: () => {},
		});

		assert.equal(evidence.exitCode, 1);
		assert.equal(evidence.aborted, false);
		assert.match(evidence.runtimeError ?? "", /split creation failed/);
	});

	it("treats failed command submission as ambiguous, interrupts the reserved surface, and never falls back", async () => {
		dir = mkdtempSync(join(tmpdir(), "gsd-cmux-send-fail-"));
		let interrupts = 0;
		const client: CmuxBackendClient = {
			createSplit: async () => "surface:9",
			sendSurface: async () => false,
			sendInterrupt: async () => {
				interrupts += 1;
				return true;
			},
		};
		const evidence = await createCmuxSubagentBackend(client, "right").execute(request(dir), {
			onStdoutLine: () => {},
			onStderr: () => {},
		});

		assert.equal(evidence.exitCode, 1);
		assert.equal(interrupts, 1);
		assert.match(evidence.runtimeError ?? "", /submission failed or was ambiguous/);
		assert.equal(evidence.metadata?.launchState, "ambiguous");
	});

	it("normalizes AbortSignal cancellation into aborted backend evidence", async () => {
		dir = mkdtempSync(join(tmpdir(), "gsd-cmux-abort-"));
		let interrupts = 0;
		const client: CmuxBackendClient = {
			createSplit: async () => "surface:10",
			sendSurface: async () => true,
			sendInterrupt: async () => {
				interrupts += 1;
				return true;
			},
		};
		const controller = new AbortController();
		controller.abort();
		const evidence = await createCmuxSubagentBackend(client, "right", {
			interruptGraceMs: 10,
			pollIntervalMs: 1,
		}).execute({ ...request(dir), signal: controller.signal }, {
			onStdoutLine: () => {},
			onStderr: () => {},
		});

		assert.equal(evidence.aborted, true);
		assert.equal(interrupts, 1);
		assert.equal(evidence.metadata?.launchState, "interrupted");
	});

	it("tracks active surfaces so session shutdown can interrupt external executions", async () => {
		dir = mkdtempSync(join(tmpdir(), "gsd-cmux-shutdown-"));
		let interrupts = 0;
		const client: CmuxBackendClient = {
			createSplit: async () => "surface:11",
			sendSurface: async () => true,
			sendInterrupt: async () => {
				interrupts += 1;
				return true;
			},
		};
		const pending = createCmuxSubagentBackend(client, "right", {
			waitTimeoutMs: 30,
			interruptGraceMs: 1,
			pollIntervalMs: 1,
		}).execute(request(dir), {
			onStdoutLine: () => {},
			onStderr: () => {},
		});

		for (let i = 0; i < 20 && getLiveCmuxSubagentExecutionCount() !== 1; i++) {
			await new Promise((resolve) => setTimeout(resolve, 1));
		}
		assert.equal(getLiveCmuxSubagentExecutionCount(), 1);
		await stopLiveCmuxSubagentExecutions();
		assert.equal(interrupts, 1);
		await pending;
		assert.equal(getLiveCmuxSubagentExecutionCount(), 0);
	});
});
