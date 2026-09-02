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
	V4EntryQuery,
	V4ForkOptions,
	V4RecordQuery,
	V4SessionLogItem,
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
	getLog(options?: { afterSeq?: number; limit?: number }): V4SessionLogItem[];
	getEntry(id: string): JsonlV4Entry | undefined;
	findEntries(query?: V4EntryQuery): JsonlV4Entry[];
	findRecords(query?: V4RecordQuery): JsonlV4Record[];
	readBranch(start: string): JsonlV4Entry[];
}

interface ConformanceFixture {
	create(id: string): Promise<ConformanceStorage>;
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
