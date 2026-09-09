import assert from "node:assert/strict";
import test from "node:test";
import { Container } from "@gsd/pi-tui";

import { handleAgentEvent } from "./controllers/chat-controller.js";
import { createStreamingRenderState } from "./streaming-render-state.js";

function makeMinimalHost(chatContainer: Container, streamingRenderState = createStreamingRenderState()) {
	return {
		isInitialized: true,
		streamingRenderState,
		footer: { invalidate() {} },
		settingsManager: {
			getTimestampFormat() {
				return "date-time-iso";
			},
			getShowImages() {
				return false;
			},
		},
		getMarkdownThemeWithSettings() {
			return undefined;
		},
		getRegisteredToolDefinition() {
			return undefined;
		},
		formatWebSearchResult() {
			return "";
		},
		session: { messages: [], retryAttempt: 0 },
		chatContainer,
		pendingTools: new Map(),
		pendingMessagesContainer: { clear() {} },
		pinnedMessageContainer: new Container(),
		statusContainer: new Container(),
		hideThinkingBlock: true,
		toolOutputExpanded: false,
		defaultWorkingMessage: "Working...",
		clearBlockingError() {},
		compactionQueuedMessages: [],
		ui: {
			terminal: { rows: 60, columns: 100 },
			requestRender() {},
		},
		init: async () => {},
		addMessageToChat() {},
		checkShutdownRequested: async () => {},
		rebuildChatFromMessages() {},
		flushCompactionQueue: async () => {},
		showStatus() {},
		showError() {},
		updatePendingMessagesDisplay() {},
		updateTerminalTitle() {},
		updateEditorBorderColor() {},
	};
}

test("StreamingRenderState: two InteractiveMode hosts do not share segment state", async () => {
	const stateA = createStreamingRenderState();
	const stateB = createStreamingRenderState();
	const hostA = makeMinimalHost(new Container(), stateA);
	const hostB = makeMinimalHost(new Container(), stateB);

	const assistantStart = {
		type: "message_start",
		message: { role: "assistant", content: [] },
	} as const;

	await handleAgentEvent(hostA as any, assistantStart as any);
	stateA.renderedSegments.push({
		kind: "text-run",
		startIndex: 0,
		endIndex: 0,
		contentType: "text",
		component: {} as any,
	});

	await handleAgentEvent(hostB as any, assistantStart as any);

	assert.equal(stateA.renderedSegments.length, 1);
	assert.equal(stateB.renderedSegments.length, 0);
	assert.equal(stateA.lastProcessedContentIndex, 0);
	assert.equal(stateB.lastProcessedContentIndex, 0);
});

test("golden: message_start assistant resets streaming state for new turn", async () => {
	const rs = createStreamingRenderState();
	rs.lastProcessedContentIndex = 5;
	rs.renderedSegments.push({
		kind: "text-run",
		startIndex: 0,
		endIndex: 0,
		contentType: "text",
		component: {} as any,
	});

	const host = makeMinimalHost(new Container(), rs);
	await handleAgentEvent(host as any, {
		type: "message_start",
		message: { role: "assistant", content: [{ type: "text", text: "hello" }] },
	} as any);

	assert.equal(rs.renderedSegments.length, 0);
	assert.equal(rs.lastProcessedContentIndex, 0);
	assert.equal(rs.lastContentLength, 0);
});

test("message_update requests non-forced renders throughout continuous streaming", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
	const host = makeMinimalHost(new Container());
	const requests: boolean[] = [];
	host.ui.requestRender = (force?: boolean) => { requests.push(force === true); };
	await handleAgentEvent(host as any, {
		type: "message_start", message: { role: "assistant", content: [] },
	} as any);
	requests.length = 0;
	for (let index = 0; index < 100; index++) {
		const prior = requests.length;
		await handleAgentEvent(host as any, {
			type: "message_update",
			message: { role: "assistant", content: [{ type: "text", text: `Streaming response ${index}` }] },
			assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: `${index}` },
		} as any);
		assert.ok(requests.length > prior, `delta ${index} must request a render without waiting for silence`);
		t.mock.timers.tick(10);
	}
	assert.ok(requests.every((forced) => !forced), "the TUI must retain its own coalescing/throttle");
});

test("stream boundaries request a normal render without resetting segment state", () => {
	const state = createStreamingRenderState();
	state.lastProcessedContentIndex = 4;
	state.lastContentLength = 12;
	const forces: Array<boolean | undefined> = [];
	state.flushPendingStreamingWork({ requestRender: (force?: boolean) => forces.push(force) } as any);
	assert.deepEqual(forces, [undefined]);
	assert.equal(state.lastProcessedContentIndex, 4);
	assert.equal(state.lastContentLength, 12);
});

test("session reset clears segments and pinned state without scheduling stale render work", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const state = createStreamingRenderState();
	state.lastProcessedContentIndex = 4;
	state.lastContentLength = 12;
	state.renderedSegments.push({ kind: "tool", contentIndex: 0, component: {} as any });
	state.orphanedSegments.push({ kind: "tool", contentIndex: 1, component: {} as any });
	state.lastPinnedText = "old session";
	state.hasToolsInTurn = true;
	state.pinnedZoneNeedsViewportRealign = true;
	let spinnerStops = 0;
	state.pinnedBorder = { stopSpinner: () => spinnerStops++ } as any;
	state.resetForSessionChange();
	t.mock.timers.tick(100);
	assert.equal(spinnerStops, 1);
	assert.equal(state.lastProcessedContentIndex, 0);
	assert.equal(state.lastContentLength, 0);
	assert.deepEqual(state.renderedSegments, []);
	assert.deepEqual(state.orphanedSegments, []);
	assert.equal(state.lastPinnedText, "");
	assert.equal(state.hasToolsInTurn, false);
	assert.equal(state.pinnedZoneNeedsViewportRealign, false);
	assert.equal(state.pinnedBorder, undefined);
});
