import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	findMostRecentSession,
	listSessionsFromDir,
	loadEntriesFromFile,
	SessionManager,
} from "../../src/core/session-manager.ts";

describe("loadEntriesFromFile", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `session-test-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("returns empty array for non-existent file", () => {
		const entries = loadEntriesFromFile(join(tempDir, "nonexistent.jsonl"));
		expect(entries).toEqual([]);
	});

	it("returns empty array for empty file", () => {
		const file = join(tempDir, "empty.jsonl");
		writeFileSync(file, "");
		expect(loadEntriesFromFile(file)).toEqual([]);
	});

	it("returns empty array for file without valid session header", () => {
		const file = join(tempDir, "no-header.jsonl");
		writeFileSync(file, '{"type":"message","id":"1"}\n');
		expect(loadEntriesFromFile(file)).toEqual([]);
	});

	it("returns empty array for malformed JSON", () => {
		const file = join(tempDir, "malformed.jsonl");
		writeFileSync(file, "not json\n");
		expect(loadEntriesFromFile(file)).toEqual([]);
	});

	it("loads valid session file", () => {
		const file = join(tempDir, "valid.jsonl");
		writeFileSync(
			file,
			'{"type":"session","id":"abc","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n' +
				'{"type":"message","id":"1","parentId":null,"timestamp":"2025-01-01T00:00:01Z","message":{"role":"user","content":"hi","timestamp":1}}\n',
		);
		const entries = loadEntriesFromFile(file);
		expect(entries).toHaveLength(2);
		expect(entries[0].type).toBe("session");
		expect(entries[1].type).toBe("message");
	});

	it("skips malformed lines but keeps valid ones", () => {
		const file = join(tempDir, "mixed.jsonl");
		writeFileSync(
			file,
			'{"type":"session","id":"abc","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n' +
				"not valid json\n" +
				'{"type":"message","id":"1","parentId":null,"timestamp":"2025-01-01T00:00:01Z","message":{"role":"user","content":"hi","timestamp":1}}\n',
		);
		const entries = loadEntriesFromFile(file);
		expect(entries).toHaveLength(2);
	});

	it("defers a missing trailing newline repair until the next append", () => {
		const file = join(tempDir, "unterminated.jsonl");
		const header =
			'{"type":"session","version":3,"id":"abc","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}';
		const assistant = '{"type":"message","id":"1","parentId":null,"timestamp":"2025-01-01T00:00:01Z","message":{"role":"assistant","content":[],"api":"test","provider":"test","model":"test","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"stop","timestamp":1}}';
		writeFileSync(file, `${header}\n${assistant}`);

		expect(loadEntriesFromFile(file)).toHaveLength(2);
		expect(readFileSync(file, "utf8")).toBe(`${header}\n${assistant}`);

		const sm = SessionManager.open(file, tempDir);
		expect(readFileSync(file, "utf8")).toBe(`${header}\n${assistant}`);
		sm.appendCustomMessageEntry("resume-test", "next", true);
		const lines = readFileSync(file, "utf8").trim().split("\n");
		expect(lines).toHaveLength(3);
		expect(lines.map((line) => JSON.parse(line).type)).toEqual(["session", "message", "custom_message"]);
	});

	it("streams records and preserves UTF-8 across read-buffer boundaries", async () => {
		const file = join(tempDir, "large-unicode.jsonl");
		const header = { type: "session", id: "large", timestamp: "2025-01-01T00:00:00Z", cwd: "/tmp" };
		const largeText = `${"x".repeat(1024 * 1024 - 3)}한글-${"y".repeat(1024 * 1024)}`;
		const message = {
			type: "message",
			id: "1",
			parentId: null,
			timestamp: "2025-01-01T00:00:01Z",
			message: { role: "user", content: largeText, timestamp: 1 },
		};
		writeFileSync(file, `${JSON.stringify(header)}\n${JSON.stringify(message)}\n`);

		const entries = loadEntriesFromFile(file);
		expect(entries).toHaveLength(2);
		expect((entries[1] as typeof message).message.content).toBe(largeText);

		const infos = await listSessionsFromDir(tempDir);
		expect(infos).toHaveLength(1);
		expect(infos[0].messageCount).toBe(1);
		expect(infos[0].allMessagesText).toContain("한글-");
	});
});

describe("findMostRecentSession", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `session-test-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("returns null for empty directory", () => {
		expect(findMostRecentSession(tempDir)).toBeNull();
	});

	it("returns null for non-existent directory", () => {
		expect(findMostRecentSession(join(tempDir, "nonexistent"))).toBeNull();
	});

	it("ignores non-jsonl files", () => {
		writeFileSync(join(tempDir, "file.txt"), "hello");
		writeFileSync(join(tempDir, "file.json"), "{}");
		expect(findMostRecentSession(tempDir)).toBeNull();
	});

	it("ignores jsonl files without valid session header", () => {
		writeFileSync(join(tempDir, "invalid.jsonl"), '{"type":"message"}\n');
		expect(findMostRecentSession(tempDir)).toBeNull();
	});

	it("returns single valid session file", () => {
		const file = join(tempDir, "session.jsonl");
		writeFileSync(file, '{"type":"session","id":"abc","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n');
		expect(findMostRecentSession(tempDir)).toBe(file);
	});

	it("returns most recently modified session", async () => {
		const file1 = join(tempDir, "older.jsonl");
		const file2 = join(tempDir, "newer.jsonl");

		writeFileSync(file1, '{"type":"session","id":"old","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n');
		// Small delay to ensure different mtime
		await new Promise((r) => setTimeout(r, 10));
		writeFileSync(file2, '{"type":"session","id":"new","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n');

		expect(findMostRecentSession(tempDir)).toBe(file2);
	});

	it("skips invalid files and returns valid one", async () => {
		const invalid = join(tempDir, "invalid.jsonl");
		const valid = join(tempDir, "valid.jsonl");

		writeFileSync(invalid, '{"type":"not-session"}\n');
		await new Promise((r) => setTimeout(r, 10));
		writeFileSync(valid, '{"type":"session","id":"abc","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n');

		expect(findMostRecentSession(tempDir)).toBe(valid);
	});
});

