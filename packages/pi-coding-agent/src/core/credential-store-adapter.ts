import type {
	AuthOperationOptions,
	Credential,
	CredentialInfo,
	CredentialStore,
} from "@gsd/pi-ai";
import type { AuthCredential, AuthStorage } from "./auth-storage.js";

function toCredential(value: AuthCredential | undefined): Credential | undefined {
	return value ? structuredClone(value) : undefined;
}

/** v0.80 credential contract backed by the existing locked AuthStorage. */
export class AuthStorageCredentialAdapter implements CredentialStore {
	constructor(private readonly authStorage: AuthStorage) {}

	async read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
		options?.signal?.throwIfAborted();
		return toCredential(this.authStorage.get(providerId));
	}

	async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
		options?.signal?.throwIfAborted();
		return this.authStorage.list().flatMap((providerId) => {
			const credential = this.authStorage.get(providerId);
			return credential ? [{ providerId, type: credential.type }] : [];
		});
	}

	async modify(
		providerId: string,
		fn: (current: Credential | undefined) => Promise<Credential | undefined>,
		options?: AuthOperationOptions,
	): Promise<Credential | undefined> {
		const result = await this.authStorage.modifyCredential(
			providerId,
			async (current) => (await fn(toCredential(current))) as AuthCredential | undefined,
			options,
		);
		return toCredential(result);
	}

	async delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
		options?.signal?.throwIfAborted();
		this.authStorage.remove(providerId);
		options?.signal?.throwIfAborted();
	}
}
