// NEVER convert to top-level imports - breaks browser/Vite builds
let _existsSync: typeof import("node:fs").existsSync | null = null;
let _homedir: typeof import("node:os").homedir | null = null;
let _join: typeof import("node:path").join | null = null;
let _nodeRequire: NodeRequire | null | undefined;

function ensureNodeBuiltins(): void {
	if (_existsSync && _homedir && _join) return;
	if (typeof process === "undefined" || !(process.versions?.node || process.versions?.bun)) {
		return;
	}
	if (_nodeRequire === undefined) {
		try {
			const { createRequire } = require("node:module") as typeof import("node:module");
			_nodeRequire = createRequire(import.meta.url);
		} catch {
			_nodeRequire = null;
		}
	}
	if (!_nodeRequire) return;
	try {
		_existsSync = _nodeRequire("node:fs").existsSync;
		_homedir = _nodeRequire("node:os").homedir;
		_join = _nodeRequire("node:path").join;
	} catch {
		// Bundled/browser contexts may not resolve node: builtins.
	}
}

import type { KnownProvider, ProviderEnv } from "./types.js";
import { getProviderEnvValue } from "./utils/provider-env.js";

let cachedVertexAdcCredentialsExists: boolean | null = null;

function hasVertexAdcCredentials(env?: ProviderEnv): boolean {
	const explicitCredentialsPath = env?.GOOGLE_APPLICATION_CREDENTIALS;
	if (explicitCredentialsPath) {
		ensureNodeBuiltins();
		return _existsSync ? _existsSync(explicitCredentialsPath) : false;
	}
	if (cachedVertexAdcCredentialsExists === null) {
		ensureNodeBuiltins();
		// If node modules aren't available, return false WITHOUT caching so the next
		// call retries once they're ready. Only cache false permanently in a browser
		// environment where fs is never available.
		if (!_existsSync || !_homedir || !_join) {
			const isNode = typeof process !== "undefined" && (process.versions?.node || process.versions?.bun);
			if (!isNode) {
				// Definitively in a browser — safe to cache false permanently
				cachedVertexAdcCredentialsExists = false;
			}
			return false;
		}

		// Check GOOGLE_APPLICATION_CREDENTIALS env var first (standard way)
		const gacPath = getProviderEnvValue("GOOGLE_APPLICATION_CREDENTIALS");
		if (gacPath) {
			cachedVertexAdcCredentialsExists = _existsSync(gacPath);
		} else {
			// Fall back to default ADC path (lazy evaluation)
			cachedVertexAdcCredentialsExists = _existsSync(
				_join(_homedir(), ".config", "gcloud", "application_default_credentials.json"),
			);
		}
	}
	return cachedVertexAdcCredentialsExists;
}

export function getApiKeyEnvVars(provider: KnownProvider): readonly string[] | undefined;
export function getApiKeyEnvVars(provider: string): readonly string[] | undefined;
export function getApiKeyEnvVars(provider: string): readonly string[] | undefined {
	if (provider === "cursor-agent") {
		return ["CURSOR_API_KEY"];
	}

	if (provider === "github-copilot") {
		return ["COPILOT_GITHUB_TOKEN"];
	}

	// ANTHROPIC_OAUTH_TOKEN takes precedence over ANTHROPIC_API_KEY
	if (provider === "anthropic") {
		return ["ANTHROPIC_OAUTH_TOKEN", "ANTHROPIC_API_KEY"];
	}

	if (provider === "anthropic-vertex") {
		return ["ANTHROPIC_VERTEX_PROJECT_ID"];
	}

	const envMap: Record<string, string> = {
		openai: "OPENAI_API_KEY",
		"azure-openai-responses": "AZURE_OPENAI_API_KEY",
		deepseek: "DEEPSEEK_API_KEY",
		google: "GEMINI_API_KEY",
		"google-vertex": "GOOGLE_CLOUD_API_KEY",
		groq: "GROQ_API_KEY",
		cerebras: "CEREBRAS_API_KEY",
		xai: "XAI_API_KEY",
		openrouter: "OPENROUTER_API_KEY",
		"vercel-ai-gateway": "AI_GATEWAY_API_KEY",
		zai: "ZAI_API_KEY",
		mistral: "MISTRAL_API_KEY",
		minimax: "MINIMAX_API_KEY",
		"minimax-cn": "MINIMAX_CN_API_KEY",
		moonshotai: "MOONSHOT_API_KEY",
		"moonshotai-cn": "MOONSHOT_API_KEY",
		huggingface: "HF_TOKEN",
		fireworks: "FIREWORKS_API_KEY",
		together: "TOGETHER_API_KEY",
		opencode: "OPENCODE_API_KEY",
		"opencode-go": "OPENCODE_API_KEY",
		"kimi-coding": "KIMI_API_KEY",
		"cloudflare-workers-ai": "CLOUDFLARE_API_KEY",
		"cloudflare-ai-gateway": "CLOUDFLARE_API_KEY",
		xiaomi: "XIAOMI_API_KEY",
		"xiaomi-token-plan-cn": "XIAOMI_TOKEN_PLAN_CN_API_KEY",
		"xiaomi-token-plan-ams": "XIAOMI_TOKEN_PLAN_AMS_API_KEY",
		"xiaomi-token-plan-sgp": "XIAOMI_TOKEN_PLAN_SGP_API_KEY",
	};

	const envVar = envMap[provider];
	return envVar ? [envVar] : undefined;
}

