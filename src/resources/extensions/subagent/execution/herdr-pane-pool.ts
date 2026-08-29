import { createHash, randomUUID } from "node:crypto";

import type { HerdrEnvironment, HerdrResponse } from "../../herdr/client.js";

const DEFAULT_MAX_PANES = 4;

export type HerdrWorkerSlotState = "idle" | "busy" | "retained-success" | "retained-failure";
export type HerdrWorkerReleaseOutcome = "completed" | "aborted" | "failed";

export interface HerdrPanePoolClient {
	getEnvironment(): HerdrEnvironment;
	request(method: string, params?: Record<string, unknown>): Promise<HerdrResponse | null>;
}

export interface HerdrWorkerPanePoolOptions {
	rootSessionId: string;
	cwd: string;
	maxPanes?: number;
	tabLabelPrefix?: string;
	paneEnv?: Readonly<Record<string, string>>;
}

export interface HerdrWorkerPaneSlotSnapshot {
	index: number;
	paneId: string;
	state: HerdrWorkerSlotState;
	affinityKey?: string;
}

export interface HerdrWorkerPanePoolSnapshot {
	workspaceId?: string;
	tabId?: string;
	tabLabel: string;
	slots: HerdrWorkerPaneSlotSnapshot[];
	waiting: number;
}

export interface HerdrPaneReservationRequest {
	affinityKey?: string;
}

export interface HerdrPaneReservation {
	paneId: string;
	slotIndex: number;
	tabId: string;
	workspaceId: string;
	affinityKey?: string;
	release(outcome: HerdrWorkerReleaseOutcome): void;
}

interface MutableSlot {
	index: number;
	paneId: string;
	state: HerdrWorkerSlotState;
	leaseId?: string;
	affinityKey?: string;
	retainedAt?: number;
}

interface Waiter {
	request: HerdrPaneReservationRequest;
	resolve(value: HerdrPaneReservation): void;
	reject(error: Error): void;
}

export class HerdrWorkerPanePool {
	private readonly client: HerdrPanePoolClient;
	private readonly rootSessionId: string;
	private readonly cwd: string;
	private readonly maxPanes: number;
	private readonly tabLabel: string;
	private readonly paneEnv: Readonly<Record<string, string>>;
	private workspaceId: string | undefined;
	private tabId: string | undefined;
	private slots: MutableSlot[] = [];
	private waiters: Waiter[] = [];
	private mutationQueue: Promise<void> = Promise.resolve();

	constructor(client: HerdrPanePoolClient, options: HerdrWorkerPanePoolOptions) {
		this.client = client;
		this.rootSessionId = requireNonEmpty(options.rootSessionId, "rootSessionId");
		this.cwd = requireNonEmpty(options.cwd, "cwd");
		this.maxPanes = normalizeMaxPanes(options.maxPanes ?? DEFAULT_MAX_PANES);
		this.paneEnv = { ...(options.paneEnv ?? {}) };
		const prefix = options.tabLabelPrefix?.trim() || "GSD Workers";
		this.tabLabel = `${prefix} · ${rootSessionHash(this.rootSessionId)}`;
	}

	reserve(request: HerdrPaneReservationRequest = {}): Promise<HerdrPaneReservation> {
		return new Promise((resolve, reject) => {
			this.waiters.push({ request, resolve, reject });
			this.scheduleDrain();
		});
	}

	clearRetained(paneId?: string): void {
		for (const slot of this.slots) {
			if (paneId && slot.paneId !== paneId) continue;
			if (slot.state === "retained-success" || slot.state === "retained-failure") {
				slot.state = "idle";
				slot.retainedAt = undefined;
			}
		}
		this.scheduleDrain();
	}

	getSnapshot(): HerdrWorkerPanePoolSnapshot {
		return {
			workspaceId: this.workspaceId,
			tabId: this.tabId,
			tabLabel: this.tabLabel,
			slots: this.slots.map(({ index, paneId, state, affinityKey }) => ({
				index,
				paneId,
				state,
				...(affinityKey ? { affinityKey } : {}),
			})),
			waiting: this.waiters.length,
		};
	}

	private scheduleDrain(): void {
		this.mutationQueue = this.mutationQueue
			.then(() => this.drain())
			.catch((error) => this.failAllWaiters(error));
	}