describe("SessionManager.setSessionFile format guard", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `session-test-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("rejects an empty file without rewriting it", () => {
		const emptyFile = join(tempDir, "empty.jsonl");
		writeFileSync(emptyFile, "");

		expect(() => SessionManager.open(emptyFile, tempDir)).toThrow("session file has no bounded header");
		expect(readFileSync(emptyFile, "utf-8")).toBe("");
	});

	it("rejects a file without a valid header without truncating it", () => {
		const noHeaderFile = join(tempDir, "no-header.jsonl");
		const content =
			'{"type":"message","id":"abc","parentId":"orphaned","timestamp":"2025-01-01T00:00:00Z","message":{"role":"assistant","content":"test"}}\n';
		writeFileSync(noHeaderFile, content);

		expect(() => SessionManager.open(noHeaderFile, tempDir)).toThrow("no recognized format discriminator");
		expect(readFileSync(noHeaderFile, "utf-8")).toBe(content);
	});

	it("recognizes v4 but rejects it until the harness codec is enabled", () => {
		const v4File = join(tempDir, "v4.jsonl");
		const content =
			'{"kind":"header","version":4,"id":"v4","createdAt":1788393600000,"cwd":"/tmp"}\n';
		writeFileSync(v4File, content);

		expect(() => SessionManager.open(v4File, tempDir)).toThrow("harness-v4 sessions are recognized but not readable");
		expect(readFileSync(v4File, "utf-8")).toBe(content);
	});

	it("repeated corrupt opens fail deterministically and preserve the source", () => {
		const corruptedFile = join(tempDir, "corrupted.jsonl");
		const content = "garbage content\n";
		writeFileSync(corruptedFile, content);

		expect(() => SessionManager.open(corruptedFile, tempDir)).toThrow("session header is not valid JSON");
		expect(() => SessionManager.open(corruptedFile, tempDir)).toThrow("session header is not valid JSON");
		expect(readFileSync(corruptedFile, "utf-8")).toBe(content);
	});
});
