import type {
	Session as HarnessSession,
	SessionContext,
	V4HarnessSessionMetadata,
} from "@gsd/pi-agent-core";
import type { Usage } from "@gsd/pi-ai";
import type { SessionEntry, SessionManager } from "@gsd/pi-coding-agent/core/session-manager.js";

export type SessionCapabilityFormat = "legacy-v3" | "harness-v4";

export interface SessionCapabilityMetadata {
	format: SessionCapabilityFormat;
	id: string;
	createdAt: string;
	cwd?: string;
	path?: string;
	parent?:
		| { kind: "legacy-path"; value: string }
		| { kind: "session-id"; value: string };
}

export interface SessionMoveSummary {
	summary: string;
	details?: unknown;
	fromHook?: boolean;
	usage?: Usage;
}

type PersistableSessionMessage = Parameters<SessionManager["appendMessage"]>[0];

/**
 * Version-neutral session capabilities required by the production agent.
 *
 * Every operation is awaitable even when the legacy implementation completes
 * synchronously. Implementations delegate durability to an existing backend;
 * this boundary must never maintain a second write log or fire-and-forget a
 * mutation.
 */
export interface SessionCapabilityAdapter {
	readonly format: SessionCapabilityFormat;
	getMetadata(): Promise<SessionCapabilityMetadata>;
	getLeafId(): Promise<string | null>;
	getEntry(id: string): Promise<SessionEntry | undefined>;
	getEntries(): Promise<SessionEntry[]>;
	getBranch(fromId?: string): Promise<SessionEntry[]>;
	buildSessionContext(): Promise<SessionContext>;
	getLabel(id: string): Promise<string | undefined>;
	getSessionName(): Promise<string | undefined>;
	appendMessage(message: PersistableSessionMessage): Promise<string>;
	appendThinkingLevelChange(thinkingLevel: string): Promise<string>;
	appendModelChange(provider: string, modelId: string): Promise<string>;
	appendCompaction<T = unknown>(
		summary: string,
		firstKeptEntryId: string,
		tokensBefore: number,
		details?: T,
		fromHook?: boolean,
		usage?: Usage,
	): Promise<string>;
	appendCustomEntry(customType: string, data?: unknown): Promise<string>;
	appendCustomMessageEntry<T = unknown>(
		customType: string,
		content: Parameters<HarnessSession["appendCustomMessageEntry"]>[1],
		display: boolean,
		details?: T,
	): Promise<string>;
	appendLabel(targetId: string, label: string | undefined): Promise<void>;
	appendSessionName(name: string): Promise<void>;
	moveTo(entryId: string | null, summary?: SessionMoveSummary): Promise<string | undefined>;
}

function legacyMetadata(manager: SessionManager): SessionCapabilityMetadata {
	const header = manager.getHeader();
	if (!header) throw new Error("Legacy-v3 capability adapter requires a session header");
	const path = manager.getSessionFile();
	return {
		format: "legacy-v3",
		id: manager.getSessionId(),
		createdAt: header.timestamp,
		cwd: manager.getCwd(),
		...(path ? { path } : {}),
		...(header.parentSession
			? { parent: { kind: "legacy-path" as const, value: header.parentSession } }
			: {}),
	};
}

export class LegacyV3SessionCapabilityAdapter implements SessionCapabilityAdapter {
	readonly format = "legacy-v3" as const;

	constructor(private readonly manager: SessionManager) {}

	async getMetadata(): Promise<SessionCapabilityMetadata> {
		return legacyMetadata(this.manager);
	}

	async getLeafId(): Promise<string | null> {
		return this.manager.getLeafId();
	}

	async getEntry(id: string): Promise<SessionEntry | undefined> {
		return this.manager.getEntry(id);
	}

	async getEntries(): Promise<SessionEntry[]> {
		return this.manager.getEntries();
	}

	async getBranch(fromId?: string): Promise<SessionEntry[]> {
		return this.manager.getBranch(fromId);
	}

	async buildSessionContext(): Promise<SessionContext> {
		return this.manager.buildSessionContext();
	}

	async getLabel(id: string): Promise<string | undefined> {
		return this.manager.getLabel(id);
	}

	async getSessionName(): Promise<string | undefined> {
		return this.manager.getSessionName();
	}

	async appendMessage(message: PersistableSessionMessage): Promise<string> {
		return this.manager.appendMessage(message);
	}

	async appendThinkingLevelChange(thinkingLevel: string): Promise<string> {
		return this.manager.appendThinkingLevelChange(thinkingLevel);
	}

	async appendModelChange(provider: string, modelId: string): Promise<string> {
		return this.manager.appendModelChange(provider, modelId);
	}

	async appendCompaction<T = unknown>(
		summary: string,
		firstKeptEntryId: string,
		tokensBefore: number,
		details?: T,
		fromHook?: boolean,
		usage?: Usage,
	): Promise<string> {
		return this.manager.appendCompaction(summary, firstKeptEntryId, tokensBefore, details, fromHook, usage);
	}

