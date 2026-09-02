import { canonicalToolName } from "../gsd/engine-hook-contract.js";

export interface HerdrInteractiveInputDescriptor {
  kind: "questions" | "secure-input";
  waitingMessage: string;
  settledMessage: string;
  waitingDisplay: string;
  settledDisplay: string;
}

/**
 * Return a privacy-bounded Herdr presentation for tools that are waiting on a
 * human. Question text, choices, and secure-input metadata are intentionally
 * excluded: Herdr needs the attention signal, not the prompt payload.
 */
export function describeHerdrInteractiveInput(
  toolName: string | undefined,
  args?: unknown,
): HerdrInteractiveInputDescriptor | undefined {
  switch (canonicalToolName(String(toolName ?? ""))) {
    case "ask_user_questions": {
      const count = questionCount(args);
      const suffix = count > 0 ? ` · ${count} ${count === 1 ? "question" : "questions"}` : "";
      return {
        kind: "questions",
        waitingMessage: `awaiting user input${suffix}`,
        settledMessage: "user input settled",
        waitingDisplay: `? awaiting user input${suffix}`,
        settledDisplay: "✓ user input settled",
      };
    }
    case "secure_env_collect":
      return {
        kind: "secure-input",
        waitingMessage: "secure input required",
        settledMessage: "secure input settled",
        waitingDisplay: "? secure input required",
        settledDisplay: "✓ secure input settled",
      };
    default:
      return undefined;
  }
}

function questionCount(value: unknown): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  const questions = (value as Record<string, unknown>).questions;
  return Array.isArray(questions) ? questions.length : 0;
}
