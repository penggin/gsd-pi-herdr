import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { MigrationError, main, migrateFile, transformConfig } from "../migrate-sol-high-to-astra-medium.mjs";

const sourceModel = {
  id: "gpt-5.6-sol", name: "GSD Fable: Sol", api: "openai-codex-responses", contextWindow: 1_000_000, maxTokens: 32_000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  compat: { codexEndpoint: "responses", supportsLongCacheRetention: false },
  thinkingLevelMap: { off: null, low: "low", medium: "medium", high: "high", max: "max", ultra: "ultra" },
};
const unchangedModel = { id: "zai/glm-5.3-flash", cost: { input: 9.99 }, contextWindow: 200_000 };
const settings = '{\n  "defaultModel": "gsd-fable/gpt-5.6-sol",\n  "defaultThinkingLevel": "high",\n  "auth": "DO_NOT_PRINT_SECRET"\n}\n';

function transform(kind, value) {
  return JSON.parse(transformConfig(kind, JSON.stringify(value, null, 2)).text);
}

async function fixture(t, content = settings) {
  const directory = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), "gsd-astra-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "settings.json");
  await fs.writeFile(file, content, { mode: 0o600 });
  return { file, directory };
}

test("models migration changes only eligible Sol entries and preserves auth, prices, and unrelated raw text", () => {
  const source = {
    providers: {
      "gsd-fable": { baseUrl: "http://localhost:10100/v1", apiKey: "KEEP_AUTH", models: [sourceModel, unchangedModel, { id: "gpt-5.6-luna" }] },
      "gsd-opus": { models: [{ ...sourceModel, contextWindow: 272_000 }] },
      opencodex: { models: [{ ...sourceModel, contextWindow: 922_000, compat: undefined, thinkingLevelMap: undefined }] },
      unrelated: { models: [sourceModel] },
    },
    auth: { token: "EXACT\nVALUE", duplicateSpacing: "must stay" },
  };
  const raw = JSON.stringify(source, null, 4).replace('"KEEP_AUTH"', '"KEEP_\\u0041UTH"').replace('"input": 0', '"input": 0.000');
  const result = transformConfig("models", raw);
  const migrated = JSON.parse(result.text);
  assert.ok(result.text.includes('"apiKey": "KEEP_\\u0041UTH"'));
  assert.ok(result.text.includes('"input": 0.000'));
  for (const provider of ["gsd-fable", "gsd-opus", "opencodex"]) {
    const model = migrated.providers[provider].models[0];
    assert.equal(model.id, "gpt-6-astra");
    assert.equal(model.name, "GSD Fable: Astra");
    assert.equal(model.contextWindow, provider === "gsd-opus" ? 272_000 : 872_000);
    assert.equal(model.maxTokens, 32_000);
    assert.deepEqual(model.cost, sourceModel.cost);
    assert.equal(model.compat.supportsTemperature, false);
    for (const [level, mapping] of Object.entries(model.thinkingLevelMap)) assert.equal(mapping, level === "medium" ? "medium" : null);
  }
  assert.deepEqual(migrated.providers["gsd-fable"].models.slice(1), source.providers["gsd-fable"].models.slice(1));
  assert.deepEqual(migrated.providers.unrelated, source.providers.unrelated);
  assert.deepEqual(migrated.auth, source.auth);
  assert.equal(migrated.providers["gsd-fable"].models[0].compat.codexEndpoint, "responses");
  assert.deepEqual(transformConfig("models", result.text), { text: result.text, changes: [] });
  assert.ok(result.changes.every((entry) => entry.startsWith("/providers/")));
});

test("models rejects conflicting Astra, duplicate Sol, invalid context, or incompatible target shapes", () => {
  for (const models of [
    [sourceModel, { id: "gpt-6-astra" }],
    [sourceModel, sourceModel],
    [{ ...sourceModel, contextWindow: undefined }],
    [{ ...sourceModel, compat: "ambiguous" }],
    [{ ...sourceModel, thinkingLevelMap: [] }],
    [{ ...sourceModel, api: "openai-completions" }],
    [{ ...sourceModel, api: undefined }],
  ]) assert.throws(() => transform("models", { providers: { "gsd-fable": { models } } }), MigrationError);
  assert.throws(() => transform("models", { providers: { "gsd-fable": { api: "anthropic-messages", models: [sourceModel] } } }), /Responses/);
});

