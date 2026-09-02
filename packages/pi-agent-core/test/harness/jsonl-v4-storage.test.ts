import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NodeExecutionEnv } from "../../src/harness/env/nodejs.ts";
import { JsonlV4SessionRepository } from "../../src/harness/session/jsonl-v4-repo.ts";
import { readJsonlV4Session } from "../../src/harness/session/jsonl-v4-reader.ts";
import { FileError, err, type Result } from "../../src/harness/types.ts";
import { createTempDir } from "./session-test-utils.ts";

class FaultInjectingEnv extends NodeExecutionEnv {
	failNextAppend = false;
	failNextRename = false;

	override async appendFile(
		path: string,
		content: string | Uint8Array,
		abortSignal?: AbortSignal,
	): Promise<Result<void, FileError>> {
		if (this.failNextAppend) {
			this.failNextAppend = false;
			return err(new FileError("unknown", "injected append failure", path));
		}
		return super.appendFile(path, content, abortSignal);
	}

	override async renameFile(
		sourcePath: string,
		destinationPath: string,
		abortSignal?: AbortSignal,
	): Promise<Result<void, FileError>> {
		if (this.failNextRename) {
			this.failNextRename = false;
			return err(new FileError("unknown", "injected rename failure", sourcePath));
		}
		return super.renameFile(sourcePath, destinationPath, abortSignal);
	}
}

function sessionFiles(root: string): string[] {
	const directories = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory());
	return directories.flatMap((directory) =>
		readdirSync(join(root, directory.name)).map((name) => join(root, directory.name, name)),
	);
}

describe("JSONL v4 writable backend", () => {
	it("serializes concurrent mutations and reopens the same state", async () => {
		const root = createTempDir();
		const sessionsRoot = join(root, "sessions");
		const env = new NodeExecutionEnv({ cwd: root });
		const repo = new JsonlV4SessionRepository({ fs: env, sessionsRoot });
		const storage = await repo.create({ id: "durable", cwd: join(root, "workspace"), metadata: { mode: "test" } });

		const rootEntry = await storage.appendEntry({
			type: "message",
			id: "root",
			message: { role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1 },
		});
		await storage.createLane("review", rootEntry.id);
		await Promise.all(
			Array.from({ length: 12 }, (_, index) =>
				storage.appendRecord({
					type: "queue_cancelled",
					id: `record-${index}`,
					lane: "main",
					entryId: `queued-${index}`,
				}),
			),
		);
		await storage.setName("Durable");
		await storage.setLabel(rootEntry.id, "checkpoint");

		const before = storage.getSnapshot();
		expect(before.sequence).toBe(16);
		expect(before.records.map((record) => record.seq)).toEqual(Array.from({ length: 12 }, (_, index) => index + 3));
		const reopened = await repo.open(storage.getMetadata());
		expect(reopened.getSnapshot()).toEqual(before);
		expect(reopened.getMetadata()).toMatchObject({ id: "durable", sourceFormat: 4, metadata: { mode: "test" } });
		expect((await repo.list()).map((metadata) => metadata.id)).toEqual(["durable"]);
	});

	it("does not advance reducer state when an append or cancellation fails", async () => {
		const root = createTempDir();
		const env = new FaultInjectingEnv({ cwd: root });
		const repo = new JsonlV4SessionRepository({ fs: env, sessionsRoot: join(root, "sessions") });
		const storage = await repo.create({ id: "append-failure", cwd: root });

		env.failNextAppend = true;
		await expect(storage.setName("not-committed")).rejects.toMatchObject({ code: "storage" });
		expect(storage.getSnapshot().sequence).toBe(0);
		expect(storage.getName()).toBeUndefined();

		const controller = new AbortController();
		controller.abort();
		await expect(storage.setName("also-not-committed", controller.signal)).rejects.toMatchObject({ code: "storage" });
		expect(storage.getSnapshot().sequence).toBe(0);
		await storage.setName("committed");
		expect(storage.getSnapshot()).toMatchObject({ sequence: 1, name: "committed" });
	});

	it("repairs a torn tail only on writable open", async () => {
		const root = createTempDir();
		const sessionsRoot = join(root, "sessions");
		const env = new NodeExecutionEnv({ cwd: root });
		const repo = new JsonlV4SessionRepository({ fs: env, sessionsRoot });
		const storage = await repo.create({ id: "repair", cwd: root });
		await storage.appendEntry({ type: "custom", id: "root", customType: "note", data: { ok: true } });
		const path = storage.getMetadata().path;
		await env.appendFile(path, '{"kind":"fact"');
		const torn = readFileSync(path, "utf8");

		const snapshot = await readJsonlV4Session(env, path, { sessionsRoot });
		expect(snapshot.ignoredTornTail).toBe(true);
		expect(readFileSync(path, "utf8")).toBe(torn);

		const reopened = await repo.open(storage.getMetadata());
		expect(reopened.getSnapshot().sequence).toBe(1);
		expect(readFileSync(path, "utf8")).not.toContain('{"kind":"fact"');
		expect(readFileSync(path, "utf8").endsWith("\n")).toBe(true);
		expect(sessionFiles(sessionsRoot).some((candidate) => candidate.includes(".tmp-"))).toBe(false);
	});

	it("publishes create and fork atomically and rejects duplicate identities", async () => {
		const root = createTempDir();
		const sessionsRoot = join(root, "sessions");
		const env = new FaultInjectingEnv({ cwd: root });
		const repo = new JsonlV4SessionRepository({ fs: env, sessionsRoot });

		env.failNextRename = true;
		await expect(repo.create({ id: "failed", cwd: root })).rejects.toMatchObject({ code: "storage" });
		expect(sessionFiles(sessionsRoot)).toEqual([]);
		const controller = new AbortController();
		controller.abort();
		await expect(repo.create({ id: "cancelled", cwd: root, abortSignal: controller.signal })).rejects.toMatchObject({
			code: "storage",
		});
		expect(sessionFiles(sessionsRoot)).toEqual([]);

		const source = await repo.create({ id: "source", cwd: root });
		await source.appendEntry({
			type: "message",
			id: "root",
			message: { role: "user", content: [], timestamp: 1 },
		});
		await expect(repo.create({ id: "source", cwd: root })).rejects.toMatchObject({ code: "already_exists" });

		const fork = await repo.fork(source.getMetadata(), { id: "fork", cwd: root, entryId: "root", position: "at" });
		expect(fork.getMetadata()).toMatchObject({ id: "fork", parentSessionId: "source" });
		expect(fork.findEntries().map((entry) => entry.id)).toEqual(["root"]);
		expect(sessionFiles(sessionsRoot).every((candidate) => !candidate.includes(".tmp-"))).toBe(true);
	});
});
