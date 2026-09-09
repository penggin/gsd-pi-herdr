import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { Container, Text, TUI, type EditorTheme } from "@gsd/pi-tui";
import { KeybindingsManager } from "@gsd/agent-core";
import { initTheme } from "@gsd/pi-coding-agent/theme/theme.js";
import { VirtualTerminal } from "../../../../pi-tui/test/virtual-terminal.ts";
import { CustomEditor } from "./components/custom-editor.js";
import { ToolExecutionComponent } from "./components/tool-execution.js";
import { AssistantMessageComponent } from "./components/assistant-message.js";
import { isRailAnimationEnabled, setRailAnimationEnabled } from "./components/transcript-design.js";
import { createStreamingRenderState } from "./streaming-render-state.js";
import { handleAgentEvent } from "./controllers/chat-controller.js";
import { rebuildChatFromMessages, showStatus } from "./interactive-chat-render.js";
import { setToolsExpanded, setupKeyHandlers, toggleThinkingBlockVisibility, toggleToolOutputExpansion } from "./interactive-key-handlers.js";
import { MAX_CHAT_COMPONENTS } from "./interactive-mode-class-constants.js";

class LoggingVirtualTerminal extends VirtualTerminal {
	writes: string[] = [];
	override write(data: string): void { this.writes.push(data); super.write(data); }
	clearWrites(): void { this.writes = []; }
	getWrites(): string { return this.writes.join(""); }
}

const editorTheme: EditorTheme = {
	borderColor: (text) => text,
	selectList: { selectedPrefix: (text) => text, selectedText: (text) => text, description: (text) => text, scrollInfo: (text) => text, noMatch: (text) => text },
};

function assistant(content: any[], stopReason = "stop"): any {
	return {
		role: "assistant", content, stopReason, api: "openai-responses", provider: "mock", model: "mock", timestamp: 1,
		usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	};
}

async function fixture(t: TestContext, clearOnShrink = true) {
	initTheme("dark", false);
	const oldAnimation = isRailAnimationEnabled();
	setRailAnimationEnabled(false);
	const terminal = new LoggingVirtualTerminal(80, 24);
	const ui = new TUI(terminal);
	ui.setClearOnShrink(clearOnShrink);
	const chatContainer = new Container();
	const pinnedMessageContainer = new Container();
	const defaultEditor = new CustomEditor(ui, editorTheme, KeybindingsManager.inMemory());
	const history = [assistant([{ type: "text", text: Array.from({ length: 40 }, (_, index) => `History ${index}`).join("\n\n") }])];
	const host: any = {
		ui, chatContainer, pinnedMessageContainer, defaultEditor, editor: defaultEditor,
		isInitialized: true, hideThinkingBlock: true, toolOutputExpanded: false,
		streamingRenderState: createStreamingRenderState(), pendingTools: new Map(),
		pendingMessagesContainer: new Container(), statusContainer: new Container(),
		footer: { invalidate() {} }, session: { messages: history, retryAttempt: 0 },
		sessionManager: { buildSessionContext: () => ({ messages: history }) },
		settingsManager: { getTimestampFormat: () => "date-time-iso", getShowImages: () => false, setHideThinkingBlock() {} },
		getMarkdownThemeWithSettings: () => undefined, getRegisteredToolDefinition: () => undefined,
		formatWebSearchResult: () => "", updateEditorBorderColor() {}, updatePendingMessagesDisplay() {},
		loadingAnimation: undefined, pendingWorkingMessage: undefined, defaultWorkingMessage: "Working...",
	};
	// InteractiveMode exposes this state through a getter with no setter.
	const streamingState = host.streamingRenderState;
	Object.defineProperty(host, "streamingRenderState", { get: () => streamingState, configurable: true });
	host.rebuildChatFromMessages = () => rebuildChatFromMessages(host);
	host.showStatus = (message: string) => showStatus(host, message);
	host.setToolsExpanded = (expanded: boolean) => setToolsExpanded(host, expanded);
	host.toggleToolOutputExpansion = () => toggleToolOutputExpansion(host);
	host.toggleThinkingBlockVisibility = () => toggleThinkingBlockVisibility(host);
	setupKeyHandlers(host);
	ui.addChild(chatContainer);
	ui.addChild(pinnedMessageContainer);
	ui.addChild(defaultEditor);
	ui.setFocus(defaultEditor);
	host.rebuildChatFromMessages();
	ui.start();
	const tools = new Set<ToolExecutionComponent>();
	t.after(() => {
		for (const component of [...chatContainer.children, ...host.pendingTools.values(), ...tools]) {
			if (component instanceof ToolExecutionComponent) component.dispose();
		}
		ui.stop();
		setRailAnimationEnabled(oldAnimation);
	});
	await terminal.waitForRender();
	return { host, ui, terminal, tools };
}

