import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

const { buildManagedScreenshotArgs, decodeManagedScreenshot, runManagedScreenshotCli } = await import("../engine/managed-screenshot.ts");
const { MAX_SCREENSHOT_WIDTH, MAX_SCREENSHOT_HEIGHT } = await import("../screenshot-constraints.ts");

const {
  MANAGED_BROWSER_TOOL_SPECS,
  MANAGED_GSD_BROWSER_TOOL_NAMES,
  ManagedGsdBrowserConnectionPool,
  findMissingContractCoverage,
  normalizeManagedArgs,
  registerManagedGsdBrowserTools,
  closeManagedGsdBrowser,
} = await import("../engine/managed-gsd-browser.ts");

// The tools @opengsd/gsd-browser actually serves over MCP (subset relevant to
// the contract). Notably absent: browser_click, browser_type, browser_verify,
// browser_reload — those are satisfied through translations.
const GSD_BROWSER_SERVED_TOOLS = [
  "browser_navigate",
  "browser_snapshot",
  "browser_click_ref",
  "browser_fill_ref",
  "browser_fill_form",
  "browser_wait_for",
  "browser_assert",
  "browser_screenshot",
  "browser_find_element",
  "browser_console",
  "browser_network",
  "browser_evaluate",
  "browser_batch",
  "browser_act",
];

function makeLaunchConfig() {
  return {
    command: "gsd-browser",
    args: ["mcp"],
    cwd: "/tmp/example-project",
    projectRoot: "/tmp/example-project",
    serverName: "gsd-browser",
    sessionName: "test-session",
  };
}

describe("registerManagedGsdBrowserTools", () => {
  it("registers the curated Pi browser contract", () => {
    const tools = [];
    registerManagedGsdBrowserTools({
      registerTool(tool) {
        tools.push(tool);
      },
    });

    assert.deepEqual(tools.map((tool) => tool.name), [...MANAGED_GSD_BROWSER_TOOL_NAMES]);
    assert.equal(new Set(tools.map((tool) => tool.name)).size, tools.length);
  });

  it("keeps screenshots marked as image-producing evidence", () => {
    const tools = [];
    registerManagedGsdBrowserTools({
      registerTool(tool) {
        tools.push(tool);
      },
    });

    const screenshot = tools.find((tool) => tool.name === "browser_screenshot");
    assert.equal(screenshot?.compatibility?.producesImages, true);
    assert.equal(tools.find((tool) => tool.name === "browser_verify")?.compatibility?.producesImages, undefined,
      "conditional-image verification must remain available to text-only tool-result providers");
  });
});

describe("findMissingContractCoverage", () => {
  it("reports nothing for the tool list gsd-browser actually serves", () => {
    assert.deepEqual(findMissingContractCoverage(GSD_BROWSER_SERVED_TOOLS), []);
  });

  it("reports contract tools none of whose MCP candidates are served", () => {
    const served = GSD_BROWSER_SERVED_TOOLS.filter((name) => name !== "browser_assert");
    // browser_verify also depends on browser_assert through its translation.
    assert.deepEqual(findMissingContractCoverage(served), ["browser_assert", "browser_verify"]);
  });

  it("reports translated tools when a required MCP tool is missing", () => {
    const served = GSD_BROWSER_SERVED_TOOLS.filter((name) => name !== "browser_batch");
    assert.deepEqual(findMissingContractCoverage(served), ["browser_click", "browser_type", "browser_batch"]);
  });
});