	async appendCustomEntry(customType: string, data?: unknown): Promise<string> {
		return this.manager.appendCustomEntry(customType, data);
	}

	async appendCustomMessageEntry<T = unknown>(
		customType: string,
		content: Parameters<HarnessSession["appendCustomMessageEntry"]>[1],
		display: boolean,
		details?: T,
	): Promise<string> {
		return this.manager.appendCustomMessageEntry(customType, content, display, details);
	}

	async appendLabel(targetId: string, label: string | undefined): Promise<void> {
		this.manager.appendLabelChange(targetId, label);
	}

	async appendSessionName(name: string): Promise<void> {
		this.manager.appendSessionInfo(name);
	}

	async moveTo(entryId: string | null, summary?: SessionMoveSummary): Promise<string | undefined> {
		if (summary) {
			return this.manager.branchWithSummary(
				entryId,
				summary.summary,
				summary.details,
				summary.fromHook,
				summary.usage,
			);
		}
		if (entryId === null) this.manager.resetLeaf();
		else this.manager.branch(entryId);
		return undefined;
	}
}

class HarnessV4SessionCapabilityAdapter implements SessionCapabilityAdapter {
	readonly format = "harness-v4" as const;

	constructor(
		private readonly session: HarnessSession<V4HarnessSessionMetadata>,
		private readonly metadata: SessionCapabilityMetadata,
	) {}

	async getMetadata(): Promise<SessionCapabilityMetadata> {
		return structuredClone(this.metadata);
	}

	getLeafId(): Promise<string | null> {
		return this.session.getLeafId();
	}

	async getEntry(id: string): Promise<SessionEntry | undefined> {
		const entry = await this.session.getEntry(id);
		return entry?.type === "leaf" ? undefined : (entry as SessionEntry | undefined);
	}

	async getEntries(): Promise<SessionEntry[]> {
		return (await this.session.getEntries()).filter(
			(entry): entry is SessionEntry => entry.type !== "leaf",
		);
	}

	async getBranch(fromId?: string): Promise<SessionEntry[]> {
		return (await this.session.getBranch(fromId)).filter(
			(entry): entry is SessionEntry => entry.type !== "leaf",
		);
	}

	buildSessionContext(): Promise<SessionContext> {
		return this.session.buildContext();
	}

	getLabel(id: string): Promise<string | undefined> {
		return this.session.getLabel(id);
	}

	getSessionName(): Promise<string | undefined> {
		return this.session.getSessionName();
	}

	appendMessage(message: PersistableSessionMessage): Promise<string> {
		return this.session.appendMessage(message);
	}

	appendThinkingLevelChange(thinkingLevel: string): Promise<string> {
		return this.session.appendThinkingLevelChange(thinkingLevel);
	}

	appendModelChange(provider: string, modelId: string): Promise<string> {
		return this.session.appendModelChange(provider, modelId);
	}

	appendCompaction<T = unknown>(
		summary: string,
		firstKeptEntryId: string,
		tokensBefore: number,
		details?: T,
		fromHook?: boolean,
		usage?: Usage,
	): Promise<string> {
		return this.session.appendCompaction(summary, firstKeptEntryId, tokensBefore, details, fromHook, usage);
	}

	appendCustomEntry(customType: string, data?: unknown): Promise<string> {
		return this.session.appendCustomEntry(customType, data);
	}

	appendCustomMessageEntry<T = unknown>(
		customType: string,
		content: Parameters<HarnessSession["appendCustomMessageEntry"]>[1],
		display: boolean,
		details?: T,
	): Promise<string> {
		return this.session.appendCustomMessageEntry(customType, content, display, details);
	}

	async appendLabel(targetId: string, label: string | undefined): Promise<void> {
		await this.session.appendLabel(targetId, label);
	}

	async appendSessionName(name: string): Promise<void> {
		await this.session.appendSessionName(name);
	}

	moveTo(entryId: string | null, summary?: SessionMoveSummary): Promise<string | undefined> {
		return this.session.moveTo(entryId, summary);
	}
}

export async function createHarnessV4SessionCapabilityAdapter(
	session: HarnessSession<V4HarnessSessionMetadata>,
): Promise<SessionCapabilityAdapter> {
	const metadata = await session.getMetadata();
	if (!("format" in metadata) || metadata.format !== "harness-v4") {
		throw new Error("Harness-v4 capability adapter requires harness-v4 session metadata");
	}
	return new HarnessV4SessionCapabilityAdapter(session, {
		format: "harness-v4",
		id: metadata.id,
		createdAt: metadata.createdAt,
		...(typeof metadata.cwd === "string" ? { cwd: metadata.cwd } : {}),
		...(typeof metadata.path === "string" ? { path: metadata.path } : {}),
		...(typeof metadata.parentSessionId === "string"
			? { parent: { kind: "session-id" as const, value: metadata.parentSessionId } }
			: {}),
	});
}
