import type {
	Session as HarnessSession,
	SessionContext,
	V4HarnessSessionMetadata,
} from "@gsd/pi-agent-core";
import type { Usage } from "@gsd/pi-ai";
import { dirname } from "node:path";
import {
	buildSessionContext as buildLegacyCompatibleSessionContext,
	CURRENT_SESSION_VERSION,
	type ReadonlySessionManager,
	type SessionEntry,
	type SessionHeader,
	type SessionManager,
	type SessionTreeNode,
} from "@gsd/pi-coding-agent/core/session-manager.js";

export type SessionCapabilityFormat = "legacy-v3" | "harness-v4";

export interface SessionCapabilityMetadata {
	format: SessionCapabilityFormat;
	id: string;
	createdAt: string;
	cwd?: string;
	path?: string;
	sessionDir?: string;
	parent?:
		| { kind: "legacy-path"; value: string }
		| { kind: "session-id"; value: string };
}

interface SessionCapabilitySnapshotState {
	metadata: SessionCapabilityMetadata;
	entries: SessionEntry[];
	leafId: string | null;
}

function clone<T>(value: T): T {
	return structuredClone(value);
}

function buildSnapshotTree(entries: SessionEntry[]): SessionTreeNode[] {
	const labels = new Map<string, { label?: string; timestamp: string }>();
	for (const entry of entries) {
		if (entry.type !== "label") continue;
		if (entry.label) labels.set(entry.targetId, { label: entry.label, timestamp: entry.timestamp });
		else labels.delete(entry.targetId);
	}
	const nodes = new Map<string, SessionTreeNode>();
	const roots: SessionTreeNode[] = [];
	for (const entry of entries) {
		const resolved = labels.get(entry.id);
		nodes.set(entry.id, {
			entry: clone(entry),
			children: [],
			...(resolved?.label ? { label: resolved.label } : {}),
			...(resolved ? { labelTimestamp: resolved.timestamp } : {}),
		});
	}
	for (const entry of entries) {
		const node = nodes.get(entry.id)!;
		const parent = entry.parentId && entry.parentId !== entry.id ? nodes.get(entry.parentId) : undefined;
		if (parent) parent.children.push(node);
		else roots.push(node);
	}
	const stack = [...roots];
	while (stack.length > 0) {
		const node = stack.pop()!;
		node.children.sort((left, right) => Date.parse(left.entry.timestamp) - Date.parse(right.entry.timestamp));
		stack.push(...node.children);
	}
	return roots;
}

/**
 * Synchronous, read-only compatibility view for UI and extension APIs.
 *
 * The snapshot is replaced atomically only after the selected capability
 * adapter has settled. It is never a persistence authority and exposes no
 * mutation methods.
 */
export class SessionCapabilityReadSnapshot implements ReadonlySessionManager {
	private constructor(private state: SessionCapabilitySnapshotState) {}

	static fromLegacy(manager: SessionManager): SessionCapabilityReadSnapshot {
		const metadata = legacyMetadata(manager);
		return new SessionCapabilityReadSnapshot({
			metadata,
			entries: clone(manager.getEntries()),
			leafId: manager.getLeafId(),
		});
	}

	refreshLegacy(manager: SessionManager): void {
		this.state = {
			metadata: legacyMetadata(manager),
			entries: clone(manager.getEntries()),
			leafId: manager.getLeafId(),
		};
	}

	static async create(adapter: SessionCapabilityAdapter): Promise<SessionCapabilityReadSnapshot> {
		const snapshot = new SessionCapabilityReadSnapshot({
			metadata: await adapter.getMetadata(),
			entries: [],
			leafId: null,
		});
		await snapshot.refresh(adapter);
		return snapshot;
	}

	async refresh(adapter: SessionCapabilityAdapter): Promise<void> {
		const metadata = await adapter.getMetadata();
		const entries = await adapter.getEntries();
		const leafId = await adapter.getLeafId();
		if (leafId !== null && !entries.some((entry) => entry.id === leafId)) {
			throw new Error(`Session capability snapshot leaf ${leafId} is not present in the entry projection`);
		}
		this.state = { metadata: clone(metadata), entries: clone(entries), leafId };
	}