test("models uses inherited Responses APIs and updates recognized capacity labels only when clamped", () => {
  for (const [name, contextWindow, expected] of [
    ["GSD Fable: Sol 1M", 1_000_000, "GSD Fable: Astra 872K"],
    ["Sol 922K", 922_000, "Astra 872K"],
    ["GSD Opus: Sol 272K", 272_000, "GSD Opus: Astra 272K"],
  ]) {
    const result = transform("models", { providers: { "gsd-fable": { api: "openai-codex-responses", models: [{ ...sourceModel, api: undefined, name, contextWindow }] } } });
    assert.equal(result.providers["gsd-fable"].models[0].name, expected);
  }
});

test("preferences preserves lines, comments, quotes, CRLF, GLM, and Luna while pairing high siblings in either order", () => {
  const before = [
    "---", "models:", "  planning:", '    model: "gsd-fable/gpt-5.6-sol" # planner', "    context_window: 1000000", "    thinking: high # effort",
    "  research:", "    thinking: 'high'", "    model: 'gpt-5.6-sol'", "  coding:", "    model: gsd-sonnet/zai/glm-5.3-flash", "    thinking: max",
    "  quick:", "    model: gpt-5.6-luna", "    thinking: high", "---", "# gpt-5.6-sol migration history", "",
  ].join("\r\n");
  const expected = before.replace('"gsd-fable/gpt-5.6-sol"', '"gsd-fable/gpt-6-astra"')
    .replace("thinking: high # effort", "thinking: medium # effort").replace("thinking: 'high'", "thinking: 'medium'")
    .replace("model: 'gpt-5.6-sol'", "model: 'gpt-6-astra'");
  const result = transformConfig("preferences", before);
  assert.equal(result.text, expected);
  assert.equal(result.changes.length, 4);
  assert.deepEqual(transformConfig("preferences", result.text), { text: expected, changes: [] });
});

test("preferences rejects missing, wrong, duplicate, nested, or unsupported Sol effort mappings", () => {
  for (const value of [
    "model: gpt-5.6-sol\n",
    "model: gpt-5.6-sol\nthinking: max\n",
    "model: gpt-5.6-sol\nthinking: high\nthinking: high\n",
    "model: gpt-5.6-sol\nchild:\n  thinking: high\n",
    "first:\n  model: gpt-5.6-sol\nsecond:\n  thinking: high\n",
    "model: { id: gpt-5.6-sol }\nthinking: high\n",
    "model: gpt-5.6-sol\nmodel: gpt-5.6-luna\nthinking: high\n",
    "\tmodel: gpt-5.6-sol\n\tthinking: high\n",
    'notes: "\n  model: gpt-5.6-sol\n  thinking: high\n"\n',
    "notes: &example |\n  model: gpt-5.6-sol\n  thinking: high\n",
    "notes: !!str >-\n  model: gpt-5.6-sol\n  thinking: high\n",
  ]) assert.throws(() => transformConfig("preferences", value), MigrationError);
});

test("preferences leaves literal/folded scalar bodies and Markdown outside frontmatter byte-for-byte", () => {
  for (const marker of ["|", ">-", "|2", "|+"]) {
    const raw = `notes: ${marker}\n  model: gpt-5.6-sol\n  thinking: high\n`;
    assert.deepEqual(transformConfig("preferences", raw), { text: raw, changes: [] });
  }
  const raw = "---\nmodels:\n  planning:\n    model: gpt-5.6-sol\n    thinking: high\nnotes: |\n  model: gpt-5.6-sol\n  thinking: high\n---\nmodel: gpt-5.6-sol\nthinking: high\n";
  const expected = raw.replace("    model: gpt-5.6-sol\n    thinking: high", "    model: gpt-6-astra\n    thinking: medium");
  assert.equal(transformConfig("preferences", raw).text, expected);
});

test("roles rejects non-high or unknown effective effort and unsupported Sol profile slots", () => {
  for (const effort of [undefined, {}, { agent_overrides: { planner: "low" }, routing_tier_defaults: { heavy: "high" } }, { routing_tier_defaults: { heavy: "max" } }]) {
    assert.throws(() => transform("roles", { model_overrides: { planner: "gpt-5.6-sol" }, effort }), MigrationError);
  }
  assert.throws(() => transform("roles", {
    model_profile_overrides: { pi: { sonnet: "gpt-5.6-sol" } },
    effort: { routing_tier_defaults: { standard: "high" } },
  }), MigrationError);
  assert.throws(() => transform("roles", {
    model_profile_overrides: { pi: { opus: "gpt-5.6-sol" } },
    effort: { routing_tier_defaults: { heavy: "max" } },
  }), MigrationError);
});

