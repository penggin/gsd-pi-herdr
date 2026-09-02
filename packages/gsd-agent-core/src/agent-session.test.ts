import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { SessionManager } from "@gsd/pi-coding-agent/core/session-manager.js";
import { resolvePath } from "@gsd/pi-coding-agent/utils/paths.js";
import { parseSkillBlock } from "./agent-session.ts";
import { AgentSessionExtensionsModule } from "./session/agent-session-extensions.ts";
import { AgentSessionModelModule } from "./session/agent-session-model.ts";
import { AgentSessionNavigationModule } from "./session/agent-session-navigation.ts";
import { AgentSessionPromptModule } from "./session/agent-session-prompt.ts";
import { AgentSessionCompactionModule } from "./session/agent-session-compaction.ts";
import { AgentSessionEventsModule } from "./session/agent-session-events.ts";
import { createRetryingSummaryCompleteFn } from "./session/summarization-retry.ts";

describe("parseSkillBlock", () => {
  test("parses a valid skill block with trailing user message", () => {
    const text = `<skill name="review" location=".gsd/skills/review.md">
Follow the checklist.
</skill>

Please review the patch.`;

    const parsed = parseSkillBlock(text);
    assert.ok(parsed);
    assert.equal(parsed.name, "review");
    assert.equal(parsed.location, ".gsd/skills/review.md");
    assert.match(parsed.content, /checklist/);
    assert.equal(parsed.userMessage, "Please review the patch.");
  });

  test("returns null for malformed skill blocks", () => {
    assert.equal(parseSkillBlock("not a skill"), null);
    assert.equal(parseSkillBlock('<skill name="x" location="y">missing close'), null);
  });
});

describe("AgentSessionCompactionModule", () => {
  test("publishes structured compaction failure events to extensions", async () => {
    const events: unknown[] = [];
    const host = {
      _extensionRunner: {
        hasHandlers: (event: string) => event === "session_compact_failed",
        emit: async (event: unknown) => events.push(event),
      },
    };
    const module = new AgentSessionCompactionModule(host as any);

    await (module as any).emitSessionCompactFailed({
      reason: "threshold",
      errorMessage: "Auto-compaction failed: unavailable",
      aborted: false,
      willRetry: false,
      fromExtension: false,
    });

    assert.deepEqual(events, [{
      type: "session_compact_failed",
      reason: "threshold",
      errorMessage: "Auto-compaction failed: unavailable",
      aborted: false,
      willRetry: false,
      fromExtension: false,
    }]);
  });
});

describe("AgentSessionEventsModule", () => {
  test("dispose aborts all active work before disconnecting listeners", () => {
    const calls: string[] = [];
    const host = {
      abortRetry: () => calls.push("retry"),
      abortCompaction: () => calls.push("compaction"),
      abortBranchSummary: () => calls.push("branch"),
      abortBash: () => calls.push("bash"),
      agent: { abort: () => calls.push("agent") },
      _extensionRunner: { invalidate: () => calls.push("invalidate") },
      _unsubscribeAgent: () => calls.push("disconnect"),
      _eventListeners: [() => {}],
      sessionId: "session-test",
    };

    new AgentSessionEventsModule(host as any).dispose();

    assert.deepEqual(calls, ["retry", "compaction", "branch", "bash", "agent", "invalidate", "disconnect"]);
    assert.deepEqual(host._eventListeners, []);
  });
});

