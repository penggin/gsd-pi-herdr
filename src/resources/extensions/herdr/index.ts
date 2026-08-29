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
import { deriveHerdrWorkflowMessage } from "./workflow-context.js";

export default function (pi: ExtensionAPI): void {
  const rootSource = createHerdrRootSource();
  let rootSequence = 0;
  const nextRootSequence = () => {
    rootSequence += 1;
    return rootSequence;
  };
  let reporter: HerdrRootReporter | null = null;

  registerHerdrCommands(pi, {
    isRootReporterActive: () => reporter?.isRootSession() === true,
  });

  pi.on("session_start", async (event, ctx) => {
    const previousReporter = reporter;
    reporter = null;
    // session_start can occur repeatedly inside one loaded extension runtime.
    // Allocate the release sequence first, then allow the new reporter to use
    // the next value. Network reordering is harmless because Herdr rejects the
    // lower stale sequence, and a broken socket cannot delay the new session.
    if (previousReporter) void previousReporter.shutdown().catch(() => {});

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
    reporter = activeReporter;

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

  pi.on("session_shutdown", async () => {
    const activeReporter = reporter;
    reporter = null;
    if (activeReporter) await activeReporter.shutdown();
  });
}

function resolvePreferences(ctx: ExtensionContext) {
  return resolveHerdrPreferences(loadEffectiveGSDPreferences(ctx.cwd)?.preferences);
}

async function refreshWorkflowMessage(reporter: HerdrRootReporter, cwd: string): Promise<void> {
  reporter.updateWorkflowMessage(await deriveHerdrWorkflowMessage(cwd));
}
