import { describe, it } from "node:test";
import assert from "node:assert/strict";

import browserToolsExtension from "../index.ts";

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

describe("legacy browser tool registration across session replacement", () => {
  it("registers the Playwright contract into each fresh tool registry exactly once", async (t) => {
    const previousEngine = process.env.GSD_BROWSER_ENGINE;
    process.env.GSD_BROWSER_ENGINE = "playwright";
    t.after(() => {
      if (previousEngine === undefined) delete process.env.GSD_BROWSER_ENGINE;
      else process.env.GSD_BROWSER_ENGINE = previousEngine;
    });

    const firstRegistry = makeRegistry();
    await startRegistry(firstRegistry);

    const replacementRegistry = makeRegistry();
    await startRegistry(replacementRegistry);

    assert.ok(firstRegistry.tools.length > 0);
    assert.ok(firstRegistry.tools.includes("browser_navigate"));
    assert.equal(new Set(firstRegistry.tools).size, firstRegistry.tools.length);
    assert.deepEqual(replacementRegistry.tools, firstRegistry.tools);

    await startRegistry(replacementRegistry);
    assert.deepEqual(
      replacementRegistry.tools,
      firstRegistry.tools,
      "repeated session_start on one registry must not duplicate registrations",
    );
  });
});