	private async drain(): Promise<void> {
		if (this.waiters.length === 0) return;
		await this.ensureTab();

		while (this.waiters.length > 0) {
			let slot = this.pickImmediatelyReusableSlot(this.waiters[0].request);
			if (!slot && this.slots.length < this.maxPanes) {
				const activeDemand = this.slots.filter((item) => item.state === "busy").length + this.waiters.length;
				await this.ensureCapacity(Math.min(this.maxPanes, Math.max(1, activeDemand)));
				slot = this.pickImmediatelyReusableSlot(this.waiters[0].request);
			}
			if (!slot) slot = this.pickReclaimableSuccess(this.waiters[0].request);
			if (!slot) {
				const busy = this.slots.some((item) => item.state === "busy");
				const allCapacityRetainedFailure = this.slots.length >= this.maxPanes
					&& this.slots.every((item) => item.state === "retained-failure");
				if (!busy && allCapacityRetainedFailure) {
					const waiter = this.waiters.shift()!;
					waiter.reject(new Error("All Herdr worker panes are retained after failures; cleanup/reconciliation is required before another launch"));
					continue;
				}
				return;
			}

			const waiter = this.waiters.shift()!;
			const leaseId = randomUUID();
			slot.state = "busy";
			slot.leaseId = leaseId;
			slot.retainedAt = undefined;
			if (waiter.request.affinityKey) slot.affinityKey = waiter.request.affinityKey;
			waiter.resolve(this.createReservation(slot, leaseId));
		}
	}

	private async ensureTab(): Promise<void> {
		if (this.tabId && this.slots.length > 0) return;
		const environment = this.client.getEnvironment();
		if (!environment.available || !environment.workspaceId) {
			throw new Error("Herdr worker pool requires a managed root pane with workspace identity");
		}
		this.workspaceId = environment.workspaceId;

		const tabs = await this.listTabs(environment.workspaceId);
		const existing = tabs.find((tab) => tab.label === this.tabLabel);
		if (existing) {
			this.tabId = existing.tabId;
			const panes = (await this.listPanes(environment.workspaceId))
				.filter((pane) => pane.tabId === existing.tabId)
				.sort((left, right) => comparePublicIds(left.paneId, right.paneId));
			if (panes.length === 0) throw new Error("Existing Herdr worker tab has no panes");
			if (panes.length > this.maxPanes) throw new Error("Existing Herdr worker tab exceeds configured pane capacity");
			this.slots = panes.map((pane, index) => ({ index, paneId: pane.paneId, state: "idle" }));
			return;
		}

		const created = await this.requireResult("tab.create", {
			workspace_id: environment.workspaceId,
			cwd: this.cwd,
			label: this.tabLabel,
			focus: false,
			env: { ...this.paneEnv },
		}, "tab_created");
		const tab = parseTabInfo(recordValue(created.tab));
		const rootPane = parsePaneInfo(recordValue(created.root_pane));
		if (!tab || !rootPane) throw new Error("Herdr tab.create returned incomplete worker-tab identity");
		this.tabId = tab.tabId;
		this.slots = [{ index: 0, paneId: rootPane.paneId, state: "idle" }];
	}

	private async ensureCapacity(requested: number): Promise<void> {
		const target = capacityBucket(Math.min(this.maxPanes, requested));
		while (this.slots.length < target) {
			const nextIndex = this.slots.length;
			const splitPlan = splitPlanForIndex(nextIndex, this.slots);
			const result = await this.requireResult("pane.split", {
				target_pane_id: splitPlan.targetPaneId,
				direction: splitPlan.direction,
				ratio: 0.5,
				cwd: this.cwd,
				focus: false,
				env: { ...this.paneEnv },
			}, "pane_info");
			const pane = parsePaneInfo(recordValue(result.pane));
			if (!pane) throw new Error("Herdr pane.split returned no pane identity");
			if (this.slots.some((slot) => slot.paneId === pane.paneId)) {
				throw new Error("Herdr pane.split returned a duplicate worker pane identity");
			}
			this.slots.push({ index: nextIndex, paneId: pane.paneId, state: "idle" });
		}
	}

	private pickImmediatelyReusableSlot(request: HerdrPaneReservationRequest): MutableSlot | undefined {
		if (request.affinityKey) {
			const affinity = this.slots.find((slot) => slot.state === "idle" && slot.affinityKey === request.affinityKey);
			if (affinity) return affinity;
		}
		return this.slots.find((slot) => slot.state === "idle");
	}

	private pickReclaimableSuccess(request: HerdrPaneReservationRequest): MutableSlot | undefined {
		const retained = this.slots.filter((slot) => slot.state === "retained-success");
		if (request.affinityKey) {
			const affinity = retained.find((slot) => slot.affinityKey === request.affinityKey);
			if (affinity) return affinity;
		}
		return retained.sort((left, right) => (left.retainedAt ?? 0) - (right.retainedAt ?? 0))[0];
	}