	applyAppendedEntry(entry: SessionEntry, leafId: string | null): void {
		const entries = this.state.entries.filter((candidate) => candidate.id !== entry.id);
		entries.push(clone(entry));
		this.state = { ...this.state, entries, leafId };
	}

	getCwd(): string {
		return this.state.metadata.cwd ?? process.cwd();
	}

	getSessionDir(): string {
		return this.state.metadata.sessionDir ?? (this.state.metadata.path ? dirname(this.state.metadata.path) : this.getCwd());
	}

	getSessionId(): string {
		return this.state.metadata.id;
	}

	getSessionFile(): string | undefined {
		return this.state.metadata.path;
	}

	getLeafId(): string | null {
		return this.state.leafId;
	}

	getLeafEntry(): SessionEntry | undefined {
		return this.state.leafId ? this.getEntry(this.state.leafId) : undefined;
	}

	getEntry(id: string): SessionEntry | undefined {
		const entry = this.state.entries.find((candidate) => candidate.id === id);
		return entry ? clone(entry) : undefined;
	}

	getLabel(id: string): string | undefined {
		let label: string | undefined;
		for (const entry of this.state.entries) {
			if (entry.type === "label" && entry.targetId === id) label = entry.label || undefined;
		}
		return label;
	}

	getBranch(fromId?: string): SessionEntry[] {
		const byId = new Map(this.state.entries.map((entry) => [entry.id, entry]));
		const branch: SessionEntry[] = [];
		let current = byId.get(fromId ?? this.state.leafId ?? "");
		while (current) {
			branch.unshift(clone(current));
			current = current.parentId ? byId.get(current.parentId) : undefined;
		}
		return branch;
	}

	getHeader(): SessionHeader {
		const { metadata } = this.state;
		return {
			type: "session",
			version: metadata.format === "harness-v4" ? 4 : CURRENT_SESSION_VERSION,
			id: metadata.id,
			timestamp: metadata.createdAt,
			cwd: this.getCwd(),
			...(metadata.parent?.kind === "legacy-path" ? { parentSession: metadata.parent.value } : {}),
		};
	}

	getEntries(): SessionEntry[] {
		return clone(this.state.entries);
	}

	getTree(): SessionTreeNode[] {
		return buildSnapshotTree(this.state.entries);
	}

	getSessionName(): string | undefined {
		for (let index = this.state.entries.length - 1; index >= 0; index--) {
			const entry = this.state.entries[index];
			if (entry.type === "session_info") return entry.name?.trim() || undefined;
		}
		return undefined;
	}

	buildSessionContext(): SessionContext {
		const entries = this.getEntries();
		return buildLegacyCompatibleSessionContext(entries, this.state.leafId, new Map(entries.map((entry) => [entry.id, entry])));
	}

	getUsageTotals(): { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number } {
		const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
		for (const entry of this.state.entries) {
			if (entry.type !== "message" || entry.message.role !== "assistant") continue;
			const usage = entry.message.usage;
			totals.input += usage?.input ?? 0;
			totals.output += usage?.output ?? 0;
			totals.cacheRead += usage?.cacheRead ?? 0;
			totals.cacheWrite += usage?.cacheWrite ?? 0;
			totals.cost += usage?.cost?.total ?? 0;
		}
		return totals;
	}

	wasInterrupted(): boolean {
		return false;
	}
}

/** Capability decorator that refreshes the synchronous read view after every mutation. */
export class SnapshottingSessionCapabilityAdapter implements SessionCapabilityAdapter {
	readonly format: SessionCapabilityFormat;

	constructor(
		private readonly adapter: SessionCapabilityAdapter,
		private readonly snapshot: SessionCapabilityReadSnapshot,
	) {
		this.format = adapter.format;
	}

