import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NodeExecutionEnv } from "../../src/harness/env/nodejs.ts";
import { JsonlSessionStorage } from "../../src/harness/session/jsonl-storage.ts";
import {
	detectJsonlSessionFormat,
	detectJsonlSessionHeader,
} from "../../src/harness/session/jsonl-version.ts";
import { ok } from "../../src/harness/types.ts";

const fixtures = join(import.meta.dirname, "fixtures");

function fixture(name: string): string {
	return join(fixtures, name);
}

describe("JSONL session format detection", () => {
	it("detects immutable legacy v3 and upstream harness v4 fixtures", async () => {
		const env = new NodeExecutionEnv({ cwd: fixtures });
		await expect(detectJsonlSessionFormat(env, fixture("session-v3-opaque.jsonl"))).resolves.toEqual({
			status: "supported",
			format: "legacy-v3",
			version: 3,
		});
		await expect(detectJsonlSessionFormat(env, fixture("session-v4-upstream.jsonl"))).resolves.toEqual({
			status: "supported",
			format: "harness-v4",
			version: 4,
		});
	});

	it("classifies future versions without selecting a writer", async () => {
		const env = new NodeExecutionEnv({ cwd: fixtures });
		await expect(detectJsonlSessionFormat(env, fixture("session-v5-future.jsonl"))).resolves.toEqual({
			status: "unsupported",
			family: "harness",
			version: 5,
		});
	});

	it("keeps legacy v1 and v2 headers readable for the existing migration path", () => {
		expect(detectJsonlSessionHeader('{"type":"session","id":"v1"}')).toEqual({
			status: "supported",
			format: "legacy-v3",
			version: 1,
		});
		expect(detectJsonlSessionHeader('{"type":"session","version":2,"id":"v2"}')).toEqual({
			status: "supported",
			format: "legacy-v3",
			version: 2,
		});
	});

	it("classifies malformed, missing, invalid, and ambiguous headers deterministically", async () => {
		const env = new NodeExecutionEnv({ cwd: fixtures });
		await expect(detectJsonlSessionFormat(env, fixture("session-malformed.jsonl"))).resolves.toMatchObject({
			status: "invalid",
			reason: "malformed-json",
		});
		expect(detectJsonlSessionHeader("  ")).toMatchObject({ status: "invalid", reason: "missing-header" });
		expect(detectJsonlSessionHeader("[]")).toMatchObject({ status: "invalid", reason: "invalid-header" });
		expect(detectJsonlSessionHeader('{"version":4}')).toMatchObject({
			status: "invalid",
			reason: "invalid-header",
		});
		expect(detectJsonlSessionHeader('{"type":"session","kind":"header","version":4}')).toMatchObject({
			status: "invalid",
			reason: "ambiguous-header",
		});
	});

	it("rejects symlinks before reading their targets", async () => {
		let read = false;
		const detection = await detectJsonlSessionFormat(
			{
				fileInfo: async () =>
					ok({ name: "session.jsonl", path: "/sessions/session.jsonl", kind: "symlink", size: 0, mtimeMs: 0 }),
				readTextLines: async () => {
					read = true;
					return ok(["{}"]);
				},
			},
			"/sessions/session.jsonl",
		);
		expect(detection).toMatchObject({ status: "invalid", reason: "symlink" });
		expect(read).toBe(false);
	});

	it("detects a valid header without hiding or rewriting a torn v3 tail", async () => {
		const env = new NodeExecutionEnv({ cwd: fixtures });
		const path = fixture("session-v3-torn-tail.jsonl");
		const before = readFileSync(path, "utf8");
		await expect(detectJsonlSessionFormat(env, path)).resolves.toMatchObject({
			status: "supported",
			format: "legacy-v3",
		});
		await expect(JsonlSessionStorage.open(env, path)).rejects.toMatchObject({ code: "invalid_entry" });
		expect(readFileSync(path, "utf8")).toBe(before);
	});

	it("round-trips opaque compaction and Assessment Gate details through the v3 reader", async () => {
		const env = new NodeExecutionEnv({ cwd: fixtures });
		const path = fixture("session-v3-opaque.jsonl");
		const before = readFileSync(path, "utf8");
		const storage = await JsonlSessionStorage.open(env, path);
		const entries = await storage.getEntries();
		expect(entries[1]).toMatchObject({
			type: "custom_message",
			details: {
				schemaVersion: "gsd.findings/v1",
				runId: "GAR-fixture",
				gateId: "second-opinion",
				status: "completed",
			},
		});
		expect(entries[2]).toMatchObject({
			type: "compaction",
			details: {
				strategy: "remote-v2",
				checkpoint: { type: "compaction", encrypted_content: "ocx1:opaque-fixture" },
			},
		});
		expect(readFileSync(path, "utf8")).toBe(before);
	});
});
