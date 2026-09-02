import type {
	FileSystem,
	JsonlSessionCreateOptions,
	JsonlSessionListOptions,
	JsonlSessionMetadata,
	JsonlSessionRepoApi,
	Session,
	SessionForkOptions,
	SessionTreeEntry,
} from "../types.js";
import { SessionError } from "../types.js";
import { JsonlSessionRepo } from "./jsonl-repo.js";
import { JsonlSessionStorage, loadJsonlSessionMetadata } from "./jsonl-storage.js";
import {
	detectJsonlSessionFormat,
	type JsonlSessionFormat,
	type JsonlSessionFormatDetection,
} from "./jsonl-version.js";

export interface SessionRepositoryAdapterOptions {
	fs: FileSystem;
	sessionsRoot: string;
}

export interface VersionedJsonlSessionCreateOptions extends JsonlSessionCreateOptions {
	/** Legacy v3 is the only writable format until the v4 conformance gate passes. */
	format?: JsonlSessionFormat;
}

export interface ReadOnlyJsonlSessionSnapshot {
	format: "legacy-v3";
	metadata: Readonly<JsonlSessionMetadata>;
	leafId: string | null;
	entries: readonly SessionTreeEntry[];
}

export interface JsonlSessionCatalogDiagnostic {
	path: string;
	modifiedAt: number;
	detection: JsonlSessionFormatDetection;
}

/** Canonical construction path for version-aware JSONL session repositories. */
export function createSessionRepository(options: SessionRepositoryAdapterOptions): SessionRepositoryAdapter {
	return new SessionRepositoryAdapter(options);
}

function detectionMessage(detection: JsonlSessionFormatDetection): string {
	if (detection.status === "invalid") return detection.message;
	if (detection.status === "unsupported") {
		return `${detection.family} session version ${detection.version} is not supported`;
	}
	return `${detection.format} is recognized but its reader is not enabled`;
}

function deepFreeze<T>(value: T): Readonly<T> {
	if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}

/**
 * Version-neutral routing seam over the current legacy JSONL repository.
 * It recognizes v4 but deliberately exposes no v4 writer or fallback.
 */
export class SessionRepositoryAdapter implements JsonlSessionRepoApi {
	private readonly fs: FileSystem;
	private readonly legacy: JsonlSessionRepo;

	constructor(options: SessionRepositoryAdapterOptions) {
		this.fs = options.fs;
		this.legacy = new JsonlSessionRepo(options);
	}

	detect(path: string): Promise<JsonlSessionFormatDetection> {
		return detectJsonlSessionFormat(this.fs, path);
	}

	async create(options: VersionedJsonlSessionCreateOptions): Promise<Session<JsonlSessionMetadata>> {
		if (options.format !== undefined && options.format !== "legacy-v3") {
			throw new SessionError("unsupported_version", "Harness v4 session creation is not enabled");
		}
		const { format: _format, ...legacyOptions } = options;
		return this.legacy.create(legacyOptions);
	}

	async open(metadata: JsonlSessionMetadata): Promise<Session<JsonlSessionMetadata>> {
		await this.requireLegacy(metadata.path);
		return this.legacy.open(metadata);
	}

	async openReadOnly(path: string): Promise<ReadOnlyJsonlSessionSnapshot> {
		await this.requireLegacy(path);
		const metadata = await loadJsonlSessionMetadata(this.fs, path);
		const storage = await JsonlSessionStorage.open(this.fs, path);
		return deepFreeze({
			format: "legacy-v3" as const,
			metadata: structuredClone(metadata),
			leafId: await storage.getLeafId(),
			entries: structuredClone(await storage.getEntries()),
		});
	}

	list(options?: JsonlSessionListOptions): Promise<JsonlSessionMetadata[]> {
		return this.legacy.list(options);
	}

	async listDiagnostics(options?: JsonlSessionListOptions): Promise<JsonlSessionCatalogDiagnostic[]> {
		const diagnostics = await Promise.all(
			(await this.legacy.listFiles(options)).map(async (file) => ({
				path: file.path,
				modifiedAt: file.mtimeMs,
				detection: await this.detect(file.path),
			})),
		);
		return diagnostics.sort((left, right) => right.modifiedAt - left.modifiedAt);
	}

	async delete(metadata: JsonlSessionMetadata): Promise<void> {
		await this.requireLegacy(metadata.path);
		await this.legacy.delete(metadata);
	}

	async fork(
		source: JsonlSessionMetadata,
		options: SessionForkOptions & VersionedJsonlSessionCreateOptions,
	): Promise<Session<JsonlSessionMetadata>> {
		await this.requireLegacy(source.path);
		if (options.format !== undefined && options.format !== "legacy-v3") {
			throw new SessionError("unsupported_version", "Harness v4 session forks are not enabled");
		}
		const { format: _format, ...legacyOptions } = options;
		return this.legacy.fork(source, legacyOptions);
	}

	async close(): Promise<void> {
		// The legacy repository holds no open handles. The method is part of the
		// version-neutral lifecycle so a future v4 backend can release resources.
	}

	private async requireLegacy(path: string): Promise<void> {
		const detection = await this.detect(path);
		if (detection.status === "supported" && detection.format === "legacy-v3") return;
		throw new SessionError(
			detection.status === "invalid" ? "invalid_session" : "unsupported_version",
			`Cannot open session ${path}: ${detectionMessage(detection)}`,
		);
	}
}
