import type { GSDState } from "../gsd/types.js";
import { deriveState } from "../gsd/state.js";

const MAX_WORKFLOW_MESSAGE_CHARS = 120;

export function formatHerdrWorkflowMessage(state: GSDState): string | undefined {
  const ids = [state.activeMilestone?.id, state.activeSlice?.id, state.activeTask?.id]
    .filter((value): value is string => Boolean(value));
  const message = [ids.join("/"), state.phase].filter(Boolean).join(" · ");
  if (!message) return undefined;
  if (message.length <= MAX_WORKFLOW_MESSAGE_CHARS) return message;
  return `${message.slice(0, MAX_WORKFLOW_MESSAGE_CHARS - 1)}…`;
}

export async function deriveHerdrWorkflowMessage(cwd: string): Promise<string | undefined> {
  try {
    return formatHerdrWorkflowMessage(await deriveState(cwd));
  } catch {
    return undefined;
  }
}
