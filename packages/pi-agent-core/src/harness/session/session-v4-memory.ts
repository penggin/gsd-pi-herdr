import { SessionError } from "../types.js";
import {
	type JsonlV4Entry,
	type JsonlV4Mutation,
	type JsonlV4Record,
	parseJsonlV4Mutation,
	serializeJsonlV4Mutation,
} from "./jsonl-v4-codec.js";
import { assertV4JsonSerializable } from "./session-v4-json.js";
import {
	type V4EntryQuery,
	type V4ForkOptions,
	type V4SessionLogItem,
	type V4RecordQuery,
	V4SessionState,
	V4SessionStateError,
	type V4SessionStateSnapshot,
} from "./session-v4-state.js";
import { uuidv7 } from "./uuid.js";

export { assertV4JsonSerializable } from "./session-v4-json.js";

export interface V4MemorySessionMetadata {
	id: string;
	createdAt: number;
	parentSessionId?: string;
}

export type V4ProvisionedEntry = {
	type: JsonlV4Entry["type"];
	id: string;
	[key: string]: unknown;
};
export type V4ProvisionedRecord = {
	type: JsonlV4Record["type"];
	id: string;
	lane: string;
	[key: string]: unknown;
};

function stateError(error: unknown): never {
	if (error instanceof V4SessionStateError) throw new SessionError(error.code, error.message, error);
	throw error;
}

export class V4MemorySessionStorage {
	private readonly metadata: V4MemorySessionMetadata;
	private readonly state = new V4SessionState();

	constructor(metadata: V4MemorySessionMetadata) {
		assertV4JsonSerializable(metadata);
		this.metadata = structuredClone(metadata);
	}

	static fromFork(
		metadata: V4MemorySessionMetadata,
		source: V4MemorySessionStorage,
		options: V4ForkOptions,
	): V4MemorySessionStorage {
		const target = new V4MemorySessionStorage(metadata);
		for (const mutation of source.state.createForkMutations(options)) target.apply(mutation);
		return target;
	}

	getMetadata(): V4MemorySessionMetadata {
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

	createLane(lane: string, at: string | null): void {
		try {
			this.state.validateNewLane(lane);
			this.state.validateTarget(at);
			this.apply({ kind: "lane", seq: this.state.nextSequence, lane, leafId: at });
		} catch (error) {
			stateError(error);
		}
	}

	moveLane(lane: string, to: string | null): void {
		try {
			this.state.requireLane(lane);
			this.state.validateTarget(to);
			this.apply({ kind: "lane", seq: this.state.nextSequence, lane, leafId: to });
		} catch (error) {
			stateError(error);
		}
	}

	appendEntry(entry: V4ProvisionedEntry, lane = "main"): JsonlV4Entry {
		assertV4JsonSerializable(entry);
		if ("seq" in entry || "parentId" in entry || "timestamp" in entry) {
			throw new SessionError("invalid_payload", "Provisioned v4 entry contains storage-owned fields");
		}
		try {
			const committed = {
				...structuredClone(entry),
				parentId: this.state.requireLane(lane),
				seq: this.state.nextSequence,
				timestamp: Date.now(),
			} as JsonlV4Entry;
			this.apply({ kind: "entry", lane, entry: committed });
			return structuredClone(committed);
		} catch (error) {
			stateError(error);
		}
	}

	appendRecord(record: V4ProvisionedRecord): JsonlV4Record {
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
			const committed = {
				...structuredClone(record),
				seq: this.state.nextSequence,
				timestamp: Date.now(),
			} as JsonlV4Record;
			this.apply({ kind: "record", record: committed });
			return structuredClone(committed);
		} catch (error) {
			stateError(error);
		}
	}

	setName(name: string | undefined): void {
		this.apply({ kind: "fact", seq: this.state.nextSequence, fact: "name", name });
	}

	setLabel(targetId: string, label: string | undefined): void {
		try {
			this.apply({ kind: "fact", seq: this.state.nextSequence, fact: "label", targetId, label });
		} catch (error) {
			stateError(error);
		}
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

	private apply(mutation: JsonlV4Mutation): void {
		assertV4JsonSerializable(mutation);
		const decoded = parseJsonlV4Mutation(serializeJsonlV4Mutation(mutation));
		if (!decoded.ok) throw new SessionError("invalid_entry", decoded.error.message, decoded.error);
		this.state.apply(decoded.value);
	}
}

export class V4MemorySessionRepository {
	private readonly sessions = new Map<string, V4MemorySessionStorage>();

	create(options: { id?: string; parentSessionId?: string } = {}): V4MemorySessionStorage {
		const id = options.id ?? uuidv7();
		if (this.sessions.has(id)) throw new SessionError("already_exists", `Session already exists: ${id}`);
		const storage = new V4MemorySessionStorage({
			id,
			createdAt: Date.now(),
			...(options.parentSessionId === undefined ? {} : { parentSessionId: options.parentSessionId }),
		});
		this.sessions.set(id, storage);
		return storage;
	}

	open(metadata: V4MemorySessionMetadata): V4MemorySessionStorage {
		const storage = this.sessions.get(metadata.id);
		if (!storage) throw new SessionError("not_found", `Session not found: ${metadata.id}`);
		return storage;
	}

	list(): V4MemorySessionMetadata[] {
		return [...this.sessions.values()].map((storage) => storage.getMetadata());
	}

	delete(metadata: V4MemorySessionMetadata): void {
		this.sessions.delete(metadata.id);
	}

	fork(
		source: V4MemorySessionMetadata,
		options: V4ForkOptions & { id?: string; parentSessionId?: string } = {},
	): V4MemorySessionStorage {
		const sourceStorage = this.open(source);
		const id = options.id ?? uuidv7();
		if (this.sessions.has(id)) throw new SessionError("already_exists", `Session already exists: ${id}`);
		let target: V4MemorySessionStorage;
		try {
			target = V4MemorySessionStorage.fromFork(
				{ id, createdAt: Date.now(), parentSessionId: options.parentSessionId ?? source.id },
				sourceStorage,
				options,
			);
		} catch (error) {
			stateError(error);
		}
		this.sessions.set(id, target);
		return target;
	}
}
