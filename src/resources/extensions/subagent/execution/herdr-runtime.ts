import { existsSync, lstatSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SAFE_PANE_ID = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/;

export interface HerdrWorkerCleanupRequestV1 {
	schemaVersion: 1;
	action: "release-retained";
	requestedAt: string;
	paneId: string;
	rootSessionId: string;
	dispatchId: string;
	childId: string;
}

/**
 * Consume plugin-authored retained-worker release requests for one root.
 *
 * The plugin cannot mutate the in-memory pane pool. It leaves a private,
 * identity-bound marker in the worker directory; the owning GSD runtime is the
 * only process allowed to convert that marker into reusable slot capacity.
 */
export function consumeHerdrWorkerCleanupRequests(runtimeRoot: string, rootSessionId: string): string[] {
	if (!isAbsolute(runtimeRoot)) throw new Error("Herdr runtime root must be absolute");
	assertSafeId(rootSessionId, "rootSessionId");
	const rootDir = resolve(runtimeRoot, rootSessionId);
	if (!existsSync(rootDir)) return [];
	assertPrivateDirectory(rootDir);

	const paneIds: string[] = [];
	for (const dispatchId of safeDirectories(rootDir)) {
		const dispatchDir = join(rootDir, dispatchId);
		for (const childId of safeDirectories(dispatchDir)) {
			const workerDir = join(dispatchDir, childId);
			const cleanupPath = join(workerDir, "cleanup.json");
			if (!existsSync(cleanupPath)) continue;
			const request = readCleanup(cleanupPath);
			if (request.rootSessionId !== rootSessionId || request.dispatchId !== dispatchId || request.childId !== childId) {
				throw new Error("Herdr worker cleanup request identity does not match its artifact path");
			}
			paneIds.push(request.paneId);
			unlinkSync(cleanupPath);
		}
	}
	return [...new Set(paneIds)];
}

function readCleanup(path: string): HerdrWorkerCleanupRequestV1 {
	const stat = lstatSync(path);
	if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Unsafe Herdr worker cleanup request");
	if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
		throw new Error("Herdr worker cleanup request must be owner-only");
	}
	const value = JSON.parse(readFileSync(path, "utf8")) as Partial<HerdrWorkerCleanupRequestV1>;
	if (value.schemaVersion !== 1 || value.action !== "release-retained") {
		throw new Error("Unsupported Herdr worker cleanup request");
	}
	if (!Number.isFinite(Date.parse(String(value.requestedAt)))) throw new Error("Invalid Herdr worker cleanup timestamp");
	if (typeof value.paneId !== "string" || !SAFE_PANE_ID.test(value.paneId)) {
		throw new Error("Invalid Herdr worker cleanup paneId");
	}
	for (const [key, item] of Object.entries({
		rootSessionId: value.rootSessionId,
		dispatchId: value.dispatchId,
		childId: value.childId,
	})) {
		if (typeof item !== "string" || !SAFE_ID.test(item)) throw new Error(`Invalid Herdr worker cleanup ${key}`);
	}
	return value as HerdrWorkerCleanupRequestV1;
}

function safeDirectories(parent: string): string[] {
	return readdirSync(parent, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && SAFE_ID.test(entry.name))
		.map((entry) => entry.name);
}

function assertPrivateDirectory(path: string): void {
	const stat = lstatSync(path);
	if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Unsafe Herdr worker runtime directory");
	if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
		throw new Error("Herdr worker runtime directory must be owner-only");
	}
}

function assertSafeId(value: string, label: string): void {
	if (!SAFE_ID.test(value) || value === "." || value === "..") throw new Error(`Invalid Herdr worker ${label}`);
}
