// Project/App: gsd-pi
// File Purpose: Extracted from interactive-mode.ts (Phase E2 seam remediation).

import type { AgentMessage } from "@gsd/pi-agent-core";
import type { AssistantMessage, Message } from "@gsd/pi-ai";
import { parseSkillBlock } from "@gsd/agent-core";
import type { SessionContext } from "@gsd/pi-coding-agent/core/session-manager.js";
import type { TruncationResult } from "@gsd/pi-coding-agent/core/tools/truncate.js";
import { Container, Markdown, Spacer, Text } from "@gsd/pi-tui";
import { theme } from "@gsd/pi-coding-agent/theme/theme.js";
import { AssistantMessageComponent } from "./components/assistant-message.js";
import { reconcileChatTurnConnections } from "./components/chat-turn-connect.js";
import { BashExecutionComponent } from "./components/bash-execution.js";
import { BranchSummaryMessageComponent } from "./components/branch-summary-message.js";
import { CompactionSummaryMessageComponent } from "./components/compaction-summary-message.js";
import { CustomMessageComponent } from "./components/custom-message.js";
import { DynamicBorder } from "./components/dynamic-border.js";
import { SkillInvocationMessageComponent } from "./components/skill-invocation-message.js";
import { ToolExecutionComponent } from "./components/tool-execution.js";
import { UserMessageComponent } from "./components/user-message.js";
import { asServerToolUse, asWebSearchResult, isToolContentBlock } from "./gsd-content-blocks.js";
import { buildAssistantReplaySegments } from "./interactive-notify-render.js";
import { MAX_CHAT_COMPONENTS } from "./interactive-mode-class-constants.js";
import type { InteractiveModeDelegateHost } from "./interactive-mode-delegate-host.js";
import { createStreamingRenderState } from "./streaming-render-state.js";
import { rebuildSegmentsOnMessageEnd, runSegmentWalker } from "./controllers/chat-segment-walker.js";

	/** Extract text content from a user message */
export function getUserMessageText(host: InteractiveModeDelegateHost, message: Message): string {
		if (message.role !== "user") return "";
		const textBlocks =
			typeof message.content === "string"
				? [{ type: "text", text: message.content }]
				: message.content.filter((c: { type: string }) => c.type === "text");
		return textBlocks.map((c) => (c as { text: string }).text).join("");
	}

	/**
	 * Show a status message in the chat.
	 *
	 * If multiple status messages are emitted back-to-back (without anything else being added to the chat),
	 * we update the previous status line instead of appending new ones to avoid log spam.
	 */
export function showStatus(host: InteractiveModeDelegateHost, message: string, options?: { append?: boolean }): void {
		const append = options?.append ?? false;
		const children = host.chatContainer.children;
		const last = children.length > 0 ? children[children.length - 1] : undefined;
		const secondLast = children.length > 1 ? children[children.length - 2] : undefined;

		if (!append && last && secondLast && last === host.lastStatusText && secondLast === host.lastStatusSpacer) {
			host.lastStatusText.setText(theme.fg("dim", message));
			host.ui.requestRender();
			return;
		}

		const spacer = new Spacer(1);
		const text = new Text(theme.fg("dim", message), 1, 0);
		host.chatContainer.addChild(spacer);
		host.chatContainer.addChild(text);
		host.lastStatusSpacer = spacer;
		host.lastStatusText = text;
		host.ui.requestRender();
	}

function addUserMessageComponent(host: InteractiveModeDelegateHost, userComponent: UserMessageComponent): void {
	host.chatContainer.addChild(userComponent);
}

function hasAssistantVisibleContent(content: Array<any>, hideThinkingBlock: boolean): boolean {
	return content.some((c: any) => {
		if (c?.type === "text" && typeof c.text === "string" && c.text.trim().length > 0) return true;
		if (!hideThinkingBlock && c?.type === "thinking" && typeof c.thinking === "string" && c.thinking.trim().length > 0) return true;
		return false;
	});
}

