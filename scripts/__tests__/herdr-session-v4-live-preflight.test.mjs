import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  evaluateSessionV4LiveEnvironment,
  evaluateSessionV4LivePreflight,
  extractCurrentPaneId,
  runSessionV4LivePreflight,
} from "../herdr-integration/session-v4-live-preflight.mjs";

const managedEnvironment = {
  HERDR_ENV: "1",
  HERDR_SOCKET_PATH: "/tmp/herdr.sock",
  HERDR_BIN_PATH: "/tmp/herdr",
  HERDR_WORKSPACE_ID: "w1",
  HERDR_TAB_ID: "w1:t1",
  HERDR_PANE_ID: "w1:p1",
  GSD_INTERNAL_SESSION_BACKEND: "harness-v4",
};

const capabilities = { compatible: true, version: "0.8.2", protocol: 20 };
const buildInfo = {
  package: "@penggin/gsd-pi-herdr",
  herdrIntegration: true,
  releaseMetadata: {
    downstream: { dirty: false },
    herdr: { capabilityVerified: true },
  },
};

test("rejects execution outside a Herdr-managed v4 root", () => {
  const result = evaluateSessionV4LiveEnvironment({});
  assert.equal(result.ready, false);
  assert.match(result.errors.join("\n"), /HERDR_ENV=1/);
  assert.match(result.errors.join("\n"), /harness-v4/);
});

test("writes environment refusal evidence without issuing Herdr commands", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "gsd-herdr-v4-preflight-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const output = join(directory, "preflight.json");
  const report = runSessionV4LivePreflight({ environment: {}, output });
  assert.equal(report.phase, "environment");
  assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), report);
});

test("rejects subagent children even when they inherit a complete environment", () => {
  const result = evaluateSessionV4LiveEnvironment({ ...managedEnvironment, GSD_SUBAGENT_CHILD: "1" });
  assert.equal(result.ready, false);
  assert.match(result.errors.join("\n"), /cannot run from a GSD subagent child/);
});

test("extracts current pane IDs from supported response envelopes", () => {
  assert.equal(extractCurrentPaneId({ result: { pane: { pane_id: "w1:p2" } } }), "w1:p2");
  assert.equal(extractCurrentPaneId({ result: { pane_id: "w1:p3" } }), "w1:p3");
  assert.equal(extractCurrentPaneId({ pane_id: "w1:p4" }), "w1:p4");
});

test("accepts only matching pinned capabilities, pane identity, and downstream build", () => {
  const pass = evaluateSessionV4LivePreflight({
    environment: managedEnvironment,
    currentPaneId: "w1:p1",
    capabilities,
    buildInfo,
  });
  assert.equal(pass.ready, true);
  assert.deepEqual(pass.errors, []);

  const fail = evaluateSessionV4LivePreflight({
    environment: managedEnvironment,
    currentPaneId: "w1:p9",
    capabilities: { compatible: true, version: "0.9.0", protocol: 21 },
    buildInfo: { package: "upstream-pi", herdrIntegration: false },
  });
  assert.equal(fail.ready, false);
  assert.match(fail.errors.join("\n"), /does not match inherited HERDR_PANE_ID/);
  assert.match(fail.errors.join("\n"), /requires pinned Herdr 0\.8\.2\/protocol 20/);
  assert.match(fail.errors.join("\n"), /not an identified Herdr-integrated downstream build/);
});

test("reports release-stamp limitations as warnings without hiding live compatibility", () => {
  const result = evaluateSessionV4LivePreflight({
    environment: managedEnvironment,
    currentPaneId: "w1:p1",
    capabilities,
    buildInfo: {
      ...buildInfo,
      releaseMetadata: {
        downstream: { dirty: true },
        herdr: { capabilityVerified: false },
      },
    },
  });
  assert.equal(result.ready, true);
  assert.equal(result.warnings.length, 2);
});
