import type { FileSystem, Result } from "../types.js";
import { SessionError } from "../types.js";
import {
	type JsonlV4Entry,
	JsonlV4DecodeError,
	type JsonlV4Record,
	parseJsonlV4Header,
	parseJsonlV4Mutation,
} from "./jsonl-v4-codec.js";
import { V4SessionState, V4SessionStateError } from "./session-v4-state.js";

export const DEFAULT_JSONL_V4_MAX_FILE_BYTES = 64 * 1024 * 1024;
export const DEFAULT_JSONL_V4_MAX_LINE_BYTES = 1024 * 1024;
export const DEFAULT_JSONL_V4_MAX_RECORDS = 200_000;

type JsonlV4ReaderFileSystem = Pick<
	FileSystem,
	"absolutePath" | "canonicalPath" | "fileInfo" | "readTextFile"
>;

export interface ReadJsonlV4Options {
	sessionsRoot: string;
	maxFileBytes?: number;
	maxLineBytes?: number;
	maxRecords?: number;
}

export interface JsonlV4SessionMetadata {
	id: string;
	createdAt: number;
	cwd: string;
	path: string;
	modifiedAt: number;
	sourceFormat: 4;
	parentSessionId?: string;
	legacyParentSessionPath?: string;
	metadata?: Readonly<Record<string, unknown>>;
}

export interface ReadOnlyJsonlV4SessionSnapshot {
	format: "harness-v4";
	metadata: Readonly<JsonlV4SessionMetadata>;
	sequence: number;
	entries: readonly Readonly<JsonlV4Entry>[];
	records: readonly Readonly<JsonlV4Record>[];
	lanes: readonly Readonly<{ lane: string; leafId: string | null }>[];
	name?: string;
	labels: Readonly<Record<string, string>>;
	ignoredTornTail: boolean;
}

function boundedText(value: string, maxLength: number): string {
	return value.length <= maxLength ? value : `…${value.slice(-(maxLength - 1))}`;
}

function unwrapFileResult<T>(result: Result<T, Error>, message: string): T {
	if (!result.ok) {
		throw new SessionError(
			"storage",
			`${boundedText(message, 512)}: ${boundedText(result.error.message, 1024)}`,
			result.error,
		);
	}
	return result.value;
}

function normalizePortablePath(path: string): string {
	const portable = path.replace(/\\/g, "/");
	const normalized = portable === "/" || /^[A-Za-z]:\/$/.test(portable) ? portable : portable.replace(/\/+$/, "");
	return /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized;
}

function assertContained(root: string, candidate: string): void {
	const normalizedRoot = normalizePortablePath(root);
	const normalizedCandidate = normalizePortablePath(candidate);
	const rootPrefix = normalizedRoot.endsWith("/") ? normalizedRoot : `${normalizedRoot}/`;
	if (normalizedCandidate !== normalizedRoot && !normalizedCandidate.startsWith(rootPrefix)) {
		throw new SessionError("invalid_session", "JSONL v4 session path escapes the configured sessions root");
	}
}

function positiveBound(value: number | undefined, fallback: number, name: string): number {
	const bound = value ?? fallback;
	if (!Number.isSafeInteger(bound) || bound <= 0) {
		throw new SessionError("invalid_session", `${name} must be a positive safe integer`);
	}
	return bound;
}

