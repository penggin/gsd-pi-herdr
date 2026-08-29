import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import type { HerdrCliResult } from "../../../herdr/cli.js";
import type { HerdrEnvironment } from "../../../herdr/client.js";
import {
	createHerdrSubagentBackend,
	getLiveHerdrSubagentExecutionCount,
} from "../herdr-backend.js";
import type { HerdrPaneReservation, HerdrWorkerReleaseOutcome } from "../herdr-pane-pool.js";
import type { SubagentBackendExecutionRequest } from "../types.js";

class FakePool {
	released: HerdrWorkerReleaseOutcome[] = [];
	discarded = 0;
	reserved: string[] = [];
	async reserve(request: { affinityKey?: string } = {}): Promise<HerdrPaneReservation> {
		this.reserved.push(request.affinityKey ?? "");
		return {
			paneId: "w1:p9",
			slotIndex: 0,
			tabId: "w1:t9",
			workspaceId: "w1",
			affinityKey: request.affinityKey,
			discard: () => { this.discarded += 1; },
			release: (outcome) => this.released.push(outcome),
		};
	}
}

class FakeClient {
	requests: Array<{ method: string; params: Record<string, unknown> }> = [];
	paneAvailable = true;
	getEnvironment(): HerdrEnvironment {
		return { available: true, socketPath: "/tmp/herdr.sock", workspaceId: "w1", tabId: "w1:t1", paneId: "w1:p1" };
	}
	async request(method: string, params: Record<string, unknown> = {}) {
		this.requests.push({ method, params });
		if (method === "pane.get" && !this.paneAvailable) {
			return { id: "fake", error: { code: "pane_not_found", message: "pane not found" } };
		}
		return { id: "fake", result: { type: "ok" } };
	}
}

function request(cwd: string, signal?: AbortSignal): SubagentBackendExecutionRequest {
	return {
		launch: {
			cwd,
			env: { TEST_ENV: "yes" },
			args: ["--mode", "json", "-p", "Task: inspect"],
			session: { mode: "fresh" },
		},
		extensionArgs: ["--extension", "/bundle/ext.js"],
		identity: {
			rootSessionId: "root-session",
			dispatchId: "dispatch-1",
			childIndex: 0,
			agent: "scout",
			trackingName: "falcon",
			affinityKey: "dispatch-1:0",
			taskPreview: "inspect",
			model: "fixture/model",
			thinking: "high",
		},
		signal,
	};
}

function cliResult(ok: boolean, stderr = ""): HerdrCliResult {
	return { ok, stdout: "", stderr, exitCode: ok ? 0 : 1, timedOut: false, notFound: false };
}

