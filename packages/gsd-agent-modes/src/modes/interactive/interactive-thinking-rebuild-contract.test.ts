import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Container, Text } from "@gsd/pi-tui";
import { initTheme } from "@gsd/pi-coding-agent/theme/theme.js";
import { AssistantMessageComponent } from "./components/assistant-message.js";
import { ToolExecutionComponent } from "./components/tool-execution.js";
import { isRailAnimationEnabled, setRailAnimationEnabled } from "./components/transcript-design.js";
import { rebuildChatWithThinkingVisibility } from "./interactive-chat-render.js";
import { createStreamingRenderState } from "./streaming-render-state.js";

function assistant(content: any[], timestamp: number): any {
	return {
		role: "assistant", content, timestamp, stopReason: "toolUse", api: "openai-responses", provider: "fixture", model: "fixture",
		usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	};
}

function fixture(t: TestContext, history: any[]) {
	initTheme("dark", false);
	const animation = isRailAnimationEnabled();
	setRailAnimationEnabled(false);
	const host: any = {
		ui: { requestRender() {} },
		chatContainer: new Container(), pinnedMessageContainer: new Container(),
		pendingTools: new Map(), streamingRenderState: createStreamingRenderState(),
		hideThinkingBlock: true, toolOutputExpanded: true,
		session: { messages: history, retryAttempt: 0 },
		sessionManager: { buildSessionContext: () => ({ messages: history }) },
		settingsManager: { getTimestampFormat: () => "date-time-iso", getShowImages: () => false, setHideThinkingBlock() {} },
		getMarkdownThemeWithSettings: () => undefined, getRegisteredToolDefinition: () => undefined,
		formatWebSearchResult: () => "", defaultEditor: { addToHistory() {} },
	};
	const live = new ToolExecutionComponent("history-probe", { value: "same arguments" }, { showImages: false }, undefined, host.ui);
	live.setExpanded(true);
	host.pendingTools.set("reused-id", live);
	host.chatContainer.addChild(live);
	t.after(() => {
		for (const component of new Set([live, ...host.chatContainer.children, ...host.pendingTools.values()])) {
			if (component instanceof ToolExecutionComponent) component.dispose();
		}
		setRailAnimationEnabled(animation);
	});
	return { host, live };
}

for (const currentPersisted of [false, true]) {
	test(`thinking replay isolates repeated tool-call IDs with identical arguments; current persisted=${currentPersisted}`, (t) => {
		const call = { type: "toolCall", id: "reused-id", name: "history-probe", arguments: { value: "same arguments" } };
		const old = assistant([structuredClone(call)], 1);
		const current = assistant([structuredClone(call)], 3);
		const history = [old, { role: "toolResult", toolCallId: "reused-id", toolName: "history-probe", content: [{ type: "text", text: "historical completed output" }], isError: false, timestamp: 2 }];
		if (currentPersisted) history.push(current);
		const { host, live } = fixture(t, history);
		if (!currentPersisted) host.streamingMessage = current;

		rebuildChatWithThinkingVisibility(host, false);

		const tools = host.chatContainer.children.filter((component: unknown) => component instanceof ToolExecutionComponent);
		assert.equal(tools.length, 2);
		assert.equal(tools.filter((component: unknown) => component === live).length, 1, "one live invocation must never occupy historical and current positions");
		const historical = tools.find((component: unknown) => component !== live)!;
		assert.equal(historical.isInFlight(), false);
		assert.match(historical.render(80).join("\n"), /historical completed output/);
		assert.equal(host.pendingTools.get("reused-id"), live);
		assert.equal(live.isInFlight(), true);
	});
}

test("settings rejection after replay leaves retained tools, orphan thinking, and pinned state untouched", (t) => {
	const history = [assistant([{ type: "toolCall", id: "historical-only", name: "history-probe", arguments: {} }], 1)];
	const { host, live } = fixture(t, history);
	const orphanMessage = assistant([{ type: "text", text: "Retained orphan prose" }, { type: "thinking", thinking: "Retained hidden thinking" }], 2);
	const orphan = new AssistantMessageComponent(orphanMessage, true);
	host.chatContainer.addChild(orphan);
	host.streamingRenderState.orphanedSegments.push({ kind: "text-run", contentType: "text", startIndex: 0, endIndex: 1, component: orphan, cachedText: "Retained orphan prose", cachedTextLength: 21 });
	const pin = new Text("Pinned state", 0, 0);
	host.pinnedMessageContainer.addChild(pin);
	const beforeChildren = host.chatContainer.children.slice();
	const beforeOrphan = orphan.render(80);
	const streamState = host.streamingRenderState;
	const orphanSegments = streamState.orphanedSegments;
	const changes: string[] = [];
	for (const method of ["updateArgs", "updateResult", "setExpanded", "dispose"] as const) {
		const original = live[method].bind(live) as (...args: any[]) => unknown;
		t.mock.method(live, method, (...args: any[]) => { changes.push(method); return original(...args); });
	}
	host.settingsManager.setHideThinkingBlock = () => { throw new Error("settings boundary rejected"); };

	assert.throws(() => rebuildChatWithThinkingVisibility(host, false), /settings boundary rejected/);

	assert.deepEqual(changes, []);
	assert.deepEqual(host.chatContainer.children, beforeChildren);
	assert.equal(host.pendingTools.get("reused-id"), live);
	assert.equal(host.streamingRenderState, streamState);
	assert.equal(streamState.orphanedSegments, orphanSegments);
	assert.equal(streamState.orphanedSegments[0].component, orphan);
	assert.deepEqual(orphan.render(80), beforeOrphan);
	assert.equal(host.pinnedMessageContainer.children[0], pin);
	assert.equal(host.hideThinkingBlock, true);
});
