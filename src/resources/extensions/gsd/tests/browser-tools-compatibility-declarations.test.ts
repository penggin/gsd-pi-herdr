// gsd-pi — ADR-005 Phase 2: Verify browser tool compatibility declarations.
//
// Locks in the declarations that always-image-producing browser tools
// (browser_screenshot, browser_zoom_region) carry `producesImages: true` so
// the model-router filters them out on providers without imageToolResults
// (OpenAI completions/responses, Azure, Mistral, Ollama). Conditional-image
// browser tools (navigation, forms, refs, intent, interaction) must NOT
// declare producesImages — they only attach error screenshots and filtering
// them would lose the whole tool surface for OpenAI users.

import test from "node:test";
import assert from "node:assert/strict";

import type { ExtensionAPI } from "@gsd/pi-coding-agent";

import { registerScreenshotTools } from "../../browser-tools/tools/screenshot.ts";
import { registerZoomTools } from "../../browser-tools/tools/zoom.ts";
import { registerManagedGsdBrowserTools } from "../../browser-tools/engine/managed-gsd-browser.ts";
import { registerToolCompatibility, resetToolCompatibilityRegistry } from "@gsd/pi-coding-agent";
import { filterToolsForProvider } from "../model-router.js";

interface CapturedToolDef {
  name: string;
  compatibility?: { producesImages?: boolean; schemaFeatures?: string[] };
}

function makeCapturingPi(): { pi: ExtensionAPI; tools: CapturedToolDef[] } {
  const tools: CapturedToolDef[] = [];
  const pi = {
    registerTool(def: CapturedToolDef): void {
      tools.push({ name: def.name, compatibility: def.compatibility });
    },
  } as unknown as ExtensionAPI;
  return { pi, tools };
}

// Browser tool registration functions accept a `deps` object. None of the
// declarations under test reach for these deps at registration time — they
// only run inside execute(), which we never invoke. A bare object satisfies
// the type signature.
const stubDeps = {} as Parameters<typeof registerScreenshotTools>[1];

test("browser_screenshot declares producesImages: true", () => {
  const { pi, tools } = makeCapturingPi();
  registerScreenshotTools(pi, stubDeps);
  const screenshot = tools.find((t) => t.name === "browser_screenshot");
  assert.ok(screenshot, "browser_screenshot should be registered");
  assert.equal(
    screenshot.compatibility?.producesImages,
    true,
    "browser_screenshot must declare producesImages so it is filtered on providers without imageToolResults",
  );
});

test("browser_zoom_region declares producesImages: true", () => {
  const { pi, tools } = makeCapturingPi();
  registerZoomTools(pi, stubDeps);
  const zoom = tools.find((t) => t.name === "browser_zoom_region");
  assert.ok(zoom, "browser_zoom_region should be registered");
  assert.equal(
    zoom.compatibility?.producesImages,
    true,
    "browser_zoom_region must declare producesImages so it is filtered on providers without imageToolResults",
  );
});

test("conditional managed verification remains available on GPT and GLM API paths", () => {
  const { pi, tools } = makeCapturingPi();
  registerManagedGsdBrowserTools(pi);
  resetToolCompatibilityRegistry();
  try {
    for (const tool of tools) {
      registerToolCompatibility(tool.name, { producesImages: tool.compatibility?.producesImages });
    }
    for (const api of ["openai-completions", "openai-responses", "openai-codex-responses"]) {
      const result = filterToolsForProvider(["browser_verify", "browser_screenshot"], api);
      assert.deepEqual(result.compatible, ["browser_verify"], `${api}: image-free verification must not disappear with image-result filtering`);
      assert.deepEqual(result.filtered, ["browser_screenshot"], `${api}: always-image screenshot retains the existing provider guard`);
    }
  } finally {
    resetToolCompatibilityRegistry();
  }
});
