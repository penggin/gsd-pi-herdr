import type { ModelsStore, ModelsStoreEntry, ModelsStoreOperationOptions } from "@gsd/pi-ai";
import { join } from "node:path";
import { getAgentDir } from "../config.js";
import { normalizePath } from "../utils/paths.js";
import { type AuthStorageBackend, FileAuthStorageBackend } from "./auth-storage.js";

type StoredModels = Record<string, ModelsStoreEntry>;

function parseStoredModels(content: string | undefined): StoredModels {
	if (!content) return {};
	const withoutBom = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
	const parsed = JSON.parse(withoutBom) as unknown;
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("Invalid models store: expected an object keyed by provider ID");
	}
	return parsed as StoredModels;
}

export class InMemoryCodingAgentModelsStore implements ModelsStore {
	private readonly entries = new Map<string, ModelsStoreEntry>();

	async read(providerId: string, options?: ModelsStoreOperationOptions): Promise<ModelsStoreEntry | undefined> {
		options?.signal?.throwIfAborted();
		const entry = this.entries.get(providerId);
		return entry ? structuredClone(entry) : undefined;
	}

	async write(providerId: string, entry: ModelsStoreEntry, options?: ModelsStoreOperationOptions): Promise<void> {
		options?.signal?.throwIfAborted();
		this.entries.set(providerId, structuredClone(entry));
	}

	async delete(providerId: string, options?: ModelsStoreOperationOptions): Promise<void> {
		options?.signal?.throwIfAborted();
		this.entries.delete(providerId);
	}
}

/** Locked JSON-backed storage for dynamically refreshed provider catalogs. */
export class FileModelsStore implements ModelsStore {
	private readonly storage: AuthStorageBackend;

	constructor(path: string = join(getAgentDir(), "models-store.json")) {
		this.storage = new FileAuthStorageBackend(normalizePath(path));
	}

	async read(providerId: string, options?: ModelsStoreOperationOptions): Promise<ModelsStoreEntry | undefined> {
		options?.signal?.throwIfAborted();
		return this.storage.withLockAsync(async (content) => {
			options?.signal?.throwIfAborted();
			const entry = parseStoredModels(content)[providerId];
			options?.signal?.throwIfAborted();
			return { result: entry ? structuredClone(entry) : undefined };
		});
	}

	async write(providerId: string, entry: ModelsStoreEntry, options?: ModelsStoreOperationOptions): Promise<void> {
		options?.signal?.throwIfAborted();
		await this.storage.withLockAsync(async (content) => {
			options?.signal?.throwIfAborted();
			const current = parseStoredModels(content);
			current[providerId] = structuredClone(entry);
			options?.signal?.throwIfAborted();
			return { result: undefined, next: JSON.stringify(current, null, 2) };
		});
	}

	async delete(providerId: string, options?: ModelsStoreOperationOptions): Promise<void> {
		options?.signal?.throwIfAborted();
		await this.storage.withLockAsync(async (content) => {
			options?.signal?.throwIfAborted();
			const current = parseStoredModels(content);
			delete current[providerId];
			options?.signal?.throwIfAborted();
			return { result: undefined, next: JSON.stringify(current, null, 2) };
		});
	}
}
