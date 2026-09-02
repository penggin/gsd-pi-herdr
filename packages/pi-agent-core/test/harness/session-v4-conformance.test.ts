import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NodeExecutionEnv } from "../../src/harness/env/nodejs.ts";
import type { JsonlV4Entry, JsonlV4Record } from "../../src/harness/session/jsonl-v4-codec.ts";
import { JsonlV4SessionRepository } from "../../src/harness/session/jsonl-v4-repo.ts";
import type { JsonlV4SessionMetadata } from "../../src/harness/session/jsonl-v4-reader.ts";
import type { V4ProvisionedEntry, V4ProvisionedRecord } from "../../src/harness/session/session-v4-memory.ts";
import {
	V4MemorySessionRepository,
	type V4MemorySessionMetadata,
} from "../../src/harness/session/session-v4-memory.ts";
import type {
	V4BranchBounds,
	V4EntryQuery,
	V4ForkOptions,
	V4RecordQuery,
	V4SessionLogItem,
	V4SessionStats,
	V4SessionStateSnapshot,
} from "../../src/harness/session/session-v4-state.ts";
import { createTempDir } from "./session-test-utils.ts";

type Awaitable<T> = T | Promise<T>;

async function invoke<T>(operation: () => Awaitable<T>): Promise<T> {
	return operation();
}

interface ConformanceStorage {
	getSnapshot(): V4SessionStateSnapshot;
	getMetadata(): { id: string };
	getLanes(): Array<{ lane: string; leafId: string | null }>;
	createLane(lane: string, at: string | null): Awaitable<void>;
	moveLane(lane: string, to: string | null): Awaitable<void>;
	appendEntry(entry: V4ProvisionedEntry, lane?: string): Awaitable<JsonlV4Entry>;
	appendRecord(record: V4ProvisionedRecord): Awaitable<JsonlV4Record>;
	setName(name: string | undefined): Awaitable<void>;
	setLabel(targetId: string, label: string | undefined): Awaitable<void>;
	getName(): string | undefined;
	getLabel(targetId: string): string | undefined;
	getStats(): V4SessionStats;
	getLog(options?: { afterSeq?: number; limit?: number }): V4SessionLogItem[];
	findOpenOperations(lane: string, options?: { limit?: number }): JsonlV4Record[];
	getEntry(id: string): JsonlV4Entry | undefined;
	findEntries(query?: V4EntryQuery): JsonlV4Entry[];
	findEntriesOnBranch(query: V4EntryQuery & V4BranchBounds & { start: string }): JsonlV4Entry[];
	findRecords(query?: V4RecordQuery): JsonlV4Record[];
	readBranch(start: string): JsonlV4Entry[];
}

interface ConformanceFixture {
	create(id: string): Promise<ConformanceStorage>;
	open(source: ConformanceStorage): Promise<ConformanceStorage>;
	list(): Awaitable<Array<{ id: string }>>;
	delete(source: ConformanceStorage): Awaitable<void>;
	fork(source: ConformanceStorage, id: string, options: V4ForkOptions): Promise<ConformanceStorage>;
}

type FixtureFactory = () => Promise<ConformanceFixture>;

const backends: Array<{ name: string; create: FixtureFactory }> = [
	{
		name: "memory",
		async create() {
			const repo = new V4MemorySessionRepository();
			return {
				async create(id) {
					return repo.create({ id });
				},
				async open(source) {
					return repo.open(source.getMetadata() as V4MemorySessionMetadata);
				},
				list() {
					return repo.list();
				},
				delete(source) {
					repo.delete(source.getMetadata() as V4MemorySessionMetadata);
				},
				async fork(source, id, options) {
					return repo.fork(source.getMetadata() as V4MemorySessionMetadata, { ...options, id });
				},
			};
		},
	},
	{
		name: "jsonl",
		async create() {
			const root = createTempDir();
			const cwd = join(root, "workspace");
			const repo = new JsonlV4SessionRepository({
				fs: new NodeExecutionEnv({ cwd: root }),
				sessionsRoot: join(root, "sessions"),
			});
			return {
				async create(id) {
					return repo.create({ id, cwd });
				},
				async open(source) {
					return repo.open(source.getMetadata() as JsonlV4SessionMetadata);
				},
				list() {
					return repo.list();
				},
				delete(source) {
					return repo.delete(source.getMetadata() as JsonlV4SessionMetadata);
				},
				async fork(source, id, options) {
					return repo.fork(source.getMetadata() as JsonlV4SessionMetadata, { ...options, id, cwd });
				},
			};
		},
	},
];

