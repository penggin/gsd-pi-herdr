import type { FileSystem } from "../types.js";
import { SessionError } from "../types.js";
import {
	type JsonlV4Entry,
	type JsonlV4Header,
	type JsonlV4Mutation,
	type JsonlV4Record,
	parseJsonlV4Header,
	parseJsonlV4Mutation,
	serializeJsonlV4Header,
	serializeJsonlV4Mutation,
} from "./jsonl-v4-codec.js";
import {
	DEFAULT_JSONL_V4_MAX_LINE_BYTES,
	type JsonlV4SessionMetadata,
	loadJsonlV4SessionState,
	type ReadJsonlV4Options,
} from "./jsonl-v4-reader.js";
import { getFileSystemResultOrThrow } from "./repo-utils.js";
import { assertV4JsonSerializable } from "./session-v4-json.js";
import type { V4ProvisionedEntry, V4ProvisionedRecord } from "./session-v4-memory.js";
import {
	type V4EntryQuery,
	type V4ForkOptions,
	type V4RecordQuery,
	type V4SessionLogItem,
	V4SessionState,
	V4SessionStateError,
	type V4SessionStateSnapshot,
} from "./session-v4-state.js";
import { uuidv7 } from "./uuid.js";

export type JsonlV4WritableFileSystem = Pick<
	FileSystem,
	| "absolutePath"
	| "appendFile"
	| "canonicalPath"
	| "fileInfo"
	| "readTextFile"
	| "remove"
	| "renameFile"
	| "writeFile"
>;

function stateError(error: unknown): never {
	if (error instanceof V4SessionStateError) throw new SessionError(error.code, error.message, error);
	throw error;
}

