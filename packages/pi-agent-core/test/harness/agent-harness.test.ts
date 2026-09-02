import { fauxAssistantMessage, fauxToolCall, getModel, registerFauxProvider, type Usage } from "@gsd/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { AgentHarness } from "../../src/harness/agent-harness.ts";
import { NodeExecutionEnv } from "../../src/harness/env/nodejs.ts";
import { InMemorySessionStorage } from "../../src/harness/session/memory-storage.ts";
import { Session } from "../../src/harness/session/session.ts";
import type { PromptTemplate, SessionTreeEntry, Skill } from "../../src/harness/types.ts";
import type { AgentMessage, AgentTool } from "../../src/types.ts";
import { calculateTool } from "../utils/calculate.ts";
import { getCurrentTimeTool } from "../utils/get-current-time.ts";

interface AppSkill extends Skill {
	source: "project" | "user";
}

interface AppPromptTemplate extends PromptTemplate {
	source: "project" | "user";
}

interface AppTool extends AgentTool {
	source: "builtin" | "extension";
}

const registrations: Array<{ unregister(): void }> = [];

function textFromUserMessages(messages: Array<{ role: string; content: unknown }>): string[] {
	return messages.flatMap((message) => {
		if (message.role !== "user") return [];
		if (typeof message.content === "string") return [message.content];
		if (!Array.isArray(message.content)) return [];
		return message.content.flatMap((part) => {
			if (!part || typeof part !== "object" || !("type" in part) || part.type !== "text") return [];
			return "text" in part && typeof part.text === "string" ? [part.text] : [];
		});
	});
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve = () => {};
	const promise = new Promise<void>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

class BlockingSessionStorage extends InMemorySessionStorage {
	readonly writeStarted = deferred();
	readonly releaseWrite = deferred();

	override async appendEntry(entry: SessionTreeEntry): Promise<void> {
		this.writeStarted.resolve();
		await this.releaseWrite.promise;
		await super.appendEntry(entry);
	}
}

function getReasoning(options: unknown): unknown {
	if (!options || typeof options !== "object" || !("reasoning" in options)) return undefined;
	return options.reasoning;
}

function createUsage(input: number, output: number, cacheRead = 0, cacheWrite = 0): Usage {
	return {
		input,
		output,
		cacheRead,
		cacheWrite,
		totalTokens: input + output + cacheRead + cacheWrite,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

afterEach(() => {
	for (const registration of registrations.splice(0)) {
		registration.unregister();
	}
});

describe("AgentHarness", () => {
	it("constructs directly and exposes queue modes", () => {
		const session = new Session(new InMemorySessionStorage());
		const env = new NodeExecutionEnv({ cwd: process.cwd() });
		const initialModel = getModel("anthropic", "claude-sonnet-4-5");
		const harness = new AgentHarness({
			env,
			session,
			model: initialModel,
			thinkingLevel: "high",
			systemPrompt: "You are helpful.",
			steeringMode: "all",
			followUpMode: "all",
		});
		expect(harness.env).toBe(env);
		expect(harness.getModel()).toBe(initialModel);
		expect(harness.getThinkingLevel()).toBe("high");
		expect(harness.getSteeringMode()).toBe("all");
		expect(harness.getFollowUpMode()).toBe("all");
		harness.setSteeringMode("one-at-a-time");
		harness.setFollowUpMode("one-at-a-time");
		expect(harness.getSteeringMode()).toBe("one-at-a-time");
		expect(harness.getFollowUpMode()).toBe("one-at-a-time");
	});

	it("shutdown aborts and awaits an active prompt and rejects future work", async () => {
		const registration = registerFauxProvider();
		registrations.push(registration);
		const entered = deferred();
		const release = deferred();
		let signal: AbortSignal | undefined;
		registration.setResponses([
			async (_context, options) => {
				signal = options?.signal;
				entered.resolve();
				await release.promise;
				return fauxAssistantMessage("finished after shutdown");
			},
		]);
		const harness = new AgentHarness({
			env: new NodeExecutionEnv({ cwd: process.cwd() }),
			session: new Session(new InMemorySessionStorage()),
			model: registration.getModel(),
		});

		const prompt = harness.prompt("hello");
		await entered.promise;
		let shutdownSettled = false;
		const shutdown = harness.shutdown().then(() => {
			shutdownSettled = true;
		});
		const secondShutdown = harness.shutdown();
		await Promise.resolve();

		expect(signal?.aborted).toBe(true);
		expect(shutdownSettled).toBe(false);
		release.resolve();
		await expect(prompt).resolves.toMatchObject({ role: "assistant" });
		await Promise.all([shutdown, secondShutdown]);
		await expect(harness.prompt("again")).rejects.toMatchObject({
			code: "invalid_state",
			message: "AgentHarness has been shut down",
		});
		await expect(harness.nextTurn("again")).rejects.toMatchObject({ code: "invalid_state" });
	});

	it("shutdown prevents an active compaction result from being persisted", async () => {
		const registration = registerFauxProvider();
		registrations.push(registration);
		const entered = deferred();
		const release = deferred();
		let signal: AbortSignal | undefined;
		registration.setResponses([
			async (_context, options) => {
				signal = options?.signal;
				entered.resolve();
				await release.promise;
				return fauxAssistantMessage("summary produced after shutdown");
			},
		]);
		const session = new Session(new InMemorySessionStorage());
		await session.appendMessage({ role: "user", content: "one", timestamp: Date.now() });
		await session.appendMessage(fauxAssistantMessage("two"));
		const harness = new AgentHarness({
			env: new NodeExecutionEnv({ cwd: process.cwd() }),
			session,
			model: registration.getModel(),
			getApiKeyAndHeaders: async () => ({ apiKey: "secret" }),
		});

		const compaction = harness.compact();
		await entered.promise;
		const shutdown = harness.shutdown();
		expect(signal?.aborted).toBe(true);
		release.resolve();

		await expect(compaction).rejects.toMatchObject({ code: "compaction" });
		await shutdown;
		expect((await session.getEntries()).some((entry) => entry.type === "compaction")).toBe(false);
	});

	it("abort cancels active compaction and leaves the harness reusable", async () => {
		const registration = registerFauxProvider();
		registrations.push(registration);
		const entered = deferred();
		const release = deferred();
		let signal: AbortSignal | undefined;
		registration.setResponses([
			async (_context, options) => {
				signal = options?.signal;
				entered.resolve();
				await release.promise;
				return fauxAssistantMessage("cancelled summary");
			},
			fauxAssistantMessage("successful summary"),
		]);
		const session = new Session(new InMemorySessionStorage());
		await session.appendMessage({ role: "user", content: "one", timestamp: Date.now() });
		await session.appendMessage(fauxAssistantMessage("two"));
		const harness = new AgentHarness({
			env: new NodeExecutionEnv({ cwd: process.cwd() }),
			session,
			model: registration.getModel(),
			getApiKeyAndHeaders: async () => ({ apiKey: "secret" }),
		});

		const firstCompaction = harness.compact();
		await entered.promise;
		const abort = harness.abort();
		expect(signal?.aborted).toBe(true);
		release.resolve();

		await expect(firstCompaction).rejects.toMatchObject({ code: "compaction" });
		await expect(abort).resolves.toEqual({ clearedSteer: [], clearedFollowUp: [] });
		await expect(harness.compact()).resolves.toMatchObject({ summary: expect.stringContaining("successful summary") });
	});

	it("persists generated and hook-provided compaction usage", async () => {
		const registration = registerFauxProvider();
		registrations.push(registration);
		const generatedUsage = createUsage(2, 3, 4, 5);
		registration.setResponses([{ ...fauxAssistantMessage("generated summary"), usage: generatedUsage }]);
		const session = new Session(new InMemorySessionStorage());
		await session.appendMessage({ role: "user", content: "one", timestamp: Date.now() });
		await session.appendMessage(fauxAssistantMessage("two"));
		const harness = new AgentHarness({
			env: new NodeExecutionEnv({ cwd: process.cwd() }),
			session,
			model: registration.getModel(),
			getApiKeyAndHeaders: async () => ({ apiKey: "secret" }),
		});

		const generated = await harness.compact();
		const generatedEntry = (await session.getEntries()).find((entry) => entry.type === "compaction");
		expect(generated.usage?.totalTokens).toBeGreaterThan(0);
		expect(generatedEntry?.type === "compaction" ? generatedEntry.usage : undefined).toEqual(generated.usage);

		const hookUsage = createUsage(6, 7, 8, 9);
		await session.appendMessage({ role: "user", content: "after compaction", timestamp: Date.now() });
		harness.on("session_before_compact", (event) => ({
			compaction: {
				summary: "hook summary",
				firstKeptEntryId: event.preparation.firstKeptEntryId,
				tokensBefore: event.preparation.tokensBefore,
				usage: hookUsage,
			},
		}));
		const hooked = await harness.compact();
		const hookedEntry = (await session.getEntries()).findLast((entry) => entry.type === "compaction");
		expect(hooked.usage).toEqual(hookUsage);
		expect(hookedEntry?.type === "compaction" ? hookedEntry.usage : undefined).toEqual(hookUsage);
	});

	it("persists generated and hook-provided branch summary usage", async () => {
		const registration = registerFauxProvider();
		registrations.push(registration);
		const generatedUsage = createUsage(10, 11, 12, 13);
		registration.setResponses([{ ...fauxAssistantMessage("generated branch summary"), usage: generatedUsage }]);
		const session = new Session(new InMemorySessionStorage());
		const firstTarget = await session.appendMessage({ role: "user", content: "first", timestamp: Date.now() });
		await session.appendMessage(fauxAssistantMessage("first reply"));
		const secondTarget = await session.appendMessage({ role: "user", content: "second", timestamp: Date.now() });
		await session.appendMessage(fauxAssistantMessage("second reply"));
		const harness = new AgentHarness({
			env: new NodeExecutionEnv({ cwd: process.cwd() }),
			session,
			model: registration.getModel(),
			getApiKeyAndHeaders: async () => ({ apiKey: "secret" }),
		});

		const generated = await harness.navigateTree(firstTarget, { summarize: true });
		expect(generated.summaryEntry?.usage?.totalTokens).toBeGreaterThan(0);

		await session.moveTo(secondTarget);
		await session.appendMessage(fauxAssistantMessage("new second reply"));
		const hookUsage = createUsage(14, 15, 16, 17);
		harness.on("session_before_tree", () => ({ summary: { summary: "hook branch summary", usage: hookUsage } }));
		const hooked = await harness.navigateTree(firstTarget, { summarize: true });
		expect(hooked.summaryEntry?.usage).toEqual(hookUsage);
	});

	it("shutdown prevents active branch summarization from moving the leaf", async () => {
		const registration = registerFauxProvider();
		registrations.push(registration);
		const entered = deferred();
		const release = deferred();
		let signal: AbortSignal | undefined;
		registration.setResponses([
			async (_context, options) => {
				signal = options?.signal;
				entered.resolve();
				await release.promise;
				return fauxAssistantMessage("summary produced after shutdown");
			},
		]);
		const session = new Session(new InMemorySessionStorage());
		const targetId = await session.appendMessage({ role: "user", content: "first", timestamp: Date.now() });
		await session.appendMessage(fauxAssistantMessage("first reply"));
		await session.appendMessage({ role: "user", content: "abandoned", timestamp: Date.now() });
		const originalLeafId = await session.appendMessage(fauxAssistantMessage("abandoned reply"));
		const harness = new AgentHarness({
			env: new NodeExecutionEnv({ cwd: process.cwd() }),
			session,
			model: registration.getModel(),
			getApiKeyAndHeaders: async () => ({ apiKey: "secret" }),
		});

		const navigation = harness.navigateTree(targetId, { summarize: true });
		await entered.promise;
		const shutdown = harness.shutdown();
		expect(signal?.aborted).toBe(true);
		release.resolve();

		await expect(navigation).resolves.toEqual({ cancelled: true });
		await shutdown;
		expect(await session.getLeafId()).toBe(originalLeafId);
	});

	it("shutdown awaits an idle session mutation without making it an active operation", async () => {
		const storage = new BlockingSessionStorage();
		const harness = new AgentHarness({
			env: new NodeExecutionEnv({ cwd: process.cwd() }),
			session: new Session(storage),
			model: getModel("anthropic", "claude-sonnet-4-5"),
		});
		const mutation = harness.appendMessage({ role: "user", content: "concurrent", timestamp: Date.now() });
		await storage.writeStarted.promise;

		await expect(harness.waitForIdle()).resolves.toBeUndefined();
		let shutdownSettled = false;
		const shutdown = harness.shutdown().then(() => {
			shutdownSettled = true;
		});
		await Promise.resolve();
		expect(shutdownSettled).toBe(false);
		storage.releaseWrite.resolve();

		await Promise.all([mutation, shutdown]);
		expect(await storage.getEntries()).toHaveLength(1);
	});

	it("drains one queued steering message at a time and emits queue updates", async () => {
		const registration = registerFauxProvider();
		registrations.push(registration);
		const userCounts: number[] = [];
		registration.setResponses([
			(context) => {
				userCounts.push(context.messages.filter((message) => message.role === "user").length);
				return fauxAssistantMessage("first");
			},
			(context) => {
				userCounts.push(context.messages.filter((message) => message.role === "user").length);
				return fauxAssistantMessage("second");
			},
			(context) => {
				userCounts.push(context.messages.filter((message) => message.role === "user").length);
				return fauxAssistantMessage("third");
			},
		]);
		const harness = new AgentHarness({
			env: new NodeExecutionEnv({ cwd: process.cwd() }),
			session: new Session(new InMemorySessionStorage()),
			model: registration.getModel(),
			steeringMode: "one-at-a-time",
		});
		const steerQueueLengths: number[] = [];
		let queued = false;
		harness.subscribe((event) => {
			if (event.type === "queue_update") {
				steerQueueLengths.push(event.steer.length);
			}
			if (event.type === "message_start" && event.message.role === "assistant" && !queued) {
				queued = true;
				harness.steer("one");
				harness.steer("two");
			}
		});

		await harness.prompt("hello");

		expect(userCounts).toEqual([1, 2, 3]);
		expect(steerQueueLengths).toEqual([1, 2, 1, 0]);
	});

	it("appends before_agent_start messages and persists them", async () => {
		const registration = registerFauxProvider();
		registrations.push(registration);
		let requestText: string[] = [];
		registration.setResponses([
			(context) => {
				requestText = textFromUserMessages(context.messages);
				return fauxAssistantMessage("ok");
			},
		]);
		const session = new Session(new InMemorySessionStorage());
		const harness = new AgentHarness({
			env: new NodeExecutionEnv({ cwd: process.cwd() }),
			session,
			model: registration.getModel(),
		});
		harness.on("before_agent_start", () => ({
			messages: [{ role: "user", content: [{ type: "text", text: "hook" }], timestamp: Date.now() }],
		}));

		await harness.prompt("hello");

		const persistedText = (await session.getEntries()).flatMap((entry) => {
			if (entry.type !== "message" || entry.message.role !== "user") return [];
			const content = entry.message.content;
			if (typeof content === "string") return [content];
			return content.flatMap((part) => (part.type === "text" ? [part.text] : []));
		});
		expect(requestText).toEqual(["hello", "hook"]);
		expect(persistedText).toEqual(["hello", "hook"]);
	});

	it("abort clears steer and follow-up queues but preserves next-turn messages", async () => {
		const registration = registerFauxProvider();
		registrations.push(registration);
		let releaseFirstResponse: (() => void) | undefined;
		let abortedSignal: AbortSignal | undefined;
		const firstResponseReleased = new Promise<void>((resolve) => {
			releaseFirstResponse = resolve;
		});
		const secondRequestText: string[] = [];
		registration.setResponses([
			async (_context, options) => {
				abortedSignal = options?.signal;
				await firstResponseReleased;
				return fauxAssistantMessage("aborted-ish");
			},
			(context) => {
				secondRequestText.push(...textFromUserMessages(context.messages));
				return fauxAssistantMessage("second");
			},
		]);
		const harness = new AgentHarness({
			env: new NodeExecutionEnv({ cwd: process.cwd() }),
			session: new Session(new InMemorySessionStorage()),
			model: registration.getModel(),
		});
		const queueUpdates: Array<{ steer: number; followUp: number; nextTurn: number }> = [];
		harness.subscribe((event) => {
			if (event.type === "queue_update") {
				queueUpdates.push({
					steer: event.steer.length,
					followUp: event.followUp.length,
					nextTurn: event.nextTurn.length,
				});
			}
		});

		const firstPrompt = harness.prompt("first");
		await new Promise((resolve) => setTimeout(resolve, 0));
		harness.steer("steer");
		harness.followUp("follow");
		harness.nextTurn("next");
		const abortResultPromise = harness.abort();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(abortedSignal?.aborted).toBe(true);
		releaseFirstResponse?.();
		const abortResult = await abortResultPromise;
		await firstPrompt;
		await harness.prompt("second");

		expect(abortResult.clearedSteer).toHaveLength(1);
		expect(abortResult.clearedFollowUp).toHaveLength(1);
		expect(queueUpdates).toContainEqual({ steer: 0, followUp: 0, nextTurn: 1 });
		expect(secondRequestText).toEqual(["first", "next", "second"]);
	});

	it("drains follow-up messages one at a time after the agent would otherwise stop", async () => {
		const registration = registerFauxProvider();
		registrations.push(registration);
		const userCounts: number[] = [];
		registration.setResponses([
			(context) => {
				userCounts.push(context.messages.filter((message) => message.role === "user").length);
				return fauxAssistantMessage("first");
			},
			(context) => {
				userCounts.push(context.messages.filter((message) => message.role === "user").length);
				return fauxAssistantMessage("second");
			},
			(context) => {
				userCounts.push(context.messages.filter((message) => message.role === "user").length);
				return fauxAssistantMessage("third");
			},
		]);
		const harness = new AgentHarness({
			env: new NodeExecutionEnv({ cwd: process.cwd() }),
			session: new Session(new InMemorySessionStorage()),
			model: registration.getModel(),
			followUpMode: "one-at-a-time",
		});
		const followUpQueueLengths: number[] = [];
		let queued = false;
		harness.subscribe((event) => {
			if (event.type === "queue_update") {
				followUpQueueLengths.push(event.followUp.length);
			}
			if (event.type === "message_start" && event.message.role === "assistant" && !queued) {
				queued = true;
				harness.followUp("one");
				harness.followUp("two");
			}
		});

		await harness.prompt("hello");

		expect(userCounts).toEqual([1, 2, 3]);
		expect(followUpQueueLengths).toEqual([1, 2, 1, 0]);
	});

	it("settles thrown hook failures with persisted assistant error messages", async () => {
		const registration = registerFauxProvider();
		registrations.push(registration);
		registration.setResponses([() => fauxAssistantMessage("should not be used")]);
		const session = new Session(new InMemorySessionStorage());
		const harness = new AgentHarness({
			env: new NodeExecutionEnv({ cwd: process.cwd() }),
			session,
			model: registration.getModel(),
		});
		const events: string[] = [];
		harness.subscribe((event) => {
			events.push(event.type);
		});
		harness.on("context", () => {
			throw new Error("context exploded");
		});

		const response = await harness.prompt("hello");
		await expect(harness.prompt("after failure")).resolves.toMatchObject({ role: "assistant" });

		const entries = await session.getEntries();
		const messages = entries.flatMap((entry) => (entry.type === "message" ? [entry.message] : []));
		expect(response.stopReason).toBe("error");
		expect(response.errorMessage).toBe("context exploded");
		expect(messages[0]?.role).toBe("user");
		expect(messages[1]).toMatchObject({ role: "assistant", stopReason: "error", errorMessage: "context exploded" });
		expect(events).toContain("agent_end");
		expect(events).toContain("settled");
	});

	it("refreshes model, thinking level, resources, system prompt, and active tools at save points", async () => {
		const registration = registerFauxProvider({
			models: [
				{ id: "first", reasoning: true },
				{ id: "second", reasoning: true },
			],
		});
		registrations.push(registration);
		const secondModel = registration.getModel("second");
		if (!secondModel) throw new Error("missing second faux model");
		const captured: Array<{ modelId: string; reasoning: unknown; systemPrompt: string; tools: string[] }> = [];
		registration.setResponses([
			(context, options, _state, model) => {
				captured.push({
					modelId: model.id,
					reasoning: getReasoning(options),
					systemPrompt: context.systemPrompt ?? "",
					tools: context.tools?.map((tool) => tool.name) ?? [],
				});
				return fauxAssistantMessage(fauxToolCall("calculate", { expression: "1 + 1" }, { id: "call-1" }), {
					stopReason: "toolUse",
				});
			},
			(context, options, _state, model) => {
				captured.push({
					modelId: model.id,
					reasoning: getReasoning(options),
					systemPrompt: context.systemPrompt ?? "",
					tools: context.tools?.map((tool) => tool.name) ?? [],
				});
				return fauxAssistantMessage("done");
			},
		]);
		const harness = new AgentHarness<Skill, PromptTemplate, AgentTool>({
			env: new NodeExecutionEnv({ cwd: process.cwd() }),
			session: new Session(new InMemorySessionStorage()),
			model: registration.getModel(),
			thinkingLevel: "off",
			resources: {
				skills: [{ name: "prompt", description: "prompt", content: "first prompt", filePath: "/skills/prompt" }],
			},
			systemPrompt: ({ resources }) => resources.skills?.[0]?.content ?? "missing prompt",
			tools: [calculateTool],
		});
		harness.subscribe((event) => {
			if (event.type === "tool_execution_start") {
				void harness.setModel(secondModel);
				void harness.setThinkingLevel("high");
				void harness.setResources({
					skills: [
						{ name: "prompt", description: "prompt", content: "second prompt", filePath: "/skills/prompt" },
					],
				});
				void harness.setTools([calculateTool, getCurrentTimeTool], [getCurrentTimeTool.name]);
			}
		});

		await harness.prompt("hello");

		expect(captured).toEqual([
			{ modelId: "first", reasoning: undefined, systemPrompt: "first prompt", tools: ["calculate"] },
			{ modelId: "second", reasoning: "high", systemPrompt: "second prompt", tools: ["get_current_time"] },
		]);
	});

	it("orders pending listener session writes after agent-emitted messages", async () => {
		const registration = registerFauxProvider();
		registrations.push(registration);
		registration.setResponses([() => fauxAssistantMessage("ok")]);
		const session = new Session(new InMemorySessionStorage());
		const harness = new AgentHarness({
			env: new NodeExecutionEnv({ cwd: process.cwd() }),
			session,
			model: registration.getModel(),
		});
		let wrotePendingMessage = false;
		harness.subscribe(async (event) => {
			if (event.type === "message_end" && event.message.role === "assistant" && !wrotePendingMessage) {
				wrotePendingMessage = true;
				await harness.appendMessage({
					role: "custom",
					customType: "listener",
					content: "listener write",
					display: true,
					timestamp: Date.now(),
				} as AgentMessage);
			}
		});

		await harness.prompt("hello");

		const entries = await session.getEntries();
		const roles = entries.flatMap((entry) => (entry.type === "message" ? [entry.message.role] : []));
		expect(roles).toEqual(["user", "assistant", "custom"]);
	});

	it("waitForIdle waits for external run settlement and awaited listeners", async () => {
		const registration = registerFauxProvider();
		registrations.push(registration);
		registration.setResponses([() => fauxAssistantMessage("ok")]);
		const barrier = deferred();
		const harness = new AgentHarness({
			env: new NodeExecutionEnv({ cwd: process.cwd() }),
			session: new Session(new InMemorySessionStorage()),
			model: registration.getModel(),
		});
		let listenerFinished = false;
		harness.subscribe(async (event) => {
			if (event.type === "agent_end") {
				await barrier.promise;
				listenerFinished = true;
			}
		});

		const promptPromise = harness.prompt("hello");
		let idleResolved = false;
		const idlePromise = harness.waitForIdle().then(() => {
			idleResolved = true;
		});
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(idleResolved).toBe(false);
		expect(listenerFinished).toBe(false);
		barrier.resolve();
		await Promise.all([promptPromise, idlePromise]);
		expect(idleResolved).toBe(true);
		expect(listenerFinished).toBe(true);
	});

	it("runs tool_call and tool_result hooks through the direct loop", async () => {
		const registration = registerFauxProvider();
		registrations.push(registration);
		registration.setResponses([
			() =>
				fauxAssistantMessage(fauxToolCall("calculate", { expression: "2 + 2" }, { id: "call-1" }), {
					stopReason: "toolUse",
				}),
		]);
		const session = new Session(new InMemorySessionStorage());
		const toolUsage = createUsage(1, 2, 3, 4);
		const patchedToolUsage = createUsage(5, 6, 7, 8);
		const calculateToolWithUsage: typeof calculateTool = {
			...calculateTool,
			execute: async (toolCallId, params, signal, onUpdate) => ({
				...(await calculateTool.execute(toolCallId, params, signal, onUpdate)),
				usage: toolUsage,
			}),
		};
		const harness = new AgentHarness({
			env: new NodeExecutionEnv({ cwd: process.cwd() }),
			session,
			model: registration.getModel(),
			tools: [calculateToolWithUsage],
		});
		const seenToolCalls: Array<{ id: string; name: string; expression: unknown }> = [];
		let seenToolUsage: Usage | undefined;
		harness.on("tool_call", (event) => {
			seenToolCalls.push({ id: event.toolCallId, name: event.toolName, expression: event.input.expression });
			return undefined;
		});
		harness.on("tool_result", (event) => {
			expect(event.toolCallId).toBe("call-1");
			expect(event.toolName).toBe("calculate");
			seenToolUsage = event.usage;
			return {
				content: [{ type: "text", text: "patched result" }],
				details: { patched: true },
				usage: patchedToolUsage,
				terminate: true,
			};
		});

		await harness.prompt("hello");

		const toolResult = (await session.getEntries()).find(
			(entry) => entry.type === "message" && entry.message.role === "toolResult",
		);
		expect(seenToolCalls).toEqual([{ id: "call-1", name: "calculate", expression: "2 + 2" }]);
		expect(seenToolUsage).toEqual(toolUsage);
		expect(toolResult).toMatchObject({
			type: "message",
			message: {
				role: "toolResult",
				content: [{ type: "text", text: "patched result" }],
				details: { patched: true },
				usage: patchedToolUsage,
			},
		});
	});

	it("preserves app resource types for getters and update events", async () => {
		const session = new Session(new InMemorySessionStorage());
		const env = new NodeExecutionEnv({ cwd: process.cwd() });
		const model = getModel("anthropic", "claude-sonnet-4-5");
		const harness = new AgentHarness<AppSkill, AppPromptTemplate, AppTool>({ env, session, model });
		const skill: AppSkill = {
			name: "inspect",
			description: "Inspect things",
			content: "Use inspection tools.",
			filePath: "/skills/inspect/SKILL.md",
			source: "project",
		};
		const promptTemplate: AppPromptTemplate = { name: "review", content: "Review $1", source: "user" };
		const resources = { skills: [skill], promptTemplates: [promptTemplate] };
		const updates: Array<{ resourcesSource?: string; previousSource?: string }> = [];
		harness.subscribe((event) => {
			if (event.type === "resources_update") {
				updates.push({
					resourcesSource: event.resources.skills?.[0]?.source,
					previousSource: event.previousResources.skills?.[0]?.source,
				});
			}
		});

		await harness.setResources(resources);
		await harness.setResources(resources);
		const resolved = harness.getResources();

		expect(updates).toEqual([
			{ resourcesSource: "project", previousSource: undefined },
			{ resourcesSource: "project", previousSource: "project" },
		]);
		expect(resolved.skills?.[0]?.source).toBe("project");
		expect(resolved.promptTemplates?.[0]?.source).toBe("user");
		expect(resolved.skills).not.toBe(resources.skills);
		expect(resolved.promptTemplates).not.toBe(resources.promptTemplates);
	});
});
