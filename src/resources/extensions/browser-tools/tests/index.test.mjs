import { describe, it } from "node:test";
import assert from "node:assert/strict";

import browserToolsExtension from "../index.ts";
import { MANAGED_GSD_BROWSER_TOOL_NAMES } from "../engine/managed-gsd-browser.ts";

function makeRegistry() {
  const handlers = new Map();
  const tools = [];
  const pi = {
    on(event, handler) {
      handlers.set(event, handler);
    },
    registerTool(tool) {
      tools.push(tool.name);
    },
  };

  browserToolsExtension(pi);
  return { handlers, tools };
}

async function startRegistry(registry) {
  const sessionStart = registry.handlers.get("session_start");
  assert.equal(typeof sessionStart, "function");
  await sessionStart({}, {
    cwd: process.cwd(),
    hasUI: false,
    ui: { notify() {} },
  });
}

describe("browser tool registration across session replacement", () => {
  it("registers the browser contract into each fresh tool registry exactly once", async (t) => {
    const previousEngine = process.env.GSD_BROWSER_ENGINE;
    const previousWarmUp = process.env.GSD_BROWSER_WARMUP;
    process.env.GSD_BROWSER_ENGINE = "gsd-browser";
    process.env.GSD_BROWSER_WARMUP = "off";
    t.after(() => {
      if (previousEngine === undefined) delete process.env.GSD_BROWSER_ENGINE;
      else process.env.GSD_BROWSER_ENGINE = previousEngine;
      if (previousWarmUp === undefined) delete process.env.GSD_BROWSER_WARMUP;
      else process.env.GSD_BROWSER_WARMUP = previousWarmUp;
    });

    const firstRegistry = makeRegistry();
    await startRegistry(firstRegistry);

    const replacementRegistry = makeRegistry();
    await startRegistry(replacementRegistry);

    assert.deepEqual(firstRegistry.tools, [...MANAGED_GSD_BROWSER_TOOL_NAMES]);
    assert.deepEqual(replacementRegistry.tools, [...MANAGED_GSD_BROWSER_TOOL_NAMES]);

    await startRegistry(replacementRegistry);
    assert.deepEqual(
      replacementRegistry.tools,
      [...MANAGED_GSD_BROWSER_TOOL_NAMES],
      "repeated session_start on one registry must not duplicate registrations",
    );
  });
});