describe("ManagedGsdBrowserConnectionPool", () => {
  it("closes a pending connection that resolves after the pool is closed", async () => {
    const closed = [];
    let resolveConnect;
    const pool = new ManagedGsdBrowserConnectionPool(async () => {
      return new Promise((resolve) => {
        resolveConnect = resolve;
      });
    }, async (connection) => {
      closed.push(connection.id);
    });

    const launch = makeLaunchConfig();

    const pending = pool.getOrConnect(launch);
    const closedPool = pool.closeAll();
    resolveConnect({ id: "late-connection" });

    await assert.rejects(
      pending,
      /closed during startup/,
      "pending callers must not receive a reusable connection after close",
    );
    await closedPool;

    assert.deepEqual(closed, ["late-connection"]);
    assert.equal(pool.activeCount, 0);
    assert.equal(pool.pendingCount, 0);
  });

  it("aborts pending connection attempts when the pool is closed", async () => {
    let receivedSignal;
    const pool = new ManagedGsdBrowserConnectionPool(async (_launch, signal) => {
      receivedSignal = signal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("connect aborted")), { once: true });
      });
    }, async () => {});

    const pending = pool.getOrConnect(makeLaunchConfig());
    const closedPool = pool.closeAll();

    await assert.rejects(pending, /connect aborted/);
    await closedPool;

    assert.equal(receivedSignal?.aborted, true);
    assert.equal(pool.activeCount, 0);
    assert.equal(pool.pendingCount, 0);
  });

  it("rejects new connection attempts started while the pool is closing", async () => {
    let resolveConnect;
    let connectCount = 0;
    const pool = new ManagedGsdBrowserConnectionPool(async () => {
      connectCount += 1;
      return new Promise((resolve) => {
        resolveConnect = resolve;
      });
    }, async () => {});

    const pending = pool.getOrConnect(makeLaunchConfig());
    const closedPool = pool.closeAll();

    // A caller that arrives during the in-flight closeAll must not open a new
    // connection that could survive shutdown.
    await assert.rejects(
      pool.getOrConnect(makeLaunchConfig()),
      /closing/,
      "getOrConnect must reject while the pool is closing",
    );

    resolveConnect({ id: "pending-connection" });
    await assert.rejects(pending, /closed during startup/);
    await closedPool;

    assert.equal(connectCount, 1, "no second connection is started during shutdown");
    assert.equal(pool.activeCount, 0);
    assert.equal(pool.pendingCount, 0);
  });
});

describe("contract tool translations", () => {
  it("translates browser_click into a single-step batch call", () => {
    const calls = MANAGED_BROWSER_TOOL_SPECS.browser_click.translate.build({ selector: "#save" });
    assert.deepEqual(calls, [{
      mcpTool: "browser_batch",
      args: { steps: [{ action: "click", selector: "#save" }] },
    }]);
  });

  it("translates browser_type into a single-step batch call", () => {
    const calls = MANAGED_BROWSER_TOOL_SPECS.browser_type.translate.build({
      selector: "#name",
      text: "hello",
      clearFirst: true,
      submit: true,
    });
    assert.deepEqual(calls, [{
      mcpTool: "browser_batch",
      args: { steps: [{ action: "type", selector: "#name", text: "hello", clearFirst: true, submit: true }] },
    }]);
  });

  it("normalizes batch options and step keys to the daemon's snake_case", () => {
    const normalized = normalizeManagedArgs("browser_batch", {
      steps: [{ action: "type", selector: "#name", text: "hi", clearFirst: true }],
      stopOnFailure: false,
      finalSummaryOnly: true,
    });
    assert.deepEqual(normalized, {
      steps: [{ action: "type", selector: "#name", text: "hi", clear_first: true }],
      stop_on_failure: false,
      summary_only: true,
    });
  });

  it("translates browser_verify into navigate, assert, and screenshot calls", () => {
    const calls = MANAGED_BROWSER_TOOL_SPECS.browser_verify.translate.build({
      url: "http://localhost:3000",
      timeout: 5000,
      checks: [
        { description: "heading shows", selector: "h1", expectedText: "Welcome" },
        { description: "spinner gone", selector: ".spinner", expectedVisible: false },
        { description: "evidence", selector: "main", expectedVisible: true, screenshot: true },
      ],
    });
    assert.deepEqual(calls, [
      { mcpTool: "browser_navigate", args: { url: "http://localhost:3000", timeout: 5000 } },
      {
        mcpTool: "browser_assert",
        args: {
          checks: [
            { kind: "text_visible", text: "Welcome" },
            { kind: "selector_hidden", selector: ".spinner" },
            { kind: "selector_visible", selector: "main" },
          ],
        },
      },
      { mcpTool: "browser_screenshot", args: { selector: "main" } },
    ]);
  });

  it("declares every tool a translation can emit in its coverage requirements", () => {
    for (const [name, spec] of Object.entries(MANAGED_BROWSER_TOOL_SPECS)) {
      if (!spec.translate) continue;
      const maximalArgs = {
        url: "http://localhost:3000",
        timeout: 5000,
        selector: "#el",
        text: "hi",
        clearFirst: true,
        checks: [{ description: "d", selector: "#el", expectedText: "hi", expectedVisible: true, screenshot: true }],
      };
      const emitted = spec.translate.build(maximalArgs).map((call) => call.mcpTool);
      for (const mcpTool of emitted) {
        assert.ok(
          spec.translate.requires.includes(mcpTool),
          `${name} translation emits ${mcpTool} but does not require it for coverage`,
        );
      }
    }
  });

  it("translates browser_verify without checks into navigation only", () => {
    const calls = MANAGED_BROWSER_TOOL_SPECS.browser_verify.translate.build({ url: "http://localhost:3000", checks: [] });
    assert.deepEqual(calls, [{ mcpTool: "browser_navigate", args: { url: "http://localhost:3000" } }]);
  });

  it("translates browser_reload into evaluate plus best-effort network-idle wait", () => {
    const calls = MANAGED_BROWSER_TOOL_SPECS.browser_reload.translate.build({});
    assert.deepEqual(calls, [
      { mcpTool: "browser_evaluate", args: { expression: "location.reload()" } },
      { mcpTool: "browser_wait_for", args: { condition: "network_idle", timeout: 3_000 }, optional: true },
    ]);
  });
});