function finalizeChatMutation(host: InteractiveModeDelegateHost): void {
	trimChatHistory(host);
	reconcileChatTurnConnections(host.chatContainer.children);
}

export function addMessageToChat(host: InteractiveModeDelegateHost, message: AgentMessage, options?: { populateHistory?: boolean }): void {
		const timestampFormat = host.settingsManager.getTimestampFormat();
		switch (message.role) {
			case "bashExecution": {
				const component = new BashExecutionComponent(message.command, host.ui, message.excludeFromContext);
				if (message.output) {
					component.appendOutput(message.output);
				}
				component.setComplete(
					message.exitCode,
					message.cancelled,
					message.truncated ? ({ truncated: true } as TruncationResult) : undefined,
					message.fullOutputPath,
				);
				host.chatContainer.addChild(component);
				break;
			}
			case "custom": {
				if (message.display) {
					const renderer = host.session.extensionRunner?.getMessageRenderer(message.customType);
					const component = new CustomMessageComponent(message, renderer, host.getMarkdownThemeWithSettings());
					component.setExpanded(host.toolOutputExpanded);
					host.chatContainer.addChild(component);
				}
				break;
			}
			case "compactionSummary": {
				host.chatContainer.addChild(new Spacer(1));
				const component = new CompactionSummaryMessageComponent(message, host.getMarkdownThemeWithSettings());
				component.setExpanded(host.toolOutputExpanded);
				host.chatContainer.addChild(component);
				break;
			}
			case "branchSummary": {
				host.chatContainer.addChild(new Spacer(1));
				const component = new BranchSummaryMessageComponent(message, host.getMarkdownThemeWithSettings());
				component.setExpanded(host.toolOutputExpanded);
				host.chatContainer.addChild(component);
				break;
			}
			case "user": {
				const textContent = getUserMessageText(host, message);
				if (textContent) {
					const skillBlock = parseSkillBlock(textContent);
					if (skillBlock) {
						// Render skill block (collapsible)
						host.chatContainer.addChild(new Spacer(1));
						const component = new SkillInvocationMessageComponent(
							skillBlock,
							host.getMarkdownThemeWithSettings(),
						);
						component.setExpanded(host.toolOutputExpanded);
						host.chatContainer.addChild(component);
						// Render user message separately if present
						if (skillBlock.userMessage) {
							const userComponent = new UserMessageComponent(
								skillBlock.userMessage,
								host.getMarkdownThemeWithSettings(),
								message.timestamp,
								timestampFormat,
							);
							addUserMessageComponent(host, userComponent);
						}
					} else {
						const userComponent = new UserMessageComponent(textContent, host.getMarkdownThemeWithSettings(), message.timestamp, timestampFormat);
						addUserMessageComponent(host, userComponent);
					}
					if (options?.populateHistory) {
						host.editor.addToHistory?.(textContent);
					}
				}
				break;
			}
			case "assistant": {
				const hasToolBlocks = message.content.some((c: any) => isToolContentBlock(c));
				const isAbortOrError = message.stopReason === "aborted" || message.stopReason === "error";
				if (!hasAssistantVisibleContent(message.content, host.hideThinkingBlock) && !(isAbortOrError && !hasToolBlocks)) break;
				const assistantComponent = new AssistantMessageComponent(
					message,
					host.hideThinkingBlock,
					host.getMarkdownThemeWithSettings(),
					timestampFormat,
				);
				host.chatContainer.addChild(assistantComponent);
				break;
			}
			case "toolResult": {
				// Tool results are rendered inline with tool calls, handled separately
				break;
			}
			default: {
				const _exhaustive: never = message;
			}
		}
		finalizeChatMutation(host);
	}

	/**
	 * Remove oldest components when chat exceeds MAX_CHAT_COMPONENTS.
	 * Only render-components are removed — session data stays in SessionManager.
	 */
