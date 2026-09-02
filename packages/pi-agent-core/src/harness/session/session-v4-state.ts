import type { SessionErrorCode } from "../types.js";
import type { JsonlV4Entry, JsonlV4Mutation, JsonlV4Record } from "./jsonl-v4-codec.js";

export interface V4SessionStateSnapshot {
	sequence: number;
	entries: JsonlV4Entry[];
	records: JsonlV4Record[];
	lanes: Array<{ lane: string; leafId: string | null }>;
	name?: string;
	labels: Record<string, string>;
}

export interface V4SessionStats {
	messageCount: number;
	cachedTokens: number;
	uncachedTokens: number;
	totalTokens: number;
	costTotal: number;
}

export type V4SessionLogItem =
	| { kind: "entry"; seq: number; entry: JsonlV4Entry }
	| { kind: "record"; seq: number; record: JsonlV4Record }
	| { kind: "lane"; seq: number; lane: string; leafId: string | null }
	| { kind: "fact"; seq: number; fact: "name"; name: string | undefined }
	| { kind: "fact"; seq: number; fact: "label"; targetId: string; label: string | undefined };

export interface V4EntryQuery {
	type?: JsonlV4Entry["type"];
	customType?: string;
	order?: "newestFirst" | "oldestFirst";
	afterSeq?: number;
	limit?: number;
}

export interface V4BranchBounds {
	stopAtType?: JsonlV4Entry["type"];
	stopAtId?: string;
}

export interface V4RecordQuery {
	type?: JsonlV4Record["type"];
	lane?: string;
	runId?: string;
	operationKind?: "run" | "compaction" | "navigation";
	order?: "newestFirst" | "oldestFirst";
	afterSeq?: number;
	limit?: number;
}

export type V4ForkOptions =
	| { scope?: "branch"; entryId?: string; position?: "before" | "at" }
	| { scope: "tree" };

function assertQueryBounds(limit: number | undefined, afterSeq: number | undefined): void {
	if (limit !== undefined && (!Number.isSafeInteger(limit) || limit <= 0)) {
		throw new V4SessionStateError("invalid_query", "limit must be a positive safe integer");
	}
	if (afterSeq !== undefined && (!Number.isSafeInteger(afterSeq) || afterSeq < 0)) {
		throw new V4SessionStateError("invalid_query", "afterSeq must be a non-negative safe integer");
	}
}

function ordered<T>(values: readonly T[], order: "newestFirst" | "oldestFirst" | undefined): T[] {
	return order === "oldestFirst" ? [...values] : [...values].reverse();
}

function finiteNumber(value: unknown, field: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new V4SessionStateError("invalid_entry", `has invalid ${field}`);
	}
	return value;
}

function usageDelta(record: JsonlV4Record): Omit<V4SessionStats, "messageCount"> | undefined {
	if (record.type !== "usage") return undefined;
	const usage = record.usage;
	if (typeof usage !== "object" || usage === null || Array.isArray(usage)) {
		throw new V4SessionStateError("invalid_entry", "has invalid usage");
	}
	const cost = (usage as Record<string, unknown>).cost;
	if (typeof cost !== "object" || cost === null || Array.isArray(cost)) {
		throw new V4SessionStateError("invalid_entry", "has invalid usage cost");
	}
	const input = finiteNumber((usage as Record<string, unknown>).input, "usage.input");
	finiteNumber((usage as Record<string, unknown>).output, "usage.output");
	const cacheRead = finiteNumber((usage as Record<string, unknown>).cacheRead, "usage.cacheRead");
	const cacheWrite = finiteNumber((usage as Record<string, unknown>).cacheWrite, "usage.cacheWrite");
	finiteNumber((cost as Record<string, unknown>).input, "usage.cost.input");
	finiteNumber((cost as Record<string, unknown>).output, "usage.cost.output");
	finiteNumber((cost as Record<string, unknown>).cacheRead, "usage.cost.cacheRead");
	finiteNumber((cost as Record<string, unknown>).cacheWrite, "usage.cost.cacheWrite");
	return {
		cachedTokens: cacheRead,
		uncachedTokens: input + cacheWrite,
		totalTokens: finiteNumber((usage as Record<string, unknown>).totalTokens, "usage.totalTokens"),
		costTotal: finiteNumber((cost as Record<string, unknown>).total, "usage.cost.total"),
	};
}