const screenshotFixturePath = fileURLToPath(new URL("./fixtures/managed-browser-image-cli.mjs", import.meta.url));
const screenshotFlags = ["--session", "image-session", "--identity-scope", "project", "--identity-key", "image-key", "--identity-project", "image-project"];

async function makeScreenshotEnvelope(format = "png", width = 4, height = 3) {
  const buffer = await sharp({ create: { width, height, channels: 3, background: "#4399ee" } })[format]().toBuffer();
  return { byteLength: buffer.length, data: buffer.toString("base64"), width, height, mimeType: `image/${format}`, scope: "viewport" };
}

async function runScreenshotFixture({ name = "browser_screenshot", params = {}, envelope, payload, mode, expectedOptions = [], signal, extraEnv = {} } = {}) {
  const previousEnv = { ...process.env };
  const cwd = process.cwd();
  const tools = [];
  try {
    process.env.GSD_BROWSER_MCP_COMMAND = process.execPath;
    process.env.GSD_BROWSER_MCP_ARGS = JSON.stringify([screenshotFixturePath, "mcp", ...screenshotFlags]);
    process.env.GSD_BROWSER_MCP_CWD = cwd;
    process.env.GSD_BROWSER_MCP_ENV = JSON.stringify({
      IMAGE_TEST_EXPECTED_ARGS: JSON.stringify(["screenshot", ...screenshotFlags, "--json", ...expectedOptions]),
      IMAGE_TEST_CWD: cwd,
      IMAGE_TEST_IDENTITY: "same-environment",
      IMAGE_TEST_MODE: mode ?? "image",
      IMAGE_TEST_PAYLOAD: payload ?? JSON.stringify(envelope ?? await makeScreenshotEnvelope()),
      ...extraEnv,
    });
    registerManagedGsdBrowserTools({ registerTool: (tool) => tools.push(tool) });
    return await tools.find((tool) => tool.name === name).execute("image-test", params, signal, undefined, { cwd });
  } finally {
    await closeManagedGsdBrowser();
    for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
    Object.assign(process.env, previousEnv);
  }
}