	private createReservation(slot: MutableSlot, leaseId: string): HerdrPaneReservation {
		const tabId = this.tabId!;
		const workspaceId = this.workspaceId!;
		let released = false;
		return {
			paneId: slot.paneId,
			slotIndex: slot.index,
			tabId,
			workspaceId,
			...(slot.affinityKey ? { affinityKey: slot.affinityKey } : {}),
			release: (outcome) => {
				if (released || slot.leaseId !== leaseId) return;
				released = true;
				slot.leaseId = undefined;
				slot.state = outcome === "failed" ? "retained-failure" : "retained-success";
				slot.retainedAt = Date.now();
				this.scheduleDrain();
			},
		};
	}

	private async listTabs(workspaceId: string): Promise<Array<{ tabId: string; label: string }>> {
		const result = await this.requireResult("tab.list", { workspace_id: workspaceId }, "tab_list");
		const tabs = Array.isArray(result.tabs) ? result.tabs : [];
		return tabs.flatMap((value) => {
			const tab = parseTabInfo(recordValue(value));
			return tab ? [tab] : [];
		});
	}

	private async listPanes(workspaceId: string): Promise<Array<{ paneId: string; tabId: string }>> {
		const result = await this.requireResult("pane.list", { workspace_id: workspaceId }, "pane_list");
		const panes = Array.isArray(result.panes) ? result.panes : [];
		return panes.flatMap((value) => {
			const pane = parsePaneInfo(recordValue(value));
			return pane ? [pane] : [];
		});
	}

	private async requireResult(
		method: string,
		params: Record<string, unknown>,
		expectedType: string,
	): Promise<Record<string, unknown>> {
		const response = await this.client.request(method, params);
		if (!response) throw new Error(`Herdr ${method} did not return a response`);
		if (response.error) throw new Error(`Herdr ${method} failed: ${response.error.message ?? response.error.code ?? "unknown error"}`);
		const result = recordValue(response.result);
		if (!result || result.type !== expectedType) throw new Error(`Herdr ${method} returned an unexpected response`);
		return result;
	}

	private failAllWaiters(error: unknown): void {
		const normalized = error instanceof Error ? error : new Error(String(error));
		const waiters = this.waiters.splice(0);
		for (const waiter of waiters) waiter.reject(normalized);
	}
}

function rootSessionHash(rootSessionId: string): string {
	return createHash("sha256").update(rootSessionId).digest("hex").slice(0, 8);
}

function capacityBucket(requested: number): number {
	if (requested <= 1) return 1;
	if (requested <= 2) return 2;
	return 4;
}

function normalizeMaxPanes(value: number): number {
	if (!Number.isInteger(value) || value < 1 || value > DEFAULT_MAX_PANES) {
		throw new Error(`Herdr worker maxPanes must be an integer between 1 and ${DEFAULT_MAX_PANES}`);
	}
	return value;
}

function splitPlanForIndex(index: number, slots: MutableSlot[]): { targetPaneId: string; direction: "right" | "down" } {
	if (index === 1 && slots[0]) return { targetPaneId: slots[0].paneId, direction: "right" };
	if (index === 2 && slots[0]) return { targetPaneId: slots[0].paneId, direction: "down" };
	if (index === 3 && slots[1]) return { targetPaneId: slots[1].paneId, direction: "down" };
	throw new Error(`Unsupported Herdr worker topology expansion at slot ${index}`);
}

function parseTabInfo(value: Record<string, unknown> | undefined): { tabId: string; label: string } | undefined {
	if (!value || typeof value.tab_id !== "string" || typeof value.label !== "string") return undefined;
	return { tabId: value.tab_id, label: value.label };
}

function parsePaneInfo(value: Record<string, unknown> | undefined): { paneId: string; tabId: string } | undefined {
	if (!value || typeof value.pane_id !== "string" || typeof value.tab_id !== "string") return undefined;
	return { paneId: value.pane_id, tabId: value.tab_id };
}

function comparePublicIds(left: string, right: string): number {
	return left.localeCompare(right, undefined, { numeric: true });
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: undefined;
}

function requireNonEmpty(value: string, label: string): string {
	const normalized = value.trim();
	if (!normalized) throw new Error(`Herdr worker pool ${label} must not be empty`);
	return normalized;
}
