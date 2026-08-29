import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { consumeHerdrWorkerCleanupRequests, recoverHerdrWorkerSlotStates } from "../herdr-runtime.js";

describe("Herdr runtime control artifacts", () => {
	let tempRoot: string | undefined;
	afterEach(() => {
		if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
		tempRoot = undefined;
	});

	function fixture() {
		tempRoot = mkdtempSync(join(tmpdir(), "gsd-herdr-runtime-control-"));
		const runtimeRoot = join(tempRoot, "v1");
		const workerDir = join(runtimeRoot, "root-1", "dispatch-1", "child-1");
		mkdirSync(workerDir, { recursive: true, mode: 0o700 });
		for (const path of [runtimeRoot, join(runtimeRoot, "root-1"), join(runtimeRoot, "root-1", "dispatch-1"), workerDir]) {
			chmodSync(path, 0o700);
		}
		const cleanupPath = join(workerDir, "cleanup.json");
		writeFileSync(cleanupPath, `${JSON.stringify({
			schemaVersion: 1,
			action: "release-retained",
			requestedAt: "2026-08-30T00:00:00.000Z",
			paneId: "w1:p2",
			rootSessionId: "root-1",
			dispatchId: "dispatch-1",
			childId: "child-1",
		})}\n`, { mode: 0o600 });
		return { runtimeRoot, cleanupPath };
	}

	it("consumes a private identity-bound cleanup request exactly once", () => {
		const { runtimeRoot, cleanupPath } = fixture();
		assert.deepEqual(consumeHerdrWorkerCleanupRequests(runtimeRoot, "root-1"), ["w1:p2"]);
		assert.equal(existsSync(cleanupPath), false);
		assert.deepEqual(consumeHerdrWorkerCleanupRequests(runtimeRoot, "root-1"), []);
	});

	it("rejects artifact identity substitution", () => {
		const { runtimeRoot, cleanupPath } = fixture();
		const value = JSON.parse(readFileSync(cleanupPath, "utf8"));
		writeFileSync(cleanupPath, `${JSON.stringify({ ...value, childId: "other" })}\n`, { mode: 0o600 });
		assert.throws(() => consumeHerdrWorkerCleanupRequests(runtimeRoot, "root-1"), /identity does not match/);
	});

	it("recovers busy and settled slot ownership without creating a duplicate lease", () => {
		const { runtimeRoot, cleanupPath } = fixture();
		const workerDir = join(runtimeRoot, "root-1", "dispatch-1", "child-1");
		const ownershipPath = join(workerDir, "ownership.json");
		const statePath = join(workerDir, "state.json");
		writeFileSync(ownershipPath, `${JSON.stringify({
			schemaVersion: 1,
			rootSessionId: "root-1",
			dispatchId: "dispatch-1",
			childId: "child-1",
			ownerInstanceId: "instance-1",
			paneId: "w1:p2",
			tabId: "w1:t2",
			workspaceId: "w1",
			affinityKey: "dispatch:child",
			status: "running",
			updatedAt: "2026-08-30T00:00:00.000Z",
		})}\n`, { mode: 0o600 });
		writeFileSync(statePath, `${JSON.stringify({ schemaVersion: 1, status: "working", updatedAt: "2026-08-30T00:00:00.000Z", paneId: "w1:p2" })}\n`, { mode: 0o600 });
		assert.deepEqual(recoverHerdrWorkerSlotStates(runtimeRoot, "root-1").get("w1:p2"), { state: "busy", affinityKey: "dispatch:child" });

		const ownership = JSON.parse(readFileSync(ownershipPath, "utf8"));
		writeFileSync(ownershipPath, `${JSON.stringify({ ...ownership, status: "settled", updatedAt: "2026-08-30T00:01:00.000Z" })}\n`, { mode: 0o600 });
		writeFileSync(statePath, `${JSON.stringify({ schemaVersion: 1, status: "completed", updatedAt: "2026-08-30T00:01:00.000Z", paneId: "w1:p2" })}\n`, { mode: 0o600 });
		assert.deepEqual(recoverHerdrWorkerSlotStates(runtimeRoot, "root-1").get("w1:p2"), { state: "retained-success", affinityKey: "dispatch:child" });
		assert.equal(existsSync(cleanupPath), true);
	});
});
