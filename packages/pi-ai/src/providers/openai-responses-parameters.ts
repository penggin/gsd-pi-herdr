import type { Api, Model, ThinkingLevel } from "../types.js";

export function isDirectOpenAIBaseUrl(baseUrl: string): boolean {
	try {
		return new URL(baseUrl).origin === "https://api.openai.com";
	} catch {
		return false;
	}
}

export function supportsOpenAIResponsesTemperature(
	model: Pick<Model<Api>, "api" | "id" | "baseUrl">,
	configured?: boolean,
): boolean {
	// Astra rejects temperature. Custom routes keep their existing contract unless
	// explicitly configured: https://developers.openai.com/api/docs/guides/latest-model
	if (configured !== undefined) return configured;
	if (model.id !== "gpt-6-astra") return true;
	if (isDirectOpenAIBaseUrl(model.baseUrl)) return false;
	if (model.api === "openai-codex-responses") {
		try {
			const baseUrl = new URL(model.baseUrl);
			if (baseUrl.origin === "https://chatgpt.com" && /^\/backend-api(?:\/|$)/.test(baseUrl.pathname)) return false;
		} catch {
			// Unknown endpoints require an explicit compatibility setting.
		}
	}
	return true;
}

export function resolveOpenAIReasoningEffort(
	model: Pick<Model<Api>, "thinkingLevelMap">,
	effort: ThinkingLevel | "none",
): string | undefined {
	const mapped = model.thinkingLevelMap?.[effort === "none" ? "off" : effort];
	// Null explicitly disables a level; only an absent mapping falls back to the
	// caller's effort. Low-level provider options must preserve supported high/max.
	return mapped === null ? undefined : (mapped ?? effort);
}
