import { describe, expect, it } from "vitest";
import {
	JsonlV4DecodeError,
	parseJsonlV4Header,
	parseJsonlV4Mutation,
} from "../../src/harness/session/jsonl-v4-codec.ts";

describe("read-only JSONL v4 codec", () => {
	it("decodes the upstream header and every mutation family", () => {
		expect(
			parseJsonlV4Header(
				JSON.stringify({
					kind: "header",
					version: 4,
					id: "session",
					createdAt: 1,
					cwd: "/workspace",
					parentSessionId: "parent",
					metadata: { owner: "agent" },
				}),
			),
		).toMatchObject({ ok: true, value: { id: "session", version: 4 } });
		expect(
			parseJsonlV4Mutation(
				JSON.stringify({
					kind: "entry",
					seq: 1,
					lane: "main",
					type: "custom",
					id: "entry",
					parentId: null,
					timestamp: 1,
					customType: "note",
				}),
			),
		).toMatchObject({ ok: true, value: { kind: "entry", entry: { id: "entry", seq: 1 } } });
		expect(
			parseJsonlV4Mutation(
				JSON.stringify({
					kind: "record",
					seq: 2,
					type: "operation_started",
					id: "run",
					lane: "main",
					timestamp: 2,
					intent: { kind: "run" },
				}),
			),
		).toMatchObject({ ok: true, value: { kind: "record", record: { id: "run", seq: 2 } } });
		expect(
			parseJsonlV4Mutation(JSON.stringify({ kind: "lane", seq: 3, lane: "review", leafId: "entry" })),
		).toMatchObject({ ok: true, value: { kind: "lane", lane: "review" } });
		expect(
			parseJsonlV4Mutation(JSON.stringify({ kind: "fact", seq: 4, fact: "name", name: "Example" })),
		).toMatchObject({ ok: true, value: { kind: "fact", fact: "name" } });
	});

	it("rejects ambiguous parents, unsafe identifiers, and incomplete typed records", () => {
		for (const line of [
			JSON.stringify({
				kind: "header",
				version: 4,
				id: "session",
				createdAt: 1,
				cwd: "/workspace",
				parentSessionId: "parent",
				legacyParentSessionPath: "/legacy",
			}),
			JSON.stringify({ kind: "header", version: 4, id: "", createdAt: 1, cwd: "/workspace" }),
		]) {
			expect(parseJsonlV4Header(line)).toMatchObject({ ok: false, error: { kind: "schema" } });
		}

		for (const line of [
			JSON.stringify({
				kind: "entry",
				seq: 1,
				type: "custom",
				id: "entry",
				parentId: null,
				timestamp: 1,
			}),
			JSON.stringify({
				kind: "record",
				seq: 1,
				type: "operation_started",
				id: "run",
				lane: "main",
				timestamp: 1,
			}),
			JSON.stringify({
				kind: "record",
				seq: 1,
				type: "operation_finished",
				id: "finish",
				lane: "main",
				timestamp: 1,
			}),
		]) {
			expect(parseJsonlV4Mutation(line)).toMatchObject({ ok: false, error: { kind: "schema" } });
		}
	});

	it("keeps syntax failures typed and free of the raw payload", () => {
		const result = parseJsonlV4Mutation('{"secret":"do-not-echo"');
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("Expected a decode failure");
		expect(result.error).toBeInstanceOf(JsonlV4DecodeError);
		expect(result.error.kind).toBe("syntax");
		expect(result.error.message).not.toContain("do-not-echo");
		expect(result.error.cause).toBeUndefined();
	});
});