describe("summarization retry", () => {
  test("uses configured backoff for a transient compaction failure", async () => {
    const events: Array<{ type: string }> = [];
    const responses = [makeAssistantError("The operation timed out"), {
      ...makeAssistantError(""),
      stopReason: "stop",
      content: [{ type: "text", text: "summary" }],
      errorMessage: undefined,
    }];
    const host = {
      settingsManager: { getRetrySettings: () => ({ enabled: true, maxRetries: 2, baseDelayMs: 0 }) },
      isRetryableError: (message: { stopReason: string }) => message.stopReason === "error",
      emit: (event: { type: string }) => events.push(event),
      agent: {
        streamFn: async () => ({ result: async () => responses.shift() }),
      },
    };

    const complete = createRetryingSummaryCompleteFn(host as any, { source: "compaction", reason: "threshold" });
    const result = await complete({} as any, { systemPrompt: "", messages: [] }, {} as any);

    assert.equal(result.stopReason, "stop");
    assert.deepEqual(events.map((event) => event.type), [
      "summarization_retry_scheduled",
      "summarization_retry_attempt_start",
      "summarization_retry_finished",
    ]);
  });
});

describe("AgentSessionExtensionsModule", () => {
  test("forwards and patches tool-result usage through extension hooks", async () => {
    const toolUsage = {
      input: 1,
      output: 2,
      cacheRead: 3,
      cacheWrite: 4,
      totalTokens: 10,
      cost: { input: 0.1, output: 0.2, cacheRead: 0.3, cacheWrite: 0.4, total: 1 },
    };
    const patchedUsage = {
      input: 5,
      output: 6,
      cacheRead: 7,
      cacheWrite: 8,
      totalTokens: 26,
      cost: { input: 0.5, output: 0.6, cacheRead: 0.7, cacheWrite: 0.8, total: 2.6 },
    };
    let observedUsage: unknown;
    const host = {
      agent: {},
      _extensionRunner: {
        hasHandlers: () => true,
        emitToolResult: async (event: { usage?: unknown }) => {
          observedUsage = event.usage;
          return { usage: patchedUsage };
        },
      },
    };
    const mod = new AgentSessionExtensionsModule(host as any);
    mod.installAgentToolHooks();

    const result = await (host.agent as any).afterToolCall({
      toolCall: { id: "call-1", name: "llm-tool" },
      args: {},
      result: { content: [], details: {}, usage: toolUsage },
      isError: false,
    });

    assert.deepEqual(observedUsage, toolUsage);
    assert.deepEqual(result.usage, patchedUsage);
  });

  test("bindExtensions forwards extension UI context into provider stream options", async () => {
    const uiContext = { notify: () => {} };
    let received: Record<string, unknown> | undefined;
    const host = {
      _extensionUIContext: undefined as typeof uiContext | undefined,
      _extensionRunner: {
        setUIContext: () => {},
        bindCommandContext: () => {},
        onError: () => () => {},
        emit: async () => {},
        hasHandlers: () => false,
      },
      _sessionStartEvent: { type: "session_start", reason: "startup" },
      agent: {
        streamFn: (_model: unknown, _context: unknown, options?: Record<string, unknown>) => {
          received = options;
          return { type: "stream" } as any;
        },
      },
    };

    const mod = new AgentSessionExtensionsModule(host as any);
    await mod.bindExtensions({ uiContext: uiContext as any });

    host.agent.streamFn({}, {}, { maxTokens: 1 });
    assert.equal(received?.extensionUIContext, uiContext);
  });

  test("skills are no longer embedded in the system prompt (discovered on-demand)", () => {
    const host = {
      _cwd: "/tmp/project",
      _toolRegistry: new Map([["read", {}]]),
      _toolPromptSnippets: new Map(),
      _toolPromptGuidelines: new Map(),
      _visibleSkillNames: ["review-skill"],
      resourceLoader: {
        getSystemPrompt: () => undefined,
        getAppendSystemPrompt: () => [],
        getSkills: () => ({
          skills: [
            makeSkill("Review-Skill"),
            makeSkill("other-skill"),
          ],
        }),
        getAgentsFiles: () => ({ agentsFiles: [] }),
      },
    };

    const prompt = new AgentSessionExtensionsModule(host as any).rebuildSystemPrompt(["read"]);

    // Skills are discovered on-demand via the read tool — no longer embedded
    // in the system prompt (~29KB saved per request).
    assert.doesNotMatch(prompt, /<name>Review-Skill<\/name>/);
    assert.doesNotMatch(prompt, /<name>other-skill<\/name>/);
    assert.doesNotMatch(prompt, /<available_skills>/);
  });

  test("forwards setModel persistence options to the session", async () => {
    const model = { provider: "test-provider", id: "test-model" };
    let receivedOptions: { persist?: boolean } | undefined;
    let boundSetModel:
      | ((selectedModel: typeof model, options?: { persist?: boolean }) => Promise<boolean>)
      | undefined;
    const host = {
      modelRegistry: { hasConfiguredAuth: () => true },
      setModel: async (_selectedModel: typeof model, options?: { persist?: boolean }) => {
        receivedOptions = options;
      },
      promptTemplates: [],
      resourceLoader: { getSkills: () => ({ skills: [] }) },
    };
    const runner = {
      bindCore: (actions: { setModel: typeof boundSetModel }) => {
        boundSetModel = actions.setModel;
      },
    };

    new AgentSessionExtensionsModule(host as any).bindExtensionCore(runner as any);
    assert.ok(boundSetModel);
    assert.equal(await boundSetModel(model, { persist: false }), true);
    assert.deepEqual(receivedOptions, { persist: false });
  });
});