async function streamWrite(subject: Awaited<ReturnType<typeof fixture>>, lines: number): Promise<ToolExecutionComponent> {
	const content = Array.from({ length: lines }, (_, index) => `const value${index} = ${index};`).join("\n");
	const message = assistant([
		{ type: "thinking", thinking: "Keep the live write visible while toggling thinking." },
		{ type: "toolCall", id: "stream-write", name: "write", arguments: { path: "generated.ts", content } },
	], "toolUse");
	if (!subject.host.streamingMessage) await handleAgentEvent(subject.host, { type: "message_start", message: assistant([], "toolUse") });
	await handleAgentEvent(subject.host, {
		type: "message_update", message,
		assistantMessageEvent: { type: "toolcall_delta", contentIndex: 1, delta: "" },
	} as any);
	const tool = subject.host.pendingTools.get("stream-write");
	assert.ok(tool instanceof ToolExecutionComponent);
	subject.tools.add(tool);
	await subject.terminal.waitForRender();
	return tool;
}

for (const clearOnShrink of [false, true]) test(`actual Ctrl-O expands and collapses streaming WRITE with clearOnShrink=${clearOnShrink}`, async (t) => {
	const subject = await fixture(t, clearOnShrink);
	await streamWrite(subject, 2000);
	const collapsedViewport = subject.terminal.getViewport();
	subject.terminal.clearWrites();
	subject.terminal.sendInput("\x0f");
	assert.equal(subject.host.toolOutputExpanded, true);
	assert.deepEqual(subject.terminal.getViewport(), collapsedViewport, "hotkey paint remains deferred");
	await subject.terminal.waitForRender();
	assert.match(subject.terminal.getViewport().join("\n"), /value1999/);
	const beforeAppend = subject.ui.fullRedraws;
	subject.terminal.clearWrites();
	await streamWrite(subject, 2001);
	t.diagnostic(`expanded WRITE append: ${subject.ui.fullRedraws - beforeAppend} full redraws, ${Buffer.byteLength(subject.terminal.getWrites())} bytes`);
	assert.equal(subject.ui.fullRedraws, beforeAppend, "appending expanded WRITE content keeps dynamic metadata in the viewport");
	assert.ok(Buffer.byteLength(subject.terminal.getWrites()) < 16_384, "a one-line append does not replay the full transcript");
	assert.doesNotMatch(subject.terminal.getWrites(), /\x1b\[[23]J/);
	assert.match(subject.terminal.getViewport().join("\n"), /value2000/);
	const redraws = subject.ui.fullRedraws;
	subject.terminal.clearWrites();
	subject.terminal.sendInput("\x0f");
	await subject.terminal.waitForRender();
	assert.equal(subject.host.toolOutputExpanded, false);
	assert.equal(subject.ui.fullRedraws, redraws, "current tall-to-tall collapse already uses viewport repaint");
	assert.doesNotMatch(subject.terminal.getWrites(), /\x1b\[[23]J/);
	assert.doesNotMatch(subject.terminal.getViewport().join("\n"), /value1999/);
	for (let frame = 0; frame < 3; frame++) {
		subject.ui.requestRender();
		await subject.terminal.waitForRender();
	}
	assert.equal(subject.ui.fullRedraws, redraws, "deferred follow-up frames do not commit an extra shrink repaint");
	assert.doesNotMatch(subject.terminal.getWrites(), /\x1b\[[23]J/);
	assert.equal(subject.ui.getClearOnShrink(), clearOnShrink);
});

test("thinking toggle preserves a live streaming WRITE through repaint and its next update", async (t) => {
	const subject = await fixture(t);
	const tool = await streamWrite(subject, 2000);
	subject.terminal.sendInput("\x0f");
	await subject.terminal.waitForRender();
	subject.terminal.sendInput("\x14");
	await subject.terminal.waitForRender();
	assert.ok(subject.host.pendingTools.get("stream-write") === tool, "the active tool keeps its update destination");
	assert.ok(subject.host.chatContainer.children.includes(tool), "the live tool stays mounted");
	assert.match(subject.terminal.getViewport().join("\n"), /value1999/);
	await streamWrite(subject, 2001);
	assert.match(subject.terminal.getViewport().join("\n"), /value2000/);
	assert.equal(subject.ui.getClearOnShrink(), true);
});

test("thinking rebuild failure preserves the previously painted transcript and shrink policy", async (t) => {
	const subject = await fixture(t);
	const before = subject.host.chatContainer.children.slice();
	const beforeLines = subject.host.chatContainer.render(80).map(stripVTControlCharacters);
	subject.host.sessionManager.buildSessionContext = () => { throw new Error("session read failed"); };
	assert.throws(() => subject.terminal.sendInput("\x14"), /session read failed/);
	assert.equal(subject.host.chatContainer.children.length, before.length);
	assert.ok(before.every((component: unknown, index: number) => subject.host.chatContainer.children[index] === component));
	assert.deepEqual(subject.host.chatContainer.render(80).map(stripVTControlCharacters), beforeLines);
	assert.equal(subject.host.hideThinkingBlock, true);
	assert.equal(subject.ui.getClearOnShrink(), true);
	await subject.terminal.waitForRender();
});

test("thinking setting failure rolls back a setter that mutated before throwing", async (t) => {
	const subject = await fixture(t);
	const before = subject.host.chatContainer.children.slice();
	let setting = true;
	const writes: boolean[] = [];
	const failure = new Error("setting persistence rejected");
	subject.host.settingsManager.getHideThinkingBlock = () => setting;
	subject.host.settingsManager.setHideThinkingBlock = (value: boolean) => {
		setting = value;
		writes.push(value);
		if (!value) throw failure;
	};

	assert.throws(() => subject.terminal.sendInput("\x14"), (error) => error === failure);

	assert.deepEqual(writes, [false, true]);
	assert.equal(setting, true);
	assert.equal(subject.host.hideThinkingBlock, true);
	assert.equal(subject.host.chatContainer.children.length, before.length);
	assert.ok(before.every((child: unknown, index: number) => subject.host.chatContainer.children[index] === child));
	assert.equal(subject.ui.getClearOnShrink(), true);
	await subject.terminal.waitForRender();
});

test("thinking toggle reuses execution-time tool state and the pinned zone without duplicate mounts", async (t) => {
	const subject = await fixture(t);
	const tool = await streamWrite(subject, 2000);
	const completedAssistant = subject.host.streamingMessage;
	subject.host.session.messages.push(completedAssistant);
	await handleAgentEvent(subject.host, { type: "message_end", message: completedAssistant });
	assert.equal(subject.host.streamingMessage, undefined);
	subject.terminal.sendInput("\x0f");
	const pin = new Text("Pinned current work", 0, 0);
	subject.host.pinnedMessageContainer.addChild(pin);
	const streamState = subject.host.streamingRenderState;
	streamState.lastPinnedText = "Pinned current work";
	streamState.pinnedTextComponent = pin;
	streamState.pinnedZoneNeedsViewportRealign = true;
	await subject.terminal.waitForRender();

	subject.terminal.sendInput("\x14");
	await subject.terminal.waitForRender();

	assert.ok(subject.host.pendingTools.get("stream-write") === tool);
	assert.equal(subject.host.chatContainer.children.filter((child: unknown) => child === tool).length, 1);
	assert.equal(tool.isInFlight(), true, "history replay does not mark the executing tool historical");
	assert.ok(subject.host.pinnedMessageContainer.children[0] === pin);
	assert.ok(subject.host.streamingRenderState === streamState);
	assert.equal(streamState.lastPinnedText, "Pinned current work");
	assert.ok(streamState.pinnedTextComponent === pin);
	assert.equal(streamState.pinnedZoneNeedsViewportRealign, true);
	await handleAgentEvent(subject.host, {
		type: "tool_execution_end", toolCallId: "stream-write", toolName: "write",
		result: { content: [{ type: "text", text: "written" }], details: {} }, isError: false,
	} as any);
	await subject.terminal.waitForRender();
	assert.equal(tool.isInFlight(), false);
	assert.match(subject.terminal.getViewport().join("\n"), /success/);
});

test("thinking toggle reveals previously omitted thinking-only history and hides it again", async (t) => {
	const subject = await fixture(t);
	subject.host.session.messages.push(assistant([{ type: "thinking", thinking: "Previously hidden reasoning marker." }]));
	assert.doesNotMatch(subject.host.chatContainer.render(80).join("\n"), /Previously hidden reasoning marker/);
	subject.terminal.sendInput("\x14");
	await subject.terminal.waitForRender();
	assert.match(subject.host.chatContainer.render(80).join("\n"), /Previously hidden reasoning marker/);
	subject.terminal.sendInput("\x14");
	await subject.terminal.waitForRender();
	assert.doesNotMatch(subject.host.chatContainer.render(80).join("\n"), /Previously hidden reasoning marker/);
});

test("failed staged replay disposes trimmed new tools and preserves live tool and pinned state", async (t) => {
	const subject = await fixture(t);
	const liveTool = await streamWrite(subject, 20);
	const pin = new Text("Pinned failure context", 0, 0);
	subject.host.pinnedMessageContainer.addChild(pin);
	const before = subject.host.chatContainer.children.slice();
	const disposed: ToolExecutionComponent[] = [];
	const dispose = ToolExecutionComponent.prototype.dispose;
	t.mock.method(ToolExecutionComponent.prototype, "dispose", function (this: ToolExecutionComponent) {
		disposed.push(this);
		dispose.call(this);
	});
	let settingsWrites = 0;
	subject.host.settingsManager.setHideThinkingBlock = () => { settingsWrites++; };
	subject.host.sessionManager.buildSessionContext = () => ({ messages: [
		assistant([{ type: "toolCall", id: "staged-only", name: "write", arguments: { path: "staged-only.ts", content: "staged" } }]),
		{ role: "toolResult", toolCallId: "staged-only", toolName: "write", content: [{ type: "text", text: "written" }], isError: false },
		...Array.from({ length: MAX_CHAT_COMPONENTS }, (_, index) => assistant([{ type: "text", text: `Staged history ${index}` }])),
		assistant([{ type: "toolCall", id: "broken", name: "broken-renderer", arguments: {} }]),
	] });
	subject.host.getRegisteredToolDefinition = (name: string) => {
		if (name === "broken-renderer") throw new Error("renderer lookup failed");
		return undefined;
	};

	assert.throws(() => subject.terminal.sendInput("\x14"), /renderer lookup failed/);

	assert.equal(disposed.length, 1);
	assert.ok(disposed[0] !== liveTool);
	assert.ok(subject.host.pendingTools.get("stream-write") === liveTool);
	assert.equal(liveTool.isInFlight(), true);
	assert.equal(subject.host.chatContainer.children.length, before.length);
	assert.ok(before.every((child: unknown, index: number) => subject.host.chatContainer.children[index] === child));
	assert.ok(subject.host.pinnedMessageContainer.children[0] === pin);
	assert.equal(subject.host.hideThinkingBlock, true);
	assert.equal(settingsWrites, 0);
	assert.equal(subject.ui.getClearOnShrink(), true);
	await subject.terminal.waitForRender();
});

test("Ctrl-T hides orphaned subturn thinking without mutating the previously mounted component", async (t) => {
	const subject = await fixture(t);
	const tool = await streamWrite(subject, 20);
	subject.terminal.sendInput("\x14");
	await subject.terminal.waitForRender();
	const nextMessage = assistant([{ type: "text", text: "A distinct follow-up observation." }], "toolUse");
	await handleAgentEvent(subject.host, {
		type: "message_update", message: nextMessage,
		assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "A distinct follow-up observation." },
	} as any);
	await subject.terminal.waitForRender();
	const orphan = subject.host.streamingRenderState.orphanedSegments.find((segment: any) => segment.kind === "text-run" && segment.contentType === "thinking");
	assert.ok(orphan);
	const originalLines = orphan.component.render(80);
	assert.match(originalLines.join("\n"), /Keep the live write visible/);

	subject.terminal.sendInput("\x14");
	await subject.terminal.waitForRender();

	assert.doesNotMatch(subject.host.chatContainer.render(80).join("\n"), /Keep the live write visible/);
	assert.match(subject.host.chatContainer.render(80).join("\n"), /distinct follow-up observation/);
	assert.deepEqual(orphan.component.render(80), originalLines, "staging never mutates the old message view");
	assert.ok(subject.host.pendingTools.get("stream-write") === tool);
	subject.terminal.sendInput("\x14");
	await subject.terminal.waitForRender();
	assert.match(subject.host.chatContainer.render(80).join("\n"), /Keep the live write visible/);
	assert.equal(subject.host.chatContainer.children.filter((child: unknown) => child === tool).length, 1);
});

test("thinking visibility clones preserve the original message range and metadata choice", () => {
	initTheme("dark", false);
	const message = assistant([
		{ type: "text", text: "Outside selected range" },
		{ type: "thinking", thinking: "Inside selected range" },
		{ type: "text", text: "Also outside selected range" },
	]);
	const original = new AssistantMessageComponent(message, false, undefined, "date-time-iso", { startIndex: 1, endIndex: 1 });
	original.setShowMetadata(false);
	const before = original.render(80);
	assert.match(before.join("\n"), /Inside selected range/);
	assert.doesNotMatch(before.join("\n"), /Outside selected range/);
	assert.deepEqual(original.cloneWithThinkingVisibility(false).render(80), before);
	assert.doesNotMatch(original.cloneWithThinkingVisibility(true).render(80).join("\n"), /Inside selected range/);
	assert.deepEqual(original.render(80), before);
});
