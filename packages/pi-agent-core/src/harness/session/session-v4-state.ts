import type { JsonlV4Entry, JsonlV4Mutation, JsonlV4Record } from "./jsonl-v4-codec.js";

export interface V4SessionStateSnapshot {
	sequence: number;
	entries: JsonlV4Entry[];
	records: JsonlV4Record[];
	lanes: Array<{ lane: string; leafId: string | null }>;
	name?: string;
	labels: Record<string, string>;
}

export class V4SessionStateError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "V4SessionStateError";
	}
}

/** Shared deterministic reducer for the v4 JSONL and memory backends. */
export class V4SessionState {
	private sequence = 0;
	private readonly usedIds = new Set<string>();
	private readonly entries: JsonlV4Entry[] = [];
	private readonly entriesById = new Map<string, JsonlV4Entry>();
	private readonly records: JsonlV4Record[] = [];
	private readonly lanes = new Map<string, string | null>([["main", null]]);
	private readonly labels = new Map<string, string>();
	private name: string | undefined;

	get nextSequence(): number {
		return this.sequence + 1;
	}

	requireLane(lane: string): string | null {
		if (!this.lanes.has(lane)) throw new V4SessionStateError(`references missing lane ${lane}`);
		return this.lanes.get(lane)!;
	}

	validateNewLane(lane: string): void {
		if (this.lanes.has(lane)) throw new V4SessionStateError(`contains duplicate lane ${lane}`);
	}

	validateTarget(targetId: string | null): void {
		if (targetId !== null && !this.entriesById.has(targetId)) {
			throw new V4SessionStateError(`references missing target ${targetId}`);
		}
	}

	validateUnusedId(id: string): void {
		if (this.usedIds.has(id)) throw new V4SessionStateError(`contains duplicate id ${id}`);
	}

	apply(mutation: JsonlV4Mutation): void {
		const seq =
			mutation.kind === "entry"
				? mutation.entry.seq
				: mutation.kind === "record"
					? mutation.record.seq
					: mutation.seq;
		if (seq !== this.sequence + 1) throw new V4SessionStateError(`has non-consecutive seq ${seq}`);

		switch (mutation.kind) {
			case "entry": {
				this.validateUnusedId(mutation.entry.id);
				if (mutation.lane !== undefined) {
					const leafId = this.requireLane(mutation.lane);
					if (mutation.entry.parentId !== leafId) {
						throw new V4SessionStateError("does not chain to the lane leaf");
					}
				}
				if (mutation.entry.parentId !== null && !this.entriesById.has(mutation.entry.parentId)) {
					throw new V4SessionStateError(`references missing parent ${mutation.entry.parentId}`);
				}
				this.usedIds.add(mutation.entry.id);
				this.entries.push(mutation.entry);
				this.entriesById.set(mutation.entry.id, mutation.entry);
				if (mutation.lane !== undefined) this.lanes.set(mutation.lane, mutation.entry.id);
				break;
			}
			case "record":
				this.requireLane(mutation.record.lane);
				this.validateUnusedId(mutation.record.id);
				this.usedIds.add(mutation.record.id);
				this.records.push(mutation.record);
				break;
			case "lane":
				this.validateTarget(mutation.leafId);
				this.lanes.set(mutation.lane, mutation.leafId);
				break;
			case "fact":
				if (mutation.fact === "name") {
					this.name = mutation.name;
				} else {
					if (!this.entriesById.has(mutation.targetId)) {
						throw new V4SessionStateError(`references missing label target ${mutation.targetId}`);
					}
					if (mutation.label === undefined) this.labels.delete(mutation.targetId);
					else this.labels.set(mutation.targetId, mutation.label);
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

	getLanes(): Array<{ lane: string; leafId: string | null }> {
		return [...this.lanes].map(([lane, leafId]) => ({ lane, leafId }));
	}

	getName(): string | undefined {
		return this.name;
	}

	getLabel(id: string): string | undefined {
		return this.labels.get(id);
	}

	readBranch(start: string): JsonlV4Entry[] {
		const branch: JsonlV4Entry[] = [];
		let current = this.entriesById.get(start);
		if (!current) throw new V4SessionStateError(`references missing target ${start}`);
		while (current) {
			branch.push(structuredClone(current));
			if (current.parentId === null) break;
			current = this.entriesById.get(current.parentId);
			if (!current) throw new V4SessionStateError("contains a broken parent chain");
		}
		return branch;
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
