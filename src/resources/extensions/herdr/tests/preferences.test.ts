import assert from "node:assert/strict";
import test from "node:test";
import { resolveHerdrPreferences } from "../preferences.js";

test("Herdr is opt-in and required defaults true once selected", () => {
  assert.deepEqual(resolveHerdrPreferences(undefined, {}), { enabled: false, required: true });
  assert.deepEqual(
    resolveHerdrPreferences({ herdr: { enabled: true } }, {}),
    { enabled: true, required: true },
  );
  assert.deepEqual(
    resolveHerdrPreferences({ herdr: { enabled: true, required: false } }, {}),
    { enabled: true, required: false },
  );
});

test("debug environment can disable Herdr or force required mode", () => {
  assert.equal(
    resolveHerdrPreferences({ herdr: { enabled: true } }, { GSD_HERDR_DISABLE: "1" }).enabled,
    false,
  );
  assert.equal(
    resolveHerdrPreferences(
      { herdr: { enabled: true, required: false } },
      { GSD_HERDR_REQUIRED: "1" },
    ).required,
    true,
  );
});