test("settings migrates only paired Sol/high defaults and remains idempotent", () => {
  const result = transformConfig("settings", settings);
  assert.equal(result.text, settings.replace("gpt-5.6-sol", "gpt-6-astra").replace('"high"', '"medium"'));
  assert.deepEqual(result.changes, ["/defaultModel", "/defaultThinkingLevel"]);
  assert.deepEqual(transformConfig("settings", result.text), { text: result.text, changes: [] });
  for (const value of ["medium", "max", null, undefined]) {
    assert.throws(() => transform("settings", { defaultModel: "gpt-5.6-sol", defaultThinkingLevel: value }), /requires defaultThinkingLevel high/);
  }
  const unrelated = '{"defaultModel":"zai/glm-5.3-flash","defaultThinkingLevel":"max","history":"gpt-5.6-sol"}';
  assert.deepEqual(transformConfig("settings", unrelated), { text: unrelated, changes: [] });
});

test("roles migrates scoped overrides and named efforts without altering other runtimes or routing tiers", () => {
  const source = {
    model_overrides: { "gsd-planner": "gsd-fable/gpt-5.6-sol", "gsd-ui-checker": "gpt-5.6-sol", "gsd-executor": "zai/glm-5.3-flash" },
    model_profile_overrides: { pi: { opus: "gsd-opus/gpt-5.6-sol", sonnet: "zai/glm-5.3-flash", haiku: "gpt-5.6-luna" }, claude: { opus: "gpt-5.6-sol" } },
    effort: { agent_overrides: { "gsd-ui-checker": "high", "gsd-executor": "max" }, routing_tier_defaults: { heavy: "high", standard: "max", light: "max" } },
    history: { model: "gpt-5.6-sol", effort: "high" },
  };
  const migrated = transform("roles", source);
  assert.equal(migrated.model_overrides["gsd-planner"], "gsd-fable/gpt-6-astra");
  assert.equal(migrated.model_overrides["gsd-ui-checker"], "gpt-6-astra");
  assert.equal(migrated.model_profile_overrides.pi.opus, "gsd-opus/gpt-6-astra");
  assert.deepEqual(migrated.effort, {
    agent_overrides: { "gsd-ui-checker": "medium", "gsd-executor": "max", "gsd-planner": "medium" },
    routing_tier_defaults: { heavy: "medium", standard: "max", light: "max" },
  });
  assert.deepEqual(migrated.history, source.history);
  assert.deepEqual(migrated.model_profile_overrides.claude, source.model_profile_overrides.claude);
  assert.equal(migrated.model_profile_overrides.pi.haiku, "gpt-5.6-luna");
  const migratedText = JSON.stringify(migrated);
  assert.deepEqual(transformConfig("roles", migratedText), { text: migratedText, changes: [] });
});

test("roles creates missing agent effort overrides and only changes heavy high when pi.opus was Sol", () => {
  for (const effort of [{ routing_tier_defaults: { heavy: "high" } }, { agent_overrides: {}, routing_tier_defaults: { heavy: "high" } }]) {
    const migrated = transform("roles", { model_overrides: { planner: "gpt-5.6-sol" }, effort });
    assert.equal(migrated.effort.agent_overrides.planner, "medium");
  }
  for (const opus of ["gpt-5.6-luna", "gpt-6-astra", undefined]) {
    const migrated = transform("roles", {
      model_overrides: { planner: "gpt-5.6-sol" }, model_profile_overrides: { pi: { opus } },
      effort: { routing_tier_defaults: { heavy: "high" } },
    });
    assert.equal(migrated.effort.routing_tier_defaults.heavy, "high");
  }
});

test("JSON transforms reject duplicate keys and malformed input without echoing their contents", () => {
  for (const raw of ['{"auth":"SECRET","auth":"SECOND"}', '{"SECRET":', "[]"]) {
    assert.throws(() => transformConfig("settings", raw), (error) => error instanceof MigrationError && !/SECRET|SECOND/.test(error.message));
  }
});

