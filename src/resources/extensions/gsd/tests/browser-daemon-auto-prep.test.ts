import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ensureBrowserDaemonStarted,
  prepareBrowserDaemonForUat,
  shouldWarmBrowserDaemonForUat,
  stopBrowserDaemon,
  teardownWarmedBrowserDaemons,
} from "../browser-daemon-auto-prep.ts";
import { commitBrowserEngineResolution } from "../../browser-tools/engine/selection.ts";

const GSD_BROWSER_ENGINE = {
  GSD_BROWSER_ENGINE: "gsd-browser",
  GSD_BROWSER_MCP_COMMAND: "/fixture/gsd-browser",
} as const;

test("shouldWarmBrowserDaemonForUat skips artifact-driven UAT", () => {
  assert.equal(
    shouldWarmBrowserDaemonForUat({
      uatType: "artifact-driven",
      sessionProvider: "claude-code",
      projectRoot: "/tmp/project",
    }),
    false,
  );
});

test("shouldWarmBrowserDaemonForUat enables Claude Code browser UAT when gsd-browser is configured", () => {
  assert.equal(
    shouldWarmBrowserDaemonForUat({
      uatType: "browser-executable",
      sessionProvider: "claude-code",
      sessionAuthMode: "externalCli",
      projectRoot: "/tmp/project",
      env: GSD_BROWSER_ENGINE,
    }),
    true,
  );
});

test("shouldWarmBrowserDaemonForUat enables warm-up for Claude Code oauth/apiKey when engine is gsd-browser", () => {
  for (const sessionAuthMode of ["oauth", "apiKey"] as const) {
    assert.equal(
      shouldWarmBrowserDaemonForUat({
        uatType: "browser-executable",
        sessionProvider: "claude-code",
        sessionAuthMode,
        sessionBaseUrl: "https://api.anthropic.com",
        projectRoot: "/tmp/project",
        env: GSD_BROWSER_ENGINE,
      }),
      true,
      `expected warm-up for sessionAuthMode=${sessionAuthMode}`,
    );
  }
});

test("shouldWarmBrowserDaemonForUat skips legacy Playwright engine for Claude Code", () => {
  assert.equal(
    shouldWarmBrowserDaemonForUat({
      uatType: "browser-executable",
      sessionProvider: "claude-code",
      sessionAuthMode: "oauth",
      projectRoot: "/tmp/project",
      env: { GSD_BROWSER_ENGINE: "legacy" },
    }),
    false,
  );
});

test("shouldWarmBrowserDaemonForUat uses session-committed ambient engine for non-Claude providers", () => {
  const projectRoot = "/tmp/ambient-engine-project";
  commitBrowserEngineResolution(projectRoot, {
    engine: "legacy",
    source: "probe",
    reason: "gsd-browser daemon connect failed (test); using legacy Playwright",
  });

  assert.equal(
    shouldWarmBrowserDaemonForUat({
      uatType: "browser-executable",
      sessionProvider: "openai",
      projectRoot,
    }),
    false,
  );
});

test("shouldWarmBrowserDaemonForUat skips when browser MCP is disabled", () => {
  assert.equal(
    shouldWarmBrowserDaemonForUat({
      uatType: "browser-executable",
      sessionProvider: "claude-code",
      projectRoot: "/tmp/project",
      env: { GSD_BROWSER_MCP_ENABLED: "0" },
    }),
    false,
  );
});

test("shouldWarmBrowserDaemonForUat skips when warm-up is disabled", () => {
  assert.equal(
    shouldWarmBrowserDaemonForUat({
      uatType: "browser-executable",
      sessionProvider: "claude-code",
      projectRoot: "/tmp/project",
      env: { GSD_BROWSER_WARMUP: "0" },
    }),
    false,
  );
});

test("prepareBrowserDaemonForUat returns null when warm-up is not required", () => {
  assert.equal(
    prepareBrowserDaemonForUat({
      uatType: "artifact-driven",
      sessionProvider: "claude-code",
      sessionAuthMode: "externalCli",
      projectRoot: "/tmp/example-project",
    }),
    null,
  );
});