export class V4SessionStateError extends Error {
	readonly code: SessionErrorCode;

	constructor(code: SessionErrorCode, message: string) {
		super(message);
		this.name = "V4SessionStateError";
		this.code = code;
	}
}

/** Shared deterministic reducer for the v4 JSONL and memory backends. */
export class V4SessionState {
	private sequence = 0;
	private readonly usedIds = new Set<string>();
	private readonly entries: JsonlV4Entry[] = [];
	private readonly entriesById = new Map<string, JsonlV4Entry>();
	private readonly records: JsonlV4Record[] = [];
	private readonly openOperationsByLane = new Map<string, Map<string, JsonlV4Record>>();
	private readonly log: V4SessionLogItem[] = [];
	private readonly lanes = new Map<string, string | null>([["main", null]]);
	private readonly labels = new Map<string, string>();
	private name: string | undefined;
	private readonly stats: V4SessionStats = {
		messageCount: 0,
		cachedTokens: 0,
		uncachedTokens: 0,
		totalTokens: 0,
		costTotal: 0,
	};

	get nextSequence(): number {
		return this.sequence + 1;
	}

	requireLane(lane: string): string | null {
		if (!this.lanes.has(lane)) throw new V4SessionStateError("invalid_lane", `references missing lane ${lane}`);
		return this.lanes.get(lane)!;
	}

	validateNewLane(lane: string): void {
		if (this.lanes.has(lane)) throw new V4SessionStateError("already_exists", `contains duplicate lane ${lane}`);
	}

	validateTarget(targetId: string | null): void {
		if (targetId !== null && !this.entriesById.has(targetId)) {
			throw new V4SessionStateError("not_found", `references missing target ${targetId}`);
		}
	}

	validateUnusedId(id: string): void {
		if (this.usedIds.has(id)) throw new V4SessionStateError("already_exists", `contains duplicate id ${id}`);
	}

	validateRecord(record: JsonlV4Record): void {
		this.requireLane(record.lane);
		this.validateUnusedId(record.id);
		usageDelta(record);
	}

	apply(mutation: JsonlV4Mutation): void {
		const seq =
			mutation.kind === "entry"
				? mutation.entry.seq
				: mutation.kind === "record"
					? mutation.record.seq
					: mutation.seq;
		if (seq !== this.sequence + 1) {
			throw new V4SessionStateError("invalid_entry", `has non-consecutive seq ${seq}`);
		}

		switch (mutation.kind) {
			case "entry": {
				this.validateUnusedId(mutation.entry.id);
				if (mutation.lane !== undefined) {
					const leafId = this.requireLane(mutation.lane);
					if (mutation.entry.parentId !== leafId) {
						throw new V4SessionStateError("invalid_entry", "does not chain to the lane leaf");
					}
				}
				if (mutation.entry.parentId !== null && !this.entriesById.has(mutation.entry.parentId)) {
					throw new V4SessionStateError("invalid_entry", `references missing parent ${mutation.entry.parentId}`);
				}
				this.usedIds.add(mutation.entry.id);
				this.entries.push(mutation.entry);
				this.entriesById.set(mutation.entry.id, mutation.entry);
				if (mutation.lane !== undefined) this.lanes.set(mutation.lane, mutation.entry.id);
				this.log.push({ kind: "entry", seq, entry: mutation.entry });
				if (mutation.entry.type === "message") this.stats.messageCount += 1;
				break;
			}
			case "record": {
				this.validateRecord(mutation.record);
				const usage = usageDelta(mutation.record);
				this.usedIds.add(mutation.record.id);
				this.records.push(mutation.record);
				if (mutation.record.type === "operation_started") {
					let open = this.openOperationsByLane.get(mutation.record.lane);
					if (!open) {
						open = new Map();
						this.openOperationsByLane.set(mutation.record.lane, open);
					}
					open.set(mutation.record.id, mutation.record);
				} else if (mutation.record.type === "operation_finished" && typeof mutation.record.runId === "string") {
					this.openOperationsByLane.get(mutation.record.lane)?.delete(mutation.record.runId);
				}
				this.log.push({ kind: "record", seq, record: mutation.record });
				if (usage) {
					this.stats.cachedTokens += usage.cachedTokens;
					this.stats.uncachedTokens += usage.uncachedTokens;
					this.stats.totalTokens += usage.totalTokens;
					this.stats.costTotal += usage.costTotal;
				}
				break;
			}
			case "lane":
				this.validateTarget(mutation.leafId);
				this.lanes.set(mutation.lane, mutation.leafId);
				this.log.push({ kind: "lane", seq, lane: mutation.lane, leafId: mutation.leafId });
				break;
			case "fact":
				if (mutation.fact === "name") {
					this.name = mutation.name;
					this.log.push({ kind: "fact", seq, fact: "name", name: mutation.name });
				} else {
					if (!this.entriesById.has(mutation.targetId)) {
						throw new V4SessionStateError("invalid_entry", `references missing label target ${mutation.targetId}`);
					}
					if (mutation.label === undefined) this.labels.delete(mutation.targetId);
					else this.labels.set(mutation.targetId, mutation.label);
					this.log.push({
						kind: "fact",
						seq,
						fact: "label",
						targetId: mutation.targetId,
						label: mutation.label,
					});
				}
				break;
		}
		this.sequence = seq;
	}

