import assert from "node:assert/strict";
import test from "node:test";

import {
  GSD_SESSION_DIRECTORY_ENV,
  LEGACY_PI_SESSION_DIRECTORY_ENV,
  resolveConfiguredSessionDirectory,
} from "../session-directory.js";

test("session directory precedence is CLI, GSD env, legacy Pi env, then settings", () => {
  const env = {
    [GSD_SESSION_DIRECTORY_ENV]: "/env/gsd",
    [LEGACY_PI_SESSION_DIRECTORY_ENV]: "/env/pi",
  };
  assert.equal(resolveConfiguredSessionDirectory({ cli: "/cli", env, settings: "/settings" }), "/cli");
  assert.equal(resolveConfiguredSessionDirectory({ env, settings: "/settings" }), "/env/gsd");
  assert.equal(
    resolveConfiguredSessionDirectory({ env: { [LEGACY_PI_SESSION_DIRECTORY_ENV]: "/env/pi" }, settings: "/settings" }),
    "/env/pi",
  );
  assert.equal(resolveConfiguredSessionDirectory({ env: {}, settings: "/settings" }), "/settings");
  assert.equal(resolveConfiguredSessionDirectory({ env: {} }), undefined);
});

test("session directory resolver expands a selected tilde path once", () => {
  assert.equal(
    resolveConfiguredSessionDirectory({ env: { [GSD_SESSION_DIRECTORY_ENV]: "~/sessions" }, homeDirectory: "/home/test" }),
    "/home/test/sessions",
  );
});
