import { err, ok, type Result } from "../types.js";

export type JsonlV4EntryType =
	| "message"
	| "model_change"
	| "thinking_level_change"
	| "active_tools_change"
	| "compaction"
	| "branch_summary"
	| "custom";

export type JsonlV4RecordType =
	| "operation_started"
	| "abort_requested"
	| "operation_finished"
	| "step_attempt"
	| "tool_started"
	| "queue_enqueued"
	| "queue_cancelled"
	| "write_deferred"
	| "usage";

export interface JsonlV4Header {
	kind: "header";
	version: 4;
	id: string;
	createdAt: number;
	cwd: string;
	parentSessionId?: string;
	legacyParentSessionPath?: string;
	metadata?: Record<string, unknown>;
}

export type JsonlV4Entry = {
	type: JsonlV4EntryType;
	id: string;
	seq: number;
	parentId: string | null;
	timestamp: number;
	[key: string]: unknown;
};

export type JsonlV4Record = {
	type: JsonlV4RecordType;
	id: string;
	seq: number;
	lane: string;
	timestamp: number;
	[key: string]: unknown;
};

export type JsonlV4Mutation =
	| { kind: "entry"; lane?: string; entry: JsonlV4Entry }
	| { kind: "record"; record: JsonlV4Record }
	| { kind: "lane"; seq: number; lane: string; leafId: string | null }
	| { kind: "fact"; seq: number; fact: "name"; name: string | undefined }
	| { kind: "fact"; seq: number; fact: "label"; targetId: string; label: string | undefined };

const ENTRY_TYPES = new Set<JsonlV4EntryType>([
	"message",
	"model_change",
	"thinking_level_change",
	"active_tools_change",
	"compaction",
	"branch_summary",
	"custom",
]);
const RECORD_TYPES = new Set<JsonlV4RecordType>([
	"operation_started",
	"abort_requested",
	"operation_finished",
	"step_attempt",
	"tool_started",
	"queue_enqueued",
	"queue_cancelled",
	"write_deferred",
	"usage",
]);
const OPERATION_KINDS = new Set(["run", "compaction", "navigation"]);
const MAX_IDENTIFIER_LENGTH = 512;
const MAX_STRING_FIELD_LENGTH = 32 * 1024;

export class JsonlV4DecodeError extends Error {
	readonly kind: "syntax" | "schema";

	constructor(kind: "syntax" | "schema", message: string, cause?: Error) {
		super(message, cause === undefined ? undefined : { cause });
		this.name = "JsonlV4DecodeError";
		this.kind = kind;
	}
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseObject(line: string): Record<string, unknown> {
	let value: unknown;
	try {
		value = JSON.parse(line);
	} catch {
		// JSON.parse errors may quote attacker-controlled source content. Keep the
		// typed classification without retaining that error as a loggable cause.
		throw new JsonlV4DecodeError("syntax", "is not valid JSON");
	}
	if (!isObject(value)) throw new JsonlV4DecodeError("schema", "is not a JSON object");
	return value;
}

function requireString(
	value: unknown,
	field: string,
	options: { nonEmpty?: boolean; maxLength?: number } = {},
): string {
	if (
		typeof value !== "string" ||
		value.length > (options.maxLength ?? MAX_STRING_FIELD_LENGTH) ||
		(options.nonEmpty && value.length === 0)
	) {
		throw new JsonlV4DecodeError("schema", `has invalid ${field}`);
	}
	return value;
}

function requireSequence(value: unknown): number {
	if (!Number.isSafeInteger(value) || (value as number) <= 0) {
		throw new JsonlV4DecodeError("schema", "has invalid seq");
	}
	return value as number;
}

function requireTimestamp(value: unknown): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new JsonlV4DecodeError("schema", "has invalid timestamp");
	}
	return value as number;
}

function requireNullableId(value: unknown, field: string): string | null {
	if (value === null) return null;
	return requireString(value, field, { nonEmpty: true, maxLength: MAX_IDENTIFIER_LENGTH });
}

function decodeHeader(line: string): JsonlV4Header {
	const value = parseObject(line);
	if (value.kind !== "header") throw new JsonlV4DecodeError("schema", "is not a header");
	if (value.version !== 4) throw new JsonlV4DecodeError("schema", "has unsupported session version");
	const parentSessionId =
		value.parentSessionId === undefined
			? undefined
			: requireString(value.parentSessionId, "parentSessionId", {
					nonEmpty: true,
					maxLength: MAX_IDENTIFIER_LENGTH,
				});
	const legacyParentSessionPath =
		value.legacyParentSessionPath === undefined
			? undefined
			: requireString(value.legacyParentSessionPath, "legacyParentSessionPath", { nonEmpty: true });
	if (parentSessionId !== undefined && legacyParentSessionPath !== undefined) {
		throw new JsonlV4DecodeError("schema", "has both parentSessionId and legacyParentSessionPath");
	}
	if (value.metadata !== undefined && !isObject(value.metadata)) {
		throw new JsonlV4DecodeError("schema", "has invalid metadata");
	}
	return {
		kind: "header",
		version: 4,
		id: requireString(value.id, "id", { nonEmpty: true, maxLength: MAX_IDENTIFIER_LENGTH }),
		createdAt: requireTimestamp(value.createdAt),
		cwd: requireString(value.cwd, "cwd", { nonEmpty: true }),
		parentSessionId,
		legacyParentSessionPath,
		metadata: value.metadata as Record<string, unknown> | undefined,
	};
}

