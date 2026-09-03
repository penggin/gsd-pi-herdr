import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider, type Usage } from "@gsd/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { AgentHarness } from "../../src/harness/agent-harness.ts";
import { NodeExecutionEnv } from "../../src/harness/env/nodejs.ts";
import { JsonlV4SessionRepository } from "../../src/harness/session/jsonl-v4-repo.ts";
import { Session } from "../../src/harness/session/session.ts";
import { V4HarnessSessionStorageAdapter } from "../../src/harness/session/session-v4-harness-adapter.ts";
import { V4MemorySessionRepository } from "../../src/harness/session/session-v4-memory.ts";
import type { AgentMessage, AgentTool } from "../../src/types.ts";
import { calculateTool } from "../utils/calculate.ts";
import { createTempDir } from "./session-test-utils.ts";

type Backend = "memory" | "jsonl";

const registrations: Array<{ unregister(): void }> = [];

afterEach(() => {
	for (const registration of registrations.splice(0)) registration.unregister();
});

function usage(input: number, output: number): Usage {
	return {
		input,
		output,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: input + output,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function userText(messages: Array<{ role: string; content: unknown }>): string[] {
	return messages.flatMap((message) => {
		if (message.role !== "user") return [];
		if (typeof message.content === "string") return [message.content];
		if (!Array.isArray(message.content)) return [];
		return message.content.flatMap((part) =>
			part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part
				? [String(part.text)]
				: [],
		);
	});
}

async function createSession(backend: Backend): Promise<Session> {
	if (backend === "memory") {
		const storage = new V4MemorySessionRepository().create();
		return new Session(new V4HarnessSessionStorageAdapter(storage));
	}
	const root = createTempDir();
	const env = new NodeExecutionEnv({ cwd: root });
	const storage = await new JsonlV4SessionRepository({
		fs: env,
		sessionsRoot: join(root, "sessions"),
	}).create({ cwd: join(root, "workspace") });
	return new Session(new V4HarnessSessionStorageAdapter(storage));
}

function createHarness(session: Session, model: ReturnType<ReturnType<typeof registerFauxProvider>["getModel"]>) {
	return new AgentHarness({
		env: new NodeExecutionEnv({ cwd: process.cwd() }),
		session,
		model,
		getApiKeyAndHeaders: async () => ({ apiKey: "test" }),
	});
}

for (const backend of ["memory", "jsonl"] as const) {
	describe(`AgentHarness v4 parity: ${backend}`, () => {
		it("projects legacy custom messages while storing names and labels as v4 facts", async () => {
			const session = await createSession(backend);
			const target = await session.appendMessage({ role: "user", content: "root", timestamp: Date.now() });
			await session.appendCustomMessageEntry("notice", "visible", true, { backend, optional: undefined });
			await session.appendLabel(target, " pinned ");
			await session.appendSessionName(" Example ");

			expect(await session.getLabel(target)).toBe(" pinned ");
			expect(await session.getSessionName()).toBe("Example");
			expect((await session.buildContext()).messages.at(-1)).toMatchObject({
				role: "custom",
				customType: "notice",
				content: "visible",
				details: { backend },
			});
		});

		it("persists prompt, tool result, hook patch, and rebuilt context", async () => {
			const registration = registerFauxProvider();
			registrations.push(registration);
			registration.setResponses([
				() =>
					fauxAssistantMessage(fauxToolCall("calculate", { expression: "2 + 2" }, { id: "call" }), {
						stopReason: "toolUse",
					}),
			]);
			const session = await createSession(backend);
			const tool: AgentTool = {
				...calculateTool,
				execute: async (id, params, signal, onUpdate) => ({
					...(await calculateTool.execute(id, params, signal, onUpdate)),
					usage: usage(1, 2),
				}),
			};
			const harness = new AgentHarness({
				env: new NodeExecutionEnv({ cwd: process.cwd() }),
				session,
				model: registration.getModel(),
				tools: [tool],
			});
			harness.on("tool_result", (event) => ({
				content: [{ type: "text", text: "patched result" }],
				details: { backend },
				usage: usage(3, 4),
				terminate: true,
			}));

			await harness.prompt("calculate");

			const context = await session.buildContext();
			const toolResult = context.messages.find((message) => message.role === "toolResult");
			expect(toolResult).toMatchObject({
				content: [{ type: "text", text: "patched result" }],
				details: { backend },
				usage: usage(3, 4),
			});
			expect((await session.getMetadata()).format).toBe("harness-v4");
		});

		it("drains steering and follow-up queues with the existing semantics", async () => {
			const registration = registerFauxProvider();
			registrations.push(registration);
			const seen: string[][] = [];
			registration.setResponses(
				Array.from({ length: 5 }, (_, index) => (context: { messages: AgentMessage[] }) => {
					seen.push(userText(context.messages));
					return fauxAssistantMessage(`response-${index}`);
				}),
			);
			const session = await createSession(backend);
			const harness = new AgentHarness({
				env: new NodeExecutionEnv({ cwd: process.cwd() }),
				session,
				model: registration.getModel(),
				steeringMode: "one-at-a-time",
				followUpMode: "one-at-a-time",
			});
			let queued = false;
			harness.subscribe((event) => {
				if (event.type !== "message_start" || event.message.role !== "assistant" || queued) return;
				queued = true;
				harness.steer("steer-1");
				harness.steer("steer-2");
				harness.followUp("follow-1");
				harness.followUp("follow-2");
			});

			await harness.prompt("root");

			expect(seen.map((messages) => messages.at(-1))).toEqual([
				"root",
				"steer-1",
				"steer-2",
				"follow-1",
				"follow-2",
			]);
			expect(userText((await session.buildContext()).messages)).toEqual([
				"root",
				"steer-1",
				"steer-2",
				"follow-1",
				"follow-2",
			]);
		});

		it("persists compaction and branch-summary usage without changing backend selection", async () => {
			const registration = registerFauxProvider();
			registrations.push(registration);
			const session = await createSession(backend);
			const first = await session.appendMessage({ role: "user", content: "first", timestamp: Date.now() });
			await session.appendMessage(fauxAssistantMessage("reply"));
			await session.appendMessage({ role: "user", content: "second", timestamp: Date.now() });
			const harness = createHarness(session, registration.getModel());
			harness.on("session_before_compact", (event) => ({
				compaction: {
					summary: "compact summary",
					firstKeptEntryId: event.preparation.firstKeptEntryId,
					tokensBefore: event.preparation.tokensBefore,
					usage: usage(5, 6),
				},
			}));

			await harness.compact();
			harness.on("session_before_tree", () => ({
				summary: { summary: "branch summary", usage: usage(7, 8) },
			}));
			const navigation = await harness.navigateTree(first, { summarize: true });

			const entries = await session.getEntries();
			expect(entries.find((entry) => entry.type === "compaction")).toMatchObject({ usage: usage(5, 6) });
			expect(navigation.summaryEntry).toMatchObject({ type: "branch_summary", usage: usage(7, 8) });
			expect(entries.find((entry) => entry.type === "branch_summary")).toMatchObject({ usage: usage(7, 8) });
		});

		it("retries transient summary failures and commits only the recovered result", async () => {
			const registration = registerFauxProvider();
			registrations.push(registration);
			registration.setResponses([
				fauxAssistantMessage("", { stopReason: "error", errorMessage: "HTTP 503 overloaded" }),
				fauxAssistantMessage("recovered summary"),
			]);
			const session = await createSession(backend);
			await session.appendMessage({ role: "user", content: "one", timestamp: Date.now() });
			await session.appendMessage(fauxAssistantMessage("two"));
			const retryEvents: string[] = [];
			const harness = new AgentHarness({
				env: new NodeExecutionEnv({ cwd: process.cwd() }),
				session,
				model: registration.getModel(),
				getApiKeyAndHeaders: async () => ({ apiKey: "test" }),
				retry: { enabled: true, maxRetries: 1, baseDelayMs: 0 },
			});
			harness.subscribe((event) => {
				if (event.type === "retry_scheduled") retryEvents.push(`scheduled:${event.attempt}`);
				if (event.type === "retry_attempt_start") retryEvents.push("started");
				if (event.type === "retry_finished") retryEvents.push(`finished:${event.success}`);
			});

			await expect(harness.compact()).resolves.toMatchObject({ summary: expect.stringContaining("recovered summary") });

			expect(retryEvents).toEqual(["scheduled:1", "started", "finished:true"]);
			expect((await session.getEntries()).filter((entry) => entry.type === "compaction")).toHaveLength(1);
		});

		it("aborts active work, remains reusable, and then shuts down idempotently", async () => {
			const registration = registerFauxProvider();
			registrations.push(registration);
			let release = () => {};
			let markEntered = () => {};
			let activeSignal: AbortSignal | undefined;
			const blocked = new Promise<void>((resolve) => {
				release = resolve;
			});
			const entered = new Promise<void>((resolve) => {
				markEntered = resolve;
			});
			registration.setResponses([
				async (_context, options) => {
					activeSignal = options?.signal;
					markEntered();
					await blocked;
					return fauxAssistantMessage("aborted response");
				},
				fauxAssistantMessage("reused"),
			]);
			const session = await createSession(backend);
			const harness = createHarness(session, registration.getModel());
			const first = harness.prompt("first");
			await entered;
			const abort = harness.abort();
			expect(activeSignal?.aborted).toBe(true);
			release();
			await first;
			await abort;
			await expect(harness.prompt("second")).resolves.toMatchObject({ role: "assistant" });
			await Promise.all([harness.shutdown(), harness.shutdown()]);
			await expect(harness.prompt("closed")).rejects.toMatchObject({ code: "invalid_state" });
		});
	});
}
