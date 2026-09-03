import type { Usage } from "@gsd/pi-ai";
import type { AgentMessage } from "../../types.js";
import type {
	CustomMessageEntry,
	JsonlSessionMetadata,
	LabelEntry,
	LeafEntry,
	SessionInfoEntry,
	SessionMetadata,
	SessionStorage,
	SessionTreeEntry,
} from "../types.js";
import { SessionError } from "../types.js";
import type { JsonlV4Entry } from "./jsonl-v4-codec.js";
import type { V4ProvisionedEntry } from "./session-v4-memory.js";
import type { V4SessionLogItem } from "./session-v4-state.js";
import { buildSessionContext } from "./session.js";
import { uuidv7 } from "./uuid.js";

type Awaitable<T> = T | Promise<T>;

/** The common subset implemented by the isolated memory and JSONL v4 stores. */
export interface V4HarnessStorageBackend {
	getMetadata(): Awaitable<{ id: string; createdAt: number; cwd?: string; path?: string; parentSessionId?: string }>;
	getLanes(): Awaitable<Array<{ lane: string; leafId: string | null }>>;
	moveLane(lane: string, to: string | null): Awaitable<void>;
	appendEntry(entry: V4ProvisionedEntry, lane?: string): Awaitable<JsonlV4Entry>;
	getEntry(id: string): Awaitable<JsonlV4Entry | undefined>;
	readBranch(start: string): Awaitable<JsonlV4Entry[]>;
	getLog(options?: { afterSeq?: number; limit?: number }): Awaitable<V4SessionLogItem[]>;
	getName(): Awaitable<string | undefined>;
	setName(name: string | undefined): Awaitable<void>;
	getLabel(id: string): Awaitable<string | undefined>;
	setLabel(id: string, label: string | undefined): Awaitable<void>;
}

export interface V4HarnessSessionMetadata extends SessionMetadata {
	format: "harness-v4";
	storageCreatedAt: number;
	cwd?: string;
	path?: string;
	parentSessionId?: string;
}

const CUSTOM_MESSAGE_TYPE = "pi.session.custom-message/v1";
const ACTIVE_TOOLS_TYPE = "pi.session.active-tools/v1";

function invalidEntry(message: string): never {
	throw new SessionError("invalid_entry", `Invalid harness-v4 entry: ${message}`);
}

function requiredString(entry: JsonlV4Entry, key: string): string {
	const value = entry[key];
	if (typeof value !== "string") invalidEntry(`${entry.id} has invalid ${key}`);
	return value;
}

function isoTimestamp(timestamp: number): string {
	const value = new Date(timestamp);
	if (!Number.isFinite(timestamp) || Number.isNaN(value.valueOf())) invalidEntry("has invalid timestamp");
	return value.toISOString();
}

function common(entry: JsonlV4Entry): Pick<SessionTreeEntry, "id" | "parentId" | "timestamp"> {
	return { id: entry.id, parentId: entry.parentId, timestamp: isoTimestamp(entry.timestamp) };
}

function decodeCustomMessage(entry: JsonlV4Entry): CustomMessageEntry {
	const data = entry.data;
	if (typeof data !== "object" || data === null || Array.isArray(data)) {
		invalidEntry(`${entry.id} has invalid custom-message data`);
	}
	const record = data as Record<string, unknown>;
	if (typeof record.customType !== "string" || typeof record.display !== "boolean") {
		invalidEntry(`${entry.id} has invalid custom-message fields`);
	}
	if (typeof record.content !== "string" && !Array.isArray(record.content)) {
		invalidEntry(`${entry.id} has invalid custom-message content`);
	}
	return {
		type: "custom_message",
		...common(entry),
		customType: record.customType,
		content: record.content as CustomMessageEntry["content"],
		display: record.display,
		...(record.details === undefined ? {} : { details: record.details }),
	};
}

