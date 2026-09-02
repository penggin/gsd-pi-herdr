import type { ExtensionAPI, ExtensionContext } from "@gsd/pi-coding-agent";
import { loadEffectiveGSDPreferences } from "../gsd/preferences.js";
import {
  HerdrClient,
  createHerdrRootSource,
  detectHerdrEnvironment,
  shouldActivateHerdrRoot,
} from "./client.js";
import { registerHerdrCommands } from "./commands.js";
import { resolveHerdrPreferences } from "./preferences.js";
import { HerdrRootReporter } from "./root-state.js";
import { HerdrRootRuntimeLease } from "./runtime-records.js";
import { deriveHerdrWorkflowMessage } from "./workflow-context.js";
import { gsdHome } from "../gsd/gsd-home.js";
import { describeHerdrInteractiveInput, describeHerdrUIPrompt } from "./interactive-input.js";

export default function (pi: ExtensionAPI): void {
  const rootSource = createHerdrRootSource();
  let rootSequence = 0;
  const nextRootSequence = () => {
    rootSequence += 1;
    return rootSequence;
  };
  let reporter: HerdrRootReporter | null = null;
  let runtimeLease: HerdrRootRuntimeLease | null = null;

  registerHerdrCommands(pi, {
    isRootReporterActive: () => reporter?.isRootSession() === true,
  });

  pi.on("session_start", async (event, ctx) => {
    const previousReporter = reporter;
    const previousLease = runtimeLease;
    reporter = null;
    runtimeLease = null;
    // session_start can occur repeatedly inside one loaded extension runtime.
    // Allocate the release sequence first, then allow the new reporter to use
    // the next value. Network reordering is harmless because Herdr rejects the
    // lower stale sequence, and a broken socket cannot delay the new session.
    if (previousReporter) void previousReporter.shutdown().catch(() => {});
    if (previousLease) previousLease.stop();

    const preferences = resolvePreferences(ctx);
    const environment = detectHerdrEnvironment();

    if (!shouldActivateHerdrRoot(ctx.hasUI, preferences.enabled)) {
      reporter = null;
      if (preferences.enabled && preferences.required && ctx.hasUI && !environment.available) {
        ctx.ui.notify(
          "Herdr integration is enabled, but this session has no usable Herdr pane environment. Run /herdr-doctor for details.",
          "warning",
        );
      }
      return;
    }

    const client = new HerdrClient(rootSource);
    const activeReporter = new HerdrRootReporter(client, { nextSequence: nextRootSequence });
    const activeLease = new HerdrRootRuntimeLease({
      gsdHome: gsdHome(),
      rootSessionId: ctx.sessionManager.getSessionId(),
      source: rootSource,
      cwd: ctx.cwd,
      environment,
    });
    reporter = activeReporter;
    runtimeLease = activeLease;
    try { activeLease.start(); } catch {
      runtimeLease = null;
      ctx.ui.notify("Unable to persist the Herdr root runtime heartbeat; crash reconciliation is degraded.", "warning");
    }

    // Do not make TUI startup depend on the external socket. The client has
    // hard request bounds, and diagnostics are surfaced asynchronously.
    void activeReporter.sessionStart(event, ctx).catch(() => {});
    void refreshWorkflowMessage(activeReporter, ctx.cwd);
    void client.probePane().then((ok) => {
      if (!ok && reporter === activeReporter && preferences.required) {
        ctx.ui.notify(
          "Herdr pane API is not responding; root status reporting is degraded. Run /herdr-doctor for details.",
          "warning",
        );
      }
    }).catch(() => {});
  });

  pi.on("agent_start", async (_event, ctx) => {
    const activeReporter = reporter;
    if (!activeReporter) return;
    activeReporter.agentStart(ctx);
    void refreshWorkflowMessage(activeReporter, ctx.cwd);
  });

  pi.on("agent_end", async (event, ctx) => {
    const activeReporter = reporter;
    if (!activeReporter) return;
    activeReporter.agentEnd(event);
    void refreshWorkflowMessage(activeReporter, ctx.cwd);
  });

  pi.on("tool_execution_start", async (event) => {
    const activeReporter = reporter;
    if (!activeReporter) return;
    const descriptor = describeHerdrInteractiveInput(event.toolName, event.args);
    if (descriptor) activeReporter.interactiveInputStart(event.toolCallId, descriptor);
  });

  pi.on("tool_execution_end", async (event) => {
    const activeReporter = reporter;
    if (!activeReporter) return;
    if (describeHerdrInteractiveInput(event.toolName)) {
      activeReporter.interactiveInputEnd(event.toolCallId);
    }
  });

  pi.on("ui_prompt_start", async (event) => {
    reporter?.uiPromptStart(describeHerdrUIPrompt(event.kind));
  });

  pi.on("ui_prompt_end", async () => {
    reporter?.uiPromptEnd();
  });

  pi.on("session_shutdown", async () => {
    const activeReporter = reporter;
    const activeLease = runtimeLease;
    reporter = null;
    runtimeLease = null;
    activeLease?.stop();
    if (activeReporter) await activeReporter.shutdown();
  });
}

function resolvePreferences(ctx: ExtensionContext) {
  return resolveHerdrPreferences(loadEffectiveGSDPreferences(ctx.cwd)?.preferences);
}

async function refreshWorkflowMessage(reporter: HerdrRootReporter, cwd: string): Promise<void> {
  reporter.updateWorkflowMessage(await deriveHerdrWorkflowMessage(cwd));
}