	getEntry(id: string): JsonlV4Entry | undefined {
		const entry = this.entriesById.get(id);
		return entry === undefined ? undefined : structuredClone(entry);
	}

	getEntries(): JsonlV4Entry[] {
		return structuredClone(this.entries);
	}

	getRecords(): JsonlV4Record[] {
		return structuredClone(this.records);
	}

	findEntries(query: V4EntryQuery = {}): JsonlV4Entry[] {
		assertQueryBounds(query.limit, query.afterSeq);
		const matches = ordered(this.entries, query.order).filter(
			(entry) =>
				(query.type === undefined || entry.type === query.type) &&
				(query.customType === undefined || (entry.type === "custom" && entry.customType === query.customType)) &&
				(query.afterSeq === undefined ||
					(query.order === "oldestFirst" ? entry.seq > query.afterSeq : entry.seq < query.afterSeq)),
		);
		return structuredClone(query.limit === undefined ? matches : matches.slice(0, query.limit));
	}

	findRecords(query: V4RecordQuery = {}): JsonlV4Record[] {
		assertQueryBounds(query.limit, query.afterSeq);
		if (query.operationKind !== undefined && query.type !== "operation_started") {
			throw new V4SessionStateError(
				"invalid_query",
				"operationKind requires type operation_started",
			);
		}
		const matches = ordered(this.records, query.order).filter(
			(record) =>
				(query.type === undefined || record.type === query.type) &&
				(query.lane === undefined || record.lane === query.lane) &&
				(query.afterSeq === undefined || record.seq > query.afterSeq) &&
				(query.operationKind === undefined ||
					(record.type === "operation_started" &&
						typeof record.intent === "object" &&
						record.intent !== null &&
						(record.intent as Record<string, unknown>).kind === query.operationKind)) &&
				(query.runId === undefined ||
					(record.type === "operation_started" ? record.id === query.runId : record.runId === query.runId)),
		);
		return structuredClone(query.limit === undefined ? matches : matches.slice(0, query.limit));
	}

	findOpenOperations(lane: string, options: { limit?: number } = {}): JsonlV4Record[] {
		this.requireLane(lane);
		assertQueryBounds(options.limit, undefined);
		const open = [...(this.openOperationsByLane.get(lane)?.values() ?? [])].reverse();
		return structuredClone(options.limit === undefined ? open : open.slice(0, options.limit));
	}

