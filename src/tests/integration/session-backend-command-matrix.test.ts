import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import test from "node:test";

import {
  assertNoCrashMarkers,
  createTempDir,
  createTempWithGsd,
  ensureBuiltLoader,
  runGsd,
  stripAnsi,
} from "./cli-process.ts";

ensureBuiltLoader();

const backends = [
  { name: "legacy-v3", version: 3 },
  { name: "harness-v4", version: 4 },
] as const;

function jsonLines(output: string): Array<Record<string, unknown>> {
  return stripAnsi(output)
    .split("\n")
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
}

for (const backend of backends) {
  test(`${backend.name} supports print, JSON, RPC, and headless catalog startup`, async (t) => {
    const gsdHome = createTempDir(`gsd-${backend.name}-command-matrix-`);
    const project = createTempWithGsd(`gsd-${backend.name}-command-project-`);
    t.after(() => {
      rmSync(gsdHome, { recursive: true, force: true });
      rmSync(project, { recursive: true, force: true });
    });
    const env = {
      GSD_HOME: gsdHome,
      GSD_INTERNAL_SESSION_BACKEND: backend.name,
    };

    await t.test("text print mode", async () => {
      const result = await runGsd(["--mode", "text", "--print", "--no-session"], 30_000, env);
      assert.equal(result.timedOut, false);
      assert.equal(result.code, 0, result.stderr);
      assertNoCrashMarkers(stripAnsi(result.stdout + result.stderr));
    });

    await t.test("JSON print mode", async () => {
      const result = await runGsd(["--mode", "json", "--no-session"], 30_000, env);
      assert.equal(result.timedOut, false);
      assert.equal(result.code, 0, result.stderr);
      const header = jsonLines(result.stdout).find((line) => line.type === "session");
      assert.equal(header?.version, backend.version);
      assertNoCrashMarkers(stripAnsi(result.stdout + result.stderr));
    });

    await t.test("RPC init and shutdown", async () => {
      const input = [
        JSON.stringify({ id: "init-1", type: "init" }),
        JSON.stringify({ id: "shutdown-1", type: "shutdown" }),
        "",
      ].join("\n");
      const result = await runGsd(["--mode", "rpc", "--no-session", "--bare"], 30_000, env, process.cwd(), input);
      assert.equal(result.timedOut, false);
      assert.equal(result.code, 0, result.stderr);
      const responses = jsonLines(result.stdout).filter((line) => line.type === "response");
      assert.ok(responses.some((line) => line.id === "init-1" && line.success === true));
      assert.ok(responses.some((line) => line.id === "shutdown-1" && line.success === true));
      assertNoCrashMarkers(stripAnsi(result.stdout + result.stderr));
    });

    await t.test("headless resume catalog", async () => {
      const result = await runGsd(
        ["headless", "--resume", `missing-${backend.name}`, "--max-restarts", "0", "auto"],
        30_000,
        env,
      );
      assert.equal(result.timedOut, false);
      assert.equal(result.code, 1);
      assert.match(stripAnsi(result.stderr), /No session matching/);
      assertNoCrashMarkers(stripAnsi(result.stdout + result.stderr));
    });

    await t.test("GSD lifecycle and Assessment Gate commands", async () => {
      for (const command of [
        "/gsd status",
        "/gsd gate list",
        "/gsd gate status",
        "/gsd debug list",
        "/gsd forensics",
        "/gsd quick",
        "/gsd validation",
        "/gsd verdict",
        "/gsd recover",
      ]) {
        const result = await runGsd(["--mode", "json", "--no-session", command], 30_000, env, project);
        assert.equal(result.timedOut, false, command);
        assert.equal(result.code, 0, `${command}: ${result.stderr}`);
        const header = jsonLines(result.stdout).find((line) => line.type === "session");
        assert.equal(header?.version, backend.version, command);
        assertNoCrashMarkers(stripAnsi(result.stdout + result.stderr));
      }
    });
  });
}