export function parseJsonlV4Header(line: string): Result<JsonlV4Header, JsonlV4DecodeError> {
	try {
		return ok<JsonlV4Header, JsonlV4DecodeError>(decodeHeader(line));
	} catch (error) {
		if (error instanceof JsonlV4DecodeError) return err<JsonlV4Header, JsonlV4DecodeError>(error);
		throw error;
	}
}

function parseEntryMutation(
	value: Record<string, unknown>,
	seq: number,
): Extract<JsonlV4Mutation, { kind: "entry" }> {
	const lane =
		value.lane === undefined
			? undefined
			: requireString(value.lane, "lane", { nonEmpty: true, maxLength: MAX_IDENTIFIER_LENGTH });
	const id = requireString(value.id, "id", { nonEmpty: true, maxLength: MAX_IDENTIFIER_LENGTH });
	const type = requireString(value.type, "entry type", { nonEmpty: true });
	if (!ENTRY_TYPES.has(type as JsonlV4EntryType)) {
		throw new JsonlV4DecodeError("schema", "has unknown entry type");
	}
	const parentId = requireNullableId(value.parentId, "parentId");
	const timestamp = requireTimestamp(value.timestamp);
	if (type === "custom") requireString(value.customType, "customType", { nonEmpty: true });
	const { kind: _kind, lane: _lane, ...entryFields } = value;
	const entry = { ...entryFields, id, type, parentId, seq, timestamp } as JsonlV4Entry;
	return lane === undefined ? { kind: "entry", entry } : { kind: "entry", lane, entry };
}

function parseRecordMutation(
	value: Record<string, unknown>,
	seq: number,
): Extract<JsonlV4Mutation, { kind: "record" }> {
	const id = requireString(value.id, "id", { nonEmpty: true, maxLength: MAX_IDENTIFIER_LENGTH });
	const lane = requireString(value.lane, "lane", { nonEmpty: true, maxLength: MAX_IDENTIFIER_LENGTH });
	const type = requireString(value.type, "record type", { nonEmpty: true });
	if (!RECORD_TYPES.has(type as JsonlV4RecordType)) {
		throw new JsonlV4DecodeError("schema", "has unknown record type");
	}
	const timestamp = requireTimestamp(value.timestamp);
	if (type === "operation_started") {
		if (!isObject(value.intent)) throw new JsonlV4DecodeError("schema", "has invalid intent");
		const operationKind = requireString(value.intent.kind, "operation kind", { nonEmpty: true });
		if (!OPERATION_KINDS.has(operationKind)) {
			throw new JsonlV4DecodeError("schema", "has unknown operation kind");
		}
	}
	if (type === "operation_finished") requireString(value.runId, "runId", { nonEmpty: true });
	const { kind: _kind, ...recordFields } = value;
	return {
		kind: "record",
		record: { ...recordFields, id, lane, type, seq, timestamp } as JsonlV4Record,
	};
}

function decodeMutation(line: string): JsonlV4Mutation {
	const value = parseObject(line);
	const seq = requireSequence(value.seq);
	switch (value.kind) {
		case "entry":
			return parseEntryMutation(value, seq);
		case "record":
			return parseRecordMutation(value, seq);
		case "lane":
			return {
				kind: "lane",
				seq,
				lane: requireString(value.lane, "lane", {
					nonEmpty: true,
					maxLength: MAX_IDENTIFIER_LENGTH,
				}),
				leafId: requireNullableId(value.leafId, "leafId"),
			};
		case "fact":
			if (value.fact === "name") {
				if (value.name !== undefined && typeof value.name !== "string") {
					throw new JsonlV4DecodeError("schema", "has invalid name");
				}
				return { kind: "fact", seq, fact: "name", name: value.name };
			}
			if (value.fact === "label") {
				if (value.label !== undefined && typeof value.label !== "string") {
					throw new JsonlV4DecodeError("schema", "has invalid label");
				}
				return {
					kind: "fact",
					seq,
					fact: "label",
					targetId: requireString(value.targetId, "targetId", {
						nonEmpty: true,
						maxLength: MAX_IDENTIFIER_LENGTH,
					}),
					label: value.label,
				};
			}
			throw new JsonlV4DecodeError("schema", "has unknown fact type");
		default:
			throw new JsonlV4DecodeError("schema", "has unknown mutation kind");
	}
}

export function parseJsonlV4Mutation(line: string): Result<JsonlV4Mutation, JsonlV4DecodeError> {
	try {
		return ok<JsonlV4Mutation, JsonlV4DecodeError>(decodeMutation(line));
	} catch (error) {
		if (error instanceof JsonlV4DecodeError) return err<JsonlV4Mutation, JsonlV4DecodeError>(error);
		throw error;
	}
}
