import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { activateGSD, deactivateGSD, setCurrentPhase } from "../../shared/gsd-phase-state.js";
import type { AgentConfig } from "../agents.js";
import { createHerdrSubagentBackend } from "../execution/herdr-backend.js";
import type { HerdrPaneReservation } from "../execution/herdr-pane-pool.js";
import type { SubagentExecutionBackend } from "../execution/types.js";
import { __subagentLocalRunnerTestHooks, runRestrictedSubagent } from "../index.js";

const ZERO_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	cost: 0,
	contextTokens: 0,
	turns: 0,
};

function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
	return {
		name: "worker",
		description: "Characterization worker",
		systemPrompt: "",
		source: "project",
		filePath: "worker.md",
		...overrides,
	};
}

function makeAssistantMessage(
	text: string,
	options: {
		model?: string;
		stopReason?: string;
		errorMessage?: string;
		input?: number;
		output?: number;
		cacheRead?: number;
		cacheWrite?: number;
		totalTokens?: number;
		cost?: number;
	} = {},
) {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		model: options.model,
		stopReason: options.stopReason,
		errorMessage: options.errorMessage,
		usage: {
			input: options.input ?? 0,
			output: options.output ?? 0,
			cacheRead: options.cacheRead ?? 0,
			cacheWrite: options.cacheWrite ?? 0,
			totalTokens: options.totalTokens ?? 0,
			cost: { total: options.cost ?? 0 },
		},
	};
}

function makeToolResultMessage(text: string) {
	return {
		role: "toolResult",
		toolCallId: "tool-1",
		toolName: "read",
		content: [{ type: "text", text }],
		isError: false,
	};
}

function jsonLine(value: unknown): string {
	return `${JSON.stringify(value)}\n`;
}

