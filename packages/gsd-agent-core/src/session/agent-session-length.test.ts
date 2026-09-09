import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "@gsd/pi-agent-core";
import type { AssistantMessage } from "@gsd/pi-ai";
import { AgentSessionCompactionModule } from "./agent-session-compaction.ts";
import { AgentSessionEventsModule } from "./agent-session-events.ts";
import { AgentSessionPromptModule } from "./agent-session-prompt.ts";

const MODEL = { id: "fixture-model", provider: "fixture-provider", api: "openai-responses", contextWindow: 1000 };

function assistant(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
	return {
		role: "assistant", content: [{ type: "text", text: "" }],
		api: MODEL.api, provider: MODEL.provider, model: MODEL.id,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "stop", timestamp: 1000,
		...overrides,
	} as AssistantMessage;
}

function rawOverflow(): AssistantMessage {
	const message = assistant({ stopReason: "length" });
	message.usage = { ...message.usage, input: 1000, totalTokens: 1000 };
	return message;
}

function overflowHalt(): AssistantMessage {
	return assistant({ stopReason: "error", timestamp: 1001, errorMessage: "[length-halt] [context_length_exceeded] Provider stop_reason: length (zero output; continuing was halted)" });
}

function harness(messages: AgentMessage[] = []) {
	const emitted: Array<Record<string, unknown>> = [];
	const persisted: AgentMessage[] = [];
	const host = {
		model: MODEL,
		agent: {
			state: { messages },
			latencyMark: undefined,
			prompt: async (_messages: AgentMessage | AgentMessage[]) => {},
			continue: async () => {},
			hasQueuedMessages: () => true,
		},
		settingsManager: {
			getRetrySettings: () => ({ enabled: true, maxRetries: 3, baseDelayMs: 0 }),
			getCompactionSettings: () => ({ enabled: true, reserveTokens: 200, keepRecentTokens: 100 }),
		},
		sessionCapabilities: { getBranch: async () => [], appendMessage: async (message: AgentMessage) => { persisted.push(message); } },
		_extensionRunner: { hasHandlers: () => false, emit: async () => undefined, emitMessageEnd: async () => undefined },
		_eventListeners: [(event: Record<string, unknown>) => { emitted.push(event); }],
		_retryAttempt: 0,
		_overflowRecoveryAttempted: false,
		_lastAssistantMessage: undefined as AssistantMessage | undefined,
		_lastTurnCost: 0,
		_steeringMessages: [] as string[],
		_followUpMessages: [] as string[],
		drainSessionMutations: async () => {},
		flushPendingBashMessages: async () => {},
		flushPendingCustomMessages: async () => {},
		emit: (event: Record<string, unknown>) => { emitted.push(event); },
		checkCompaction: async (_message: AssistantMessage) => false,
		canPrepareRetry: (_message: AssistantMessage) => false,
	};
	const compaction = new AgentSessionCompactionModule(host as never);
	const prompt = new AgentSessionPromptModule(host as never);
	const events = new AgentSessionEventsModule(host as never);
	const compactCalls: Array<[string, boolean]> = [];
	compaction.runAutoCompaction = async (reason, retry) => { compactCalls.push([reason, retry]); return true; };
	host.checkCompaction = (message) => compaction.checkCompaction(message);
	host.canPrepareRetry = (message) => prompt.canPrepareRetry(message);
	return { host, compaction, prompt, events, compactCalls, emitted, persisted };
}

test("terminal length markers suppress ordinary retry even when provider text is retryable", () => {
	const subject = harness();
	for (const errorMessage of ["[length-halt] rate limit", "[length-halt] 529 overloaded", "[length-halt] request timed out"]) {
		assert.equal(subject.prompt.isRetryableError(assistant({ stopReason: "error", errorMessage })), false);
	}
	assert.equal(subject.prompt.isRetryableError(assistant({ stopReason: "error", errorMessage: "529 overloaded" })), true);
});

