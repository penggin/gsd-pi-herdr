import assert from "node:assert/strict";
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  HERDR_WORKER_SCHEMA_VERSION,
  createHerdrWorkerLaunchSpec,
  ensureHerdrWorkerArtifactDirectory,
  herdrWorkerRuntimeRoot,
  readHerdrWorkerEnvAndDelete,
  readHerdrWorkerExit,
  readHerdrWorkerLaunchSpec,
  resolveHerdrWorkerArtifactPaths,
  writeHerdrWorkerExit,
  writeHerdrWorkerHeartbeat,
  writeHerdrWorkerLaunchBundle,
  writeHerdrWorkerState,
} from "../artifacts.js";

describe("Herdr worker artifact contract v1", () => {
  let tempRoot: string | undefined;

  afterEach(() => {
    if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  });

  function fixture() {
    tempRoot ??= mkdtempSync(join(tmpdir(), "gsd-herdr-worker-artifacts-"));
    const gsdHome = join(tempRoot, "gsd-home");
    mkdirSync(gsdHome, { recursive: true });
    const runtimeRoot = herdrWorkerRuntimeRoot(gsdHome);
    const identity = {
      rootSessionId: "root-123",
      dispatchId: "dispatch-456",
      childId: "child-0",
    };
    const paths = resolveHerdrWorkerArtifactPaths(runtimeRoot, identity);
    return { gsdHome, runtimeRoot, identity, paths };
  }

  it("derives only generated-id paths inside the versioned runtime root", () => {
    const { gsdHome, runtimeRoot, identity, paths } = fixture();
    assert.equal(runtimeRoot, join(gsdHome, "runtime", "herdr", "v1"));
    assert.equal(paths.workerDir, join(runtimeRoot, identity.rootSessionId, identity.dispatchId, identity.childId));
    assert.equal(paths.launchPath, join(paths.workerDir, "launch.json"));
    assert.throws(
      () => resolveHerdrWorkerArtifactPaths(runtimeRoot, { ...identity, childId: "../../escape" }),
      /Invalid generated Herdr worker childId/,
    );
    assert.throws(
      () => resolveHerdrWorkerArtifactPaths("relative/runtime", identity),
      /runtime root must be an absolute path/,
    );
  });

  it("creates owner-only directories and launch/env artifacts", () => {
    const { paths, identity } = fixture();
    const spec = writeHerdrWorkerLaunchBundle(
      paths,
      {
        ...identity,
        agent: "scout",
        trackingName: "falcon",
        taskPreview: "Inspect auth state",
        model: "provider/model",
        thinking: "high",
        cwd: "/tmp/project",
        executable: process.execPath,
        args: ["/tmp/gsd.js", "--mode", "json", "-p", "Task: secret input"],
      },
      { API_TOKEN: "secret", EMPTY: "", OMIT: undefined },
    );

    const loaded = readHerdrWorkerLaunchSpec(paths.launchPath, paths.runtimeRoot);
    assert.deepEqual(loaded.spec, spec);
    assert.equal(loaded.paths.workerDir, paths.workerDir);
    assert.equal(spec.schemaVersion, HERDR_WORKER_SCHEMA_VERSION);
    assert.equal(spec.stdoutPath, paths.stdoutPath);

    if (process.platform !== "win32") {
      assert.equal(lstatSync(paths.workerDir).mode & 0o777, 0o700);
      assert.equal(lstatSync(paths.launchPath).mode & 0o777, 0o600);
      assert.equal(lstatSync(paths.envPath).mode & 0o777, 0o600);
    }

    const env = readHerdrWorkerEnvAndDelete(paths.envPath, paths.workerDir);
    assert.deepEqual(env, { API_TOKEN: "secret", EMPTY: "" });
    assert.equal(readFileSync(paths.launchPath, "utf8").includes("secret input"), true);
    assert.throws(() => readFileSync(paths.envPath, "utf8"));
  });

  it("rejects a symlinked generated directory instead of following it outside the runtime root", () => {
    const { paths, runtimeRoot, identity } = fixture();
    mkdirSync(runtimeRoot, { recursive: true });
    const outside = join(tempRoot!, "outside");
    mkdirSync(outside);
    symlinkSync(outside, join(runtimeRoot, identity.rootSessionId), "dir");
    assert.throws(() => ensureHerdrWorkerArtifactDirectory(paths), /Unsafe Herdr worker directory/);
  });

  it("rejects launch specs with future schemas or artifact-path substitution", () => {
    const { paths, identity } = fixture();
    ensureHerdrWorkerArtifactDirectory(paths);
    const spec = createHerdrWorkerLaunchSpec(
      {
        ...identity,
        agent: "scout",
        cwd: "/tmp/project",
        executable: process.execPath,
        args: [],
      },
      paths,
    );

    writeFileSync(paths.launchPath, `${JSON.stringify({ ...spec, schemaVersion: 2 })}\n`, { mode: 0o600 });
    assert.throws(() => readHerdrWorkerLaunchSpec(paths.launchPath, paths.runtimeRoot), /Unsupported Herdr worker schema/);

    writeFileSync(paths.launchPath, `${JSON.stringify({ ...spec, stdoutPath: join(tempRoot!, "outside.jsonl") })}\n`, { mode: 0o600 });
    assert.throws(() => readHerdrWorkerLaunchSpec(paths.launchPath, paths.runtimeRoot), /stdoutPath does not match/);
  });

  it("atomically replaces mutable state/heartbeat while exit evidence is immutable", () => {
    const { paths } = fixture();
    ensureHerdrWorkerArtifactDirectory(paths);

    writeHerdrWorkerState(paths, {
      schemaVersion: 1,
      status: "starting",
      updatedAt: "2026-08-30T00:00:00.000Z",
      pid: 10,
    });
    writeHerdrWorkerState(paths, {
      schemaVersion: 1,
      status: "working",
      updatedAt: "2026-08-30T00:00:01.000Z",
      pid: 10,
      lastActivity: { kind: "tool", label: "read file" },
    });
    assert.equal(JSON.parse(readFileSync(paths.statePath, "utf8")).status, "working");

    writeHerdrWorkerHeartbeat(paths, {
      schemaVersion: 1,
      updatedAt: "2026-08-30T00:00:02.000Z",
      pid: 10,
      status: "working",
    });
    assert.equal(JSON.parse(readFileSync(paths.heartbeatPath, "utf8")).pid, 10);

    writeHerdrWorkerExit(paths, {
      schemaVersion: 1,
      exitCode: 0,
      signal: null,
      aborted: false,
      completedAt: "2026-08-30T00:00:03.000Z",
    });
    assert.equal(readHerdrWorkerExit(paths).exitCode, 0);
    assert.throws(
      () => writeHerdrWorkerExit(paths, {
        schemaVersion: 1,
        exitCode: 1,
        signal: null,
        aborted: false,
        completedAt: "2026-08-30T00:00:04.000Z",
      }),
      /already exists|EEXIST/,
    );
  });

  it("rejects group/world-readable launch input", () => {
    if (process.platform === "win32") return;
    const { paths, identity } = fixture();
    writeHerdrWorkerLaunchBundle(
      paths,
      {
        ...identity,
        agent: "scout",
        cwd: "/tmp/project",
        executable: process.execPath,
        args: [],
      },
      {},
    );
    chmodSync(paths.launchPath, 0o644);
    assert.throws(() => readHerdrWorkerLaunchSpec(paths.launchPath, paths.runtimeRoot), /owner-only/);
  });
});
