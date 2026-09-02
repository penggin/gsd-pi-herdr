import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NodeExecutionEnv } from "../../src/harness/env/nodejs.ts";
import { parseJsonlV4Mutation, type JsonlV4Mutation } from "../../src/harness/session/jsonl-v4-codec.ts";
import { readJsonlV4Session } from "../../src/harness/session/jsonl-v4-reader.ts";
import { V4SessionState, V4SessionStateError } from "../../src/harness/session/session-v4-state.ts";
import { getOrThrow } from "../../src/harness/types.ts";
import { createTempDir } from "./session-test-utils.ts";

function mutation(value: Record<string, unknown>): JsonlV4Mutation {
	return getOrThrow(parseJsonlV4Mutation(JSON.stringify(value)));
}

const mutations = [
	{
		kind: "entry",
		seq: 1,
		lane: "main",
		type: "custom",
		id: "root",
		parentId: null,
		timestamp: 1,
		customType: "note",
		data: { nested: true },
	},
	{ kind: "lane", seq: 2, lane: "review", leafId: "root" },
	{
		kind: "entry",
		seq: 3,
		lane: "review",
		type: "custom",
		id: "review-leaf",
		parentId: "root",
		timestamp: 3,
		customType: "assessment",
	},
	{
		kind: "record",
		seq: 4,
		type: "operation_started",
		id: "run",
		lane: "main",
		timestamp: 4,
		intent: { kind: "run" },
	},
	{ kind: "fact", seq: 5, fact: "name", name: "Parity" },
	{ kind: "fact", seq: 6, fact: "label", targetId: "review-leaf", label: "checked" },
] satisfies Array<Record<string, unknown>>;

describe("V4SessionState", () => {
	it("produces the same state in memory and through the JSONL reader", async () => {
		const state = new V4SessionState();
		for (const value of mutations) state.apply(mutation(value));
		const expected = state.snapshot();

		const root = createTempDir();
		const path = join(root, "parity.jsonl");
		const header = { kind: "header", version: 4, id: "parity", createdAt: 1, cwd: root };
		writeFileSync(path, `${[header, ...mutations].map((value) => JSON.stringify(value)).join("\n")}\n`);
		const actual = await readJsonlV4Session(new NodeExecutionEnv({ cwd: root }), path, { sessionsRoot: root });

		expect({
			sequence: actual.sequence,
			entries: actual.entries,
			records: actual.records,
			lanes: actual.lanes,
			name: actual.name,
			labels: actual.labels,
		}).toEqual(expected);
		expect(state.readBranch("review-leaf").map((entry) => entry.id)).toEqual(["review-leaf", "root"]);
	});

	it("returns detached snapshots and deterministic validation failures", () => {
		const state = new V4SessionState();
		state.apply(mutation(mutations[0]!));
		const first = state.snapshot();
		(first.entries[0]!.data as { nested: boolean }).nested = false;
		expect((state.getEntry("root")?.data as { nested: boolean }).nested).toBe(true);

		expect(() => state.apply(mutation({ ...mutations[0], seq: 2 }))).toThrowError(V4SessionStateError);
		expect(() =>
			state.apply(
				mutation({
					kind: "entry",
					seq: 2,
					lane: "missing",
					type: "custom",
					id: "next",
					parentId: "root",
					timestamp: 2,
					customType: "note",
				}),
			),
		).toThrowError("references missing lane missing");
	});
});