function toLegacyEntry(entry: JsonlV4Entry): SessionTreeEntry {
	const base = common(entry);
	switch (entry.type) {
		case "message":
			if (typeof entry.message !== "object" || entry.message === null) {
				invalidEntry(`${entry.id} has invalid message`);
			}
			return { type: "message", ...base, message: entry.message as AgentMessage };
		case "model_change":
			return {
				type: "model_change",
				...base,
				provider: requiredString(entry, "provider"),
				modelId: requiredString(entry, "modelId"),
			};
		case "thinking_level_change":
			return { type: "thinking_level_change", ...base, thinkingLevel: requiredString(entry, "thinkingLevel") };
		case "compaction":
			return {
				type: "compaction",
				...base,
				summary: requiredString(entry, "summary"),
				firstKeptEntryId:
					typeof entry.firstKeptEntryId === "string" ? entry.firstKeptEntryId : entry.id,
				tokensBefore: typeof entry.tokensBefore === "number" ? entry.tokensBefore : 0,
				...(entry.details === undefined ? {} : { details: entry.details }),
				...(entry.usage === undefined ? {} : { usage: entry.usage as Usage }),
				...(entry.fromHook === true ? { fromHook: true } : {}),
			};
		case "branch_summary":
			return {
				type: "branch_summary",
				...base,
				fromId: requiredString(entry, "fromId"),
				summary: requiredString(entry, "summary"),
				...(entry.details === undefined ? {} : { details: entry.details }),
				...(entry.usage === undefined ? {} : { usage: entry.usage as Usage }),
				...(entry.fromHook === true ? { fromHook: true } : {}),
			};
		case "custom":
			if (entry.customType === CUSTOM_MESSAGE_TYPE) return decodeCustomMessage(entry);
			return {
				type: "custom",
				...base,
				customType: requiredString(entry, "customType"),
				...(entry.data === undefined ? {} : { data: entry.data }),
			};
		case "active_tools_change":
			return {
				type: "custom",
				...base,
				customType: ACTIVE_TOOLS_TYPE,
				data: { activeToolNames: entry.activeToolNames },
			};
	}
}

function syntheticTimestamp(): string {
	return new Date(0).toISOString();
}

function normalizeLegacyJson<T>(value: T): T {
	if (Array.isArray(value)) {
		return value.map((item) => (item === undefined ? null : normalizeLegacyJson(item))) as T;
	}
	if (typeof value !== "object" || value === null) return value;
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) return value;
	return Object.fromEntries(
		Object.entries(value)
			.filter(([, child]) => child !== undefined)
			.map(([key, child]) => [key, normalizeLegacyJson(child)]),
	) as T;
}

/**
 * Transitional adapter that lets the working downstream AgentHarness execute
 * against either isolated v4 backend. It does not select v4 at runtime and it
 * never rewrites a legacy-v3 file.
 */
export class V4HarnessSessionStorageAdapter implements SessionStorage<V4HarnessSessionMetadata> {
	constructor(private readonly backend: V4HarnessStorageBackend) {}

	private async appendV4(entry: V4ProvisionedEntry): Promise<JsonlV4Entry> {
		return this.backend.appendEntry(normalizeLegacyJson(entry));
	}

	private async retainedTail(firstKeptEntryId: string): Promise<AgentMessage[]> {
		const leafId = await this.getLeafId();
		if (leafId === null) return [];
		const branch = (await this.backend.readBranch(leafId)).reverse().map(toLegacyEntry);
		const firstKeptIndex = branch.findIndex(({ id }) => id === firstKeptEntryId);
		if (firstKeptIndex < 0) {
			throw new SessionError("invalid_entry", `Compaction retained-tail target ${firstKeptEntryId} is not on main`);
		}
		return normalizeLegacyJson(buildSessionContext(branch.slice(firstKeptIndex)).messages);
	}

	async getMetadata(): Promise<V4HarnessSessionMetadata> {
		const metadata = await this.backend.getMetadata();
		return {
			id: metadata.id,
			createdAt: new Date(metadata.createdAt).toISOString(),
			format: "harness-v4",
			storageCreatedAt: metadata.createdAt,
			...(metadata.cwd === undefined ? {} : { cwd: metadata.cwd }),
			...(metadata.path === undefined ? {} : { path: metadata.path }),
			...(metadata.parentSessionId === undefined ? {} : { parentSessionId: metadata.parentSessionId }),
		};
	}

	async getLeafId(): Promise<string | null> {
		const main = (await this.backend.getLanes()).find(({ lane }) => lane === "main");
		if (!main) throw new SessionError("invalid_session", "Harness-v4 session has no main lane");
		return main.leafId;
	}

	async setLeafId(leafId: string | null): Promise<void> {
		await this.backend.moveLane("main", leafId);
	}

	async createEntryId(): Promise<string> {
		for (let attempt = 0; attempt < 100; attempt++) {
			const id = uuidv7().slice(0, 8);
			if (!(await this.backend.getEntry(id))) return id;
		}
		return uuidv7();
	}