/**
 * Find configured environment variables that can provide an API key or auth marker for a provider.
 *
 * This only reports explicit environment variables. It intentionally excludes
 * ambient credential sources such as AWS profiles, AWS IAM credentials, and
 * Google Application Default Credentials.
 */
export function findEnvKeys(provider: KnownProvider, env?: ProviderEnv): string[] | undefined;
export function findEnvKeys(provider: string, env?: ProviderEnv): string[] | undefined;
export function findEnvKeys(provider: string, env?: ProviderEnv): string[] | undefined {
	const envVars = getApiKeyEnvVars(provider);
	if (!envVars) return undefined;

	const found = envVars.filter((envVar) => !!getProviderEnvValue(envVar, env));
	return found.length > 0 ? found : undefined;
}

/**
 * Get API key for provider from known environment variables, e.g. OPENAI_API_KEY.
 *
 * Will not return API keys for providers that require OAuth tokens.
 */
export function getEnvApiKey(provider: KnownProvider, env?: ProviderEnv): string | undefined;
export function getEnvApiKey(provider: string, env?: ProviderEnv): string | undefined;
export function getEnvApiKey(provider: string, env?: ProviderEnv): string | undefined {
	if (provider === "anthropic-vertex") {
		const hasProject = !!getProviderEnvValue("ANTHROPIC_VERTEX_PROJECT_ID", env);
		if (hasProject) {
			return "<authenticated>";
		}

		const hasGoogleProject = !!(
			getProviderEnvValue("GOOGLE_CLOUD_PROJECT", env) || getProviderEnvValue("GCLOUD_PROJECT", env)
		);
		if (hasGoogleProject && hasVertexAdcCredentials(env)) {
			return "<authenticated>";
		}
	}

	const envKeys = findEnvKeys(provider, env);
	if (envKeys?.[0]) {
		return getProviderEnvValue(envKeys[0], env);
	}

	// Vertex AI supports either an explicit API key or Application Default Credentials.
	// Auth is configured via `gcloud auth application-default login`.
	if (provider === "google-vertex") {
		const hasCredentials = hasVertexAdcCredentials(env);
		const hasProject = !!(
			getProviderEnvValue("GOOGLE_CLOUD_PROJECT", env) || getProviderEnvValue("GCLOUD_PROJECT", env)
		);
		const hasLocation = !!getProviderEnvValue("GOOGLE_CLOUD_LOCATION", env);

		if (hasCredentials && hasProject && hasLocation) {
			return "<authenticated>";
		}
	}

	if (provider === "amazon-bedrock") {
		// Amazon Bedrock supports multiple credential sources:
		// 1. AWS_PROFILE - named profile from ~/.aws/credentials
		// 2. AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY - standard IAM keys
		// 3. AWS_BEARER_TOKEN_BEDROCK - Bedrock bearer token
		// 4. AWS_CONTAINER_CREDENTIALS_RELATIVE_URI - ECS task roles
		// 5. AWS_CONTAINER_CREDENTIALS_FULL_URI - ECS task roles (full URI)
		// 6. AWS_WEB_IDENTITY_TOKEN_FILE - IRSA (IAM Roles for Service Accounts)
		if (
			getProviderEnvValue("AWS_PROFILE", env) ||
			(getProviderEnvValue("AWS_ACCESS_KEY_ID", env) && getProviderEnvValue("AWS_SECRET_ACCESS_KEY", env)) ||
			getProviderEnvValue("AWS_BEARER_TOKEN_BEDROCK", env) ||
			getProviderEnvValue("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", env) ||
			getProviderEnvValue("AWS_CONTAINER_CREDENTIALS_FULL_URI", env) ||
			getProviderEnvValue("AWS_WEB_IDENTITY_TOKEN_FILE", env)
		) {
			return "<authenticated>";
		}
	}

	return undefined;
}
