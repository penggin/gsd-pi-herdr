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

test("upstream watcher reports remote refs without merging or pushing branches", () => {
  assert.match(workflow, /upstream-impact\.mjs/);
  assert.match(workflow, /refs\/remotes\/upstream-watch\/main/);
  assert.doesNotMatch(workflow, /git\s+(?:merge|rebase|push|reset)/);
});
