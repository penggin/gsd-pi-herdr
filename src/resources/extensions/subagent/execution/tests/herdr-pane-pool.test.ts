import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HerdrWorkerPanePool } from "../herdr-pane-pool.js";
import type { HerdrEnvironment, HerdrResponse } from "../../../herdr/client.js";

interface RecordedRequest {
	method: string;
	params: Record<string, unknown>;
}

class FakeHerdrPoolClient {
	readonly requests: RecordedRequest[] = [];
	private readonly environment: HerdrEnvironment;
	private tabs: Array<{ tab_id: string; workspace_id: string; label: string }> = [];
	private panes: Array<{ pane_id: string; workspace_id: string; tab_id: string }> = [];
	private nextTab = 2;
	private nextPane = 2;

	constructor(environment: HerdrEnvironment = {
			available: true,
			socketPath: "/tmp/herdr.sock",
			workspaceId: "w1",
			tabId: "w1:t1",
			paneId: "w1:p1",
		}) {
		this.environment = environment;
	}

	seedTab(label: string, paneIds: string[]): void {
		const tabId = "w1:t9";
		this.tabs.push({ tab_id: tabId, workspace_id: "w1", label });
		for (const paneId of paneIds) this.panes.push({ pane_id: paneId, workspace_id: "w1", tab_id: tabId });
	}

	getEnvironment(): HerdrEnvironment {
		return this.environment;
	}

	async request(method: string, params: Record<string, unknown> = {}): Promise<HerdrResponse> {
		this.requests.push({ method, params });
		switch (method) {
			case "tab.list":
				return response({ type: "tab_list", tabs: this.tabs });
			case "pane.list":
				return response({ type: "pane_list", panes: this.panes });
			case "tab.create": {
				const tabId = `w1:t${this.nextTab++}`;
				const paneId = `w1:p${this.nextPane++}`;
				const label = String(params.label ?? "");
				const tab = { tab_id: tabId, workspace_id: "w1", label };
				const pane = { pane_id: paneId, workspace_id: "w1", tab_id: tabId };
				this.tabs.push(tab);
				this.panes.push(pane);
				return response({ type: "tab_created", tab, root_pane: pane });
			}
			case "pane.split": {
				const target = this.panes.find((pane) => pane.pane_id === params.target_pane_id);
				assert.ok(target);
				const pane = { pane_id: `w1:p${this.nextPane++}`, workspace_id: "w1", tab_id: target.tab_id };
				this.panes.push(pane);
				return response({ type: "pane_info", pane });
			}
			default:
				throw new Error(`unexpected fake Herdr method: ${method}`);
		}
	}
}

function response(result: Record<string, unknown>): HerdrResponse {
	return { id: "fake", result };
}

function pool(client: FakeHerdrPoolClient, rootSessionId = "root-session") {
	return new HerdrWorkerPanePool(client, {
		rootSessionId,
		cwd: "/repo",
		paneEnv: { GSD_HOME: "/custom/gsd-home" },
	});
}

describe("Herdr worker pane pool", () => {
	it("creates one root-session worker tab without changing focus", async () => {
		const client = new FakeHerdrPoolClient();
		const workers = pool(client);
		const reservation = await workers.reserve();
		assert.equal(reservation.paneId, "w1:p2");
		const create = client.requests.find((request) => request.method === "tab.create");
		assert.ok(create);
		assert.equal(create.params.workspace_id, "w1");
		assert.equal(create.params.focus, false);
		assert.equal(create.params.cwd, "/repo");
		assert.deepEqual(create.params.env, { GSD_HOME: "/custom/gsd-home" });
		assert.match(String(create.params.label), /^GSD Workers · [0-9a-f]{8}$/);
		assert.equal(client.requests.some((request) => /focus/.test(request.method)), false);
	});

	it("expands deterministically from one to two to four slots with focus:false", async () => {
		const client = new FakeHerdrPoolClient();
		const workers = pool(client);
		const reservations = await Promise.all([
			workers.reserve({ affinityKey: "a" }),
			workers.reserve({ affinityKey: "b" }),
			workers.reserve({ affinityKey: "c" }),
			workers.reserve({ affinityKey: "d" }),
		]);
		assert.deepEqual(reservations.map((item) => item.paneId), ["w1:p2", "w1:p3", "w1:p4", "w1:p5"]);
		const splits = client.requests.filter((request) => request.method === "pane.split");
		assert.deepEqual(splits.map((request) => [request.params.target_pane_id, request.params.direction]), [
			["w1:p2", "right"],
			["w1:p2", "down"],
			["w1:p3", "down"],
		]);
		assert.ok(splits.every((request) => request.params.focus === false && request.params.ratio === 0.5));
		assert.ok(splits.every((request) => (request.params.env as any).GSD_HOME === "/custom/gsd-home"));
	});

	it("queues the fifth reservation until a successful slot becomes reclaimable", async () => {
		const client = new FakeHerdrPoolClient();
		const workers = pool(client);
		const firstFour = await Promise.all([workers.reserve(), workers.reserve(), workers.reserve(), workers.reserve()]);
		let fifthResolved = false;
		const fifthPromise = workers.reserve().then((value) => {
			fifthResolved = true;
			return value;
		});
		await Promise.resolve();
		assert.equal(fifthResolved, false);
		firstFour[2].release("completed");
		const fifth = await fifthPromise;
		assert.equal(fifth.paneId, firstFour[2].paneId);
	});

	it("retains failed panes and fails visibly instead of waiting forever when every slot needs review", async () => {
		const client = new FakeHerdrPoolClient();
		const workers = pool(client);
		const firstFour = await Promise.all([workers.reserve(), workers.reserve(), workers.reserve(), workers.reserve()]);
		firstFour[0].release("failed");
		for (const item of firstFour.slice(1)) item.release("failed");
		await assert.rejects(
			() => workers.reserve(),
			/retained after failures/,
		);
		workers.clearRetained(firstFour[1].paneId);
		assert.equal((await workers.reserve()).paneId, firstFour[1].paneId);
	});

	it("prefers affinity reuse for retry/chain continuity", async () => {
		const client = new FakeHerdrPoolClient();
		const workers = pool(client);
		const first = await workers.reserve({ affinityKey: "dispatch:child-0" });
		const second = await workers.reserve({ affinityKey: "other" });
		first.release("completed");
		second.release("completed");
		const retry = await workers.reserve({ affinityKey: "dispatch:child-0" });
		assert.equal(retry.paneId, first.paneId);
	});

	it("reuses an existing matching worker tab after a runtime/session reload", async () => {
		const client = new FakeHerdrPoolClient();
		const firstPool = pool(client, "same-root");
		const first = await firstPool.reserve();
		const label = firstPool.getSnapshot().tabLabel;
		first.release("completed");

		const reconnected = pool(client, "same-root");
		const second = await reconnected.reserve();
		assert.equal(second.paneId, first.paneId);
		assert.equal(client.requests.filter((request) => request.method === "tab.create").length, 1);
		assert.equal(reconnected.getSnapshot().tabLabel, label);
	});

	it("fails visibly without managed workspace identity", async () => {
		const client = new FakeHerdrPoolClient({ available: false });
		await assert.rejects(() => pool(client).reserve(), /requires a managed root pane/);
	});
});