function byteLength(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

function normalizedMutation(mutation: JsonlV4Mutation): { mutation: JsonlV4Mutation; line: string } {
	assertV4JsonSerializable(mutation);
	const line = serializeJsonlV4Mutation(mutation);
	if (byteLength(line) > DEFAULT_JSONL_V4_MAX_LINE_BYTES) {
		throw new SessionError("invalid_payload", "Durable v4 mutation exceeds the line length limit");
	}
	const decoded = parseJsonlV4Mutation(line);
	if (!decoded.ok) throw new SessionError("invalid_entry", decoded.error.message, decoded.error);
	return { mutation: decoded.value, line };
}

function normalizedHeader(header: JsonlV4Header): string {
	assertV4JsonSerializable(header);
	const line = serializeJsonlV4Header(header);
	if (byteLength(line) > DEFAULT_JSONL_V4_MAX_LINE_BYTES) {
		throw new SessionError("invalid_payload", "Durable v4 header exceeds the line length limit");
	}
	const decoded = parseJsonlV4Header(line);
	if (!decoded.ok) throw new SessionError("invalid_payload", decoded.error.message, decoded.error);
	return line;
}

/** Publish a complete sibling temporary file with one atomic rename. */
export async function publishJsonlV4FileAtomically(
	fs: Pick<FileSystem, "writeFile" | "renameFile" | "remove">,
	destinationPath: string,
	content: string,
	abortSignal?: AbortSignal,
): Promise<void> {
	const tempPath = `${destinationPath}.tmp-${uuidv7()}`;
	try {
		getFileSystemResultOrThrow(
			await fs.writeFile(tempPath, content, abortSignal),
			`Failed to stage JSONL v4 session ${destinationPath}`,
		);
		getFileSystemResultOrThrow(
			await fs.renameFile(tempPath, destinationPath, abortSignal),
			`Failed to publish JSONL v4 session ${destinationPath}`,
		);
	} catch (error) {
		await fs.remove(tempPath, { force: true });
		throw error;
	}
}

export class JsonlV4SessionStorage {
	private readonly fs: JsonlV4WritableFileSystem;
	private metadata: JsonlV4SessionMetadata;
	private readonly state: V4SessionState;
	private tail: Promise<void> = Promise.resolve();

	private constructor(
		fs: JsonlV4WritableFileSystem,
		metadata: JsonlV4SessionMetadata,
		state = new V4SessionState(),
	) {
		this.fs = fs;
		this.metadata = structuredClone(metadata);
		this.state = state;
	}

	static async create(
		fs: JsonlV4WritableFileSystem,
		path: string,
		header: JsonlV4Header,
		readOptions: ReadJsonlV4Options,
		abortSignal?: AbortSignal,
	): Promise<JsonlV4SessionStorage> {
		const headerLine = normalizedHeader(header);
		await publishJsonlV4FileAtomically(fs, path, `${headerLine}\n`, abortSignal);
		return JsonlV4SessionStorage.load(fs, path, readOptions, abortSignal);
	}

	static async load(
		fs: JsonlV4WritableFileSystem,
		path: string,
		options: ReadJsonlV4Options,
		abortSignal?: AbortSignal,
	): Promise<JsonlV4SessionStorage> {
		if (abortSignal?.aborted) throw new SessionError("storage", "Opening JSONL v4 session was aborted");
		const loaded = await loadJsonlV4SessionState(fs, path, { ...options, abortSignal });
		if (loaded.repairContent !== undefined) {
			await publishJsonlV4FileAtomically(fs, path, loaded.repairContent, abortSignal);
			const info = getFileSystemResultOrThrow(
				await fs.fileInfo(path, abortSignal),
				`Failed to inspect repaired JSONL v4 session ${path}`,
			);
			loaded.metadata = { ...loaded.metadata, modifiedAt: info.mtimeMs };
		}
		return new JsonlV4SessionStorage(fs, loaded.metadata, loaded.state);
	}

	async fork(
		path: string,
		header: JsonlV4Header,
		options: V4ForkOptions,
		readOptions: ReadJsonlV4Options,
		abortSignal?: AbortSignal,
	): Promise<JsonlV4SessionStorage> {
		await this.drain();
		let mutations: JsonlV4Mutation[];
		try {
			mutations = this.state.createForkMutations(options);
		} catch (error) {
			stateError(error);
		}
		const targetState = new V4SessionState();
		const lines = [normalizedHeader(header)];
		for (const mutation of mutations) {
			const normalized = normalizedMutation(mutation);
			targetState.apply(normalized.mutation);
			lines.push(normalized.line);
		}
		await publishJsonlV4FileAtomically(this.fs, path, `${lines.join("\n")}\n`, abortSignal);
		return JsonlV4SessionStorage.load(this.fs, path, readOptions, abortSignal);
	}

	drain(): Promise<void> {
		return this.tail;
	}

	getMetadata(): JsonlV4SessionMetadata {
		return structuredClone(this.metadata);
	}

	getSnapshot(): V4SessionStateSnapshot {
		return this.state.snapshot();
	}

	getLanes(): Array<{ lane: string; leafId: string | null }> {
		return this.state.getLanes();
	}

	getName(): string | undefined {
		return this.state.getName();
	}

	getLabel(targetId: string): string | undefined {
		return this.state.getLabel(targetId);
	}

	getLog(options?: { afterSeq?: number; limit?: number }): V4SessionLogItem[] {
		try {
			return this.state.getLog(options);
		} catch (error) {
			stateError(error);
		}
	}

	findOpenOperations(lane: string): JsonlV4Record[] {
		try {
			return this.state.findOpenOperations(lane);
		} catch (error) {
			stateError(error);
		}
	}

	createLane(lane: string, at: string | null, abortSignal?: AbortSignal): Promise<void> {
		return this.enqueue(async () => {
			try {
				this.state.validateNewLane(lane);
				this.state.validateTarget(at);
			} catch (error) {
				stateError(error);
			}
			await this.commit({ kind: "lane", seq: this.state.nextSequence, lane, leafId: at }, abortSignal);
		});
	}

	moveLane(lane: string, to: string | null, abortSignal?: AbortSignal): Promise<void> {
		return this.enqueue(async () => {
			try {
				this.state.requireLane(lane);
				this.state.validateTarget(to);
			} catch (error) {
				stateError(error);
			}
			await this.commit({ kind: "lane", seq: this.state.nextSequence, lane, leafId: to }, abortSignal);
		});
	}

	appendEntry(entry: V4ProvisionedEntry, lane = "main", abortSignal?: AbortSignal): Promise<JsonlV4Entry> {
		return this.enqueue(async () => {
			assertV4JsonSerializable(entry);
			if ("seq" in entry || "parentId" in entry || "timestamp" in entry) {
				throw new SessionError("invalid_payload", "Provisioned v4 entry contains storage-owned fields");
			}
			let parentId: string | null;
			try {
				parentId = this.state.requireLane(lane);
				this.state.validateUnusedId(entry.id);
			} catch (error) {
				stateError(error);
			}
			const committed = {
				...structuredClone(entry),
				parentId,
				seq: this.state.nextSequence,
				timestamp: Date.now(),
			} as JsonlV4Entry;
			await this.commit({ kind: "entry", lane, entry: committed }, abortSignal);
			return structuredClone(committed);
		});
	}

	appendRecord(record: V4ProvisionedRecord, abortSignal?: AbortSignal): Promise<JsonlV4Record> {
		return this.enqueue(async () => {
			assertV4JsonSerializable(record);
			if ("seq" in record || "timestamp" in record) {
				throw new SessionError("invalid_payload", "Provisioned v4 record contains storage-owned fields");
			}
			try {
				this.state.requireLane(record.lane);
				this.state.validateUnusedId(record.id);
				if (record.type === "operation_started" && this.state.findOpenOperations(record.lane).length > 0) {
					throw new SessionError("invalid_entry", `Lane ${record.lane} already has an open operation`);
				}
			} catch (error) {
				stateError(error);
			}
			const committed = {
				...structuredClone(record),
				seq: this.state.nextSequence,
				timestamp: Date.now(),
			} as JsonlV4Record;
			await this.commit({ kind: "record", record: committed }, abortSignal);
			return structuredClone(committed);
		});
	}

	setName(name: string | undefined, abortSignal?: AbortSignal): Promise<void> {
		return this.enqueue(() =>
			this.commit({ kind: "fact", seq: this.state.nextSequence, fact: "name", name }, abortSignal),
		);
	}

	setLabel(targetId: string, label: string | undefined, abortSignal?: AbortSignal): Promise<void> {
		return this.enqueue(async () => {
			try {
				this.state.validateTarget(targetId);
			} catch (error) {
				stateError(error);
			}
			await this.commit(
				{ kind: "fact", seq: this.state.nextSequence, fact: "label", targetId, label },
				abortSignal,
			);
		});
	}

	getEntry(id: string): JsonlV4Entry | undefined {
		return this.state.getEntry(id);
	}

	findEntries(query?: V4EntryQuery): JsonlV4Entry[] {
		try {
			return this.state.findEntries(query);
		} catch (error) {
			stateError(error);
		}
	}

	findRecords(query?: V4RecordQuery): JsonlV4Record[] {
		try {
			return this.state.findRecords(query);
		} catch (error) {
			stateError(error);
		}
	}

	readBranch(start: string): JsonlV4Entry[] {
		try {
			return this.state.readBranch(start);
		} catch (error) {
			stateError(error);
		}
	}

	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.tail.then(operation);
		this.tail = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	private async commit(mutation: JsonlV4Mutation, abortSignal?: AbortSignal): Promise<void> {
		const normalized = normalizedMutation(mutation);
		getFileSystemResultOrThrow(
			await this.fs.appendFile(this.metadata.path, `${normalized.line}\n`, abortSignal),
			`Failed to append JSONL v4 session ${this.metadata.path}`,
		);
		try {
			this.state.apply(normalized.mutation);
		} catch (error) {
			stateError(error);
		}
	}
}
