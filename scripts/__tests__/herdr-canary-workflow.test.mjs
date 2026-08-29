import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../../.github/workflows/herdr-canary.yml", import.meta.url), "utf8");

test("canary workflow checks supported, latest stable, and preview Herdr releases", () => {
  assert.match(workflow, /channel: supported[\s\S]*release: v0\.8\.2[\s\S]*mode: supported/);
  assert.match(workflow, /channel: latest-stable[\s\S]*mode: canary/);
  assert.match(workflow, /channel: latest-preview[\s\S]*experimental: true/);
  assert.match(workflow, /capability-check\.mjs/);
  assert.match(workflow, /release-stamp\.mjs/);
  assert.match(workflow, /validate-pack/);
});

test("repository impact job uses only this checkout and never contacts the original repository", () => {
  assert.match(workflow, /upstream-impact\.mjs/);
  assert.match(workflow, /--base origin\/main/);
  assert.match(workflow, /--head HEAD/);
  assert.doesNotMatch(workflow, /open-gsd\/gsd-pi|git\s+(?:fetch|merge|rebase|push|reset|remote)/);
});
