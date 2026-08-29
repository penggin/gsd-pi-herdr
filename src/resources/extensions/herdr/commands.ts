import type { ExtensionAPI, ExtensionCommandContext } from "@gsd/pi-coding-agent";
import { loadEffectiveGSDPreferences } from "../gsd/preferences.js";
import { HerdrClient, detectHerdrEnvironment, isHerdrSubagentChild } from "./client.js";
import { probeHerdrCli } from "./cli.js";
import { resolveHerdrPreferences } from "./preferences.js";

export interface HerdrCommandRuntime {
  isRootReporterActive(): boolean;
}

export function registerHerdrCommands(pi: ExtensionAPI, runtime: HerdrCommandRuntime): void {
  pi.registerCommand("herdr-status", {
    description: "Show effective GSD ↔ Herdr integration status",
    handler: async (_args, ctx) => {
      ctx.ui.notify(buildStatus(ctx, runtime), "info");
    },
  });

  pi.registerCommand("herdr-doctor", {
    description: "Check Herdr environment, CLI, and root pane API connectivity",
    handler: async (_args, ctx) => {
      const preferences = loadEffectiveGSDPreferences(ctx.cwd)?.preferences;
      const resolved = resolveHerdrPreferences(preferences);
      const environment = detectHerdrEnvironment();
      const client = new HerdrClient("custom:gsd:doctor", {
        requestTimeoutMs: 300,
        retryTimeoutMs: 700,
      });

      const [cli, paneReachable] = await Promise.all([
        probeHerdrCli({ timeoutMs: 1000 }),
        environment.available ? client.probePane() : Promise.resolve(false),
      ]);

      const cliLabel = cli.ok
        ? `ok${firstSafeLine(cli.stdout) ? ` (${firstSafeLine(cli.stdout)})` : ""}`
        : cli.notFound
          ? "missing"
          : cli.timedOut
            ? "timeout"
            : "failed";

      const lines = [
        "Herdr doctor",
        `  configured: ${resolved.enabled ? "enabled" : "disabled"} · required=${resolved.required}`,
        `  root authority eligible: ${ctx.hasUI && !isHerdrSubagentChild() ? "yes" : "no"}`,
        `  Herdr environment: ${environment.available ? "detected" : "not detected"}`,
        `  pane identity: ${environment.paneId ?? "missing"}`,
        `  socket API pane.get: ${paneReachable ? "ok" : "unavailable"}`,
        `  Herdr CLI: ${cliLabel}`,
      ];
      ctx.ui.notify(lines.join("\n"), paneReachable || !resolved.enabled ? "info" : "warning");
    },
  });
}

function buildStatus(ctx: ExtensionCommandContext, runtime: HerdrCommandRuntime): string {
  const preferences = loadEffectiveGSDPreferences(ctx.cwd)?.preferences;
  const resolved = resolveHerdrPreferences(preferences);
  const environment = detectHerdrEnvironment();
  return [
    "Herdr status",
    `  configured: ${resolved.enabled ? "enabled" : "disabled"} · required=${resolved.required}`,
    `  environment: ${environment.available ? "detected" : "not detected"}`,
    `  root reporter: ${runtime.isRootReporterActive() ? "active" : "inactive"}`,
    `  child session: ${isHerdrSubagentChild() ? "yes" : "no"}`,
    `  pane: ${environment.paneId ?? "n/a"}`,
  ].join("\n");
}

function firstSafeLine(value: string): string | undefined {
  const line = value.split(/\r?\n/, 1)[0]?.trim();
  if (!line) return undefined;
  return line.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 80);
}