	getMetadata() { return this.adapter.getMetadata(); }
	getLeafId() { return this.adapter.getLeafId(); }
	getEntry(id: string) { return this.adapter.getEntry(id); }
	getEntries() { return this.adapter.getEntries(); }
	getBranch(fromId?: string) { return this.adapter.getBranch(fromId); }
	buildSessionContext() { return this.adapter.buildSessionContext(); }
	getLabel(id: string) { return this.adapter.getLabel(id); }
	getSessionName() { return this.adapter.getSessionName(); }

	private async mutate<T>(mutation: () => Promise<T>): Promise<T> {
		const result = await mutation();
		await this.snapshot.refresh(this.adapter);
		return result;
	}

	private async append(mutation: () => Promise<string>): Promise<string> {
		const id = await mutation();
		const [entry, leafId] = await Promise.all([this.adapter.getEntry(id), this.adapter.getLeafId()]);
		if (entry) this.snapshot.applyAppendedEntry(entry, leafId);
		else await this.snapshot.refresh(this.adapter);
		return id;
	}

	appendMessage(message: PersistableSessionMessage) { return this.append(() => this.adapter.appendMessage(message)); }
	appendThinkingLevelChange(thinkingLevel: string) { return this.append(() => this.adapter.appendThinkingLevelChange(thinkingLevel)); }
	appendModelChange(provider: string, modelId: string) { return this.append(() => this.adapter.appendModelChange(provider, modelId)); }
	appendCompaction<T = unknown>(summary: string, firstKeptEntryId: string, tokensBefore: number, details?: T, fromHook?: boolean, usage?: Usage) {
		return this.append(() => this.adapter.appendCompaction(summary, firstKeptEntryId, tokensBefore, details, fromHook, usage));
	}
	appendCustomEntry(customType: string, data?: unknown) { return this.append(() => this.adapter.appendCustomEntry(customType, data)); }
	appendCustomMessageEntry<T = unknown>(customType: string, content: Parameters<HarnessSession["appendCustomMessageEntry"]>[1], display: boolean, details?: T) {
		return this.append(() => this.adapter.appendCustomMessageEntry(customType, content, display, details));
	}
	appendLabel(targetId: string, label: string | undefined) { return this.mutate(() => this.adapter.appendLabel(targetId, label)); }
	appendSessionName(name: string) { return this.mutate(() => this.adapter.appendSessionName(name)); }
	moveTo(entryId: string | null, summary?: SessionMoveSummary) { return this.mutate(() => this.adapter.moveTo(entryId, summary)); }
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

export type SessionCapabilityMutation = (adapter: SessionCapabilityAdapter) => Promise<unknown>;

/**
 * Bridges legacy synchronous extension callbacks to the awaitable session
 * contract. Legacy mutations begin immediately to preserve established read-
 * after-write behavior. Harness-v4 mutations are serialized because their
 * parent/leaf checks are asynchronous. Every queued failure is retained until
 * an enclosing runtime boundary drains and surfaces it.
 */
export class SessionCapabilityMutationDrain {
	private tail: Promise<void> = Promise.resolve();
	private firstFailure: unknown;

	constructor(private readonly adapter: SessionCapabilityAdapter) {}

	enqueue(mutation: SessionCapabilityMutation): void {
		const recordFailure = (error: unknown): void => {
			if (this.firstFailure === undefined) this.firstFailure = error;
		};

		if (this.adapter.format === "legacy-v3") {
			let pending: Promise<unknown>;
			try {
				pending = mutation(this.adapter);
			} catch (error) {
				recordFailure(error);
				return;
			}
			this.tail = Promise.all([this.tail, pending.catch(recordFailure)]).then(() => undefined);
			return;
		}

		this.tail = this.tail.then(async () => {
			try {
				await mutation(this.adapter);
			} catch (error) {
				recordFailure(error);
			}
		});
	}

	async drain(): Promise<void> {
		while (true) {
			const observed = this.tail;
			await observed;
			if (observed === this.tail) break;
		}
		if (this.firstFailure !== undefined) {
			const failure = this.firstFailure;
			this.firstFailure = undefined;
			throw failure;
		}
	}
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
		sessionDir: manager.getSessionDir(),
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
