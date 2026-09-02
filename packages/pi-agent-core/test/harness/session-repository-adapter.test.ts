import { readFileSync, writeFileSync } from "node:fs";
import { symlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { NodeExecutionEnv } from "../../src/harness/env/nodejs.ts";
import {
	createSessionRepository,
	SessionRepositoryAdapter,
} from "../../src/harness/session/session-repository-adapter.ts";
import { createTempDir } from "./session-test-utils.ts";

const fixtures = join(import.meta.dirname, "fixtures");

describe("SessionRepositoryAdapter", () => {
	it("creates legacy v3 by default and exposes a read-only snapshot", async () => {
		const root = createTempDir();
		const env = new NodeExecutionEnv({ cwd: root });
		const adapter = new SessionRepositoryAdapter({ fs: env, sessionsRoot: join(root, "sessions") });
		const session = await adapter.create({ cwd: root, id: "adapter-v3" });
		const metadata = await session.getMetadata();
		expect(await adapter.detect(metadata.path)).toEqual({
			status: "supported",
			format: "legacy-v3",
			version: 3,
		});
		const snapshot = await adapter.openReadOnly(metadata.path);
		expect(snapshot).toMatchObject({ format: "legacy-v3", leafId: null, metadata: { id: "adapter-v3" } });
		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(Object.isFrozen(snapshot.entries)).toBe(true);
		expect(Object.isFrozen(snapshot.metadata)).toBe(true);
	});

	it("constructs the version-aware repository through the canonical factory", async () => {
		const root = createTempDir();
		const adapter = createSessionRepository({
			fs: new NodeExecutionEnv({ cwd: root }),
			sessionsRoot: join(root, "sessions"),
		});
		expect(adapter).toBeInstanceOf(SessionRepositoryAdapter);
		const session = await adapter.create({ cwd: root, id: "factory-v3" });
		expect(await adapter.detect((await session.getMetadata()).path)).toMatchObject({
			status: "supported",
			format: "legacy-v3",
		});
	});

	it("does not expose a harness v4 create path", async () => {
		const root = createTempDir();
		const env = new NodeExecutionEnv({ cwd: root });
		const adapter = new SessionRepositoryAdapter({ fs: env, sessionsRoot: join(root, "sessions") });
		await expect(adapter.create({ cwd: root, format: "harness-v4" })).rejects.toMatchObject({
			code: "unsupported_version",
		});
		expect(await adapter.list()).toEqual([]);
	});

	it("lists recognized v4 files as diagnostics without making them openable", async () => {
		const root = createTempDir();
		const env = new NodeExecutionEnv({ cwd: root });
		const adapter = new SessionRepositoryAdapter({ fs: env, sessionsRoot: join(root, "sessions") });
		const legacy = await adapter.create({ cwd: root, id: "listed-v3" });
		const legacyMetadata = await legacy.getMetadata();
		const v4Path = join(dirname(legacyMetadata.path), "listed-v4.jsonl");
		writeFileSync(
			v4Path,
			`${JSON.stringify({ kind: "header", version: 4, id: "listed-v4", createdAt: 1, cwd: root })}\n`,
		);

		const diagnostics = await adapter.listDiagnostics({ cwd: root });
		expect(diagnostics).toHaveLength(2);
		expect(diagnostics.find((entry) => entry.path === legacyMetadata.path)?.detection).toMatchObject({
			status: "supported",
			format: "legacy-v3",
		});
		expect(diagnostics.find((entry) => entry.path === v4Path)?.detection).toEqual({
			status: "supported",
			format: "harness-v4",
			version: 4,
		});
		expect((await adapter.list({ cwd: root })).map((entry) => entry.id)).toEqual(["listed-v3"]);
		await expect(adapter.openReadOnly(v4Path)).rejects.toMatchObject({ code: "unsupported_version" });
	});

	it("reports symlink candidates without following them in the normal list", async () => {
		const root = createTempDir();
		const env = new NodeExecutionEnv({ cwd: root });
		const adapter = createSessionRepository({ fs: env, sessionsRoot: join(root, "sessions") });
		const legacy = await adapter.create({ cwd: root, id: "symlink-target" });
		const metadata = await legacy.getMetadata();
		const linkPath = join(dirname(metadata.path), "linked-session.jsonl");
		await symlink(metadata.path, linkPath);

		const diagnostics = await adapter.listDiagnostics({ cwd: root });
		expect(diagnostics.find((entry) => entry.path === linkPath)?.detection).toEqual({
			status: "invalid",
			reason: "symlink",
			message: "session path must not be a symbolic link",
		});
		expect((await adapter.list({ cwd: root })).map((entry) => entry.id)).toEqual(["symlink-target"]);
	});

	it("recognizes v4 and corrupt inputs without rewriting or falling back", async () => {
		const env = new NodeExecutionEnv({ cwd: fixtures });
		const adapter = new SessionRepositoryAdapter({ fs: env, sessionsRoot: fixtures });
		for (const [name, code] of [
			["session-v4-upstream.jsonl", "unsupported_version"],
			["session-malformed.jsonl", "invalid_session"],
		] as const) {
			const path = join(fixtures, name);
			const before = readFileSync(path, "utf8");
			await expect(adapter.openReadOnly(path)).rejects.toMatchObject({ code });
			expect(readFileSync(path, "utf8")).toBe(before);
		}
	});

	it("preserves opaque downstream details in read-only legacy snapshots", async () => {
		const env = new NodeExecutionEnv({ cwd: fixtures });
		const adapter = new SessionRepositoryAdapter({ fs: env, sessionsRoot: fixtures });
		const path = join(fixtures, "session-v3-opaque.jsonl");
		const before = readFileSync(path, "utf8");
		const snapshot = await adapter.openReadOnly(path);
		expect(snapshot.entries[1]).toMatchObject({
			type: "custom_message",
			details: { schemaVersion: "gsd.findings/v1", runId: "GAR-fixture" },
		});
		expect(snapshot.entries[2]).toMatchObject({
			type: "compaction",
			details: { checkpoint: { encrypted_content: "ocx1:opaque-fixture" } },
		});
		expect(readFileSync(path, "utf8")).toBe(before);
	});
});
