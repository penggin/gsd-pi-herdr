import assert from "node:assert/strict";
import test from "node:test";

import type { SubagentLaunchPlan } from "../../launch.js";
import type {
	SubagentBackendCallbacks,
	SubagentBackendExecutionRequest,
	SubagentExecutionBackend,
} from "../types.js";

test("backend contract carries resolved launch identity and raw stream evidence without SingleResult semantics", async () => {
	const launch: SubagentLaunchPlan = {
		args: ["--mode", "json", "-p", "--no-session", "Task: inspect"],
		env: { GSD_SUBAGENT_CHILD: "1" },
		cwd: "/repo",
		session: { mode: "fresh" },
	};
	const request = {
		launch,
		extensionArgs: ["--extension", "/bundle/subagent"],
		identity: {
			runId: "run-1",
			dispatchId: "dispatch-1",
			childIndex: 2,
			mode: "parallel",
			agent: "scout",
			trackingName: "amber-fox",
			step: 3,
		},
	} satisfies SubagentBackendExecutionRequest;

	const stdout: string[] = [];
	const stderr: string[] = [];
	const callbacks: SubagentBackendCallbacks = {
		onStdoutLine: (line) => stdout.push(line),
		onStderr: (chunk) => stderr.push(chunk),
	};

	const backend: SubagentExecutionBackend = {
		id: "fixture",
		isAvailable: () => true,
		async execute(received, sinks) {
			assert.equal(received, request);
			sinks.onStdoutLine('{"type":"message_end"}');
			sinks.onStderr("diagnostic");
			return {
				exitCode: 0,
				aborted: false,
				handle: {
					backendId: "fixture",
					executionId: "fixture-1",
					native: { pid: 42 },
				},
				metadata: { pid: 42 },
			};
		},
	};

	assert.equal(await backend.isAvailable({ defaultCwd: "/repo", env: {} }), true);
	const evidence = await backend.execute(request, callbacks);
	assert.deepEqual(stdout, ['{"type":"message_end"}']);
	assert.deepEqual(stderr, ["diagnostic"]);
	assert.deepEqual(evidence, {
		exitCode: 0,
		aborted: false,
		handle: {
			backendId: "fixture",
			executionId: "fixture-1",
			native: { pid: 42 },
		},
		metadata: { pid: 42 },
	});
});

test("backend result can represent cancellation/runtime failure without prescribing semantic mapping", () => {
	const backend: SubagentExecutionBackend = {
		id: "external-fixture",
		isAvailable: async () => true,
		async execute() {
			return {
				exitCode: 143,
				aborted: true,
				signal: "SIGTERM",
				runtimeError: "worker transport closed",
				metadata: { paneId: "w1:p2" },
			};
		},
	};

	assert.equal(backend.id, "external-fixture");
});