export function trimChatHistory(host: InteractiveModeDelegateHost): void {
		while (host.chatContainer.children.length > MAX_CHAT_COMPONENTS) {
			const oldest = host.chatContainer.children[0];
			host.chatContainer.removeChild(oldest);
		}
	}

	/**
	 * Render session context to chat. Used for initial load and rebuild after compaction.
	 * @param sessionContext Session context to render
	 * @param options.updateFooter Update footer state
	 * @param options.populateHistory Add user messages to editor history
	 */
export function renderSessionContext(host: InteractiveModeDelegateHost, 
		sessionContext: SessionContext,
		options: {
			updateFooter?: boolean;
			populateHistory?: boolean;
			liveTools?: ReadonlyMap<string, ToolExecutionComponent>;
			onToolCreated?: (component: ToolExecutionComponent) => void;
		} = {},
	): void {
		host.pendingTools.clear();
		const timestampFormat = host.settingsManager.getTimestampFormat();
		const lastToolCall = new Map<string, unknown>();
		if (options.liveTools?.size) {
			for (const message of sessionContext.messages) {
				if (message.role !== "assistant") continue;
				for (const content of message.content) {
					if (content.type === "toolCall") lastToolCall.set(content.id, content);
					else {
						const serverTool = asServerToolUse(content);
						if (serverTool) lastToolCall.set(serverTool.id, content);
					}
				}
			}
		}

		if (options.updateFooter) {
			host.footer.invalidate();
			host.updateEditorBorderColor();
		}

		for (const message of sessionContext.messages) {
			// Assistant messages need special handling for tool calls
			if (message.role === "assistant") {
				const hasToolBlocks = message.content.some((c) => isToolContentBlock(c));
				if (!hasToolBlocks) {
					addMessageToChat(host, message);
					continue;
				}

				const assistantSegments: AssistantMessageComponent[] = [];
				const replaySegments = buildAssistantReplaySegments(message.content);

				for (const segment of replaySegments) {
					if (segment.kind === "assistant") {
						const segContent = message.content.slice(segment.startIndex, segment.endIndex + 1);
						if (!hasAssistantVisibleContent(segContent, host.hideThinkingBlock)) continue;
						const assistantComponent = new AssistantMessageComponent(
							message,
							host.hideThinkingBlock,
							host.getMarkdownThemeWithSettings(),
							timestampFormat,
							{ startIndex: segment.startIndex, endIndex: segment.endIndex },
						);
						host.chatContainer.addChild(assistantComponent);
						assistantSegments.push(assistantComponent);
						continue;
					}

					const content = message.content[segment.contentIndex];
					if (content.type === "toolCall") {
						const candidate = options.liveTools?.get(content.id);
						const liveComponent = lastToolCall.get(content.id) === content && candidate?.matchesInvocation(content.name, content.arguments) ? candidate : undefined;
						const component = liveComponent ?? new ToolExecutionComponent(
							content.name,
							content.arguments,
							{ showImages: host.settingsManager.getShowImages() },
							host.getRegisteredToolDefinition(content.name),
							host.ui,
						);
						host.chatContainer.addChild(component);
						if (!liveComponent) options.onToolCreated?.(component);
						if (liveComponent) {
							host.pendingTools.set(content.id, component);
							continue;
						}
						component.setExpanded(host.toolOutputExpanded);

						// On an aborted/errored turn, only the tool calls that never
						// produced a result should render as interrupted. A tool that
						// actually completed has its result in a later `toolResult`
						// message (keyed by toolCallId) — register it as pending so the
						// normal toolResult handler below renders the TRUE result with
						// its real isError flag. Otherwise the successful result would be
						// silently discarded and the row shown red.
						const turnAbortedOrErrored =
							message.stopReason === "aborted" || message.stopReason === "error";
						const hasRealResult =
							turnAbortedOrErrored &&
							sessionContext.messages.some(
								(m) => m.role === "toolResult" && m.toolCallId === content.id,
							);

						if (turnAbortedOrErrored && !hasRealResult) {
							let errorMessage: string;
							if (message.stopReason === "aborted") {
								const retryAttempt = host.session.retryAttempt;
								errorMessage =
									retryAttempt > 0
										? `Aborted after ${retryAttempt} retry attempt${retryAttempt > 1 ? "s" : ""}`
										: "Operation aborted";
							} else {
								errorMessage = message.errorMessage || "Error";
							}
							component.updateResult({ content: [{ type: "text", text: errorMessage }], isError: true });
						} else {
							host.pendingTools.set(content.id, component);
						}
					} else {
						const serverTool = asServerToolUse(content);
						if (serverTool) {
						// Server-side tool (e.g., native web search)
						const candidate = options.liveTools?.get(serverTool.id);
						const liveComponent = lastToolCall.get(serverTool.id) === content && candidate?.matchesInvocation(serverTool.name, serverTool.input ?? {}) ? candidate : undefined;
						const component = liveComponent ?? new ToolExecutionComponent(
							serverTool.name,
							serverTool.input ?? {},
							{ showImages: host.settingsManager.getShowImages() },
							undefined,
							host.ui,
						);
						host.chatContainer.addChild(component);
						if (!liveComponent) options.onToolCreated?.(component);
						if (liveComponent) {
							host.pendingTools.set(serverTool.id, component);
							continue;
						}
						component.setExpanded(host.toolOutputExpanded);
						// Find matching webSearchResult in host message's content
						const resultBlock = message.content
							.map(asWebSearchResult)
							.find((block) => block && block.toolUseId === serverTool.id);
						if (resultBlock) {
							const searchContent = resultBlock.content;
							const isError = searchContent && typeof searchContent === "object" && "type" in (searchContent as any) && (searchContent as any).type === "web_search_tool_result_error";
							const resultText = host.formatWebSearchResult(searchContent);
							component.updateResult({
								content: [{ type: "text", text: resultText }],
								isError: !!isError,
							});
						} else {
							// No result yet (aborted stream?) — show as pending
							host.pendingTools.set(serverTool.id, component);
						}
						}
					}
				}

				// Match streaming-mode behavior: show metadata once on the final
				// assistant prose segment for host message.
				const lastAssistantSegment = assistantSegments[assistantSegments.length - 1];
				lastAssistantSegment?.setShowMetadata(true);
			} else if (message.role === "toolResult") {
				// Match tool results to pending tool components
				const component = host.pendingTools.get(message.toolCallId);
				if (component && options.liveTools?.get(message.toolCallId) !== component) {
					component.updateResult(message);
					host.pendingTools.delete(message.toolCallId);
				}
			} else {
				// All other messages use standard rendering
				addMessageToChat(host, message, options);
			}
		}

		// Any pendingTools entries left over after replay are historical tool
		// calls whose results were squashed out of session context (commonly by
		// compaction). Mark them finished so the frame stops showing "Running".
		for (const [id, component] of host.pendingTools.entries()) {
			if (options.liveTools?.get(id) === component) continue;
			component.markHistoricalNoResult();
			host.pendingTools.delete(id);
		}
		trimChatHistory(host);
		reconcileChatTurnConnections(host.chatContainer.children);
		host.ui.requestRender();
	}