function byteLength(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

function invalidLine(path: string, line: number, cause: Error): SessionError {
	return new SessionError(
		"invalid_entry",
		`Invalid JSONL v4 session ${boundedText(path, 512)}: line ${line} ${boundedText(cause.message, 1024)}`,
		cause,
	);
}

function deepFreeze<T>(value: T): Readonly<T> {
	if (typeof value !== "object" || value === null) return value;
	const pending: object[] = [value];
	const visited = new Set<object>();
	while (pending.length > 0) {
		const current = pending.pop()!;
		if (visited.has(current)) continue;
		visited.add(current);
		for (const child of Object.values(current)) {
			if (typeof child === "object" && child !== null && !visited.has(child)) pending.push(child);
		}
		Object.freeze(current);
	}
	return value;
}

/**
 * Decode and reduce a v4 session without acquiring a writer or repairing the
 * source. A final syntactically torn append is ignored in memory only.
 */
export async function readJsonlV4Session(
	fs: JsonlV4ReaderFileSystem,
	path: string,
	options: ReadJsonlV4Options,
): Promise<ReadOnlyJsonlV4SessionSnapshot> {
	const maxFileBytes = positiveBound(options.maxFileBytes, DEFAULT_JSONL_V4_MAX_FILE_BYTES, "maxFileBytes");
	const maxLineBytes = positiveBound(options.maxLineBytes, DEFAULT_JSONL_V4_MAX_LINE_BYTES, "maxLineBytes");
	const maxRecords = positiveBound(options.maxRecords, DEFAULT_JSONL_V4_MAX_RECORDS, "maxRecords");
	const info = unwrapFileResult(await fs.fileInfo(path), `Failed to inspect session ${path}`);
	if (info.kind === "symlink") throw new SessionError("invalid_session", "Session path must not be a symbolic link");
	if (info.kind !== "file") throw new SessionError("invalid_session", "Session path must be a regular file");
	if (info.size > maxFileBytes) throw new SessionError("invalid_session", "JSONL v4 session exceeds the file size limit");

	const rootPath = unwrapFileResult(await fs.absolutePath(options.sessionsRoot), "Failed to resolve sessions root");
	const canonicalRoot = unwrapFileResult(await fs.canonicalPath(rootPath), "Failed to resolve sessions root");
	const canonicalPath = unwrapFileResult(await fs.canonicalPath(path), `Failed to resolve session ${path}`);
	assertContained(canonicalRoot, canonicalPath);

	const content = unwrapFileResult(await fs.readTextFile(path), `Failed to read session ${path}`);
	if (byteLength(content) > maxFileBytes) {
		throw new SessionError("invalid_session", "JSONL v4 session exceeds the file size limit");
	}
	const lines = content.split("\n");
	if (lines.at(-1) === "") lines.pop();
	if (lines.length === 0 || lines[0] === "") {
		throw invalidLine(path, 1, new JsonlV4DecodeError("schema", "is missing a header"));
	}
	if (byteLength(lines[0]!) > maxLineBytes) {
		throw invalidLine(path, 1, new JsonlV4DecodeError("schema", "exceeds the line length limit"));
	}
	const headerResult = parseJsonlV4Header(lines[0]!);
	if (!headerResult.ok) throw invalidLine(path, 1, headerResult.error);
	if (lines.length - 1 > maxRecords) {
		throw new SessionError("invalid_session", "JSONL v4 session exceeds the record count limit");
	}

	const state = new V4SessionState();
	let ignoredTornTail = false;
	for (let index = 1; index < lines.length; index++) {
		const line = lines[index]!;
		if (byteLength(line) > maxLineBytes) {
			throw invalidLine(path, index + 1, new JsonlV4DecodeError("schema", "exceeds the line length limit"));
		}
		const mutationResult = parseJsonlV4Mutation(line);
		if (!mutationResult.ok) {
			if (index === lines.length - 1 && mutationResult.error.kind === "syntax") {
				ignoredTornTail = true;
				break;
			}
			throw invalidLine(path, index + 1, mutationResult.error);
		}
		try {
			state.apply(mutationResult.value);
		} catch (error) {
			if (error instanceof V4SessionStateError) throw invalidLine(path, index + 1, error);
			throw error;
		}
	}
	const stateSnapshot = state.snapshot();
	const header = headerResult.value;
	const metadata: JsonlV4SessionMetadata = {
		id: header.id,
		createdAt: header.createdAt,
		cwd: header.cwd,
		path,
		modifiedAt: info.mtimeMs,
		sourceFormat: 4,
		...(header.parentSessionId === undefined ? {} : { parentSessionId: header.parentSessionId }),
		...(header.legacyParentSessionPath === undefined
			? {}
			: { legacyParentSessionPath: header.legacyParentSessionPath }),
		...(header.metadata === undefined ? {} : { metadata: structuredClone(header.metadata) }),
	};
	return deepFreeze({
		format: "harness-v4" as const,
		metadata,
		...stateSnapshot,
		ignoredTornTail,
	});
}

/** Return one immutable leaf-to-root branch from an already validated snapshot. */
export function readJsonlV4Branch(
	snapshot: ReadOnlyJsonlV4SessionSnapshot,
	start: string,
): readonly Readonly<JsonlV4Entry>[] {
	const entries = new Map(snapshot.entries.map((entry) => [entry.id, entry]));
	const branch: Readonly<JsonlV4Entry>[] = [];
	let current = entries.get(start);
	if (!current) throw new SessionError("not_found", `Entry not found: ${start}`);
	while (current) {
		branch.push(current);
		if (current.parentId === null) break;
		const parent = entries.get(current.parentId);
		if (!parent) throw new SessionError("invalid_entry", `Entry not found: ${current.parentId}`);
		current = parent;
	}
	return Object.freeze(branch);
}
