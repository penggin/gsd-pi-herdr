import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NodeExecutionEnv } from "../../src/harness/env/nodejs.ts";
import { SessionRepositoryAdapter } from "../../src/harness/session/session-repository-adapter.ts";
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

	it("does not expose a harness v4 create path", async () => {
		const root = createTempDir();
		const env = new NodeExecutionEnv({ cwd: root });
		const adapter = new SessionRepositoryAdapter({ fs: env, sessionsRoot: join(root, "sessions") });
		await expect(adapter.create({ cwd: root, format: "harness-v4" })).rejects.toMatchObject({
			code: "unsupported_version",
		});
		expect(await adapter.list()).toEqual([]);
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
