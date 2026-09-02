import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionFileOpenError, SessionManager } from "./session-manager.js";

test("session open fails closed for corrupt and recognized v4 files", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "pi-session-format-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const corrupt = join(dir, "corrupt.jsonl");
	const v4 = join(dir, "v4.jsonl");
	const corruptContent = "not json\n";
	const v4Content = '{"kind":"header","version":4,"id":"v4","createdAt":1,"cwd":"/tmp"}\n';
	writeFileSync(corrupt, corruptContent);
	writeFileSync(v4, v4Content);

	assert.throws(
		() => SessionManager.open(corrupt, dir),
		(error: unknown) => error instanceof SessionFileOpenError && error.code === "invalid-session",
	);
	assert.throws(
		() => SessionManager.open(v4, dir),
		(error: unknown) => error instanceof SessionFileOpenError && error.code === "unsupported-session-format",
	);
	assert.equal(readFileSync(corrupt, "utf8"), corruptContent);
	assert.equal(readFileSync(v4, "utf8"), v4Content);
});

test("session open is read-only and repairs a missing separator only when appending", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "pi-session-separator-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const file = join(dir, "legacy.jsonl");
	const header = '{"type":"session","version":3,"id":"legacy","timestamp":"2026-09-03T00:00:00.000Z","cwd":"/tmp"}';
	const assistant =
		'{"type":"message","id":"assistant","parentId":null,"timestamp":"2026-09-03T00:00:01.000Z","message":{"role":"assistant","content":[],"api":"test","provider":"test","model":"test","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"stop","timestamp":1}}';
	const original = `${header}\n${assistant}`;
	writeFileSync(file, original);

	const session = SessionManager.open(file, dir);
	assert.equal(readFileSync(file, "utf8"), original);
	session.appendCustomMessageEntry("contract", "next", false);
	const lines = readFileSync(file, "utf8").trim().split("\n");
	assert.deepEqual(
		lines.map((line) => JSON.parse(line).type),
		["session", "message", "custom_message"],
	);
});

test(
	"session open rejects a symlink without reading or mutating its target",
	{ skip: process.platform === "win32" },
	(t) => {
		const dir = mkdtempSync(join(tmpdir(), "pi-session-symlink-"));
		t.after(() => rmSync(dir, { recursive: true, force: true }));
		const target = join(dir, "target.jsonl");
		const link = join(dir, "link.jsonl");
		const content =
			'{"type":"session","version":3,"id":"target","timestamp":"2026-09-03T00:00:00.000Z","cwd":"/tmp"}\n';
		writeFileSync(target, content);
		symlinkSync(target, link);

		assert.throws(
			() => SessionManager.open(link, dir),
			(error: unknown) => error instanceof SessionFileOpenError && error.detection.status === "invalid",
		);
		assert.equal(readFileSync(target, "utf8"), content);
	},
);