test("preview creates no files and its output cannot reveal credential values", async (t) => {
  const { file, directory } = await fixture(t);
  const result = await migrateFile({ kind: "settings", file });
  assert.equal(result.applied, false);
  assert.equal(result.changeCount, 2);
  assert.equal(await fs.readFile(file, "utf8"), settings);
  assert.deepEqual(await fs.readdir(directory), ["settings.json"]);
  assert.doesNotMatch(JSON.stringify(result), /DO_NOT_PRINT_SECRET/);
  const script = fileURLToPath(new URL("../migrate-sol-high-to-astra-medium.mjs", import.meta.url));
  const output = execFileSync(process.execPath, [script, "--kind", "settings", "--file", file], { encoding: "utf8" });
  assert.equal(JSON.parse(output).mode, "preview");
  assert.doesNotMatch(output, /DO_NOT_PRINT_SECRET/);
});

test("apply atomically replaces the file, saves a private recoverable original, and is idempotent", async (t) => {
  const { file, directory } = await fixture(t);
  const before = await fs.stat(file);
  const result = await migrateFile({ kind: "settings", file, apply: true });
  t.after(() => fs.rm(path.dirname(result.backupFile), { recursive: true, force: true }));
  assert.equal(result.applied, true);
  assert.equal(await fs.readFile(result.backupFile, "utf8"), settings);
  assert.equal((await fs.stat(result.backupFile)).mode & 0o777, 0o600);
  assert.equal((await fs.stat(path.dirname(result.backupFile))).mode & 0o777, 0o700);
  assert.equal((await fs.stat(file)).mode & 0o777, before.mode & 0o777);
  assert.notEqual((await fs.stat(file)).ino, before.ino);
  assert.equal(JSON.parse(await fs.readFile(file, "utf8")).defaultModel, "gsd-fable/gpt-6-astra");
  const again = await migrateFile({ kind: "settings", file, apply: true });
  assert.equal(again.changeCount, 0);
  assert.equal(again.applied, false);
  assert.equal(again.backupFile, undefined);
  assert.deepEqual(await fs.readdir(directory), ["settings.json"]);
});

test("apply cancels when an external edit arrives before commit and retains that edit", async (t) => {
  const { file, directory } = await fixture(t);
  const externalEdit = settings.replace('"high"', '"max"');
  let backup;
  await assert.rejects(migrateFile({
    kind: "settings", file, apply: true,
    beforeCommit: () => fs.writeFile(file, externalEdit),
  }), (error) => {
    assert.match(error.message, /Target changed before commit/);
    backup = /Backup retained at (.*)\.$/.exec(error.message)?.[1];
    return true;
  });
  assert.ok(backup);
  t.after(() => fs.rm(path.dirname(backup), { recursive: true, force: true }));
  assert.equal(await fs.readFile(file, "utf8"), externalEdit);
  assert.equal(await fs.readFile(backup, "utf8"), settings);
  assert.deepEqual(await fs.readdir(directory), ["settings.json"]);
});

test("apply rejects same-content replacement, symlinks, and existing migration locks", async (t) => {
  const { file, directory } = await fixture(t);
  const link = path.join(directory, "link.json");
  await fs.symlink(file, link);
  await assert.rejects(migrateFile({ kind: "settings", file: link, apply: true }), /Symlink/);
  const parentLink = path.join(directory, "linked-parent");
  await fs.symlink(directory, parentLink);
  await assert.rejects(migrateFile({ kind: "settings", file: path.join(parentLink, "settings.json"), apply: true }), /Symlink/);
  await fs.writeFile(path.join(directory, ".settings.json.astra-migration.lock"), "locked");
  await assert.rejects(migrateFile({ kind: "settings", file, apply: true }), /Migration lock exists/);
  await fs.unlink(path.join(directory, ".settings.json.astra-migration.lock"));
  let backup;
  await assert.rejects(migrateFile({ kind: "settings", file, apply: true, beforeCommit: async () => {
    const replacement = path.join(directory, "external.json");
    await fs.writeFile(replacement, settings);
    await fs.rename(replacement, file);
  } }), (error) => {
    backup = /Backup retained at (.*)\.$/.exec(error.message)?.[1];
    return /Target changed/.test(error.message);
  });
  assert.ok(backup);
  t.after(() => fs.rm(path.dirname(backup), { recursive: true, force: true }));
  assert.equal(await fs.readFile(file, "utf8"), settings);
});

test("CLI rejects missing, relative, and unknown options", async () => {
  await assert.rejects(main([]), /required/);
  await assert.rejects(main(["--kind", "settings", "--file", "relative.json"]), /absolute/);
  await assert.rejects(main(["--kind", "settings", "--file", "/unused", "--force"]), /Usage/);
});