	findEntriesOnBranch(query: V4EntryQuery & V4BranchBounds & { start: string }): JsonlV4Entry[] {
		assertQueryBounds(query.limit, query.afterSeq);
		const path = this.readBranch(query.start);
		const scan = query.order === "oldestFirst" ? path.reverse() : path;
		const results: JsonlV4Entry[] = [];
		for (const entry of scan) {
			const reachedBound = entry.id === query.stopAtId || entry.type === query.stopAtType;
			const cursorMatches =
				query.afterSeq === undefined ||
				(query.order === "oldestFirst" ? entry.seq > query.afterSeq : entry.seq < query.afterSeq);
			if (
				cursorMatches &&
				(query.type === undefined || entry.type === query.type) &&
				(query.customType === undefined || (entry.type === "custom" && entry.customType === query.customType))
			) {
				results.push(entry);
			}
			if (reachedBound || results.length === query.limit) break;
		}
		return structuredClone(results);
	}

	getLog(options: { afterSeq?: number; limit?: number } = {}): V4SessionLogItem[] {
		assertQueryBounds(options.limit, options.afterSeq);
		const matches = this.log.filter((item) => options.afterSeq === undefined || item.seq > options.afterSeq);
		return structuredClone(options.limit === undefined ? matches : matches.slice(0, options.limit));
	}

	getLanes(): Array<{ lane: string; leafId: string | null }> {
		return [...this.lanes].map(([lane, leafId]) => ({ lane, leafId }));
	}

	getName(): string | undefined {
		return this.name;
	}

	getLabel(id: string): string | undefined {
		return this.labels.get(id);
	}

	getStats(): V4SessionStats {
		return structuredClone(this.stats);
	}

	readBranch(start: string): JsonlV4Entry[] {
		const branch: JsonlV4Entry[] = [];
		let current = this.entriesById.get(start);
		if (!current) throw new V4SessionStateError("not_found", `references missing target ${start}`);
		while (current) {
			branch.push(structuredClone(current));
			if (current.parentId === null) break;
			current = this.entriesById.get(current.parentId);
			if (!current) throw new V4SessionStateError("invalid_entry", "contains a broken parent chain");
		}
		return branch;
	}

	createForkMutations(options: V4ForkOptions): JsonlV4Mutation[] {
		let entries: JsonlV4Entry[];
		let lanes: Array<{ lane: string; leafId: string | null }>;
		if (options.scope === "tree") {
			entries = this.getEntries();
			lanes = this.getLanes();
		} else {
			const selectedId = options.entryId ?? this.requireLane("main");
			let targetId: string | null = null;
			if (selectedId !== null) {
				const selected = this.entriesById.get(selectedId);
				if (!selected || selected.type !== "message") {
					throw new V4SessionStateError("invalid_fork_target", `fork target is not a message entry: ${selectedId}`);
				}
				const position = options.position ?? (options.entryId === undefined ? "at" : "before");
				targetId = position === "at" ? selected.id : selected.parentId;
			}
			entries = targetId === null ? [] : this.readBranch(targetId).reverse();
			lanes = [{ lane: "main", leafId: targetId }];
		}

		const mutations: JsonlV4Mutation[] = [];
		let seq = 1;
		for (const entry of entries) mutations.push({ kind: "entry", entry: { ...entry, seq: seq++ } });
		for (const pointer of lanes) mutations.push({ kind: "lane", seq: seq++, ...pointer });
		if (this.name !== undefined) mutations.push({ kind: "fact", seq: seq++, fact: "name", name: this.name });
		for (const entry of entries) {
			const label = this.labels.get(entry.id);
			if (label !== undefined) {
				mutations.push({ kind: "fact", seq: seq++, fact: "label", targetId: entry.id, label });
			}
		}
		return structuredClone(mutations);
	}

	snapshot(): V4SessionStateSnapshot {
		return {
			sequence: this.sequence,
			entries: this.getEntries(),
			records: this.getRecords(),
			lanes: this.getLanes(),
			...(this.name === undefined ? {} : { name: this.name }),
			labels: Object.fromEntries(this.labels),
		};
	}
}