test("prepareBrowserDaemonForUat returns actionable error when daemon start fails", () => {
  const error = prepareBrowserDaemonForUat({
    uatType: "browser-executable",
    sessionProvider: "claude-code",
    sessionAuthMode: "externalCli",
    projectRoot: "/tmp/example-project",
    env: {
      ...GSD_BROWSER_ENGINE,
      GSD_BROWSER_MCP_COMMAND: "/definitely/missing/gsd-browser",
    },
  });

  assert.match(error ?? "", /gsd-browser daemon failed to start/i);
});

test("stopBrowserDaemon reports failure when the gsd-browser CLI is missing", () => {
  const result = stopBrowserDaemon("/tmp/example-project", {
    env: { GSD_BROWSER_MCP_COMMAND: "/definitely/missing/gsd-browser" },
  });

  assert.equal(result.ok, false);
});

test("teardownWarmedBrowserDaemons is a no-op when nothing was warmed", () => {
  // A failed warm-up must not register a project root for teardown.
  prepareBrowserDaemonForUat({
    uatType: "browser-executable",
    sessionProvider: "claude-code",
    sessionAuthMode: "externalCli",
    projectRoot: "/tmp/example-project",
    env: {
      ...GSD_BROWSER_ENGINE,
      GSD_BROWSER_MCP_COMMAND: "/definitely/missing/gsd-browser",
    },
  });

  assert.deepEqual(teardownWarmedBrowserDaemons(), []);
});

function fakeDaemon(dir: string, source: string): NodeJS.ProcessEnv {
  const script = join(dir, "fake daemon.mjs");
  writeFileSync(script, source);
  return { GSD_BROWSER_MCP_COMMAND: `"${process.execPath}" "${script.replaceAll("\\", "/")}"` };
}

for (const [action, run] of [["start", ensureBrowserDaemonStarted], ["stop", stopBrowserDaemon]] as const) {
  test(`daemon ${action} returns after launcher exit while a bounded grandchild still holds stdio`, (t) => {
    const dir = mkdtempSync(join(tmpdir(), "gsd-daemon-pipe-"));
    const pidPath = join(dir, "grandchild.pid");
    t.after(() => {
      try { process.kill(Number(readFileSync(pidPath, "utf8"))); } catch { /* exited */ }
      rmSync(dir, { recursive: true, force: true });
    });
    const env = fakeDaemon(dir, [
      'import { spawn } from "node:child_process";',
      'import { writeFileSync } from "node:fs";',
      'const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 5000)"], { stdio: "inherit", detached: true });',
      `writeFileSync(${JSON.stringify(pidPath)}, String(child.pid));`,
      'child.unref(); process.stdout.write("daemon ready\\n"); process.exit(0);',
    ].join("\n"));
    const started = performance.now();
    const result = run(dir, { env, timeoutMs: 1_000 });
    assert.deepEqual(result, { ok: true });
    assert.ok(performance.now() - started < 900, "warm-up must not consume the configured timeout");
  });
}

test("daemon failure preserves a bounded stderr head and tail and cleans its capture directory", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "gsd-daemon-capture-"));
  const saved = { TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP, TMP: process.env.TMP };
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  });
  process.env.TMPDIR = process.env.TEMP = process.env.TMP = dir;
  const env = fakeDaemon(dir, 'process.stderr.write("HEAD: missing Chrome\\n" + "x".repeat(5 * 1024 * 1024) + "\\nTAIL: configure GSD_BROWSER_PATH"); process.exitCode = 1;');
  const result = ensureBrowserDaemonStarted(dir, { env, timeoutMs: 5_000 });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /HEAD: missing Chrome/);
  assert.match(result.error, /TAIL: configure GSD_BROWSER_PATH/);
  assert.match(result.error, /truncated/);
  assert.ok(Buffer.byteLength(result.error) < 6_000, "failure diagnostics must remain bounded");
  assert.deepEqual(readdirSync(dir), ["fake daemon.mjs"]);
});

test("daemon capture setup failure remains non-throwing", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "gsd-daemon-capture-failure-"));
  const saved = { TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP, TMP: process.env.TMP };
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  });
  const env = fakeDaemon(dir, 'process.stderr.write("missing Chrome\\n"); process.exitCode = 1;');
  process.env.TMPDIR = process.env.TEMP = process.env.TMP = join(dir, "missing", "directory");
  assert.equal(ensureBrowserDaemonStarted(dir, { env, timeoutMs: 5_000 }).ok, false);
});