describe("HerdrBackend", () => {
	let tempRoot: string | undefined;
	afterEach(() => {
		if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
		tempRoot = undefined;
	});

	function fixture() {
		tempRoot = mkdtempSync(join(tmpdir(), "gsd-herdr-backend-"));
		const gsdHome = join(tempRoot, "home");
		const cwd = join(tempRoot, "repo");
		mkdirSync(gsdHome, { recursive: true });
		mkdirSync(cwd);
		const pool = new FakePool();
		const client = new FakeClient();
		return { gsdHome, cwd, pool, client };
	}

	it("writes an M3 launch bundle, submits only argv through pane run, relays artifacts, and releases a completed slot", async () => {
		const { gsdHome, cwd, pool, client } = fixture();
		const cliCalls: readonly string[][] = [] as unknown as readonly string[][];
		const calls: string[][] = [];
		const backend = createHerdrSubagentBackend({
			rootSessionId: "root-session",
			cwd,
			gsdHome,
			client,
			pool,
			gsdBinPath: "/opt/gsd/loader.js",
			nodeExecutable: process.execPath,
			pollIntervalMs: 5,
			runCli: async (args) => {
				calls.push([...args]);
				const launchPath = String(args.at(-1));
				const spec = JSON.parse(readFileSync(launchPath, "utf8"));
				assert.deepEqual(spec.args, [
					"/opt/gsd/loader.js",
					"--extension",
					"/bundle/ext.js",
					"--mode",
					"json",
					"-p",
					"Task: inspect",
				]);
				setTimeout(() => {
					writeFileSync(spec.stdoutPath, '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"done"}]}}\n');
					writeFileSync(spec.stderrPath, "diagnostic");
					writeFileSync(spec.exitPath, JSON.stringify({ schemaVersion: 1, exitCode: 0, signal: null, aborted: false, completedAt: new Date().toISOString() }), { mode: 0o600 });
				}, 10);
				return cliResult(true);
			},
		});
		const stdout: string[] = [];
		const stderr: string[] = [];
		const result = await backend.execute(request(cwd), {
			onStdoutLine: (line) => stdout.push(line),
			onStderr: (chunk) => stderr.push(chunk),
		});
		assert.equal(result.exitCode, 0);
		assert.equal(result.aborted, false);
		assert.deepEqual(pool.released, ["completed"]);
		assert.deepEqual(pool.reserved, ["dispatch-1:0"]);
		assert.equal(calls.length, 1);
		assert.deepEqual(calls[0].slice(0, 4), ["pane", "run", "w1:p9", process.execPath]);
		assert.equal(calls[0][4], "/opt/gsd/loader.js");
		assert.equal(calls[0][5], "__herdr-worker");
		assert.equal(stdout.length, 1);
		assert.deepEqual(stderr, ["diagnostic"]);
		assert.match(String(result.metadata?.workerDir), /runtime[\\/]herdr[\\/]v1/);
		assert.equal(getLiveHerdrSubagentExecutionCount(), 0);
		void cliCalls;
	});

	it("fails visibly and retains the pane when CLI submission is ambiguous", async () => {
		const { gsdHome, cwd, pool, client } = fixture();
		const backend = createHerdrSubagentBackend({
			rootSessionId: "root-session", cwd, gsdHome, client, pool,
			gsdBinPath: "/opt/gsd/loader.js",
			runCli: async () => cliResult(false, "submission failed"),
		});
		const result = await backend.execute(request(cwd), { onStdoutLine: () => {}, onStderr: () => {} });
		assert.equal(result.exitCode, 1);
		assert.match(result.runtimeError ?? "", /failed or was ambiguous/);
		assert.deepEqual(pool.released, ["failed"]);
		assert.ok(client.requests.some((item) => item.method === "pane.send_keys"));
	});

	it("interrupts the exact pane on AbortSignal and returns M3 aborted exit evidence", async () => {
		const { gsdHome, cwd, pool, client } = fixture();
		const controller = new AbortController();
		const backend = createHerdrSubagentBackend({
			rootSessionId: "root-session", cwd, gsdHome, client, pool,
			gsdBinPath: "/opt/gsd/loader.js",
			pollIntervalMs: 5,
			cancelEvidenceTimeoutMs: 200,
			runCli: async (args) => {
				const launchPath = String(args.at(-1));
				const spec = JSON.parse(readFileSync(launchPath, "utf8"));
				setTimeout(() => controller.abort(), 10);
				const interval = setInterval(() => {
					if (client.requests.some((item) => item.method === "pane.send_keys")) {
						clearInterval(interval);
						writeFileSync(spec.stdoutPath, "");
						writeFileSync(spec.stderrPath, "");
						writeFileSync(spec.exitPath, JSON.stringify({ schemaVersion: 1, exitCode: 1, signal: "SIGKILL", aborted: true, completedAt: new Date().toISOString() }), { mode: 0o600 });
					}
				}, 5);
				return cliResult(true);
			},
		});
		const result = await backend.execute(request(cwd, controller.signal), { onStdoutLine: () => {}, onStderr: () => {} });
		assert.equal(result.aborted, true);
		assert.deepEqual(pool.released, ["aborted"]);
		const interrupt = client.requests.find((item) => item.method === "pane.send_keys");
		assert.deepEqual(interrupt?.params, { pane_id: "w1:p9", keys: ["ctrl+c"] });
	});

	it("fails before launch when Herdr environment is unavailable", async () => {
		const { gsdHome, cwd, pool } = fixture();
		const client = new FakeClient();
		client.getEnvironment = () => ({ available: false });
		const backend = createHerdrSubagentBackend({ rootSessionId: "root", cwd, gsdHome, client, pool });
		const result = await backend.execute(request(cwd), { onStdoutLine: () => {}, onStderr: () => {} });
		assert.match(result.runtimeError ?? "", /not running in a managed Herdr pane/);
		assert.deepEqual(pool.released, []);
	});

	it("fails visibly when the reserved worker pane disappears before exit evidence", async () => {
		const { gsdHome, cwd, pool, client } = fixture();
		const terminated: number[] = [];
		const backend = createHerdrSubagentBackend({
			rootSessionId: "root-session", cwd, gsdHome, client, pool,
			gsdBinPath: "/opt/gsd/loader.js",
			pollIntervalMs: 5,
			paneProbeIntervalMs: 10,
			waitTimeoutMs: 500,
			terminateProcessTree: async (pid) => { terminated.push(pid); },
			runCli: async (args) => {
				const launchPath = String(args.at(-1));
				const spec = JSON.parse(readFileSync(launchPath, "utf8"));
				writeFileSync(spec.statePath, JSON.stringify({
					schemaVersion: 1,
					status: "working",
					updatedAt: new Date().toISOString(),
					pid: 31337,
					childPid: 424242,
					paneId: "w1:p9",
				}), { mode: 0o600 });
				setTimeout(() => { client.paneAvailable = false; }, 15);
				return cliResult(true);
			},
		});
		const result = await backend.execute(request(cwd), { onStdoutLine: () => {}, onStderr: () => {} });
		assert.equal(result.exitCode, 1);
		assert.match(result.runtimeError ?? "", /pane disappeared/);
		assert.deepEqual(pool.released, ["failed"]);
		assert.deepEqual(terminated, [424242]);
		assert.equal(pool.discarded, 1);
	});
});