for (const reason of ["three continuations exhausted", "provider error: rate limit", "no output tokens"]) {
	test(`terminal length halt (${reason}) cannot resume queued work through threshold compaction`, async () => {
		const history = assistant({ content: [{ type: "text", text: "earlier result" }] });
		history.usage = { ...history.usage, input: 950, output: 1, totalTokens: 951 };
		const halt = assistant({ stopReason: "error", errorMessage: `[length-halt] Provider stop_reason: length (${reason}; continuing was halted)` });
		const subject = harness([history, halt]);
		subject.host._lastAssistantMessage = halt;
		subject.host._followUpMessages.push("queued follow-up");
		assert.equal(await subject.prompt.handlePostAgentRun(), false);
		assert.deepEqual(subject.compactCalls, []);
		assert.equal(subject.emitted.some((event) => event.type === "auto_retry_start"), false);
		assert.deepEqual(subject.host._followUpMessages, ["queued follow-up"]);
	});
}

test("overflow removes only its raw length and synthetic failure while keeping historical assistants", async () => {
	const previous = assistant({ content: [{ type: "text", text: "Keep this historical response." }], timestamp: 900 });
	const raw = rawOverflow();
	const halt = overflowHalt();
	const subject = harness([previous, raw, halt]);
	assert.equal(await subject.compaction.checkCompaction(halt), true);
	assert.deepEqual(subject.host.agent.state.messages, [previous]);
	assert.deepEqual(subject.compactCalls, [["overflow", true]]);
});

test("overflow cleanup preserves a raw length tool call and its terminal tool result", async () => {
	const raw = rawOverflow();
	raw.content = [{ type: "toolCall", id: "tool-1", name: "fixture", arguments: {} }];
	const result = { role: "toolResult", toolCallId: "tool-1", toolName: "fixture", content: [{ type: "text", text: "skipped" }], isError: true, timestamp: 1000 } as AgentMessage;
	const halt = overflowHalt();
	const subject = harness([raw, result, halt]);
	assert.equal(await subject.compaction.checkCompaction(halt), true);
	assert.deepEqual(subject.host.agent.state.messages, [raw, result]);
});

test("overflow cleanup never removes another provider's adjacent length response", async () => {
	const prior = rawOverflow();
	prior.provider = "other-provider";
	const halt = overflowHalt();
	const subject = harness([prior, halt]);
	await subject.compaction.checkCompaction(halt);
	assert.deepEqual(subject.host.agent.state.messages, [prior]);
});

test("repeated zero-output length events retain the one-compaction guard", async () => {
	const subject = harness();
	for (let round = 0; round < 2; round += 1) {
		const raw = rawOverflow();
		const halt = overflowHalt();
		subject.host.agent.state.messages.push(raw, halt);
		await subject.events.handleAgentEvent({ type: "message_end", message: raw });
		await subject.events.handleAgentEvent({ type: "message_end", message: halt });
		assert.equal(await subject.prompt.handlePostAgentRun(), round === 0);
	}
	assert.deepEqual(subject.compactCalls, [["overflow", true]]);
	assert.equal(subject.host._overflowRecoveryAttempted, true);
	assert.equal(subject.persisted.length, 4, "both raw responses and terminal diagnostics stay in session history");
});

test("queued user messages do not renew an active overflow recovery allowance", async () => {
	const subject = harness();
	subject.host._overflowRecoveryAttempted = true;
	subject.host._followUpMessages.push("queued work");
	await subject.events.handleAgentEvent({ type: "message_start", message: { role: "user", content: "queued work", timestamp: 1002 } });
	assert.equal(subject.host._overflowRecoveryAttempted, true);
	assert.deepEqual(subject.host._followUpMessages, []);
});

test("failed length and aborted responses do not announce retry success or reset overflow recovery", async () => {
	const subject = harness();
	for (const stopReason of ["length", "aborted"] as const) {
		subject.host._overflowRecoveryAttempted = true;
		subject.host._retryAttempt = 1;
		await subject.events.handleAgentEvent({ type: "message_end", message: assistant({ stopReason }) });
		assert.equal(subject.host._overflowRecoveryAttempted, true);
		assert.equal(subject.host._retryAttempt, 1);
	}
	assert.equal(subject.emitted.some((event) => event.type === "auto_retry_end"), false);
});

test("silent successful-stop overflow does not reset the overflow guard", async () => {
	const subject = harness();
	subject.host._overflowRecoveryAttempted = true;
	const message = assistant();
	message.usage = { ...message.usage, input: 1100, totalTokens: 1100 };
	await subject.events.handleAgentEvent({ type: "message_end", message });
	assert.equal(subject.host._overflowRecoveryAttempted, true);
});