describe("managed screenshot image delivery", { skip: process.platform === "win32" }, () => {
  it("returns actual image bytes when native MCP only reports Screenshot captured", async () => {
    const envelope = await makeScreenshotEnvelope();
    const result = await runScreenshotFixture({ envelope });
    assert.equal(result.isError, false);
    const image = result.content.find((item) => item.type === "image");
    assert.ok(image, "a successful screenshot must include an image block, not only native success text");
    assert.equal(image.data, envelope.data);
    assert.equal(image.mimeType, "image/png");
    assert.equal(JSON.stringify(result.details).includes(envelope.data), false);
    assert.equal(result.content.filter((item) => item.type === "text").some((item) => item.text.includes(envelope.data)), false);
  });

  it("preserves screenshot selector, fullPage, quality, and format as individual CLI arguments", async () => {
    const selector = '#target[data-label="a b; $(noop)"]';
    const result = await runScreenshotFixture({
      params: { selector, fullPage: true, quality: 1, format: "jpeg", output: "/not-an-image-file" },
      // Native element crops are PNG even when JPEG was requested.
      envelope: { ...await makeScreenshotEnvelope(), scope: "element", selector },
      expectedOptions: [`--selector=${selector}`, "--full-page", "--quality", "1", "--format", "jpeg"],
    });
    assert.equal(result.isError, false);
    assert.equal(result.content.find((item) => item.type === "image")?.mimeType, "image/png");
  });

  it("delivers requested image evidence from translated browser_verify", async () => {
    const result = await runScreenshotFixture({
      name: "browser_verify",
      params: { url: "http://fixture.test", checks: [{ description: "main evidence", selector: "main", screenshot: true, fullPage: true, quality: 100, format: "png" }] },
      expectedOptions: ["--selector=main", "--full-page", "--quality", "100", "--format", "png"],
    });
    assert.equal(result.isError, false);
    assert.ok(result.content.some((item) => item.type === "image"));
    assert.deepEqual(result.details.mcpTools, ["browser_navigate", "browser_assert", "browser_screenshot"]);
  });

  it("keeps navigation-only verification successful without requiring an image", async () => {
    const result = await runScreenshotFixture({
      name: "browser_verify",
      params: { url: "http://fixture.test", checks: [] },
      payload: "{}",
    });
    assert.equal(result.isError, false);
    assert.equal(result.content.some((item) => item.type === "image"), false);
    assert.equal(result.details.mcpTool, "browser_navigate");
  });

  it("captures every requested verification screenshot", async () => {
    const result = await runScreenshotFixture({
      name: "browser_verify",
      params: { url: "http://fixture.test", checks: [{ description: "first", screenshot: true }, { description: "second", screenshot: true }] },
    });
    assert.equal(result.isError, false);
    assert.equal(result.content.filter((item) => item.type === "image").length, 2);
  });

  it("rejects excessive requested screenshots while leaving checks without images unrestricted", () => {
    const build = MANAGED_BROWSER_TOOL_SPECS.browser_verify.translate.build;
    assert.equal(build({ url: "http://fixture.test", checks: Array.from({ length: 5 }, () => ({ screenshot: true })) }).length, 6);
    assert.throws(() => build({ url: "http://fixture.test", checks: Array.from({ length: 6 }, () => ({ screenshot: true })) }), /at most 5/);
    assert.equal(build({ url: "http://fixture.test", checks: Array.from({ length: 100 }, () => ({ expectedText: "ready" })) }).length, 2);
  });

  it("rejects verification evidence exceeding the aggregate image budget", async () => {
    const result = await runScreenshotFixture({
      name: "browser_verify", mode: "large",
      params: { url: "http://fixture.test", checks: Array.from({ length: 3 }, () => ({ description: "large evidence", screenshot: true })) },
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /combined image size limit/);
    assert.equal(result.content.some((item) => item.type === "image"), false);
  });

  for (const name of ["browser_screenshot", "browser_verify"]) {
    it(`fails ${name} truthfully when requested screenshot bytes are absent`, async () => {
      const result = await runScreenshotFixture({
        name,
        params: name === "browser_verify" ? { url: "http://fixture.test", checks: [{ description: "evidence", screenshot: true }] } : {},
        payload: JSON.stringify({ output: "/etc/passwd", evidence_refs: null }),
      });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /missing or invalid image evidence/);
      assert.equal(result.content.some((item) => item.type === "image"), false);
      assert.doesNotMatch(JSON.stringify(result), /\/etc\/passwd|passed|reinstall dependencies/);
    });
  }

  it("does not expose raw CLI errors or payloads through text or details", async () => {
    const envelope = await makeScreenshotEnvelope();
    for (const scenario of [{ mode: "exit", envelope }, { payload: `invalid-json-${envelope.data}` }]) {
      const result = await runScreenshotFixture(scenario);
      assert.equal(result.isError, true);
      assert.equal(JSON.stringify(result).includes(envelope.data), false);
      assert.match(result.content[0].text, /Screenshot CLI (failed|returned invalid JSON)/);
    }
  });

  it("reports aborted verification screenshot evidence instead of successful assertions", async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 500);
    try {
      const result = await runScreenshotFixture({
        name: "browser_verify", mode: "hang", signal: controller.signal,
        params: { url: "http://fixture.test", checks: [{ description: "evidence", screenshot: true }] },
      });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /aborted/);
      assert.equal(result.content.some((item) => item.type === "image"), false);
    } finally {
      clearTimeout(timer);
    }
  });

  for (const action of ["abort", "close"]) {
    it(`${action} terminates the capture launcher and native child without stale image success`, async () => {
      const directory = await mkdtemp(join(tmpdir(), "managed-browser-image-test-"));
      const readyFile = join(directory, "capture-ready.json");
      const controller = new AbortController();
      const pending = runScreenshotFixture({ mode: "hang", signal: controller.signal, extraEnv: { IMAGE_TEST_READY_FILE: readyFile } });
      try {
        let pids;
        for (let attempt = 0; attempt < 100 && !pids; attempt++) {
          try {
            pids = JSON.parse(await readFile(readyFile, "utf8"));
          } catch {
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
        }
        assert.ok(pids, "capture must actually start before cancelling");
        if (action === "abort") controller.abort();
        else await closeManagedGsdBrowser();
        const result = await pending;
        assert.equal(result.isError, true);
        assert.match(result.content[0].text, /aborted/);
        for (const pid of [pids.pid, pids.nativePid]) {
          let alive = true;
          for (let attempt = 0; attempt < 100 && alive; attempt++) {
            try { process.kill(pid, 0); } catch { alive = false; }
            if (alive) await new Promise((resolve) => setTimeout(resolve, 20));
          }
          assert.equal(alive, false, "capture process must be reaped after abort/close");
        }
      } finally {
        controller.abort();
        await pending;
        await rm(directory, { recursive: true, force: true });
      }
    });
  }
});

