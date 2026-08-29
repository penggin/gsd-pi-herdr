import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  herdrWorkerRuntimeRoot,
  resolveHerdrWorkerArtifactPaths,
  writeHerdrWorkerLaunchBundle,
} from "../artifacts.js";
import { HERDR_WORKER_INTERNAL_COMMAND, runHerdrWorkerCli } from "../entry.js";

describe("private Herdr worker CLI entry", () => {
  let tempRoot: string | undefined;
  afterEach(() => {
    if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  });

  it("rejects malformed invocation without exposing normal GSD startup", async () => {
    const output: string[] = [];
    const code = await runHerdrWorkerCli([HERDR_WORKER_INTERNAL_COMMAND], {
      stderr: { write: ((text: string) => { output.push(text); return true; }) as any },
    });
    assert.equal(code, 2);
    assert.match(output.join(""), /invalid internal worker invocation/);
  });

  it("validates the owner-only spec before invoking the runner dependency", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), "gsd-herdr-worker-entry-"));
    const gsdHome = join(tempRoot, "home");
    mkdirSync(gsdHome, { recursive: true });
    const runtimeRoot = herdrWorkerRuntimeRoot(gsdHome);
    const identity = { rootSessionId: "root", dispatchId: "dispatch", childId: "child" };
    const paths = resolveHerdrWorkerArtifactPaths(runtimeRoot, identity);
    const spec = writeHerdrWorkerLaunchBundle(paths, {
      ...identity,
      agent: "scout",
      cwd: tempRoot,
      executable: process.execPath,
      args: ["fixture.js"],
    }, {});
    let received = false;
    const code = await runHerdrWorkerCli([HERDR_WORKER_INTERNAL_COMMAND, paths.launchPath], {
      runtimeRoot,
      run: async (actualSpec, actualPaths) => {
        received = true;
        assert.deepEqual(actualSpec, spec);
        assert.equal(actualPaths.workerDir, paths.workerDir);
        return 7;
      },
    });
    assert.equal(received, true);
    assert.equal(code, 7);
  });

  it("rejects an otherwise valid launch spec outside the configured GSD runtime root", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), "gsd-herdr-worker-entry-root-"));
    const gsdHome = join(tempRoot, "home-a");
    const otherHome = join(tempRoot, "home-b");
    mkdirSync(gsdHome, { recursive: true });
    mkdirSync(otherHome, { recursive: true });
    const runtimeRoot = herdrWorkerRuntimeRoot(gsdHome);
    const paths = resolveHerdrWorkerArtifactPaths(runtimeRoot, { rootSessionId: "root", dispatchId: "dispatch", childId: "child" });
    writeHerdrWorkerLaunchBundle(paths, {
      rootSessionId: "root",
      dispatchId: "dispatch",
      childId: "child",
      agent: "scout",
      cwd: tempRoot,
      executable: process.execPath,
      args: [],
    }, {});
    const output: string[] = [];
    const code = await runHerdrWorkerCli([HERDR_WORKER_INTERNAL_COMMAND, paths.launchPath], {
      runtimeRoot: herdrWorkerRuntimeRoot(otherHome),
      stderr: { write: ((text: string) => { output.push(text); return true; }) as any },
    });
    assert.equal(code, 2);
    assert.match(output.join(""), /outside the configured GSD runtime root/);
  });
});