describe("AgentSessionModelModule", () => {
  test("switches models without changing the default when persist is false", async () => {
    const { host, model, persistedModels, sessionModels } = makeModelModuleHost();

    await new AgentSessionModelModule(host as any).setModel(model as any, { persist: false });

    assert.equal(host.agent.state.model, model);
    assert.deepEqual(sessionModels, [[model.provider, model.id]]);
    assert.deepEqual(persistedModels, []);
  });

  test("persists the default model when persistence options are omitted", async () => {
    const { host, model, persistedModels } = makeModelModuleHost();

    await new AgentSessionModelModule(host as any).setModel(model as any);

    assert.deepEqual(persistedModels, [[model.provider, model.id]]);
  });
});

describe("AgentSessionNavigationModule", () => {
  test("records workspaceRoot as the new session header cwd", async () => {
    // Canonicalize with the same resolver the session code uses so the
    // expected cwd matches on Windows too (a bare POSIX path like
    // "/tmp/..." resolves to "C:\\tmp\\..." there). No-op on POSIX.
    const projectRoot = resolvePath("/tmp/project-root");
    const worktreeRoot = resolvePath("/tmp/project-root/.gsd-worktrees/M001");
    const sessionManager = SessionManager.inMemory(projectRoot);
    let rebuiltRuntime = false;

    const host = {
      sessionFile: undefined,
      _extensionRunner: undefined,
      _cwd: projectRoot,
      _steeringMessages: ["old"],
      _followUpMessages: ["old"],
      _pendingNextTurnMessages: ["old"],
      thinkingLevel: "off",
      agent: {
        state: { isStreaming: false },
        sessionId: sessionManager.getSessionId(),
        waitForIdle: async () => {},
        reset: () => {},
      },
      sessionManager,
      abortRetry: () => {},
      abort: async () => {},
      disconnectFromAgent: () => {},
      reconnectToAgent: () => {},
      getActiveToolNames: () => [],
      buildRuntime: () => {
        rebuiltRuntime = true;
      },
      refreshToolRegistry: () => {},
      emitSessionStartWithLegacySwitch: async () => {},
    };

    const result = await new AgentSessionNavigationModule(host as any).newSession({
      workspaceRoot: worktreeRoot,
    });

    assert.equal(result, true);
    assert.equal(host._cwd, worktreeRoot);
    assert.equal(sessionManager.getHeader()?.cwd, worktreeRoot);
    assert.equal(sessionManager.getCwd(), worktreeRoot);
    assert.equal(rebuiltRuntime, true);
  });
});