export function renderInitialMessages(host: InteractiveModeDelegateHost): void {
		const context = host.sessionManager.buildSessionContext();
		renderSessionContext(host, context, {
			updateFooter: true,
			populateHistory: true,
		});
		populatePinnedFromMessages(host, context.messages);

		const allEntries = host.sessionManager.getEntries();
		const compactionCount = allEntries.filter((e: { type: string }) => e.type === "compaction").length;
		if (compactionCount > 0) {
			const times = compactionCount === 1 ? "1 time" : `${compactionCount} times`;
			showStatus(host, `Session compacted ${times}`);
		}
	}

export async function getUserInput(host: InteractiveModeDelegateHost): Promise<string> {
		return new Promise((resolve) => {
			host.onInputCallback = (text: string) => {
				host.onInputCallback = undefined;
				resolve(text);
			};
		});
	}

export function rebuildChatFromMessages(host: InteractiveModeDelegateHost): void {
		host.chatContainer.clear();
		host.pinnedMessageContainer.clear();
		const context = host.sessionManager.buildSessionContext();
		renderSessionContext(host, context);
		// Pinned content NOT re-populated here — the streaming lifecycle in
		// chat-controller.ts manages the pinned zone during active work.
		// populatePinnedFromMessages() remains in renderInitialMessages()
		// for the session-resume case at startup.
	}

