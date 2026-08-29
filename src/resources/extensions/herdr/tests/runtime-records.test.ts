import assert from "node:assert/strict";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test, { type TestContext } from "node:test";

import {
  HerdrRootRuntimeLease,
  herdrRootRuntimeId,
  readHerdrRootRuntimeRecord,
  resolveHerdrRootRuntimePaths,
} from "../runtime-records.js";

function fixture(t: TestContext) {
  const tempRoot = mkdtempSync(join(tmpdir(), "gsd-herdr-root-runtime-"));
  const gsdHome = join(tempRoot, "gsd-home");
  mkdirSync(gsdHome);
  t.after(() => rmSync(tempRoot, { recursive: true, force: true }));
  const environment = {
    available: true,
    socketPath: join(tempRoot, "herdr.sock"),
    paneId: "w1:p1",
    workspaceId: "w1",
    tabId: "w1:t1",
  };
  return { gsdHome, environment };
}

test("root runtime lease publishes versioned owner-only record and terminal heartbeat", (t) => {
  const { gsdHome, environment } = fixture(t);
  const times = [
    new Date("2026-08-30T00:00:00.000Z"),
    new Date("2026-08-30T00:00:01.000Z"),
    new Date("2026-08-30T00:00:02.000Z"),
    new Date("2026-08-30T00:00:03.000Z"),
  ];
  const lease = new HerdrRootRuntimeLease({
    gsdHome,
    rootSessionId: "session-1",
    source: "custom:gsd:test",
    cwd: "/tmp/project",
    environment,
    heartbeatMs: 60_000,
    now: () => times.shift() ?? new Date("2026-08-30T00:00:04.000Z"),
    pid: 1234,
    instanceId: "instance-1",
  });
  lease.start();
  assert.equal(herdrRootRuntimeId("session-1"), basename(lease.paths.rootDir));
  assert.equal(readHerdrRootRuntimeRecord(lease.paths).status, "active");
  lease.stop();
  const record = readHerdrRootRuntimeRecord(lease.paths);
  assert.equal(record.status, "stopped");
  assert.equal(record.paneId, "w1:p1");
  assert.equal(JSON.parse(readFileSync(lease.paths.heartbeatPath, "utf8")).status, "stopped");
  if (process.platform !== "win32") {
    assert.equal(lstatSync(lease.paths.recordPath).mode & 0o777, 0o600);
    assert.equal(lstatSync(lease.paths.rootDir).mode & 0o777, 0o700);
  }
});

test("an obsolete root lease cannot stop a replacement instance", (t) => {
  const { gsdHome, environment } = fixture(t);
  const base = {
    gsdHome,
    rootSessionId: "same-session",
    source: "custom:gsd:test",
    cwd: "/tmp/project",
    environment,
    heartbeatMs: 60_000,
  };
  const first = new HerdrRootRuntimeLease({ ...base, instanceId: "old-instance" });
  const replacement = new HerdrRootRuntimeLease({ ...base, instanceId: "new-instance" });
  first.start();
  replacement.start();
  first.stop();
  const paths = resolveHerdrRootRuntimePaths(gsdHome, "same-session");
  assert.equal(readHerdrRootRuntimeRecord(paths).instanceId, "new-instance");
  assert.equal(readHerdrRootRuntimeRecord(paths).status, "active");
  replacement.stop();
});
