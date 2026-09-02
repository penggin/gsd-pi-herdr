import type {
	Api,
	AssistantMessageEventStream,
	Context,
	Model,
	OAuthProviderInterface,
	SimpleStreamOptions,
} from "@gsd/pi-ai";
import type { ProviderAuthMode } from "./provider-readiness.js";

/** Input type for the extension registerProvider API. */
export interface ProviderConfigInput {
	name?: string;
	baseUrl?: string;
	apiKey?: string;
	api?: Api;
	authMode?: ProviderAuthMode;
	isReady?: () => boolean;
	streamSimple?: (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => AssistantMessageEventStream;
	headers?: Record<string, string>;
	authHeader?: boolean;
	oauth?: Omit<OAuthProviderInterface, "id">;
	models?: Array<{
		id: string;
		name: string;
		api?: Api;
		baseUrl?: string;
		reasoning: boolean;
		thinkingLevelMap?: Model<Api>["thinkingLevelMap"];
		input: ("text" | "image")[];
		cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
		contextWindow: number;
		maxTokens: number;
		headers?: Record<string, string>;
		compat?: Model<Api>["compat"];
	}>;
}

/** Merge repeated extension registrations without erasing omitted fields. */
export function mergeProviderConfig(
	existing: ProviderConfigInput | undefined,
	incoming: ProviderConfigInput,
): ProviderConfigInput {
	if (!existing) return { ...incoming };
	const merged = { ...existing };
	for (const key of Object.keys(incoming) as (keyof ProviderConfigInput)[]) {
		if (incoming[key] !== undefined) {
			(merged as Record<string, unknown>)[key] = incoming[key];
		}
	}
	return merged;
}

/** Apply the final extension-provider model layer to a composed base catalog. */
export function applyExtensionProviderModels(
	models: readonly Model<Api>[],
	providerName: string,
	config: ProviderConfigInput,
): Model<Api>[] {
	if (config.models?.length) {
		const remaining = models.filter((model) => model.provider !== providerName);
		const replacements = config.models.map((definition) => ({
			id: definition.id,
			name: definition.name,
			api: (definition.api ?? config.api) as Api,
			provider: providerName,
			baseUrl: definition.baseUrl ?? config.baseUrl!,
			reasoning: definition.reasoning,
			thinkingLevelMap: definition.thinkingLevelMap,
			input: definition.input,
			cost: definition.cost,
			contextWindow: definition.contextWindow,
			maxTokens: definition.maxTokens,
			headers: undefined,
			compat: definition.compat,
		})) as Model<Api>[];
		return [...remaining, ...replacements];
	}

	if (!config.baseUrl) return [...models];
	return models.map((model) =>
		model.provider === providerName ? { ...model, baseUrl: config.baseUrl! } : model,
	);
}
