import type { Api, Model } from "@gsd/pi-ai";
import type { AuthStorage } from "./auth-storage.js";
import { resolveConfigValueOrThrow, resolveHeadersOrThrow } from "./resolve-config-value.js";

export interface ProviderRequestConfig {
	apiKey?: string;
	headers?: Record<string, string>;
	authHeader?: boolean;
}

export type ResolvedRequestAuth =
	| { ok: true; apiKey?: string; headers?: Record<string, string> }
	| { ok: false; error: string };

export interface ProviderCredentialResolverDeps {
	authStorage: AuthStorage;
	providerRequestConfigs: ReadonlyMap<string, ProviderRequestConfig>;
	modelRequestHeaders: ReadonlyMap<string, Record<string, string>>;
}

export async function resolveProviderRequestAuth(
	deps: ProviderCredentialResolverDeps,
	model: Model<Api>,
): Promise<ResolvedRequestAuth> {
	try {
		const providerConfig = deps.providerRequestConfigs.get(model.provider);
		const storedAuth = await deps.authStorage.getApiKeyWithOAuthState(model.provider, { includeFallback: false });
		const apiKey =
			storedAuth?.apiKey ??
			(providerConfig?.apiKey
				? resolveConfigValueOrThrow(providerConfig.apiKey, `API key for provider "${model.provider}"`)
				: undefined);
		const providerHeaders = resolveHeadersOrThrow(providerConfig?.headers, `provider "${model.provider}"`);
		const modelHeaders = resolveHeadersOrThrow(
			deps.modelRequestHeaders.get(`${model.provider}:${model.id}`),
			`model "${model.provider}/${model.id}"`,
		);
		let headers = model.headers || providerHeaders || modelHeaders
			? { ...model.headers, ...providerHeaders, ...modelHeaders }
			: undefined;
		if (providerConfig?.authHeader) {
			if (!apiKey) return { ok: false, error: `No API key found for "${model.provider}"` };
			headers = { ...headers, Authorization: `Bearer ${apiKey}` };
		}
		if (model.provider === "kimi-coding" && storedAuth?.isOAuth && apiKey) {
			headers = { ...headers, Authorization: `Bearer ${apiKey}` };
		}
		return { ok: true, apiKey, headers: headers && Object.keys(headers).length > 0 ? headers : undefined };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}
