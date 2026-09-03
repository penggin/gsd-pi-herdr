import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	Session,
	V4HarnessSessionStorageAdapter,
	type V4HarnessSessionMetadata,
	V4MemorySessionRepository,
} from "@gsd/pi-agent-core";
import { SessionManager } from "@gsd/pi-coding-agent/core/session-manager.js";
import {
	createHarnessV4SessionCapabilityAdapter,
	LegacyV3SessionCapabilityAdapter,
	type SessionCapabilityAdapter,
	SessionCapabilityMutationDrain,
} from "./session-capability-adapter.js";
import { AgentSessionNavigationModule } from "./session/agent-session-navigation.js";

function normalizeValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(normalizeValue);
	if (typeof value !== "object" || value === null) return value;
	return Object.fromEntries(
		Object.entries(value)
			.filter(
				([key, child]) =>
					child !== undefined && key !== "id" && key !== "parentId" && key !== "timestamp" && key !== "fromId",
			)
			.map(([key, child]) => [key, normalizeValue(child)]),
	);
}

async function exercise(adapter: SessionCapabilityAdapter): Promise<{
	branch: unknown[];
	context: unknown;
	label: string | undefined;
	name: string | undefined;
}> {
	const rootId = await adapter.appendMessage({ role: "user", content: "root", timestamp: 1 });
	await adapter.appendLabel(rootId, " pinned ");
	await adapter.appendSessionName(" Example ");
	await adapter.appendMessage({ role: "user", content: "abandoned", timestamp: 2 });
	await adapter.moveTo(rootId, { summary: "branch summary", details: { reason: "parity" } });
	await adapter.appendModelChange("test-provider", "test-model");
	await adapter.appendThinkingLevelChange("medium");
	await adapter.appendCustomMessageEntry("notice", "replacement", true, { stable: true });

	return {
		branch: normalizeValue(await adapter.getBranch()) as unknown[],
		context: normalizeValue(await adapter.buildSessionContext()),
		label: await adapter.getLabel(rootId),
		name: await adapter.getSessionName(),
	};
}

async function exerciseNavigation(adapter: SessionCapabilityAdapter): Promise<void> {
	await adapter.appendMessage({ role: "user", content: "root", timestamp: 1 });
	const targetId = await adapter.appendModelChange("test-provider", "test-model");
	await adapter.appendMessage({ role: "user", content: "old branch", timestamp: 2 });
	const host = {
		sessionCapabilities: adapter,
		drainSessionMutations: async () => {},
		model: undefined,
		agent: { state: { messages: [] } },
		_extensionRunner: { hasHandlers: () => false, emit: async () => {} },
		_branchSummaryAbortController: undefined,
	};

	const result = await new AgentSessionNavigationModule(host as never).navigateTree(targetId);
	assert.deepEqual(result, { cancelled: false, summaryEntry: undefined, editorText: undefined });
	assert.equal(await adapter.getLeafId(), targetId);
	assert.deepEqual((await adapter.buildSessionContext()).model, {
		provider: "test-provider",
		modelId: "test-model",
	});
}

describe("session capability adapter", () => {
	it("preserves branch, context, label, and name semantics across legacy-v3 and harness-v4", async () => {
		const legacy = new LegacyV3SessionCapabilityAdapter(SessionManager.inMemory("/workspace"));
		const backend = new V4MemorySessionRepository().create({ id: "v4-session" });
		const harness = new Session(new V4HarnessSessionStorageAdapter(backend));
		const v4 = await createHarnessV4SessionCapabilityAdapter(harness);

		assert.deepEqual(await exercise(v4), await exercise(legacy));
	});

	it("navigates the same capability tree without touching a legacy manager", async () => {
		await exerciseNavigation(new LegacyV3SessionCapabilityAdapter(SessionManager.inMemory("/workspace")));
		const backend = new V4MemorySessionRepository().create({ id: "v4-navigation" });
		const harness = new Session(new V4HarnessSessionStorageAdapter(backend));
		await exerciseNavigation(await createHarnessV4SessionCapabilityAdapter(harness));
	});

	it("reports parent references without conflating legacy paths and v4 session IDs", async () => {
		const legacyManager = SessionManager.inMemory("/workspace");
		legacyManager.newSession({ parentSession: "/sessions/parent.jsonl" });
		const legacy = new LegacyV3SessionCapabilityAdapter(legacyManager);
		assert.deepEqual((await legacy.getMetadata()).parent, {
			kind: "legacy-path",
			value: "/sessions/parent.jsonl",
		});

		const backend = new V4MemorySessionRepository().create({ id: "child", parentSessionId: "parent" });
		const harness = new Session(new V4HarnessSessionStorageAdapter(backend));
		const v4 = await createHarnessV4SessionCapabilityAdapter(harness);
		assert.deepEqual((await v4.getMetadata()).parent, { kind: "session-id", value: "parent" });
	});

	it("does not leak harness-v4 lane movement records through the legacy-compatible entry facade", async () => {
		const backend = new V4MemorySessionRepository().create({ id: "v4-lanes" });
		const harness = new Session(new V4HarnessSessionStorageAdapter(backend));
		const adapter = await createHarnessV4SessionCapabilityAdapter(harness);
		const rootId = await adapter.appendMessage({ role: "user", content: "root", timestamp: 1 });
		await adapter.appendMessage({ role: "user", content: "old branch", timestamp: 2 });
		await adapter.moveTo(rootId);

		assert.equal((await adapter.getEntries()).some((entry) => entry.type === "leaf"), false);
		assert.deepEqual((await adapter.getBranch()).map((entry) => entry.id), [rootId]);
	});

	it("rejects a session whose metadata is not harness-v4", async () => {
		const incompatible = {
			getMetadata: async () => ({ id: "legacy", createdAt: new Date().toISOString(), format: "legacy-v3" }),
		} as unknown as Session<V4HarnessSessionMetadata>;

		await assert.rejects(
			createHarnessV4SessionCapabilityAdapter(incompatible),
			/Harness-v4 capability adapter requires harness-v4 session metadata/,
		);
	});

	it("keeps legacy mutations immediately visible and surfaces queued failures at drain", async () => {
		const manager = SessionManager.inMemory("/workspace");
		const adapter = new LegacyV3SessionCapabilityAdapter(manager);
		const mutations = new SessionCapabilityMutationDrain(adapter);

		mutations.enqueue((session) => session.appendSessionName("Immediate"));
		assert.equal(manager.getSessionName(), "Immediate");
		mutations.enqueue(async () => {
			throw new Error("durability failed");
		});

		await assert.rejects(mutations.drain(), /durability failed/);
		await mutations.drain();
	});

	it("serializes harness-v4 mutations before drain settles", async () => {
		const order: string[] = [];
		let releaseFirst: (() => void) | undefined;
		const firstBlocked = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const adapter = { format: "harness-v4" } as SessionCapabilityAdapter;
		const mutations = new SessionCapabilityMutationDrain(adapter);

		mutations.enqueue(async () => {
			order.push("first-start");
			await firstBlocked;
			order.push("first-end");
		});
		mutations.enqueue(async () => {
			order.push("second");
		});
		await Promise.resolve();
		assert.deepEqual(order, ["first-start"]);
		releaseFirst?.();
		await mutations.drain();
		assert.deepEqual(order, ["first-start", "first-end", "second"]);
	});
});