/** Rebuild visibility without exposing a cleared frame or replacing live tool state. */
export function rebuildChatWithThinkingVisibility(host: InteractiveModeDelegateHost, hideThinkingBlock: boolean): void {
	const previousSetting = host.settingsManager.getHideThinkingBlock?.() ?? host.hideThinkingBlock;
	const oldChildren = host.chatContainer.children.slice();
	const liveTools = new Map<string, ToolExecutionComponent>(host.pendingTools ?? []);
	const oldStream = host.streamingRenderState;
	const preserveLive = !!host.streamingMessage || liveTools.size > 0;
	const retained = new Set<any>([
		...liveTools.values(),
		...(oldStream?.renderedSegments ?? []).map((segment: any) => segment.component),
		...(oldStream?.orphanedSegments ?? []).map((segment: any) => segment.component),
		host.streamingComponent,
	]);
	const orphanClones = new Map<any, AssistantMessageComponent>();
	for (const segment of oldStream?.orphanedSegments ?? []) {
		if (segment.kind === "text-run") orphanClones.set(segment.component, segment.component.cloneWithThinkingVisibility(hideThinkingBlock));
	}
	const stagedValues = {
		chatContainer: new Container(),
		pinnedMessageContainer: new Container(),
		pendingTools: new Map<string, ToolExecutionComponent>(),
		hideThinkingBlock,
		streamingComponent: host.streamingComponent,
		streamingRenderState: oldStream ? Object.assign(createStreamingRenderState(), oldStream, {
			renderedSegments: oldStream.renderedSegments.map((segment: any) => ({ ...segment })),
			orphanedSegments: oldStream.orphanedSegments.map((segment: any) => ({ ...segment, component: orphanClones.get(segment.component) ?? segment.component })),
			_desiredSegmentsCache: undefined,
		}) : undefined,
	};
	// The real mode exposes streaming state through a getter-only property.
	// Own descriptors shadow it without invoking inherited mode setters.
	const staged = Object.create(host, Object.fromEntries(Object.entries(stagedValues).map(([key, value]) => [key, {
		value, writable: true, configurable: true, enumerable: true,
	}])));
	const createdTools = new Set<ToolExecutionComponent>();
	const onToolCreated = (component: ToolExecutionComponent): void => { createdTools.add(component); };
	const disposeNewTools = (): void => {
		for (const component of new Set<any>([...createdTools, ...staged.chatContainer.children, ...staged.pendingTools.values()])) {
			if (component instanceof ToolExecutionComponent && !retained.has(component)) component.dispose();
		}
	};
	let persistAttempted = false;
	try {
		const context = host.sessionManager.buildSessionContext();
		const replayTools = new Map(liveTools);
		// A partial assistant is not persisted yet. Its reused IDs must not
		// replace older completed invocations in historical replay.
		for (const content of host.streamingMessage?.content ?? []) {
			if (content.type === "toolCall") replayTools.delete(content.id);
			else {
				const serverTool = asServerToolUse(content);
				if (serverTool) replayTools.delete(serverTool.id);
			}
		}
		renderSessionContext(staged, context, { liveTools: replayTools, onToolCreated });
		if (preserveLive) {
			staged.pinnedMessageContainer.children = host.pinnedMessageContainer.children.slice();
			for (const component of oldChildren) {
				const visibleComponent = orphanClones.get(component) ?? component;
				if (retained.has(component) && !staged.chatContainer.children.includes(visibleComponent)) staged.chatContainer.addChild(visibleComponent);
			}
			for (const [id, component] of liveTools) staged.pendingTools.set(id, component);
			if (host.streamingMessage && staged.streamingRenderState) {
				const timestampFormat = host.settingsManager.getTimestampFormat();
				if (staged.streamingRenderState.renderedSegments.length > 0) {
					rebuildSegmentsOnMessageEnd(staged, staged.streamingRenderState, timestampFormat, { onToolCreated });
				} else {
					runSegmentWalker(staged, staged.streamingRenderState, timestampFormat);
				}
			} else if (host.streamingComponent && host.streamingMessage) {
				staged.chatContainer.removeChild(host.streamingComponent);
				staged.streamingComponent = new AssistantMessageComponent(host.streamingMessage, hideThinkingBlock, host.getMarkdownThemeWithSettings(), host.settingsManager.getTimestampFormat());
				staged.chatContainer.addChild(staged.streamingComponent);
			}
		}
		// Persist only after all fallible replay/component work has succeeded.
		persistAttempted = true;
		host.settingsManager.setHideThinkingBlock(hideThinkingBlock);
	} catch (error) {
		if (persistAttempted) {
			try { host.settingsManager.setHideThinkingBlock(previousSetting); } catch { /* Preserve the original failure. */ }
		}
		disposeNewTools();
		throw error;
	}
	host.hideThinkingBlock = hideThinkingBlock;
	host.chatContainer.children = staged.chatContainer.children;
	host.pinnedMessageContainer.children = staged.pinnedMessageContainer.children;
	host.pendingTools.clear();
	for (const [id, component] of staged.pendingTools) host.pendingTools.set(id, component);
	if (oldStream) Object.assign(oldStream, staged.streamingRenderState);
	host.streamingComponent = staged.streamingComponent;
	const mounted = new Set<any>([...host.chatContainer.children, ...host.pendingTools.values()]);
	for (const component of createdTools) {
		if (!mounted.has(component)) component.dispose();
	}
	for (const component of oldChildren) {
		if (component instanceof ToolExecutionComponent && !mounted.has(component)) component.dispose();
	}
	host.ui.requestRender();
}

	/**
	 * After rebuilding chat from messages, pin the last assistant text above the
	 * editor if tool results would otherwise push it out of the viewport.
	 */
