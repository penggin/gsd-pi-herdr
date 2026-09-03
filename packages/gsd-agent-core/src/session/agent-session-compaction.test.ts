import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AgentMessage } from "@gsd/pi-agent-core";
import type { AssistantMessage } from "@gsd/pi-ai";
import { AgentSessionCompactionModule } from "./agent-session-compaction.js";

const MODEL = {
	id: "gpt-5.6-sol",
	provider: "openai-codex",
	api: "openai-codex-responses",
	contextWindow: 200_000,
};

function usage(totalTokens: number) {
	return {
		input: totalTokens,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function assistant(options: {
	timestamp: number;
	stopReason?: AssistantMessage["stopReason"];
	errorMessage?: string;
	totalTokens?: number;
}): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "" }],
		api: MODEL.api,
		provider: MODEL.provider,
		model: MODEL.id,
		usage: usage(options.totalTokens ?? 0),
		stopReason: options.stopReason ?? "stop",
		...(options.errorMessage ? { errorMessage: options.errorMessage } : {}),
		timestamp: options.timestamp,
	};
}

function user(text: string, timestamp: number): AgentMessage {
	return { role: "user", content: [{ type: "text", text }], timestamp };
}

function compactionBoundary(timestamp: number) {
	return {
		type: "compaction",
		id: "compaction-1",
		parentId: "message-1",
		timestamp: new Date(timestamp).toISOString(),
		summary: "prior summary",
		firstKeptEntryId: "message-1",
		tokensBefore: 190_000,
	};
}

function createSubject(options?: {
	enabled?: boolean;
	entries?: unknown[];
	messages?: AgentMessage[];
	reserveTokens?: number;
}) {
	const events: Array<Record<string, unknown>> = [];
	const host = {
		settingsManager: {
			getCompactionSettings: () => ({
				enabled: options?.enabled ?? true,
				reserveTokens: options?.reserveTokens ?? 20_000,
				keepRecentTokens: 20_000,
			}),
		},
		model: MODEL,
		sessionCapabilities: {
			getBranch: async () => options?.entries ?? [],
		},
		agent: {
			state: { messages: options?.messages ?? [] },
		},
		_overflowRecoveryAttempted: false,
		_extensionRunner: {
			hasHandlers: () => false,
			emit: async () => undefined,
		},
		emit: (event: Record<string, unknown>) => events.push(event),
	};
	const module = new AgentSessionCompactionModule(host as never);
	const autoCompactionCalls: Array<["overflow" | "threshold", boolean]> = [];
	module.runAutoCompaction = async (reason, willRetry) => {
		autoCompactionCalls.push([reason, willRetry]);
		return false;
	};
	return { module, host, events, autoCompactionCalls };
}

describe("AgentSessionCompactionModule threshold checks", () => {
	test("limits overflow recovery to one compact-and-retry attempt", async () => {
		const now = Date.now();
		const overflow = assistant({
			timestamp: now,
			stopReason: "error",
			errorMessage: "prompt is too long",
		});
		const subject = createSubject({ messages: [user("hello", now - 1), overflow] });

		await subject.module.checkCompaction(overflow);
		await subject.module.checkCompaction({ ...overflow, timestamp: now + 1 });

		assert.deepEqual(subject.autoCompactionCalls, [["overflow", true]]);
		assert.equal(subject.host._overflowRecoveryAttempted, true);
		assert.equal(
			subject.events.some(
				(event) =>
					event.type === "compaction_end" &&
					event.reason === "overflow" &&
					String(event.errorMessage).includes("failed after one compact-and-retry attempt"),
			),
			true,
		);
	});

	test("ignores an assistant response older than the latest compaction boundary", async () => {
		const now = Date.now();
		const stale = assistant({ timestamp: now - 10_000, totalTokens: 190_000 });
		const subject = createSubject({
			entries: [compactionBoundary(now - 5_000)],
			messages: [stale, user("new prompt", now)],
		});

		assert.equal(await subject.module.checkCompaction(stale, false), false);
		assert.deepEqual(subject.autoCompactionCalls, []);
	});

	test("uses the last successful usage when a later provider response is an error", async () => {
		const now = Date.now();
		const successful = assistant({ timestamp: now, totalTokens: 190_000 });
		const failed = assistant({
			timestamp: now + 2,
			stopReason: "error",
			errorMessage: "529 overloaded",
		});
		const subject = createSubject({
			messages: [user("hello", now - 1), successful, user("retry", now + 1), failed],
		});

		await subject.module.checkCompaction(failed);

		assert.deepEqual(subject.autoCompactionCalls, [["threshold", false]]);
	});

	test("does not threshold-compact an error when no successful usage exists", async () => {
		const now = Date.now();
		const failed = assistant({
			timestamp: now,
			stopReason: "error",
			errorMessage: "529 overloaded",
		});
		const subject = createSubject({ messages: [user("hello", now - 1), failed] });

		assert.equal(await subject.module.checkCompaction(failed), false);
		assert.deepEqual(subject.autoCompactionCalls, []);
	});

	test("does not reuse pre-compaction usage to compact a post-compaction error", async () => {
		const now = Date.now();
		const successful = assistant({ timestamp: now - 10_000, totalTokens: 190_000 });
		const failed = assistant({
			timestamp: now,
			stopReason: "error",
			errorMessage: "529 overloaded",
		});
		const subject = createSubject({
			entries: [compactionBoundary(now - 5_000)],
			messages: [successful, user("new prompt", now - 1), failed],
		});

		assert.equal(await subject.module.checkCompaction(failed), false);
		assert.deepEqual(subject.autoCompactionCalls, []);
	});

	test("does not run below the threshold or while compaction is disabled", async () => {
		const now = Date.now();
		const below = assistant({ timestamp: now, totalTokens: 1_000 });
		const belowSubject = createSubject({ messages: [below] });
		const disabledSubject = createSubject({
			enabled: false,
			messages: [assistant({ timestamp: now, totalTokens: 1_000_000 })],
		});

		assert.equal(await belowSubject.module.checkCompaction(below), false);
		assert.equal(
			await disabledSubject.module.checkCompaction(disabledSubject.host.agent.state.messages[0] as AssistantMessage),
			false,
		);
		assert.deepEqual(belowSubject.autoCompactionCalls, []);
		assert.deepEqual(disabledSubject.autoCompactionCalls, []);
	});
});
