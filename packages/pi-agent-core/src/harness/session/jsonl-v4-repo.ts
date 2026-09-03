import type { FileSystem } from "../types.js";
import { SessionError } from "../types.js";
import type { JsonlV4Header } from "./jsonl-v4-codec.js";
import type { JsonlV4SessionMetadata } from "./jsonl-v4-reader.js";
import { readJsonlV4Session } from "./jsonl-v4-reader.js";
import { JsonlV4SessionStorage } from "./jsonl-v4-storage.js";
import { getFileSystemResultOrThrow } from "./repo-utils.js";
import { assertV4JsonSerializable } from "./session-v4-json.js";
import type { V4ForkOptions } from "./session-v4-state.js";
import { uuidv7 } from "./uuid.js";

const SESSION_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const MAX_SESSION_ID_LENGTH = 512;

export interface JsonlV4SessionCreateOptions {
	id?: string;
	cwd: string;
	parentSessionId?: string;
	metadata?: Record<string, unknown>;
	abortSignal?: AbortSignal;
}

export interface JsonlV4SessionListOptions {
	cwd?: string;
}

export type JsonlV4SessionDirectoryLayout = "cwd-partitioned" | "flat";

function validateSessionId(id: string): void {
	if (id.length > MAX_SESSION_ID_LENGTH || !SESSION_ID_PATTERN.test(id)) {
		throw new SessionError(
			"invalid_payload",
			"Session id must use at most 512 alphanumeric, '-', '_', or '.' characters and start and end with an alphanumeric character",
		);
	}
}