test("a fresh explicit run gets a new allowance after a prior overflow halt", async () => {
	const subject = harness();
	subject.host._overflowRecoveryAttempted = true;
	subject.host.agent.prompt = async () => {
		assert.equal(subject.host._overflowRecoveryAttempted, false);
	};
	await subject.prompt.runAgentPrompt({ role: "user", content: "Try again with a smaller request", timestamp: 1003 });
});

test("synthetic length diagnostics preserve the last provider cost without double-counting persisted usage", async () => {
	const subject = harness();
	const raw = rawOverflow();
	raw.usage = { ...raw.usage, cost: { ...raw.usage.cost, input: 0.42, total: 0.42 } };
	await subject.events.handleAgentEvent({ type: "message_end", message: raw });
	await subject.events.handleAgentEvent({ type: "message_end", message: overflowHalt() });
	assert.equal(subject.host._lastTurnCost, 0.42);
	assert.equal(subject.persisted.reduce((cost, message) => cost + (message.role === "assistant" ? message.usage.cost.total : 0), 0), 0.42);
	await subject.events.handleAgentEvent({ type: "message_end", message: assistant({ stopReason: "error", errorMessage: "ordinary provider error" }) });
	assert.equal(subject.host._lastTurnCost, 0, "ordinary provider error accounting remains unchanged");
});

for (const outcome of ["success", "queued", "cancel", "abort", "failure", "exhausted"] as const) {
	test(`overflow recovery bridge is bounded for ${outcome} compaction`, async () => {
		const history = assistant({ content: [{ type: "text", text: "Completed actions remain in context." }], timestamp: 900 });
		const raw = rawOverflow();
		const halt = overflowHalt();
		const subject = harness([history, raw, halt]);
		const queued: AgentMessage[] = outcome === "queued" ? [{ role: "user", content: "An existing follow-up", timestamp: 901 }] : [];
		const branch = [
			{ role: "user", content: "original request", timestamp: 899 } as AgentMessage,
			history, raw, halt,
		].map((message, index) => ({ type: "message", id: `entry-${index}`, parentId: index ? `entry-${index - 1}` : null, timestamp: new Date(1000 + index).toISOString(), message }));
		let compactions = 0;
		Object.assign(subject.host.agent, {
			hasQueuedMessages: () => queued.length > 0,
			followUp: (message: AgentMessage) => { queued.push(message); },
		});
		Object.assign(subject.host, { getCompactionRequestAuth: async () => ({}) });
		Object.assign(subject.host.sessionCapabilities, {
			getBranch: async () => branch,
			appendCompaction: async () => { compactions += 1; },
			getEntries: async () => [],
			buildSessionContext: async () => ({ messages: structuredClone([history, raw, halt]) }),
		});
		Object.assign(subject.host._extensionRunner, {
			hasHandlers: (event: string) => event === "session_before_compact",
			emit: async () => {
				if (outcome === "failure") throw new Error("fixture compaction failed");
				if (outcome === "cancel") return { cancel: true };
				if (outcome === "abort") (subject.host as unknown as { _autoCompactionAbortController: AbortController })._autoCompactionAbortController.abort();
				return { compaction: { summary: "compacted", firstKeptEntryId: "entry-1", tokensBefore: 1000 } };
			},
		});
		subject.compaction.runAutoCompaction = AgentSessionCompactionModule.prototype.runAutoCompaction.bind(subject.compaction);
		subject.host._overflowRecoveryAttempted = outcome === "exhausted";
		const result = await subject.compaction.checkCompaction(halt);
		assert.equal(result, outcome === "success" || outcome === "queued");
		assert.equal(compactions, result ? 1 : 0);
		assert.equal(queued.length, result ? 1 : 0);
		if (result) {
			assert.deepEqual(subject.host.agent.state.messages, [history]);
			assert.equal(queued[0].role, "user");
			if (outcome === "success") assert.match(JSON.stringify(queued[0]), /Preserve completed work/);
			else assert.match(JSON.stringify(queued[0]), /existing follow-up/);
			assert.equal(await subject.compaction.checkCompaction(halt), false);
			assert.equal(queued.length, 1, "an exhausted guard cannot enqueue a second bridge");
		}
	});
}
