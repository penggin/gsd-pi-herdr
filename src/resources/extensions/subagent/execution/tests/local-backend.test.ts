import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import {
	getLiveLocalSubagentProcessCount,
	localSubagentBackend,
	stopLocalSubagentProcesses,
} from "../local-backend.js";

describe("LocalBackend process mechanics", () => {
	let dir: string | undefined;
	const previousBinPath = process.env.GSD_BIN_PATH;

	afterEach(async () => {
		await stopLocalSubagentProcesses();
		if (previousBinPath === undefined) delete process.env.GSD_BIN_PATH;
		else process.env.GSD_BIN_PATH = previousBinPath;
		if (dir) rmSync(dir, { recursive: true, force: true });
		dir = undefined;
	});

	function child(source: string): string {
		dir ??= mkdtempSync(join(tmpdir(), "gsd-local-backend-"));
		const script = join(dir, "child.mjs");
		writeFileSync(script, source, "utf8");
		process.env.GSD_BIN_PATH = script;
		return script;
	}

	function request() {
		return {
			launch: {
				args: [],
				env: { ...process.env },
				cwd: dir!,
				session: { mode: "fresh" as const },
			},
			extensionArgs: [],
			identity: { agent: "fixture" },
		};
	}

	it("frames complete stdout lines, flushes the final buffer, forwards stderr, and preserves exit evidence", async () => {
		child(`
process.stdout.write('first');
process.stdout.write(' line\\nsecond line\\nfinal line');
process.stderr.write('warn-one\\n');
process.stderr.write('warn-two');
process.exitCode = 7;
`);
		const stdout: string[] = [];
		const stderr: string[] = [];

		const evidence = await localSubagentBackend.execute(request(), {
			onStdoutLine: (line) => stdout.push(line),
			onStderr: (chunk) => stderr.push(chunk),
		});

		assert.deepEqual(stdout, ["first line", "second line", "final line"]);
		assert.equal(stderr.join(""), "warn-one\nwarn-two");
		assert.deepEqual(evidence, { exitCode: 7, aborted: false });
		assert.equal(getLiveLocalSubagentProcessCount(), 0);
	});

	it("owns a running direct child in the local registry until shutdown terminates it", async () => {
		child(`setInterval(() => {}, 1000);`);
		const pending = localSubagentBackend.execute(request(), {
			onStdoutLine: () => {},
			onStderr: () => {},
		});

		for (let i = 0; i < 50 && getLiveLocalSubagentProcessCount() !== 1; i++) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		assert.equal(getLiveLocalSubagentProcessCount(), 1);

		await stopLocalSubagentProcesses();
		const evidence = await pending;
		assert.equal(evidence.aborted, false);
		assert.equal(getLiveLocalSubagentProcessCount(), 0);
	});
});
