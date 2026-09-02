import { describe, expect, it } from "vitest";
import {
	assertV4JsonSerializable,
	V4MemorySessionRepository,
} from "../../src/harness/session/session-v4-memory.ts";

describe("v4 memory session backend", () => {
	it("supports entries, lanes, records, facts, queries, and detached reads", () => {
		const repo = new V4MemorySessionRepository();
		const storage = repo.create({ id: "memory" });
		const root = storage.appendEntry({
			type: "message",
			id: "root",
			message: { role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1 },
		});
		storage.createLane("review", root.id);
		const review = storage.appendEntry(
			{ type: "custom", id: "review", customType: "assessment", data: { verdict: "pass" } },
			"review",
		);
		storage.setName("Example");
		storage.setLabel(review.id, "checked");
		storage.appendRecord({
			type: "operation_started",
			id: "run",
			lane: "main",
			intent: { kind: "run" },
		});
		storage.appendRecord({
			type: "operation_finished",
			id: "finish",
			lane: "main",
			runId: "run",
			outcome: "completed",
		});

		expect(storage.getSnapshot()).toMatchObject({
			sequence: 7,
			name: "Example",
			labels: { review: "checked" },
			lanes: [
				{ lane: "main", leafId: "root" },
				{ lane: "review", leafId: "review" },
			],
		});
		expect(storage.findEntries({ order: "oldestFirst" }).map((entry) => entry.id)).toEqual(["root", "review"]);
		expect(storage.findRecords({ runId: "run" }).map((record) => record.id)).toEqual(["finish", "run"]);
		expect(storage.readBranch("review").map((entry) => entry.id)).toEqual(["review", "root"]);

		(review.data as { verdict: string }).verdict = "mutated";
		expect(storage.getEntry("review")?.data).toEqual({ verdict: "pass" });
	});

	it("forks a branch or complete tree without sharing mutable payloads", () => {
		const repo = new V4MemorySessionRepository();
		const source = repo.create({ id: "source" });
		source.appendEntry({
			type: "message",
			id: "root",
			message: { role: "user", content: [{ type: "text", text: "root" }], timestamp: 1 },
		});
		source.appendEntry({
			type: "message",
			id: "leaf",
			message: { role: "assistant", content: [], timestamp: 2 },
		});
		source.createLane("review", "root");
		source.setLabel("root", "anchor");

		const branch = repo.fork(source.getMetadata(), { id: "branch", entryId: "leaf", position: "at" });
		const tree = repo.fork(source.getMetadata(), { id: "tree", scope: "tree" });
		expect(branch.findEntries({ order: "oldestFirst" }).map((entry) => entry.id)).toEqual(["root", "leaf"]);
		expect(branch.getLanes()).toEqual([{ lane: "main", leafId: "leaf" }]);
		expect(tree.getLanes()).toEqual([
			{ lane: "main", leafId: "leaf" },
			{ lane: "review", leafId: "root" },
		]);
		expect(tree.getSnapshot().labels).toEqual({ root: "anchor" });
	});

	it("rejects invalid durable payloads and overlapping operations", () => {
		const cyclic: { self?: unknown } = {};
		cyclic.self = cyclic;
		expect(() => assertV4JsonSerializable(cyclic)).toThrowError(/cycle/);
		expect(() => assertV4JsonSerializable({ value: undefined })).toThrowError(/undefined/);

		const storage = new V4MemorySessionRepository().create({ id: "invalid" });
		expect(() => storage.appendEntry({ type: "custom", id: "missing-custom-type" })).toThrowError(/customType/);
		storage.appendRecord({ type: "operation_started", id: "run-1", lane: "main", intent: { kind: "run" } });
		expect(() =>
			storage.appendRecord({ type: "operation_started", id: "run-2", lane: "main", intent: { kind: "run" } }),
		).toThrowError(/already has an open operation/);
	});

	it("keeps repository identities unique and returns detached metadata", () => {
		const repo = new V4MemorySessionRepository();
		const storage = repo.create({ id: "same" });
		expect(() => repo.create({ id: "same" })).toThrowError(/already exists/);
		const metadata = storage.getMetadata();
		metadata.id = "changed";
		expect(repo.list()[0]!.id).toBe("same");
		repo.delete(storage.getMetadata());
		expect(repo.list()).toEqual([]);
	});
});