describe("local runSingleAgent semantics before backend extraction", () => {
	let dir: string | undefined;
	const previousBinPath = process.env.GSD_BIN_PATH;
	const previousBundledPaths = process.env.GSD_BUNDLED_EXTENSION_PATHS;

	afterEach(async () => {
		deactivateGSD();
		await __subagentLocalRunnerTestHooks.stopLiveSubagents();
		if (previousBinPath === undefined) delete process.env.GSD_BIN_PATH;
		else process.env.GSD_BIN_PATH = previousBinPath;
		if (previousBundledPaths === undefined) delete process.env.GSD_BUNDLED_EXTENSION_PATHS;
		else process.env.GSD_BUNDLED_EXTENSION_PATHS = previousBundledPaths;
		if (dir) rmSync(dir, { recursive: true, force: true });
		dir = undefined;
	});

	function createFixtureChild(source: string): string {
		dir ??= mkdtempSync(join(tmpdir(), "gsd-local-runner-characterization-"));
		const script = join(dir, `child-${Math.random().toString(16).slice(2)}.mjs`);
		writeFileSync(script, source, "utf8");
		process.env.GSD_BIN_PATH = script;
		process.env.GSD_BUNDLED_EXTENSION_PATHS = "";
		return script;
	}

	async function run(options: {
		agents?: AgentConfig[];
		agentName?: string;
		task?: string;
		step?: number;
		trackingName?: string;
		thinkingOverride?: string;
		signal?: AbortSignal;
		sessionOverride?: { mode: "fresh" } | { mode: "fork"; sessionFile: string; sessionDir?: string };
		onUpdate?: (partial: any) => void;
	} = {}) {
		dir ??= mkdtempSync(join(tmpdir(), "gsd-local-runner-characterization-"));
		return __subagentLocalRunnerTestHooks.runSingleAgent(
			dir,
			options.agents ?? [makeAgent()],
			options.agentName ?? "worker",
			options.task ?? "inspect the fixture",
			undefined,
			options.step ?? 2,
			options.signal,
			options.onUpdate,
			(results) => ({
				mode: "single",
				agentScope: "both",
				projectAgentsDir: null,
				results,
			}),
			{
				contextMode: "fresh",
				trackingName: options.trackingName,
				thinkingOverride: options.thinkingOverride,
				sessionOverride: options.sessionOverride,
			},
		);
	}

	it("streams complete JSONL events, accumulates usage, and returns the last assistant text", async () => {
		const first = makeAssistantMessage("draft", {
			model: "fixture-model-a",
			stopReason: "stop",
			input: 3,
			output: 5,
			cacheRead: 7,
			cacheWrite: 11,
			totalTokens: 26,
			cost: 0.12,
		});
		const tool = makeToolResultMessage("tool output");
		const second = makeAssistantMessage("final answer", {
			model: "fixture-model-b",
			stopReason: "length",
			errorMessage: "last assistant diagnostic",
			input: 13,
			output: 17,
			cacheRead: 19,
			cacheWrite: 23,
			totalTokens: 72,
			cost: 0.34,
		});
		createFixtureChild(`
process.stdout.write('not-json\\n');
process.stdout.write(${JSON.stringify(jsonLine({ type: "message_end", message: first }))});
process.stdout.write(${JSON.stringify(jsonLine({ type: "tool_result_end", message: tool }))});
process.stdout.write(${JSON.stringify(jsonLine({ type: "message_end", message: second }))});
process.stderr.write('fixture stderr\\n');
`);

		const updates: any[] = [];
		const result = await run({
			trackingName: "slot-a",
			onUpdate: (partial) => updates.push(structuredClone(partial)),
		});

		assert.equal(result.exitCode, 0);
		assert.equal(result.running, false);
		assert.equal(result.agent, "worker");
		assert.equal(result.trackingName, "slot-a");
		assert.equal(result.agentSource, "project");
		assert.equal(result.step, 2);
		assert.equal(result.stderr, "fixture stderr\n");
		assert.equal(result.model, "fixture-model-a");
		assert.equal(result.stopReason, "length");
		assert.equal(result.errorMessage, "last assistant diagnostic");
		assert.deepEqual(result.usage, {
			input: 16,
			output: 22,
			cacheRead: 26,
			cacheWrite: 34,
			cost: 0.46,
			contextTokens: 72,
			turns: 2,
		});
		assert.equal(result.messages.length, 3);
		assert.equal((result.messages[2] as any).content[0].text, "final answer");

		assert.equal(updates.length, 3);
		assert.deepEqual(updates.map((update) => update.content[0].text), ["draft", "draft", "final answer"]);
		assert.ok(updates.every((update) => update.details.results[0].running === true));
		assert.ok(updates.every((update) => update.details.results[0].exitCode === -1));
	});

	it("restricted child disables ambient resources and loads only explicit extensions and tools", async () => {
		dir ??= mkdtempSync(join(tmpdir(), "gsd-local-runner-characterization-"));
		const argsPath = join(dir, "args.json");
		const finalMessage = makeAssistantMessage("restricted result", { stopReason: "stop" });
		createFixtureChild(`
import { writeFileSync } from "node:fs";
writeFileSync(process.env.ARGS_PATH, JSON.stringify(process.argv.slice(2)));
process.stdout.write(${JSON.stringify(jsonLine({ type: "message_end", message: finalMessage }))});
`);
		process.env.GSD_BUNDLED_EXTENSION_PATHS = "/tmp/ambient-extension.ts";

		const result = await runRestrictedSubagent({
			defaultCwd: dir,
			agent: makeAgent({ tools: ["assessment_read"] }),
			task: "restricted task",
			env: { ARGS_PATH: argsPath },
			extensionPaths: ["/tmp/assessment-extension.ts"],
		});
		const args = JSON.parse(readFileSync(argsPath, "utf8")) as string[];

		assert.equal(result.output, "restricted result");
		for (const flag of ["--bare", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes"]) {
			assert.ok(args.includes(flag), `missing ${flag}`);
		}
		assert.deepEqual(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2), ["--tools", "assessment_read"]);
		assert.ok(args.includes("/tmp/assessment-extension.ts"));
		assert.equal(args.includes("/tmp/ambient-extension.ts"), false);
	});

	it("converts exit 0 with no assistant final text into the canonical missing-final failure", async () => {
		const tool = makeToolResultMessage("only a tool result");
		createFixtureChild(`process.stdout.write(${JSON.stringify(jsonLine({ type: "tool_result_end", message: tool }))});`);

		const updates: any[] = [];
		const result = await run({ onUpdate: (partial) => updates.push(structuredClone(partial)) });

		assert.equal(result.exitCode, 1);
		assert.equal(result.running, false);
		assert.equal(result.stopReason, "error");
		assert.equal(result.errorMessage, "Subagent produced no valid final response.");
		assert.equal(result.stderr, "Subagent produced no valid final response.");
		assert.deepEqual(result.usage, ZERO_USAGE);
		assert.equal(updates.length, 1);
		assert.equal(updates[0].content[0].text, "(running...)");
	});

	it("preserves a non-zero child exit code instead of rewriting it as missing-final", async () => {
		createFixtureChild(`process.stderr.write('child failed\\n'); process.exitCode = 7;`);

		const result = await run();

		assert.equal(result.exitCode, 7);
		assert.equal(result.running, false);
		assert.equal(result.stderr, "child failed\n");
		assert.equal(result.stopReason, undefined);
		assert.equal(result.errorMessage, undefined);
		assert.deepEqual(result.messages, []);
	});

	it("processes a final complete JSON object left in the stdout buffer without a newline", async () => {
		const finalMessage = makeAssistantMessage("buffered final", {
			model: "buffer-model",
			stopReason: "stop",
			input: 2,
			output: 3,
			totalTokens: 5,
		});
		createFixtureChild(`process.stdout.write(${JSON.stringify(JSON.stringify({ type: "message_end", message: finalMessage }))});`);

		const updates: any[] = [];
		const result = await run({ onUpdate: (partial) => updates.push(structuredClone(partial)) });

		assert.equal(result.exitCode, 0);
		assert.equal(result.model, "buffer-model");
		assert.equal(result.stopReason, "stop");
		assert.equal((result.messages[0] as any).content[0].text, "buffered final");
		assert.equal(updates.length, 1);
		assert.equal(updates[0].content[0].text, "buffered final");
	});

	it("copies the forked session file onto the semantic result", async () => {
		const finalMessage = makeAssistantMessage("forked result", { stopReason: "stop" });
		createFixtureChild(`process.stdout.write(${JSON.stringify(jsonLine({ type: "message_end", message: finalMessage }))});`);
		dir ??= mkdtempSync(join(tmpdir(), "gsd-local-runner-characterization-"));
		const sessionFile = join(dir, "forked-session.jsonl");

		const result = await run({
			sessionOverride: { mode: "fork", sessionFile, sessionDir: dir },
		});

		assert.equal(result.exitCode, 0);
		assert.equal(result.sessionFile, sessionFile);
	});

	it("returns an unknown-agent result without spawning a child", async () => {
		const markerDir = mkdtempSync(join(tmpdir(), "gsd-local-runner-no-spawn-"));
		dir = markerDir;
		process.env.GSD_BIN_PATH = join(markerDir, "should-not-be-used.mjs");

		const result = await run({
			agents: [makeAgent({ name: "known" })],
			agentName: "missing",
			trackingName: "slot-missing",
			thinkingOverride: "high",
		});

		assert.equal(result.exitCode, 1);
		assert.equal(result.agentSource, "unknown");
		assert.equal(result.trackingName, "slot-missing");
		assert.equal(result.thinking, "high");
		assert.match(result.stderr, /Unknown agent: "missing"\. Available agents: "known"\./);
		assert.deepEqual(result.usage, ZERO_USAGE);
	});

	it("enforces the local GSD phase-conflict guard before child launch", async () => {
		const markerDir = mkdtempSync(join(tmpdir(), "gsd-local-runner-phase-"));
		dir = markerDir;
		process.env.GSD_BIN_PATH = join(markerDir, "should-not-be-used.mjs");
		activateGSD();
		assert.equal(setCurrentPhase("plan-slice"), true);

		const result = await run({
			agents: [makeAgent({ conflictsWith: ["plan-slice"], thinking: "medium" })],
		});

		assert.equal(result.exitCode, 1);
		assert.equal(result.agentSource, "project");
		assert.equal(result.thinking, "medium");
		assert.match(result.stderr, /blocked: it conflicts with the active GSD phase "plan-slice"/);
		assert.deepEqual(result.messages, []);
		assert.deepEqual(result.usage, ZERO_USAGE);
	});

	it("tracks a spawned local child until shutdown terminates it and removes it from the registry", async () => {
		createFixtureChild(`setInterval(() => {}, 1000);`);
		const pending = run();

		for (let i = 0; i < 50 && __subagentLocalRunnerTestHooks.getLiveProcessCount() !== 1; i++) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		assert.equal(__subagentLocalRunnerTestHooks.getLiveProcessCount(), 1);

		await __subagentLocalRunnerTestHooks.stopLiveSubagents();
		const result = await pending;

		assert.equal(__subagentLocalRunnerTestHooks.getLiveProcessCount(), 0);
		assert.equal(result.exitCode, 1);
		assert.equal(result.stopReason, "error");
		assert.equal(result.errorMessage, "Subagent produced no valid final response.");
	});

	it("rejects with the canonical local abort error after terminating an AbortSignal-cancelled child", async () => {
		createFixtureChild(`setInterval(() => {}, 1000);`);
		const controller = new AbortController();
		const realSetTimeout = globalThis.setTimeout;
		globalThis.setTimeout = ((handler: (...args: any[]) => void, timeout?: number, ...args: any[]) => {
			const timer = realSetTimeout(handler, timeout, ...args);
			if (timeout === 5000 && typeof (timer as any).unref === "function") (timer as any).unref();
			return timer;
		}) as typeof globalThis.setTimeout;

		try {
			const pending = run({ signal: controller.signal });
			for (let i = 0; i < 50 && __subagentLocalRunnerTestHooks.getLiveProcessCount() !== 1; i++) {
				await new Promise((resolve) => realSetTimeout(resolve, 10));
			}
			assert.equal(__subagentLocalRunnerTestHooks.getLiveProcessCount(), 1);
			controller.abort();
			await assert.rejects(pending, /Subagent was aborted/);
			assert.equal(__subagentLocalRunnerTestHooks.getLiveProcessCount(), 0);
		} finally {
			globalThis.setTimeout = realSetTimeout;
		}
	});
});

