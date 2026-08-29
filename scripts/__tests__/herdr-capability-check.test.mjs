import assert from "node:assert/strict";
import test from "node:test";

import { collectMethodConstants, evaluateCapabilities, REQUIRED_METHODS } from "../herdr-integration/capability-check.mjs";

const matrix = {
  minimumVersion: "0.8.2",
  minimumProtocol: 20,
  supported: { version: "0.8.2", protocol: 20 },
};

function schemaFor(methods) {
  return {
    schemas: {
      request: {
        oneOf: methods.map((method) => ({ properties: { method: { const: method } } })),
      },
    },
  };
}

test("collects nested socket methods and passes the supported capability contract", () => {
  const methods = collectMethodConstants(schemaFor(REQUIRED_METHODS));
  const result = evaluateCapabilities({
    version: "0.8.2",
    protocol: 20,
    schemaVersion: 1,
    methods,
    paneRunHelp: "Run a command in a pane",
    pluginLinkHelp: "Link a local plugin",
    pluginMinVersion: "0.8.2",
    matrix,
    mode: "supported",
  });
  assert.equal(result.compatible, true);
  assert.deepEqual(result.missingMethods, []);
});

test("canary mode remains capability based and reports missing methods", () => {
  const methods = collectMethodConstants(schemaFor(REQUIRED_METHODS.filter((method) => method !== "pane.send_keys")));
  const result = evaluateCapabilities({
    version: "0.9.0",
    protocol: 21,
    schemaVersion: 2,
    methods,
    paneRunHelp: "Run a command in a pane",
    pluginLinkHelp: "Link a local plugin",
    pluginMinVersion: "0.8.2",
    matrix,
    mode: "canary",
  });
  assert.equal(result.compatible, false);
  assert.deepEqual(result.missingMethods, ["pane.send_keys"]);
  assert.equal(result.checks.version, true);
  assert.equal(result.checks.protocol, true);
});