describe("AgentSessionPromptModule", () => {
	test("emits agent_settled once after automatic continuations finish", async () => {
		const order: string[] = [];
		let postRunChecks = 0;
		const host = {
			agent: {
				latencyMark: undefined,
				prompt: async () => order.push("prompt"),
				continue: async () => order.push("continue"),
			},
			flushPendingBashMessages: () => order.push("flush-bash"),
			flushPendingCustomMessages: () => order.push("flush-custom"),
			_extensionRunner: {
				emit: async (event: { type: string }) => order.push(`extension:${event.type}`),
			},
			emit: (event: { type: string }) => order.push(`session:${event.type}`),
		};
		const mod = new AgentSessionPromptModule(host as any);
		mod.handlePostAgentRun = async () => postRunChecks++ === 0;

		await mod.runAgentPrompt({ role: "user", content: "continue once", timestamp: 1 } as any);

		assert.deepEqual(order, [
			"prompt",
			"continue",
			"flush-bash",
			"flush-custom",
			"extension:agent_settled",
			"session:agent_settled",
		]);
	});

	test("emits agent_settled when the agent run fails", async () => {
		const events: string[] = [];
		const host = {
			agent: {
				latencyMark: undefined,
				prompt: async () => {
					throw new Error("provider failed");
				},
			},
			flushPendingBashMessages: () => {},
			flushPendingCustomMessages: () => {},
			_extensionRunner: { emit: async (event: { type: string }) => events.push(`extension:${event.type}`) },
			emit: (event: { type: string }) => events.push(`session:${event.type}`),
		};
		const mod = new AgentSessionPromptModule(host as any);

		await assert.rejects(() => mod.runAgentPrompt({ role: "user", content: "fail", timestamp: 1 } as any));
		assert.deepEqual(events, ["extension:agent_settled", "session:agent_settled"]);
	});

	test("uses shared provider retry classification without retrying account limits", () => {
		const mod = new AgentSessionPromptModule({ model: { contextWindow: 128000 } } as any);

		for (const message of [
			"HTTP 524: upstream timed out",
			"ResourceExhausted: concurrent request limit",
			"The socket connection was closed unexpectedly",
			"Please retry your request",
		]) {
			assert.equal(mod.isRetryableError(makeAssistantError(message) as any), true, message);
		}

		for (const message of [
			"429 insufficient_quota: add billing details",
			"429 Provider error 429: Usage limit reached for 5 hour. Your limit will reset soon",
			"Monthly usage limit reached; enable available balance",
			"invalid_api_key",
		]) {
			assert.equal(mod.isRetryableError(makeAssistantError(message) as any), false, message);
		}

		assert.equal(
			mod.isRetryableError(makeAssistantError("HTTP 500: maximum context length exceeded") as any),
			false,
			"context overflow must stay on the compaction path",
		);
	});

  test("refuses to expand Assessment Gates through ordinary /skill commands", () => {
    const errors: Array<{ error: string }> = [];
    const gate = {
      ...makeSkill("security-review"),
      gsd: {
        kind: "assessment-gate",
        invocation: "manual",
        lifecycle: ["post-validation"],
        effect: "report-only",
        revisionBinding: "required",
        resultSchema: "gsd.findings/v1",
        capabilities: ["repository.read"],
      },
    };
    const host = {
      resourceLoader: { getSkills: () => ({ skills: [gate] }) },
      _extensionRunner: { emitError: (error: { error: string }) => errors.push(error) },
    };
    const mod = new AgentSessionPromptModule(host as any);

    const expanded = mod.expandSkillCommand("/skill:security-review inspect this");

    assert.equal(expanded, 'Assessment Gate "security-review" was not executed. Run /gsd gate run security-review.');
    assert.match(errors[0]?.error ?? "", /approval and isolation/);
    assert.doesNotMatch(expanded, /inspect this/);
  });

  test("keeps no-progress terminal fingerprint across other retryable errors", async () => {
    const userMessage = {
      role: "user",
      content: [{ type: "text", text: "do the work" }],
      timestamp: 1,
    };
    const events: Array<{ type: string }> = [];
    const host = {
      _retryAttempt: 0,
      _retryAbortController: undefined,
      settingsManager: {
        getRetrySettings: () => ({
          enabled: true,
          maxRetries: 5,
          baseDelayMs: 0,
        }),
      },
      emit: (event: { type: string }) => {
        events.push(event);
      },
      agent: {
        state: {
          messages: [] as any[],
        },
      },
    };
    const mod = new AgentSessionPromptModule(host as any);

    const firstTerminalFailure = makeAssistantError("terminated before any output");
    host.agent.state.messages = [userMessage, firstTerminalFailure];
    assert.equal(await mod.prepareRetry(firstTerminalFailure as any), true);

    const unrelatedRetryableFailure = makeAssistantError("overloaded_error: provider is busy");
    host.agent.state.messages = [userMessage, unrelatedRetryableFailure];
    assert.equal(await mod.prepareRetry(unrelatedRetryableFailure as any), true);

    const repeatedTerminalFailure = makeAssistantError("terminated before any output");
    host.agent.state.messages = [userMessage, repeatedTerminalFailure];
    assert.equal(mod.canPrepareRetry(repeatedTerminalFailure as any), false);
    assert.equal(await mod.prepareRetry(repeatedTerminalFailure as any), false);
    assert.equal(host._retryAttempt, 2);
    assert.equal(events.filter((event) => event.type === "auto_retry_start").length, 2);
  });

  test("defers context-only extension messages until a replay-safe boundary", async () => {
    const persisted: string[] = [];
    const emitted: string[] = [];
    const host = {
      isStreaming: true,
      _pendingNextTurnMessages: [],
      _pendingCustomMessages: [],
      agent: {
        state: {
          messages: [{ role: "toolResult", toolCallId: "tool-1", content: [] }],
        },
        steer: () => assert.fail("context-only message must not steer"),
        followUp: () => assert.fail("context-only message must not follow up"),
      },
      sessionManager: {
        appendCustomMessageEntry: (customType: string) => persisted.push(customType),
      },
      emit: (event: { type: string }) => emitted.push(event.type),
    };
    const mod = new AgentSessionPromptModule(host as any);

    await mod.sendCustomMessage(
      { customType: "context-only", content: "after tools", display: false },
      { triggerTurn: false },
    );

    assert.equal(host._pendingCustomMessages.length, 1);
    assert.deepEqual(host.agent.state.messages.map((message) => message.role), ["toolResult"]);
    assert.deepEqual(persisted, []);

    mod.flushPendingCustomMessages();
    assert.deepEqual(host.agent.state.messages.map((message) => message.role), ["toolResult", "custom"]);
    assert.deepEqual(persisted, ["context-only"]);
    assert.deepEqual(emitted, ["message_start", "message_end"]);
  });
});