describe("managed screenshot image validation", () => {
  for (const format of ["png", "jpeg"]) {
    it(`accepts actual ${format} bytes including singleton dimensions`, async () => {
      const envelope = await makeScreenshotEnvelope(format, 1, 1);
      const image = await decodeManagedScreenshot(JSON.stringify(envelope), 80);
      assert.equal(image.data, envelope.data);
      assert.equal(image.mimeType, envelope.mimeType);
    });

    it(`rejects truncated ${format} with valid headers`, async () => {
      const envelope = await makeScreenshotEnvelope(format);
      const bytes = Buffer.from(envelope.data, "base64");
      for (const remove of [8, Math.floor(bytes.length / 2)]) {
        const truncated = bytes.subarray(0, bytes.length - remove);
        await assert.rejects(decodeManagedScreenshot(JSON.stringify({ ...envelope, byteLength: truncated.length, data: truncated.toString("base64") }), 80), /invalid|undecodable/);
      }
    });

    it(`constrains oversized ${format} evidence with the existing screenshot limits`, async () => {
      const envelope = await makeScreenshotEnvelope(format, 2000, 20);
      const image = await decodeManagedScreenshot(JSON.stringify(envelope), 80);
      const dimensions = await sharp(Buffer.from(image.data, "base64")).metadata();
      assert.ok(dimensions.width <= MAX_SCREENSHOT_WIDTH);
      assert.ok(dimensions.height <= MAX_SCREENSHOT_HEIGHT);
      assert.equal(dimensions.format, format);
      assert.equal(image.mimeType, `image/${format}`);
    });
  }

  it("rejects missing, malformed, mislabeled, and inconsistent image envelopes", async () => {
    const envelope = await makeScreenshotEnvelope();
    const invalid = [
      null, [], {}, { ...envelope, data: "" }, { ...envelope, data: `${envelope.data}\n` },
      { ...envelope, data: "not base64" }, { ...envelope, mimeType: "image/svg+xml" },
      { ...envelope, mimeType: "image/jpeg" }, { ...envelope, byteLength: envelope.byteLength + 1 },
      { ...envelope, width: envelope.width + 1 }, { ...envelope, height: 0 },
      { ...envelope, data: Buffer.from("not a PNG").toString("base64"), byteLength: 9 },
      { ...envelope, data: "A".repeat(Math.ceil(16 * 1024 * 1024 / 3) * 4 + 4) },
    ];
    for (const payload of invalid) {
      await assert.rejects(decodeManagedScreenshot(JSON.stringify(payload), 80), /missing|invalid|undecodable/);
    }
  });

  it("rejects evidence when the caller is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(decodeManagedScreenshot(JSON.stringify(await makeScreenshotEnvelope()), 80, controller.signal), /aborted/);
  });
});