export function populatePinnedFromMessages(host: InteractiveModeDelegateHost, messages: AgentMessage[]): void {
		host.pinnedMessageContainer.clear();

		// Walk backwards to find the last assistant message
		let lastAssistant: AssistantMessage | undefined;
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i];
			if (msg && "role" in msg && msg.role === "assistant") {
				lastAssistant = msg as AssistantMessage;
				break;
			}
		}
		if (!lastAssistant) return;

		// Check if any tool calls follow the last text block
		const content = lastAssistant.content;
		let lastTextIndex = -1;
		let hasToolAfterText = false;
		for (let i = 0; i < content.length; i++) {
			if (content[i].type === "text") lastTextIndex = i;
		}
		if (lastTextIndex >= 0) {
			for (let i = lastTextIndex + 1; i < content.length; i++) {
				if (isToolContentBlock(content[i])) {
					hasToolAfterText = true;
					break;
				}
			}
		}
		if (!hasToolAfterText || lastTextIndex < 0) return;

		const textBlock = content[lastTextIndex] as { type: "text"; text: string };
		const text = textBlock.text?.trim();
		if (!text) return;

		host.pinnedMessageContainer.addChild(
			new DynamicBorder((str: string) => theme.fg("dim", str), "Latest Output"),
		);
		host.pinnedMessageContainer.addChild(
			new Markdown(text, 1, 0, host.getMarkdownThemeWithSettings()),
		);
	}
