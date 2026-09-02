import { readFileSync, writeFileSync } from "node:fs";
import { mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NodeExecutionEnv } from "../../src/harness/env/nodejs.ts";
import {
	readJsonlV4Branch,
	readJsonlV4Session,
} from "../../src/harness/session/jsonl-v4-reader.ts";
import { createTempDir } from "./session-test-utils.ts";

function header(root: string): Record<string, unknown> {
	return { kind: "header", version: 4, id: "reader-v4", createdAt: 1, cwd: root };
}

function entry(seq: number, id: string, parentId: string | null): Record<string, unknown> {
	return {
		kind: "entry",
		seq,
		lane: "main",
		type: "custom",
		id,
		parentId,
		timestamp: seq,
		customType: "note",
	};
}

function writeJsonl(path: string, lines: Record<string, unknown>[], trailingNewline = true): void {
	writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join("\n")}${trailingNewline ? "\n" : ""}`);
}

describe("read-only JSONL v4 reader", () => {
	it("reduces validated mutations and returns an immutable branch snapshot", async () => {
		const root = createTempDir();
		const path = join(root, "session.jsonl");
		writeJsonl(path, [
			header(root),
			entry(1, "root", null),
			entry(2, "leaf", "root"),
			{ kind: "fact", seq: 3, fact: "name", name: "Example" },
			{ kind: "fact", seq: 4, fact: "label", targetId: "leaf", label: "checkpoint" },
		]);
		const snapshot = await readJsonlV4Session(new NodeExecutionEnv({ cwd: root }), path, {
			sessionsRoot: root,
		});
		expect(snapshot).toMatchObject({
			format: "harness-v4",
			sequence: 4,
			name: "Example",
			labels: { leaf: "checkpoint" },
			lanes: [{ lane: "main", leafId: "leaf" }],
			ignoredTornTail: false,
		});
		expect(readJsonlV4Branch(snapshot, "leaf").map((candidate) => candidate.id)).toEqual(["leaf", "root"]);
		expect(Object.isFrozen(snapshot.entries[0])).toBe(true);
	});

	it("rejects non-consecutive sequences and broken parent linkage", async () => {
		for (const mutations of [
			[entry(2, "root", null)],
			[entry(1, "leaf", "missing")],
		]) {
			const root = createTempDir();
			const path = join(root, "invalid.jsonl");
			writeJsonl(path, [header(root), ...mutations]);
			await expect(
				readJsonlV4Session(new NodeExecutionEnv({ cwd: root }), path, { sessionsRoot: root }),
			).rejects.toMatchObject({ code: "invalid_entry" });
		}
	});

	it("ignores a final syntactically torn append in memory without rewriting the file", async () => {
		const root = createTempDir();
		const path = join(root, "torn.jsonl");
		writeFileSync(path, `${JSON.stringify(header(root))}\n${JSON.stringify(entry(1, "root", null))}\n{"kind":`);
		const before = readFileSync(path, "utf8");
		const snapshot = await readJsonlV4Session(new NodeExecutionEnv({ cwd: root }), path, {
			sessionsRoot: root,
		});
		expect(snapshot).toMatchObject({ sequence: 1, ignoredTornTail: true });
		expect(readFileSync(path, "utf8")).toBe(before);
	});

	it("rejects a complete invalid final mutation and preserves a valid unterminated file", async () => {
		const root = createTempDir();
		const invalidPath = join(root, "invalid-final.jsonl");
		writeJsonl(invalidPath, [header(root), { kind: "unknown", seq: 1 }]);
		const invalidBefore = readFileSync(invalidPath, "utf8");
		const env = new NodeExecutionEnv({ cwd: root });
		await expect(readJsonlV4Session(env, invalidPath, { sessionsRoot: root })).rejects.toMatchObject({
			code: "invalid_entry",
		});
		expect(readFileSync(invalidPath, "utf8")).toBe(invalidBefore);

		const validPath = join(root, "unterminated.jsonl");
		writeJsonl(validPath, [header(root), entry(1, "root", null)], false);
		const validBefore = readFileSync(validPath, "utf8");
		await expect(readJsonlV4Session(env, validPath, { sessionsRoot: root })).resolves.toMatchObject({
			sequence: 1,
			ignoredTornTail: false,
		});
		expect(readFileSync(validPath, "utf8")).toBe(validBefore);
	});

	it("bounds file size, line length, and record count before exposing state", async () => {
		const root = createTempDir();
		const path = join(root, "bounded.jsonl");
		writeJsonl(path, [header(root), entry(1, "root", null)]);
		const env = new NodeExecutionEnv({ cwd: root });
		await expect(readJsonlV4Session(env, path, { sessionsRoot: root, maxFileBytes: 8 })).rejects.toMatchObject({
			code: "invalid_session",
		});
		await expect(readJsonlV4Session(env, path, { sessionsRoot: root, maxLineBytes: 8 })).rejects.toMatchObject({
			code: "invalid_entry",
		});
		await expect(readJsonlV4Session(env, path, { sessionsRoot: root, maxRecords: 1 })).resolves.toMatchObject({
			sequence: 1,
		});
		writeJsonl(path, [header(root), entry(1, "root", null), entry(2, "leaf", "root")]);
		await expect(readJsonlV4Session(env, path, { sessionsRoot: root, maxRecords: 1 })).rejects.toMatchObject({
			code: "invalid_session",
		});
	});

	it("rejects symlink files and canonical paths outside the configured root", async () => {
		const root = createTempDir();
		const sessionsRoot = join(root, "sessions");
		const outsideRoot = join(root, "outside");
		await mkdir(sessionsRoot);
		await mkdir(outsideRoot);
		const outside = join(outsideRoot, "outside.jsonl");
		writeJsonl(outside, [header(outsideRoot)]);
		const link = join(sessionsRoot, "linked.jsonl");
		await symlink(outside, link);
		const env = new NodeExecutionEnv({ cwd: root });

		await expect(readJsonlV4Session(env, link, { sessionsRoot })).rejects.toMatchObject({
			code: "invalid_session",
		});
		await expect(readJsonlV4Session(env, outside, { sessionsRoot })).rejects.toMatchObject({
			code: "invalid_session",
		});
	});
});