	async appendEntry(entry: SessionTreeEntry): Promise<void> {
		const currentLeaf = await this.getLeafId();
		if (entry.parentId !== currentLeaf) {
			throw new SessionError(
				"invalid_entry",
				`Harness-v4 append parent ${entry.parentId ?? "null"} does not match main leaf ${currentLeaf ?? "null"}`,
			);
		}
		switch (entry.type) {
			case "leaf":
				await this.setLeafId(entry.targetId);
				return;
			case "label":
				// Legacy-v3 preserves non-empty label text verbatim. Only an empty
				// string clears the label, so the v4 compatibility projection must
				// not introduce trimming that changes established session behavior.
				await this.backend.setLabel(entry.targetId, entry.label || undefined);
				return;
			case "session_info":
				await this.backend.setName(entry.name?.trim() || undefined);
				return;
			case "custom_message":
				await this.appendV4({
					type: "custom",
					id: entry.id,
					customType: CUSTOM_MESSAGE_TYPE,
					data: {
						customType: entry.customType,
						content: entry.content,
						display: entry.display,
						...(entry.details === undefined ? {} : { details: entry.details }),
					},
				});
				return;
			case "message":
				// Legacy-v3 JSON.stringify omitted optional undefined properties. The
				// v4 stores reject them deliberately, so normalize only at this
				// compatibility boundary before the strict durability validator runs.
				await this.appendV4({
					type: "message",
					id: entry.id,
					message: normalizeLegacyJson(entry.message),
				});
				return;
			case "model_change":
				await this.appendV4({
					type: "model_change",
					id: entry.id,
					provider: entry.provider,
					modelId: entry.modelId,
				});
				return;
			case "thinking_level_change":
				await this.appendV4({
					type: "thinking_level_change",
					id: entry.id,
					thinkingLevel: entry.thinkingLevel,
				});
				return;
			case "compaction":
				await this.appendV4({
					type: "compaction",
					id: entry.id,
					summary: entry.summary,
					firstKeptEntryId: entry.firstKeptEntryId,
					retainedTail: await this.retainedTail(entry.firstKeptEntryId),
					tokensBefore: entry.tokensBefore,
					...(entry.details === undefined ? {} : { details: entry.details }),
					...(entry.usage === undefined ? {} : { usage: entry.usage }),
					...(entry.fromHook === true ? { fromHook: true } : {}),
				});
				return;
			case "branch_summary":
				await this.appendV4({
					type: "branch_summary",
					id: entry.id,
					fromId: entry.fromId,
					summary: entry.summary,
					...(entry.details === undefined ? {} : { details: entry.details }),
					...(entry.usage === undefined ? {} : { usage: entry.usage }),
					...(entry.fromHook === true ? { fromHook: true } : {}),
				});
				return;
			case "custom":
				if (entry.customType === CUSTOM_MESSAGE_TYPE || entry.customType === ACTIVE_TOOLS_TYPE) {
					throw new SessionError("invalid_entry", `Custom type ${entry.customType} is reserved by the v4 adapter`);
				}
				await this.appendV4({
					type: "custom",
					id: entry.id,
					customType: entry.customType,
					...(entry.data === undefined ? {} : { data: entry.data }),
				});
				return;
		}
	}

	async getEntry(id: string): Promise<SessionTreeEntry | undefined> {
		const entry = await this.backend.getEntry(id);
		if (entry) return toLegacyEntry(entry);
		return (await this.getEntries()).find((candidate) => candidate.id === id);
	}

	async findEntries<TType extends SessionTreeEntry["type"]>(
		type: TType,
	): Promise<Array<Extract<SessionTreeEntry, { type: TType }>>> {
		return (await this.getEntries()).filter(
			(entry): entry is Extract<SessionTreeEntry, { type: TType }> => entry.type === type,
		);
	}

	getLabel(id: string): Promise<string | undefined> {
		return Promise.resolve(this.backend.getLabel(id));
	}

	async getPathToRoot(leafId: string | null): Promise<SessionTreeEntry[]> {
		if (leafId === null) return [];
		return (await this.backend.readBranch(leafId)).reverse().map(toLegacyEntry);
	}

	async getEntries(): Promise<SessionTreeEntry[]> {
		const entries: SessionTreeEntry[] = [];
		let mainLeaf: string | null = null;
		for (const item of await this.backend.getLog()) {
			if (item.kind === "entry") {
				entries.push(toLegacyEntry(item.entry));
				mainLeaf = item.entry.id;
			} else if (item.kind === "lane" && item.lane === "main") {
				entries.push({
					type: "leaf",
					id: `v4-main-lane-${item.seq}`,
					parentId: mainLeaf,
					timestamp: syntheticTimestamp(),
					targetId: item.leafId,
				} satisfies LeafEntry);
				mainLeaf = item.leafId;
			} else if (item.kind === "fact" && item.fact === "name") {
				entries.push({
					type: "session_info",
					id: `v4-name-${item.seq}`,
					parentId: null,
					timestamp: syntheticTimestamp(),
					...(item.name === undefined ? {} : { name: item.name }),
				} satisfies SessionInfoEntry);
			} else if (item.kind === "fact" && item.fact === "label") {
				entries.push({
					type: "label",
					id: `v4-label-${item.seq}`,
					parentId: null,
					timestamp: syntheticTimestamp(),
					targetId: item.targetId,
					label: item.label,
				} satisfies LabelEntry);
			}
		}
		return entries;
	}
}

/** Convenience metadata shape for callers adapting a JSONL v4 session. */
export type JsonlV4HarnessSessionMetadata = V4HarnessSessionMetadata &
	Pick<JsonlSessionMetadata, "cwd" | "path">;