describe("managed screenshot invocation bounds", { skip: process.platform === "win32" }, () => {
  it("rejects unsupported custom MCP launch shapes without starting another browser", () => {
    for (const args of [[], ["serve"], ["mcp", "mcp"]]) {
      assert.throws(() => buildManagedScreenshotArgs({ ...makeLaunchConfig(), args }, {}), /unambiguous/);
    }
  });

  it("validates screenshot argument boundaries before spawning", () => {
    for (const args of [{ quality: 0 }, { quality: 101 }, { quality: 0.5 }, { quality: "80" }, { selector: "" }, { selector: false }, { selector: "secret\0selector" }, { fullPage: "true" }, { format: "svg" }]) {
      assert.throws(() => buildManagedScreenshotArgs(makeLaunchConfig(), args), /Screenshot/);
    }
    assert.deepEqual(buildManagedScreenshotArgs(makeLaunchConfig(), { fullPage: false, quality: 100, format: "png" }), ["screenshot", "--json", "--quality", "100", "--format", "png"]);
  });

  it("treats selectors beginning with dashes as values and preserves existing JSON flags", () => {
    assert.deepEqual(buildManagedScreenshotArgs({ ...makeLaunchConfig(), args: ["mcp", "--json"] }, { selector: "--session=other" }), ["screenshot", "--json", "--selector=--session=other"]);
  });

  const nodeLaunch = { ...makeLaunchConfig(), command: process.execPath, cwd: process.cwd() };

  it("times out and terminates a CLI that ignores SIGTERM", async () => {
    await assert.rejects(runManagedScreenshotCli(nodeLaunch, ["-e", 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);'], {}, undefined, { timeoutMs: 150, maxOutputBytes: 1024 }), /timed out/);
  });

  it("bounds stdout and stderr and does not return their contents on failure", async () => {
    for (const stream of ["stdout", "stderr"]) {
      await assert.rejects(runManagedScreenshotCli(nodeLaunch, ["-e", `process.${stream}.write("private-data".repeat(1000))`], {}, undefined, { timeoutMs: 2000, maxOutputBytes: 1024 }), (error) => {
        assert.match(error.message, /output limit/);
        assert.doesNotMatch(error.message, /private-data/);
        return true;
      });
    }
  });

  it("accepts the exact output limit and rejects its adjacent byte", async () => {
    assert.equal(await runManagedScreenshotCli(nodeLaunch, ["-e", 'process.stdout.write("x".repeat(1024))'], {}, undefined, { timeoutMs: 2000, maxOutputBytes: 1024 }), "x".repeat(1024));
    await assert.rejects(runManagedScreenshotCli(nodeLaunch, ["-e", 'process.stdout.write("x".repeat(1025))'], {}, undefined, { timeoutMs: 2000, maxOutputBytes: 1024 }), /output limit/);
  });

  it("fails safely when the launch executable does not exist", async () => {
    await assert.rejects(runManagedScreenshotCli({ ...nodeLaunch, command: "/nonexistent/managed-browser" }, [], {}), /could not be started/);
  });

  it("sanitizes synchronous process launch errors", async () => {
    await assert.rejects(runManagedScreenshotCli(nodeLaunch, ["secret\0argument"], {}), (error) => {
      assert.match(error.message, /could not be started/);
      assert.doesNotMatch(error.message, /secret/);
      return true;
    });
  });
});

it("fails closed on Windows without spawning an uncancellable native process", { skip: process.platform !== "win32" }, () => {
  assert.throws(() => runManagedScreenshotCli(makeLaunchConfig(), [], {}), /not supported on Windows/);
});
