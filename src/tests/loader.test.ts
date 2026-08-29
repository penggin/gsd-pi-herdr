import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  herdrWorkerRuntimeRoot,
  resolveHerdrWorkerArtifactPaths,
  writeHerdrWorkerLaunchBundle,
} from "../resources/extensions/subagent/execution/herdr-worker/artifacts.js";

const REPO_ROOT = process.cwd();
const LOADER = join(REPO_ROOT, "src", "loader.ts");
const RESOLVER = join(REPO_ROOT, "src", "resources", "extensions", "gsd", "tests", "resolve-ts.mjs");

describe("loader private Herdr worker fast-path", () => {
  let tempRoot: string | undefined;
  afterEach(() => {
    if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  });

  it("handles invalid worker invocation before normal GSD startup/banner work", () => {
    const result = runLoader(["__herdr-worker"]);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /invalid internal worker invocation/);
    assert.doesNotMatch(result.stderr, /Welcome to GSD|GSD-Pi Project Console/);
  });

  it("executes a valid worker spec through the loader without entering normal CLI startup", () => {
    tempRoot = mkdtempSync(join(tmpdir(), "gsd-herdr-loader-worker-"));
    const childPath = join(tempRoot, "child.mjs");
    writeFileSync(childPath, "process.stdout.write('{\\\"type\\\":\\\"agent_start\\\"}\\n');");
    const gsdHome = join(tempRoot, "home");
    mkdirSync(gsdHome, { recursive: true });
    const runtimeRoot = herdrWorkerRuntimeRoot(gsdHome);
    const identity = { rootSessionId: "root", dispatchId: "dispatch", childId: "child" };
    const paths = resolveHerdrWorkerArtifactPaths(runtimeRoot, identity);
    writeHerdrWorkerLaunchBundle(paths, {
      ...identity,
      agent: "scout",
      cwd: tempRoot,
      executable: process.execPath,
      args: [childPath],
    }, {});

    const result = runLoader(["__herdr-worker", paths.launchPath], { GSD_HOME: gsdHome });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /working/);
    assert.doesNotMatch(result.stdout, /\{\"type\":\"agent_start\"\}/);
    assert.doesNotMatch(result.stdout, /GSD-Pi Project Console|Welcome to GSD/);
    assert.equal(existsSync(paths.envPath), false);
    assert.equal(JSON.parse(readFileSync(paths.exitPath, "utf8")).exitCode, 0);
  });
});

function runLoader(args: string[], env: NodeJS.ProcessEnv = {}) {
  const result = spawnSync(
    process.execPath,
    ["--import", RESOLVER, "--experimental-strip-types", LOADER, ...args],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, GSD_SUPPRESS_LOGO: "1", ...env },
      encoding: "utf8",
      timeout: 10_000,
    },
  );
  if (result.error) throw result.error;
  return result;
}
