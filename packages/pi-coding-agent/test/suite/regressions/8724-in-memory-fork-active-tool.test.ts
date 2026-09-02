import {
	AgentSessionRuntime,
	type AgentSession,
	type AgentSessionServices,
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
} from "@gsd/agent-core";
import type { AgentTool, AgentToolResult } from "@gsd/pi-agent-core";
import {
	type AssistantMessage,
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	fauxToolCall,
	type Message,
} from "@gsd/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness } from "../harness.ts";

async function waitForStage<T>(label: string, promise: Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error(`Timed out while ${label}`)), 1_000);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

describe("regression #8724: in-memory fork during an active tool turn", () => {
	const cleanups: Array<() => Promise<void> | void> = [];

	afterEach(async () => {
		while (cleanups.length > 0) {
			await cleanups.pop()?.();
		}
	});

	it("does not append the aborted turn to the replacement session", async () => {
		let markToolStarted = () => {};
		const toolStarted = new Promise<void>((resolve) => {
			markToolStarted = resolve;
		});
		const blockingTool: AgentTool = {
			name: "block",
			label: "Block",
			description: "Wait until aborted",
			parameters: Type.Object({}),
			execute: (_toolCallId, _params, signal) =>
				new Promise<AgentToolResult<unknown>>((resolve) => {
					markToolStarted();
					signal?.addEventListener(
						"abort",
						() => resolve({ content: [{ type: "text", text: "tool aborted" }], details: {} }),
						{ once: true },
					);
				}),
		};
		const harness = await createHarness({ tools: [blockingTool] });
		const services: AgentSessionServices = {
			cwd: harness.tempDir,
			agentDir: harness.tempDir,
			authStorage: harness.authStorage,
			settingsManager: harness.settingsManager,
			modelRegistry: harness.session.modelRegistry,
			resourceLoader: harness.session.resourceLoader,
			diagnostics: [],
		};
		const createRuntime: CreateAgentSessionRuntimeFactory = async ({ sessionManager, sessionStartEvent }) => ({
			...(await createAgentSessionFromServices({
				services,
				sessionManager,
				sessionStartEvent,
				model: harness.getModel(),
				noTools: "all",
			})),
			services,
			diagnostics: [],
		});
		const runtime = new AgentSessionRuntime(harness.session, services, createRuntime);
		await runtime.session.bindExtensions({});
		expect(runtime.session.getActiveToolNames()).toContain("block");
		cleanups.push(async () => {
			if (runtime.session !== harness.session) {
				await runtime.dispose();
			}
			harness.cleanup();
		});

		type ResponseStep = AssistantMessage | ((messages: Message[]) => AssistantMessage);
		let responses: ResponseStep[] = [
			fauxAssistantMessage("first response"),
			fauxAssistantMessage(fauxToolCall("block", {}), { stopReason: "toolUse" }),
			fauxAssistantMessage("unused after abort"),
		];
		const installResponseStream = (session: AgentSession) => {
			session.agent.streamFn = (model, context) => {
				const stream = createAssistantMessageEventStream();
				queueMicrotask(() => {
					const step = responses.shift();
					if (!step) throw new Error("No response queued");
					const response = typeof step === "function" ? step(context.messages) : step;
					const message = { ...response, api: model.api, provider: model.provider, model: model.id };
					stream.push({ type: "done", reason: message.stopReason, message });
				});
				return stream;
			};
		};
		installResponseStream(runtime.session);
		await waitForStage("running the initial prompt", runtime.session.prompt("first prompt"));
		const firstUserEntryId = runtime.session.getUserMessagesForForking()[0]?.entryId;
		expect(firstUserEntryId).toBeDefined();

		const outgoingPrompt = runtime.session.prompt("start blocking tool");
		await waitForStage("waiting for the blocking tool", toolStarted);
		const forkResult = await waitForStage("forking the active session", runtime.fork(firstUserEntryId!));
		await waitForStage("settling the outgoing prompt", outgoingPrompt);
		await waitForStage("binding the replacement session", runtime.session.bindExtensions({}));
		installResponseStream(runtime.session);

		expect(forkResult).toEqual({ cancelled: false, selectedText: "first prompt" });
		expect(runtime.session.messages).toEqual([]);
		expect(runtime.session.sessionManager.getEntries().filter((entry) => entry.type === "message")).toEqual([]);

		let capturedRoles: string[] = [];
		responses = [
			(messages) => {
				capturedRoles = messages.map((message) => message.role);
				return fauxAssistantMessage("next response");
			},
		];
		await waitForStage("running the replacement prompt", runtime.session.prompt("next prompt"));

		expect(capturedRoles).toEqual(["user"]);
	});
});
