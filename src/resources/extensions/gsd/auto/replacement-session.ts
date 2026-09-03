// Project/App: gsd-pi
// File Purpose: Bind long-lived GSD orchestration to a fresh Pi replacement session.

import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@gsd/pi-coding-agent";

import type { AutoSession } from "./session.js";

export type AutoReplacementContext = ExtensionCommandContext & Pick<
  ExtensionAPI,
  | "sendMessage"
  | "setModel"
  | "getThinkingLevel"
  | "setThinkingLevel"
  | "getActiveTools"
  | "getVisibleSkills"
  | "setVisibleSkills"
>;

/**
 * Pi invalidates the ExtensionAPI and command context that initiated a session
 * replacement. The replacement context exposes the session-bound operations
 * auto-mode needs; the event bus is process-scoped and can be carried forward.
 */
export function bindAutoReplacementSession(
  s: AutoSession,
  freshCtx: AutoReplacementContext,
  previousPi: ExtensionAPI,
): { ctx: AutoReplacementContext; pi: ExtensionAPI } {
  s.cmdCtx = freshCtx;
  const pi = Object.assign(freshCtx, { events: previousPi.events }) as unknown as ExtensionAPI;
  return { ctx: freshCtx, pi };
}
