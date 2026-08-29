import assert from "node:assert/strict";
import test from "node:test";
import { resolveHerdrBinary, runHerdrCli } from "../cli.js";

test("Herdr CLI resolver prefers the injected binary path", () => {
  assert.equal(resolveHerdrBinary({ HERDR_BIN_PATH: "/opt/herdr/bin/herdr" }), "/opt/herdr/bin/herdr");
  assert.equal(resolveHerdrBinary({}), "herdr");
});

test("Herdr CLI helper executes argv directly and captures bounded output", async () => {
  const result = await runHerdrCli(
    ["-e", "process.stdout.write(process.argv[1])", "value with spaces;$(not-a-shell)"],
    { binary: process.execPath, timeoutMs: 1000 },
  );
  assert.equal(result.ok, true);
  assert.equal(result.stdout, "value with spaces;$(not-a-shell)");
});

test("Herdr CLI helper classifies a missing executable", async () => {
  const result = await runHerdrCli([], { binary: "/definitely/missing/herdr", timeoutMs: 100 });
  assert.equal(result.ok, false);
  assert.equal(result.notFound, true);
});
