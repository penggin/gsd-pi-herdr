import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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
} from "../artifacts.js";
import {
  buildHerdrWorkerChildEnv,
  runHerdrWorker,
  terminateHerdrWorkerProcessGroup,
} from "../runner.js";

describe("internal Herdr worker runner", () => {
  let tempRoot: string | undefined;
  afterEach(() => {
    if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  });

  function fixture(script: string, env: NodeJS.ProcessEnv = {}) {
    tempRoot ??= mkdtempSync(join(tmpdir(), "gsd-herdr-worker-runner-"));
    const scriptPath = join(tempRoot, "child.mjs");
    writeFileSync(scriptPath, script);
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
      args: [scriptPath],
    }, env);
    return { paths, spec };
  }

  it("spawns with shell:false semantics, captures exact raw streams, relays complete lines, and publishes exit evidence", async () => {
    const { paths, spec } = fixture([
      "process.stdout.write(Buffer.from('{\\\"type\\\":\\\"message_end\\\",\\\"text\\\":\\\"한'));",
      "setTimeout(() => {",
      "  process.stdout.write(Buffer.from('글\\\"}\\nmalformed\\n{\\\"tail\\\":true}'));",
      "  process.stderr.write('private stderr');",
      "}, 5);",
    ].join("\n"), { TEST_SECRET: "value" });
    const lines: string[] = [];
    const reported: string[] = [];
    const activity: string[] = [];
    const code = await runHerdrWorker(spec, paths, {
      hostEnv: {
        HERDR_ENV: "1",
        HERDR_SOCKET_PATH: "/tmp/worker.sock",
        HERDR_WORKSPACE_ID: "w1",
        HERDR_TAB_ID: "w1:t2",
        HERDR_PANE_ID: "w1:p4",
      },
      onJsonlLine: (line) => lines.push(line),
      activityWrite: (text) => activity.push(text),
      reporter: {
        initialize: async () => { reported.push("init"); },
        reportStatus: async (status) => { reported.push(status); },
        reportFinal: async (status) => { reported.push(`final:${status}`); },
      },
      heartbeatMs: 10,
    });

    assert.equal(code, 0);
    assert.deepEqual(lines, [
      '{"type":"message_end","text":"한글"}',
      "malformed",
      '{"tail":true}',
    ]);
    assert.equal(readFileSync(paths.stdoutPath, "utf8"), `${lines[0]}\n${lines[1]}\n${lines[2]}`);
    assert.equal(readFileSync(paths.stderrPath, "utf8"), "private stderr");
    assert.equal(existsSync(paths.envPath), false);
    assert.equal(JSON.parse(readFileSync(paths.statePath, "utf8")).status, "completed");
    assert.equal(JSON.parse(readFileSync(paths.exitPath, "utf8")).exitCode, 0);
    assert.deepEqual(reported, ["init", "starting", "working", "final:completed"]);
    // Fixture lines do not contain displayable tool activity, so no raw child
    // JSON is echoed to the human pane output.
    assert.deepEqual(activity, []);
  });

  it("replaces copied root Herdr identity with the worker pane identity and forces child authority mode", () => {
    const env = buildHerdrWorkerChildEnv({
      HERDR_ENV: "1",
      HERDR_SOCKET_PATH: "/tmp/root.sock",
      HERDR_WORKSPACE_ID: "root-workspace",
      HERDR_TAB_ID: "root-tab",
      HERDR_PANE_ID: "root-pane",
      KEEP: "yes",
      GSD_SUBAGENT_CHILD: "0",
    }, {
      HERDR_ENV: "1",
      HERDR_SOCKET_PATH: "/tmp/worker.sock",
      HERDR_WORKSPACE_ID: "worker-workspace",
      HERDR_TAB_ID: "worker-tab",
      HERDR_PANE_ID: "worker-pane",
    });
    assert.equal(env.HERDR_SOCKET_PATH, "/tmp/worker.sock");
    assert.equal(env.HERDR_PANE_ID, "worker-pane");
    assert.equal(env.KEEP, "yes");
    assert.equal(env.GSD_SUBAGENT_CHILD, "1");
  });

  it("passes shell metacharacters as literal argv without command execution", async () => {
    const { paths, spec } = fixture("process.stdout.write(JSON.stringify({ type: 'argv', value: process.argv[2] }));");
    const marker = join(tempRoot!, "injected-by-shell");
    const hostileArg = `$(touch ${marker}); echo pwned`;
    spec.args.push(hostileArg);
    const lines: string[] = [];
    const code = await runHerdrWorker(spec, paths, {
      onJsonlLine: (line) => lines.push(line),
      activityWrite: () => {},
      reporter: noOpReporter(),
    });
    assert.equal(code, 0);
    assert.equal(existsSync(marker), false);
    assert.deepEqual(JSON.parse(lines[0]), { type: "argv", value: hostileArg });
  });

  it("refreshes heartbeat evidence while a child is still running", async () => {
    const { paths, spec } = fixture("setTimeout(() => process.exit(0), 180);");
    const run = runHerdrWorker(spec, paths, {
      activityWrite: () => {},
      reporter: noOpReporter(),
      heartbeatMs: 15,
    });
    await waitFor(() => existsSync(paths.heartbeatPath), 1000);
    const first = JSON.parse(readFileSync(paths.heartbeatPath, "utf8")).updatedAt as string;
    await new Promise((resolve) => setTimeout(resolve, 45));
    const second = JSON.parse(readFileSync(paths.heartbeatPath, "utf8")).updatedAt as string;
    assert.notEqual(second, first);
    assert.equal(await run, 0);
  });

  it("does not publish reusable exit evidence before final Herdr reporting settles", async () => {
    const { paths, spec } = fixture("process.exit(0);");
    let releaseFinal!: () => void;
    const finalGate = new Promise<void>((resolve) => { releaseFinal = resolve; });
    let finalStarted = false;
    const run = runHerdrWorker(spec, paths, {
      activityWrite: () => {},
      reporter: {
        initialize: async () => {},
        reportStatus: async () => {},
        reportFinal: async () => {
          finalStarted = true;
          await finalGate;
        },
      },
    });
    await waitFor(() => finalStarted, 1000);
    assert.equal(existsSync(paths.exitPath), false);
    releaseFinal();
    assert.equal(await run, 0);
    assert.equal(existsSync(paths.exitPath), true);
  });

  it("escalates cancellation SIGINT → SIGTERM → SIGKILL when the child group does not exit", async () => {
    const signals: NodeJS.Signals[] = [];
    await terminateHerdrWorkerProcessGroup(123, () => false, {
      interruptGraceMs: 20,
      terminateGraceMs: 20,
      sendSignal: (_pid, signal) => signals.push(signal),
      wait: async () => {},
    });
    assert.deepEqual(signals, ["SIGINT", "SIGTERM", "SIGKILL"]);
  });

  it("stops escalation as soon as the child group reports closed", async () => {
    const signals: NodeJS.Signals[] = [];
    let closed = false;
    await terminateHerdrWorkerProcessGroup(123, () => closed, {
      interruptGraceMs: 20,
      terminateGraceMs: 20,
      sendSignal: (_pid, signal) => {
        signals.push(signal);
        if (signal === "SIGINT") closed = true;
      },
      wait: async () => {},
    });
    assert.deepEqual(signals, ["SIGINT"]);
  });

  it("uses the Windows tree-kill equivalent instead of single-PID signals", async () => {
    const killed: number[] = [];
    const signals: NodeJS.Signals[] = [];
    await terminateHerdrWorkerProcessGroup(456, () => false, {
      platform: "win32",
      sendSignal: (_pid, signal) => signals.push(signal),
      killWindowsTree: async (pid) => { killed.push(pid); },
    });
    assert.deepEqual(killed, [456]);
    assert.deepEqual(signals, []);
  });

  it("terminates a real POSIX process group including a descendant", { skip: process.platform === "win32" }, async () => {
    tempRoot ??= mkdtempSync(join(tmpdir(), "gsd-herdr-worker-process-group-"));
    const marker = join(tempRoot, "pids.json");
    const scriptPath = join(tempRoot, "group.mjs");
    writeFileSync(scriptPath, [
      "import { spawn } from 'node:child_process';",
      "import { writeFileSync } from 'node:fs';",
      "const marker = process.argv[2];",
      "process.on('SIGINT', () => {});",
      "process.on('SIGTERM', () => {});",
      "if (process.env.GSD_GROUP_GRANDCHILD === '1') { setInterval(() => {}, 1000); }",
      "else {",
      "  const grand = spawn(process.execPath, [process.argv[1], marker], { env: { ...process.env, GSD_GROUP_GRANDCHILD: '1' }, stdio: 'ignore' });",
      "  writeFileSync(marker, JSON.stringify({ leader: process.pid, grandchild: grand.pid }));",
      "  setInterval(() => {}, 1000);",
      "}",
    ].join("\n"));
    const leader = spawn(process.execPath, [scriptPath, marker], { detached: true, stdio: "ignore" });
    let leaderClosed = false;
    leader.once("close", () => { leaderClosed = true; });
    await waitFor(() => existsSync(marker), 2000);
    const pids = JSON.parse(readFileSync(marker, "utf8")) as { leader: number; grandchild: number };
    assert.equal(pids.leader, leader.pid);

    await terminateHerdrWorkerProcessGroup(leader.pid!, () => leaderClosed, {
      interruptGraceMs: 30,
      terminateGraceMs: 30,
    });
    await waitFor(() => leaderClosed, 1000);
    await waitFor(() => !isPidAlive(pids.grandchild), 2000);
    assert.equal(isPidAlive(pids.leader), false);
    assert.equal(isPidAlive(pids.grandchild), false);
  });
});

function noOpReporter() {
  return {
    initialize: async () => {},
    reportStatus: async () => {},
    reportFinal: async () => {},
  };
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`condition not met within ${timeoutMs}ms`);
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
