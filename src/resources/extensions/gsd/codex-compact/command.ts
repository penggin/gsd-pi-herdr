import type { ExtensionAPI } from "@gsd/pi-coding-agent";

export function registerCodexCompactCommand(pi: ExtensionAPI): void {
  pi.registerCommand("codex-compact", {
    description: "Inspect or run OpenAI Codex Remote Compaction V2",
    getArgumentCompletions: (prefix) => ["status", "now"]
      .filter((value) => value.startsWith(prefix.trim().toLowerCase()))
      .map((value) => ({ value, label: value })),
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase() || "status";
      const { codexRemoteRouteLabel } = await import("./integration.js");
      if (action === "status") {
        ctx.ui.notify(`Compaction route: ${codexRemoteRouteLabel(ctx, ctx.cwd)}`, "info");
        return;
      }
      if (action === "now") {
        if (!ctx.isIdle()) {
          ctx.ui.notify("Wait for the active model request to finish before compacting.", "warning");
          return;
        }
        ctx.ui.notify(`Compacting via ${codexRemoteRouteLabel(ctx, ctx.cwd)}.`, "info");
        ctx.compact({
          onError: (error) => ctx.ui.notify(`Compaction failed: ${error.message}`, "error"),
        });
        return;
      }
      ctx.ui.notify("Usage: /codex-compact [status|now]", "warning");
    },
  });
}
