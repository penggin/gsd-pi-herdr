import type { OAuthCredentials } from "./utils/oauth/types.js";

export interface ApiKeyCredential {
	type: "api_key";
	key?: string;
	env?: Record<string, string>;
}

export interface OAuthCredential extends OAuthCredentials {
	type: "oauth";
}

export type Credential = ApiKeyCredential | OAuthCredential;
export interface CredentialInfo { providerId: string; type: Credential["type"] }
export interface AuthOperationOptions { signal?: AbortSignal }

export interface CredentialStore {
	read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined>;
	list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]>;
	modify(
		providerId: string,
		fn: (current: Credential | undefined) => Promise<Credential | undefined>,
		options?: AuthOperationOptions,
	): Promise<Credential | undefined>;
	delete(providerId: string, options?: AuthOperationOptions): Promise<void>;
}