describe("runSingleAgentWithBackend semantic boundary", () => {
	it("produces Local-vs-Herdr semantic parity for the same deterministic JSONL and exit evidence", async (t) => {
		const dir = mkdtempSync(join(tmpdir(), "gsd-local-herdr-parity-"));
		const gsdHome = join(dir, "home");
		mkdirSync(gsdHome, { recursive: true });
		const previousBinPath = process.env.GSD_BIN_PATH;
		const previousBundledPaths = process.env.GSD_BUNDLED_EXTENSION_PATHS;
		t.after(async () => {
			await __subagentLocalRunnerTestHooks.stopLiveSubagents();
			if (previousBinPath === undefined) delete process.env.GSD_BIN_PATH;
			else process.env.GSD_BIN_PATH = previousBinPath;
			if (previousBundledPaths === undefined) delete process.env.GSD_BUNDLED_EXTENSION_PATHS;
			else process.env.GSD_BUNDLED_EXTENSION_PATHS = previousBundledPaths;
			rmSync(dir, { recursive: true, force: true });
		});

		const assistant = makeAssistantMessage("parity final", {
			model: "parity-model",
			stopReason: "stop",
			input: 7,
			output: 9,
			cacheRead: 2,
			cacheWrite: 3,
			totalTokens: 21,
			cost: 0.42,
		});
		const rawLine = JSON.stringify({ type: "message_end", message: assistant });
		const localScript = join(dir, "local-child.mjs");
		writeFileSync(localScript, `process.stdout.write(${JSON.stringify(`${rawLine}\n`)});`, "utf8");
		process.env.GSD_BIN_PATH = localScript;
		process.env.GSD_BUNDLED_EXTENSION_PATHS = "";
		const agent = makeAgent({ model: "configured-model", thinking: "high" });
		const makeDetails = (results: any[]) => ({ mode: "single" as const, agentScope: "both" as const, projectAgentsDir: null, results });

		const local = await __subagentLocalRunnerTestHooks.runSingleAgent(
			dir,
			[agent],
			"worker",
			"parity task",
			undefined,
			1,
			undefined,
			undefined,
			makeDetails,
			{ contextMode: "fresh", trackingName: "falcon" },
		);

		const client = {
			getEnvironment: () => ({
				available: true,
				socketPath: "/tmp/herdr.sock",
				workspaceId: "w1",
				tabId: "w1:t1",
				paneId: "w1:p1",
			}),
			request: async () => ({ id: "fake", result: { type: "ok" } }),
		};
		const pool = {
			async reserve(): Promise<HerdrPaneReservation> {
				return {
					paneId: "w1:p9",
					slotIndex: 0,
					tabId: "w1:t9",
					workspaceId: "w1",
					discard: () => {},
					release: () => {},
				};
			},
		};
		const herdr = createHerdrSubagentBackend({
			rootSessionId: "root-parity",
			cwd: dir,
			gsdHome,
			client,
			pool,
			gsdBinPath: "/fixture/gsd-loader.js",
			pollIntervalMs: 5,
			runCli: async (args) => {
				const launchPath = String(args.at(-1));
				const spec = JSON.parse(readFileSync(launchPath, "utf8"));
				setTimeout(() => {
					writeFileSync(spec.stdoutPath, `${rawLine}\n`);
					writeFileSync(spec.stderrPath, "");
					writeFileSync(spec.exitPath, JSON.stringify({
						schemaVersion: 1,
						exitCode: 0,
						signal: null,
						aborted: false,
						completedAt: new Date().toISOString(),
					}), { mode: 0o600 });
				}, 10);
				return { ok: true, stdout: "", stderr: "", exitCode: 0, timedOut: false, notFound: false };
			},
		});
		const herdrResult = await __subagentLocalRunnerTestHooks.runSingleAgentWithBackend(
			dir,
			[agent],
			"worker",
			"parity task",
			undefined,
			1,
			undefined,
			undefined,
			makeDetails,
			{ contextMode: "fresh", trackingName: "falcon" },
			herdr,
		);

		const semantic = (result: typeof local) => ({
			agent: result.agent,
			trackingName: result.trackingName,
			agentSource: result.agentSource,
			task: result.task,
			exitCode: result.exitCode,
			messages: result.messages,
			usage: result.usage,
			model: result.model,
			thinking: result.thinking,
			stopReason: result.stopReason,
			errorMessage: result.errorMessage,
			step: result.step,
		});
		assert.deepEqual(semantic(herdrResult), semantic(local));
	});

	it("produces the same semantic result from backend stream/evidence without owning runtime mechanics", async (t) => {
		const dir = mkdtempSync(join(tmpdir(), "gsd-common-runner-"));
		t.after(() => rmSync(dir, { recursive: true, force: true }));
		const assistant = makeAssistantMessage("backend-neutral final", {
			model: "backend-model",
			stopReason: "stop",
			input: 5,
			output: 8,
			totalTokens: 13,
			cost: 0.25,
		});
		const toolResult = makeToolResultMessage("backend tool output");
		let receivedAgent = "";
		let receivedTask = "";

		const backend: SubagentExecutionBackend = {
			id: "fixture-backend",
			isAvailable: () => true,
			async execute(request, callbacks) {
				receivedAgent = request.identity.agent;
				receivedTask = request.launch.args.at(-1) ?? "";
				callbacks.onStdoutLine(JSON.stringify({ type: "message_end", message: assistant }));
				callbacks.onStdoutLine(JSON.stringify({ type: "tool_result_end", message: toolResult }));
				callbacks.onStderr("backend stderr\n");
				return { exitCode: 0, aborted: false, metadata: { runtime: "fixture" } };
			},
		};
		const updates: any[] = [];

		const result = await __subagentLocalRunnerTestHooks.runSingleAgentWithBackend(
			dir,
			[makeAgent({ model: "configured-model", thinking: "high" })],
			"worker",
			"inspect backend neutrality",
			undefined,
			4,
			undefined,
			(partial) => updates.push(structuredClone(partial)),
			(results) => ({
				mode: "single",
				agentScope: "both",
				projectAgentsDir: null,
				results,
			}),
			{
				contextMode: "fresh",
				trackingName: "backend-slot",
			},
			backend,
		);

		assert.equal(receivedAgent, "worker");
		assert.equal(receivedTask, "Task: inspect backend neutrality");
		assert.equal(result.exitCode, 0);
		assert.equal(result.running, false);
		assert.equal(result.model, "configured-model");
		assert.equal(result.thinking, "high");
		assert.equal(result.stopReason, "stop");
		assert.equal(result.stderr, "backend stderr\n");
		assert.deepEqual(result.usage, {
			input: 5,
			output: 8,
			cacheRead: 0,
			cacheWrite: 0,
			cost: 0.25,
			contextTokens: 13,
			turns: 1,
		});
		assert.equal(result.messages.length, 2);
		assert.deepEqual(updates.map((update) => update.content[0].text), [
			"backend-neutral final",
			"backend-neutral final",
		]);
	});

	it("maps backend aborted evidence to the existing canonical runner rejection", async (t) => {
		const dir = mkdtempSync(join(tmpdir(), "gsd-common-runner-abort-"));
		t.after(() => rmSync(dir, { recursive: true, force: true }));
		const backend: SubagentExecutionBackend = {
			id: "aborted-fixture",
			isAvailable: () => true,
			async execute() {
				return { exitCode: 143, aborted: true, signal: "SIGTERM" };
			},
		};

		await assert.rejects(
			__subagentLocalRunnerTestHooks.runSingleAgentWithBackend(
				dir,
				[makeAgent()],
				"worker",
				"abort fixture",
				undefined,
				undefined,
				undefined,
				undefined,
				(results) => ({
					mode: "single",
					agentScope: "both",
					projectAgentsDir: null,
					results,
				}),
				{ contextMode: "fresh" },
				backend,
			),
			/Subagent was aborted/,
		);
	});

	it("suppresses late backend updates after the parent AbortSignal fires", async (t) => {
		const dir = mkdtempSync(join(tmpdir(), "gsd-common-runner-late-abort-"));
		t.after(() => rmSync(dir, { recursive: true, force: true }));
		const controller = new AbortController();
		let updates = 0;
		const backend: SubagentExecutionBackend = {
			id: "late-abort-fixture",
			isAvailable: () => true,
			async execute(_request, callbacks) {
				controller.abort();
				callbacks.onStdoutLine(JSON.stringify({
					type: "message_end",
					message: makeAssistantMessage("late buffered final"),
				}));
				return { exitCode: 130, aborted: true, signal: "SIGINT" };
			},
		};

		await assert.rejects(
			__subagentLocalRunnerTestHooks.runSingleAgentWithBackend(
				dir,
				[makeAgent()],
				"worker",
				"late abort fixture",
				undefined,
				undefined,
				controller.signal,
				() => { updates += 1; },
				(results) => ({
					mode: "single",
					agentScope: "both",
					projectAgentsDir: null,
					results,
				}),
				{ contextMode: "fresh" },
				backend,
			),
			/Subagent was aborted/,
		);
		assert.equal(updates, 0);
	});

	it("surfaces external backend runtime errors instead of inventing a local fallback", async (t) => {
		const dir = mkdtempSync(join(tmpdir(), "gsd-common-runner-runtime-error-"));
		t.after(() => rmSync(dir, { recursive: true, force: true }));
		const backend: SubagentExecutionBackend = {
			id: "cmux-fixture",
			isAvailable: () => true,
			async execute() {
				return {
					exitCode: 1,
					aborted: false,
					runtimeError: "cmux submission is ambiguous; local fallback disabled",
				};
			},
		};

		const result = await __subagentLocalRunnerTestHooks.runSingleAgentWithBackend(
			dir,
			[makeAgent()],
			"worker",
			"external failure fixture",
			undefined,
			undefined,
			undefined,
			undefined,
			(results) => ({
				mode: "single",
				agentScope: "both",
				projectAgentsDir: null,
				results,
			}),
			{ contextMode: "fresh" },
			backend,
		);

		assert.equal(result.exitCode, 1);
		assert.equal(result.stopReason, "error");
		assert.equal(result.errorMessage, "cmux submission is ambiguous; local fallback disabled");
		assert.equal(result.stderr, "cmux submission is ambiguous; local fallback disabled");
	});

	it("applies the phase-conflict guard before an external backend can execute", async (t) => {
		const dir = mkdtempSync(join(tmpdir(), "gsd-common-runner-phase-external-"));
		t.after(() => {
			deactivateGSD();
			rmSync(dir, { recursive: true, force: true });
		});
		activateGSD();
		assert.equal(setCurrentPhase("plan-slice"), true);
		let executeCalls = 0;
		const backend: SubagentExecutionBackend = {
			id: "cmux-fixture",
			isAvailable: () => true,
			async execute() {
				executeCalls += 1;
				return { exitCode: 0, aborted: false };
			},
		};

		const result = await __subagentLocalRunnerTestHooks.runSingleAgentWithBackend(
			dir,
			[makeAgent({ conflictsWith: ["plan-slice"] })],
			"worker",
			"must not run",
			undefined,
			undefined,
			undefined,
			undefined,
			(results) => ({
				mode: "single",
				agentScope: "both",
				projectAgentsDir: null,
				results,
			}),
			{ contextMode: "fresh" },
			backend,
		);

		assert.equal(executeCalls, 0);
		assert.equal(result.exitCode, 1);
		assert.match(result.stderr, /conflicts with the active GSD phase "plan-slice"/);
	});
});