function directoryName(cwd: string): string {
	return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

function fileName(createdAt: number, id: string): string {
	return `${new Date(createdAt).toISOString().replace(/[:.]/g, "-")}_${id}.jsonl`;
}

function normalizePortablePath(path: string): string {
	const portable = path.replace(/\\/g, "/");
	const normalized = portable === "/" || /^[A-Za-z]:\/$/.test(portable) ? portable : portable.replace(/\/+$/, "");
	return /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized;
}

function isContained(root: string, candidate: string): boolean {
	const normalizedRoot = normalizePortablePath(root);
	const normalizedCandidate = normalizePortablePath(candidate);
	const prefix = normalizedRoot.endsWith("/") ? normalizedRoot : `${normalizedRoot}/`;
	return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(prefix);
}

export class JsonlV4SessionRepository {
	private readonly fs: FileSystem;
	private readonly sessionsRootInput: string;
	private readonly directoryLayout: JsonlV4SessionDirectoryLayout;
	private readonly activeDestinations = new Set<string>();
	private rootPromise: Promise<string> | undefined;

	constructor(options: {
		fs: FileSystem;
		sessionsRoot: string;
		directoryLayout?: JsonlV4SessionDirectoryLayout;
	}) {
		this.fs = options.fs;
		this.sessionsRootInput = options.sessionsRoot;
		this.directoryLayout = options.directoryLayout ?? "cwd-partitioned";
	}

	async create(options: JsonlV4SessionCreateOptions): Promise<JsonlV4SessionStorage> {
		const destination = await this.resolveDestination(options);
		return this.claimDestination(destination, async () => {
			const prepared = await this.prepareCreate(destination, options);
			return JsonlV4SessionStorage.create(
				this.fs,
				prepared.path,
				prepared.header,
				{ sessionsRoot: await this.root() },
				options.abortSignal,
			);
		});
	}

	async open(metadata: JsonlV4SessionMetadata, abortSignal?: AbortSignal): Promise<JsonlV4SessionStorage> {
		if (!getFileSystemResultOrThrow(await this.fs.exists(metadata.path, abortSignal), `Failed to check session`)) {
			throw new SessionError("not_found", `Session not found: ${metadata.id}`);
		}
		const storage = await JsonlV4SessionStorage.load(
			this.fs,
			metadata.path,
			{ sessionsRoot: await this.root() },
			abortSignal,
		);
		if (storage.getMetadata().id !== metadata.id) {
			throw new SessionError("invalid_entry", `Session id does not match header: ${metadata.id}`);
		}
		return storage;
	}

	async list(options: JsonlV4SessionListOptions = {}): Promise<JsonlV4SessionMetadata[]> {
		const metadata: JsonlV4SessionMetadata[] = [];
		for (const directory of await this.sessionDirectories(options.cwd)) {
			const info = getFileSystemResultOrThrow(await this.fs.fileInfo(directory), `Failed to inspect ${directory}`);
			if (info.kind !== "directory") continue;
			for (const file of getFileSystemResultOrThrow(await this.fs.listDir(directory), `Failed to list ${directory}`)) {
				if (file.kind !== "file" || !file.name.endsWith(".jsonl")) continue;
				try {
					const snapshot = await readJsonlV4Session(this.fs, file.path, { sessionsRoot: await this.root() });
					metadata.push(structuredClone(snapshot.metadata));
				} catch (error) {
					if (
						error instanceof SessionError &&
						(error.code === "invalid_session" || error.code === "invalid_entry")
					) {
						continue;
					}
					throw error;
				}
			}
		}
		return metadata.sort((left, right) => right.modifiedAt - left.modifiedAt);
	}

	async delete(metadata: JsonlV4SessionMetadata): Promise<void> {
		if (!getFileSystemResultOrThrow(await this.fs.exists(metadata.path), `Failed to check session`)) return;
		const storage = await this.open(metadata);
		await storage.drain();
		getFileSystemResultOrThrow(
			await this.fs.remove(metadata.path, { force: true }),
			`Failed to delete session ${metadata.id}`,
		);
	}

	async fork(
		source: JsonlV4SessionMetadata,
		options: V4ForkOptions & JsonlV4SessionCreateOptions,
	): Promise<JsonlV4SessionStorage> {
		const sourceStorage = await this.open(source, options.abortSignal);
		const createOptions = { ...options, parentSessionId: options.parentSessionId ?? source.id };
		const destination = await this.resolveDestination(createOptions);
		return this.claimDestination(destination, async () => {
			const prepared = await this.prepareCreate(destination, createOptions);
			return sourceStorage.fork(
				prepared.path,
				prepared.header,
				options,
				{ sessionsRoot: await this.root() },
				options.abortSignal,
			);
		});
	}

	private async resolveDestination(options: JsonlV4SessionCreateOptions): Promise<{ id: string; cwd: string }> {
		const id = options.id ?? uuidv7();
		validateSessionId(id);
		const cwd = getFileSystemResultOrThrow(
			await this.fs.absolutePath(options.cwd, options.abortSignal),
			`Failed to resolve session cwd`,
		);
		return { id, cwd };
	}

	private async claimDestination<T>(destination: { id: string; cwd: string }, operation: () => Promise<T>): Promise<T> {
		const key = this.directoryLayout === "flat" ? destination.id : `${destination.cwd}\0${destination.id}`;
		if (this.activeDestinations.has(key)) {
			throw new SessionError("already_exists", `Session already exists: ${destination.id}`);
		}
		this.activeDestinations.add(key);
		try {
			return await operation();
		} finally {
			this.activeDestinations.delete(key);
		}
	}

	private async prepareCreate(
		destination: { id: string; cwd: string },
		options: JsonlV4SessionCreateOptions,
	): Promise<{ header: JsonlV4Header; path: string }> {
		const directory = await this.ensureSessionDirectory(destination.cwd, options.abortSignal);
		if (await this.sessionIdExists(destination.id, directory, options.abortSignal)) {
			throw new SessionError("already_exists", `Session already exists: ${destination.id}`);
		}
		if (options.metadata !== undefined) assertV4JsonSerializable(options.metadata);
		const createdAt = Date.now();
		const path = getFileSystemResultOrThrow(
			await this.fs.joinPath([directory, fileName(createdAt, destination.id)], options.abortSignal),
			`Failed to resolve session path`,
		);
		return {
			path,
			header: {
				kind: "header",
				version: 4,
				id: destination.id,
				createdAt,
				cwd: destination.cwd,
				...(options.parentSessionId === undefined ? {} : { parentSessionId: options.parentSessionId }),
				...(options.metadata === undefined ? {} : { metadata: structuredClone(options.metadata) }),
			},
		};
	}

	private async sessionIdExists(id: string, directory: string, abortSignal?: AbortSignal): Promise<boolean> {
		const suffix = `_${id}.jsonl`;
		return getFileSystemResultOrThrow(
			await this.fs.listDir(directory, abortSignal),
			`Failed to list session directory`,
		).some((entry) => entry.kind !== "directory" && entry.name.endsWith(suffix));
	}

	private async ensureSessionDirectory(cwd: string, abortSignal?: AbortSignal): Promise<string> {
		const root = await this.root();
		getFileSystemResultOrThrow(
			await this.fs.createDir(root, { recursive: true, abortSignal }),
			`Failed to create sessions root`,
		);
		const directory = this.directoryLayout === "flat"
			? root
			: getFileSystemResultOrThrow(
					await this.fs.joinPath([root, directoryName(cwd)], abortSignal),
					`Failed to resolve session directory`,
				);
		getFileSystemResultOrThrow(
			await this.fs.createDir(directory, { recursive: true, abortSignal }),
			`Failed to create session directory`,
		);
		const info = getFileSystemResultOrThrow(await this.fs.fileInfo(directory, abortSignal), `Failed to inspect directory`);
		if (info.kind !== "directory") throw new SessionError("invalid_session", "Session directory is not a directory");
		const canonicalRoot = getFileSystemResultOrThrow(await this.fs.canonicalPath(root, abortSignal), `Failed to resolve root`);
		const canonicalDirectory = getFileSystemResultOrThrow(
			await this.fs.canonicalPath(directory, abortSignal),
			`Failed to resolve session directory`,
		);
		if (!isContained(canonicalRoot, canonicalDirectory)) {
			throw new SessionError("invalid_session", "Session directory escapes the configured sessions root");
		}
		return directory;
	}

	private async sessionDirectories(cwd?: string): Promise<string[]> {
		const root = await this.root();
		if (this.directoryLayout === "flat") {
			return getFileSystemResultOrThrow(await this.fs.exists(root), `Failed to check sessions root`) ? [root] : [];
		}
		if (cwd !== undefined) {
			const resolvedCwd = getFileSystemResultOrThrow(await this.fs.absolutePath(cwd), `Failed to resolve session cwd`);
			const directory = getFileSystemResultOrThrow(
				await this.fs.joinPath([root, directoryName(resolvedCwd)]),
				`Failed to resolve session directory`,
			);
			return getFileSystemResultOrThrow(await this.fs.exists(directory), `Failed to check session directory`)
				? [directory]
				: [];
		}
		if (!getFileSystemResultOrThrow(await this.fs.exists(root), `Failed to check sessions root`)) return [];
		return getFileSystemResultOrThrow(await this.fs.listDir(root), `Failed to list sessions root`)
			.filter((entry) => entry.kind === "directory")
			.map((entry) => entry.path);
	}

	private root(): Promise<string> {
		this.rootPromise ??= this.fs
			.absolutePath(this.sessionsRootInput)
			.then((result) => getFileSystemResultOrThrow(result, `Failed to resolve sessions root`));
		return this.rootPromise;
	}
}
