import type { Skill } from "@gsd/pi-coding-agent";
import { listSuggestibleAssessmentGates } from "./registry.js";
import { getGateRecommendationDisposition } from "./store.js";

function tokens(value: string): Set<string> {
  return new Set((value.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ?? [])
    .flatMap((token) => token.split("-"))
    .filter((token) => token.length >= 3));
}

function relevant(description: string, context: string): boolean {
  const descriptionTokens = tokens(description);
  return [...tokens(context)].some((token) => descriptionTokens.has(token));
}

function trivial(context: string): boolean {
  const normalized = context.trim().toLowerCase();
  return normalized.length < 20 || /\b(readme|docs?)\s+(typo|spelling)\b/.test(normalized);
}

export function buildAssessmentGateSuggestionBlock(input: {
  lifecycle: "pre-milestone" | "post-validation";
  scopeId: string;
  context: string;
  skills?: Skill[];
}): string {
  if (trivial(input.context)) return "";
  const gates = listSuggestibleAssessmentGates(input.skills).filter((gate) => {
    if (!gate.lifecycle.includes(input.lifecycle) || !relevant(gate.description, input.context)) return false;
    try {
      return getGateRecommendationDisposition(gate.gateId, input.scopeId) === null;
    } catch {
      return true;
    }
  });
  if (gates.length === 0) return "";
  const entries = gates.map((gate) => [
    "  <gate>",
    `    <name>${gate.gateId}</name>`,
    `    <description>${gate.description.replace(/[<>&]/g, " ")}</description>`,
    `    <lifecycle>${input.lifecycle}</lifecycle>`,
    "  </gate>",
  ].join("\n"));
  return [
    `<assessment_gate_suggestions scope="${input.scopeId}" lifecycle="${input.lifecycle}">`,
    "These are nonblocking report-only recommendations. Do not read their skill bodies and never run them automatically.",
    "Recommend at most one relevant gate once. Explain why and lifecycle placement, then offer: Run now / Skip / Do not suggest again for this scope.",
    ...entries,
    "</assessment_gate_suggestions>",
  ].join("\n");
}