for (const backend of backends) {
	describe(`v4 session conformance: ${backend.name}`, () => {
		it("assigns one sequence across entries, lanes, records, and facts", async () => {
			const fixture = await backend.create();
			const storage = await fixture.create("session");
			const root = await storage.appendEntry({
				type: "message",
				id: "root",
				message: { role: "user", content: [], timestamp: 1 },
			});
			await storage.createLane("review", root.id);
			const child = await storage.appendEntry(
				{ type: "custom", id: "child", customType: "note", data: { value: 1 } },
				"review",
			);
			await storage.appendRecord({
				type: "operation_started",
				id: "run",
				lane: "review",
				intent: { kind: "run" },
			});
			await storage.setName("Example");
			await storage.setLabel(child.id, "checked");
			await storage.moveLane("main", child.id);

			expect(storage.getLog().map((item) => [item.kind, item.seq])).toEqual([
				["entry", 1],
				["lane", 2],
				["entry", 3],
				["record", 4],
				["fact", 5],
				["fact", 6],
				["lane", 7],
			]);
			expect(storage.getLanes()).toEqual([
				{ lane: "main", leafId: "child" },
				{ lane: "review", leafId: "child" },
			]);
			expect(storage.getName()).toBe("Example");
			expect(storage.getLabel("child")).toBe("checked");
			expect(storage.readBranch("child").map((entry) => entry.id)).toEqual(["child", "root"]);
		});

		it("provides deterministic query and identity errors", async () => {
			const fixture = await backend.create();
			const storage = await fixture.create("errors");
			await storage.appendEntry({ type: "custom", id: "same", customType: "note" });
			await expect(invoke(() => storage.appendEntry({ type: "custom", id: "same", customType: "note" }))).rejects.toMatchObject({
				code: "already_exists",
			});
			await expect(invoke(() => storage.createLane("main", null))).rejects.toMatchObject({
				code: "already_exists",
			});
			expect(() => storage.findEntries({ limit: 0 })).toThrowError(expect.objectContaining({ code: "invalid_query" }));
			expect(() => storage.findRecords({ afterSeq: -1 })).toThrowError(expect.objectContaining({ code: "invalid_query" }));
			expect(() => storage.findRecords({ operationKind: "run" })).toThrowError(
				expect.objectContaining({ code: "invalid_query" }),
			);
			expect(() => storage.findRecords({ type: "usage", operationKind: "run" })).toThrowError(
				expect.objectContaining({ code: "invalid_query" }),
			);
			expect(() => storage.findOpenOperations("main", { limit: 0 })).toThrowError(
				expect.objectContaining({ code: "invalid_query" }),
			);
		});

		it("supports bounded branch queries across custom and compaction entries", async () => {
			const fixture = await backend.create();
			const storage = await fixture.create("queries");
			await storage.appendEntry({
				type: "message",
				id: "root",
				message: { role: "user", content: [], timestamp: 1 },
			});
			await storage.appendEntry({ type: "custom", id: "old-note", customType: "note", data: 1 });
			await storage.appendEntry({
				type: "compaction",
				id: "compact",
				summary: "summary",
				retainedTail: [],
				tokensBefore: 10,
			});
			await storage.appendEntry({ type: "custom", id: "new-note", customType: "note", data: 2 });
			await storage.appendEntry({
				type: "message",
				id: "tail",
				message: { role: "assistant", content: [], timestamp: 2 },
			});

			expect(storage.findEntriesOnBranch({ start: "tail", customType: "note", limit: 1 }).map(({ id }) => id)).toEqual([
				"new-note",
			]);
			expect(
				storage.findEntriesOnBranch({ start: "tail", stopAtType: "compaction", type: "message" }).map(({ id }) => id),
			).toEqual(["tail"]);
			expect(
				storage.findEntriesOnBranch({ start: "tail", stopAtId: "tail", type: "custom" }).map(({ id }) => id),
			).toEqual([]);
			expect(
				storage
					.findEntriesOnBranch({ start: "tail", stopAtType: "custom", order: "oldestFirst" })
					.map(({ id }) => id),
			).toEqual(["root", "old-note"]);
			expect(
				storage.findEntriesOnBranch({ start: "tail", order: "oldestFirst", afterSeq: 2, limit: 2 }).map(({ id }) => id),
			).toEqual(["compact", "new-note"]);
			expect(() => storage.findEntriesOnBranch({ start: "missing" })).toThrowError(
				expect.objectContaining({ code: "not_found" }),
			);
		});

		it("filters operation kinds and tracks one open operation per lane", async () => {
			const fixture = await backend.create();
			const storage = await fixture.create("operations");
			await storage.createLane("thread", null);
			const oldRun = await storage.appendRecord({
				type: "operation_started",
				id: "run-old",
				lane: "main",
				intent: { kind: "run" },
			});
			await expect(
				invoke(() =>
					storage.appendRecord({
						type: "operation_started",
						id: "overlap",
						lane: "main",
						intent: { kind: "run" },
					}),
				),
			).rejects.toMatchObject({ code: "storage" });
			await storage.appendRecord({
				type: "operation_finished",
				id: "run-old-finished",
				lane: "main",
				runId: "run-old",
				outcome: "completed",
			});
			await storage.appendRecord({
				type: "operation_finished",
				id: "early-finish",
				lane: "thread",
				runId: "navigation",
				outcome: "completed",
			});
			const navigation = await storage.appendRecord({
				type: "operation_started",
				id: "navigation",
				lane: "thread",
				intent: { kind: "navigation" },
			});
			const newRun = await storage.appendRecord({
				type: "operation_started",
				id: "run-new",
				lane: "main",
				intent: { kind: "run" },
			});

			expect(
				storage
					.findRecords({ type: "operation_started", operationKind: "run", order: "oldestFirst" })
					.map(({ id }) => id),
			).toEqual([oldRun.id, newRun.id]);
			expect(storage.findOpenOperations("main", { limit: 1 })).toEqual([newRun]);
			expect(storage.findOpenOperations("thread", { limit: 1 })).toEqual([navigation]);

			const detached = storage.findOpenOperations("thread")[0]!;
			(detached.intent as { kind: string }).kind = "mutated";
			expect(storage.findOpenOperations("thread")).toEqual([navigation]);
		});

		it("computes ledger statistics across lanes and usage corrections", async () => {
			const fixture = await backend.create();
			const storage = await fixture.create("stats");
			await storage.appendEntry({
				type: "message",
				id: "user",
				message: { role: "user", content: [], timestamp: 1 },
			});
			await storage.appendEntry({
				type: "message",
				id: "assistant",
				message: { role: "assistant", content: [], timestamp: 2 },
			});
			await storage.appendRecord({
				type: "usage",
				id: "assistant-usage",
				lane: "main",
				cause: "assistant",
				usage: {
					input: 10,
					output: 5,
					cacheRead: 3,
					cacheWrite: 2,
					totalTokens: 20,
					cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 },
				},
			});
			await storage.createLane("thread", "assistant");
			await storage.appendRecord({
				type: "usage",
				id: "correction",
				lane: "thread",
				cause: "adjustment",
				usage: {
					input: -2,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: -2,
					cost: { input: -0.5, output: 0, cacheRead: 0, cacheWrite: 0, total: -0.5 },
				},
			});

			expect(storage.getStats()).toEqual({
				messageCount: 2,
				cachedTokens: 3,
				uncachedTokens: 10,
				totalTokens: 18,
				costTotal: 9.5,
			});
		});

		it("filters records by lane, type, run, cursor, order, and limit", async () => {
			const fixture = await backend.create();
			const storage = await fixture.create("record-queries");
			await storage.createLane("thread", null);
			await storage.appendRecord({
				type: "operation_started",
				id: "run-1",
				lane: "thread",
				intent: { kind: "run" },
			});
			await storage.appendRecord({
				type: "step_attempt",
				id: "attempt-1",
				lane: "thread",
				runId: "run-1",
				attempt: 1,
			});
			await storage.appendRecord({
				type: "step_attempt",
				id: "attempt-2",
				lane: "thread",
				runId: "run-1",
				attempt: 2,
			});

			expect(storage.findRecords({ lane: "main" })).toEqual([]);
			expect(storage.findRecords({ type: "step_attempt", order: "oldestFirst" }).map(({ id }) => id)).toEqual([
				"attempt-1",
				"attempt-2",
			]);
			expect(storage.findRecords({ runId: "run-1", afterSeq: 2 }).map(({ id }) => id)).toEqual([
				"attempt-2",
				"attempt-1",
			]);
			expect(storage.findRecords({ limit: 1 }).map(({ id }) => id)).toEqual(["attempt-2"]);
		});

		it("persists latest-value facts and deletes sessions idempotently", async () => {
			const fixture = await backend.create();
			const storage = await fixture.create("durable-facts");
			await storage.appendEntry({ type: "custom", id: "target", customType: "note" });
			await storage.setName("Temporary");
			await storage.setName(undefined);
			await storage.setLabel("target", "Temporary");
			await storage.setLabel("target", undefined);

			const reopened = await fixture.open(storage);
			expect(reopened.getName()).toBeUndefined();
			expect(reopened.getLabel("target")).toBeUndefined();
			expect((await fixture.list()).map(({ id }) => id)).toContain("durable-facts");

			await fixture.delete(reopened);
			await expect(fixture.open(reopened)).rejects.toMatchObject({ code: "not_found" });
			await fixture.delete(reopened);
		});

		it("rejects non-JSON records before advancing durable state", async () => {
			const fixture = await backend.create();
			const storage = await fixture.create("invalid-json");
			const cyclic: { self?: unknown } = {};
			cyclic.self = cyclic;
			await expect(
				invoke(() =>
					storage.appendRecord({
						type: "tool_started",
						id: "cyclic",
						lane: "main",
						data: cyclic,
					}),
				),
			).rejects.toMatchObject({ code: "invalid_payload" });
			await expect(
				invoke(() =>
					storage.appendRecord({
						type: "usage",
						id: "bad-usage",
						lane: "main",
						usage: { cacheRead: 1 },
					}),
				),
			).rejects.toMatchObject({ code: "invalid_entry" });
			expect(storage.getLog()).toEqual([]);

			const reopened = await fixture.open(storage);
			expect(reopened.getLog()).toEqual([]);
		});

		it("linearizes concurrent writes across lanes", async () => {
			const fixture = await backend.create();
			const storage = await fixture.create("concurrency");
			await storage.createLane("thread", null);
			const completed: string[] = [];
			const writes = [
				storage.appendEntry({ type: "custom", id: "main-1", customType: "note" }, "main"),
				storage.appendEntry({ type: "custom", id: "thread-1", customType: "note" }, "thread"),
				storage.appendEntry({ type: "custom", id: "main-2", customType: "note" }, "main"),
				storage.appendEntry({ type: "custom", id: "thread-2", customType: "note" }, "thread"),
			].map(async (write) => {
				const entry = await write;
				completed.push(entry.id);
				return entry;
			});
			const entries = await Promise.all(writes);
			const committed = [...entries].sort((left, right) => left.seq - right.seq).map(({ id }) => id);

			expect(completed).toEqual(committed);
			expect(new Set(entries.map(({ seq }) => seq)).size).toBe(entries.length);
			expect(storage.getLog().map(({ seq }) => seq)).toEqual([1, 2, 3, 4, 5]);
		});

		it("forks branch and tree state without sharing payload objects", async () => {
			const fixture = await backend.create();
			const source = await fixture.create("source");
			await source.appendEntry({
				type: "message",
				id: "root",
				message: { role: "user", content: [], timestamp: 1 },
			});
			await source.appendEntry({
				type: "message",
				id: "leaf",
				message: { role: "assistant", content: [], timestamp: 2 },
			});
			await source.createLane("review", "root");
			await source.setLabel("root", "anchor");

			const branch = await fixture.fork(source, "branch", { entryId: "leaf", position: "at" });
			const tree = await fixture.fork(source, "tree", { scope: "tree" });
			expect(branch.findEntries({ order: "oldestFirst" }).map((entry) => entry.id)).toEqual(["root", "leaf"]);
			expect(branch.getLanes()).toEqual([{ lane: "main", leafId: "leaf" }]);
			expect(tree.getLanes()).toEqual([
				{ lane: "main", leafId: "leaf" },
				{ lane: "review", leafId: "root" },
			]);
			expect(tree.getLabel("root")).toBe("anchor");

			const detached = tree.getEntry("root")!;
			(detached.message as { role: string }).role = "mutated";
			expect((tree.getEntry("root")!.message as { role: string }).role).toBe("user");
		});
	});
}