function makeSkill(name: string) {
  return {
    name,
    description: `${name} description`,
    filePath: `/skills/${name}/SKILL.md`,
    baseDir: `/skills/${name}`,
    sourceInfo: { kind: "test" },
    source: "test",
    disableModelInvocation: false,
  };
}

function makeModelModuleHost() {
  const model = { provider: "test-provider", id: "test-model", reasoning: false };
  const persistedModels: string[][] = [];
  const sessionModels: string[][] = [];
  const host = {
    model: undefined,
    thinkingLevel: "off",
    agent: { state: { model: undefined, thinkingLevel: "off" } },
    modelRegistry: { hasConfiguredAuth: () => true },
    sessionManager: {
      appendModelChange: (provider: string, id: string) => sessionModels.push([provider, id]),
    },
    settingsManager: {
      getDefaultThinkingLevel: () => "off",
      setDefaultModelAndProvider: (provider: string, id: string) => persistedModels.push([provider, id]),
    },
    setThinkingLevel: () => {},
    _extensionRunner: { emit: async () => {} },
  };

  return { host, model, persistedModels, sessionModels };
}

function makeAssistantError(errorMessage: string) {
  return {
    role: "assistant",
    content: [],
    api: "test",
    provider: "test",
    model: "test-model",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason: "error",
    errorMessage,
    timestamp: 1,
  };
}
