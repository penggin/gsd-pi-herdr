#!/usr/bin/env node

import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_MODEL = "gpt-5.6-sol";
const TARGET_MODEL = "gpt-6-astra";
const PROVIDERS = new Set(["opencodex", "gsd-fable", "gsd-opus"]);
const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const KINDS = new Set(["models", "preferences", "settings", "roles"]);

export class MigrationError extends Error {}

function fail(message) {
  throw new MigrationError(message);
}

function pointer(parts) {
  return `/${parts.map((part) => String(part).replaceAll("~", "~0").replaceAll("/", "~1")).join("/")}`;
}

function replaceModel(value) {
  if (typeof value !== "string") return undefined;
  if (value === SOURCE_MODEL) return TARGET_MODEL;
  if (value.endsWith(`/${SOURCE_MODEL}`)) return value.slice(0, -SOURCE_MODEL.length) + TARGET_MODEL;
  return undefined;
}

// Keep source spans so JSON credentials, prices, whitespace, and unrelated values
// survive byte-for-byte. Reject duplicate keys instead of guessing which wins.
function parseJson(text) {
  try { JSON.parse(text); } catch { fail("Invalid JSON; no changes made."); }
  let position = 0;
  const whitespace = () => { while (/\s/.test(text[position] ?? "") && position < text.length) position++; };
  const string = () => {
    const start = position++;
    while (position < text.length) {
      if (text[position++] === "\\") position++;
      else if (text[position - 1] === '"') break;
    }
    return JSON.parse(text.slice(start, position));
  };
  const value = () => {
    whitespace();
    const start = position;
    const token = text[position];
    let children;
    if (token === "{") {
      children = new Map();
      position++;
      whitespace();
      while (text[position] !== "}") {
        const key = string();
        if (children.has(key)) fail("Duplicate JSON keys are ambiguous; no changes made.");
        whitespace();
        position++;
        children.set(key, value());
        whitespace();
        if (text[position] !== ",") break;
        position++;
        whitespace();
      }
      position++;
    } else if (token === "[") {
      children = [];
      position++;
      whitespace();
      while (text[position] !== "]") {
        children.push(value());
        whitespace();
        if (text[position] !== ",") break;
        position++;
      }
      position++;
    } else if (token === '"') string();
    else {
      while (position < text.length && !/[\s,}\]]/.test(text[position])) position++;
    }
    return { start, end: position, value: JSON.parse(text.slice(start, position)), children };
  };
  return value();
}

function object(node, label) {
  if (!(node?.children instanceof Map)) fail(`${label} must be a JSON object; no changes made.`);
  return node;
}

function child(node, key) {
  return node?.children instanceof Map ? node.children.get(key) : undefined;
}

function jsonEditor(text) {
  const root = object(parseJson(text), "Root");
  const edits = [];
  const additions = new Map();
  const changes = [];
  const set = (parent, key, newValue, parts) => {
    object(parent, "Target section");
    const current = child(parent, key);
    if (current && JSON.stringify(current.value) === JSON.stringify(newValue)) return;
    changes.push(pointer(parts));
    if (current) edits.push({ start: current.start, end: current.end, value: JSON.stringify(newValue) });
    else {
      const fields = additions.get(parent) ?? new Map();
      fields.set(key, newValue);
      additions.set(parent, fields);
    }
  };
  const finish = () => {
    for (const [parent, fields] of additions) {
      const body = text.slice(parent.start, parent.end);
      const multiline = body.includes("\n");
      const beforeClose = text.slice(0, parent.end - 1);
      const indent = beforeClose.slice(beforeClose.lastIndexOf("\n") + 1).match(/^\s*/)?.[0] ?? "";
      const newline = text.includes("\r\n") ? "\r\n" : "\n";
      const serialized = [...fields].map(([key, item]) => `${JSON.stringify(key)}: ${JSON.stringify(item)}`);
      // Insert immediately after the last value, preserving existing trailing indentation.
      const existing = [...parent.children.values()];
      const at = existing.at(-1)?.end ?? parent.start + 1;
      const separator = multiline ? `${newline}${indent}  ` : " ";
      edits.push({ start: at, end: at, value: `${existing.length ? "," : ""}${separator}${serialized.join(`,${separator}`)}` });
    }
    let result = text;
    let previousStart = text.length + 1;
    for (const edit of edits.sort((a, b) => b.start - a.start)) {
      if (edit.end > previousStart) fail("Overlapping migration edits; no changes made.");
      result = result.slice(0, edit.start) + edit.value + result.slice(edit.end);
      previousStart = edit.start;
    }
    try { JSON.parse(result); } catch { fail("Migration produced invalid JSON; no changes made."); }
    return { text: result, changes };
  };
  return { root, set, finish };
}

function transformModels(text) {
  const { root, set, finish } = jsonEditor(text);
  const providers = child(root, "providers");
  if (!providers) return finish();
  object(providers, "providers");
  for (const provider of PROVIDERS) {
    const definition = child(providers, provider);
    if (!definition) continue;
    object(definition, "Provider definition");
    const models = child(definition, "models");
    if (!models) continue;
    if (!Array.isArray(models.children)) fail("Provider models must be an array; no changes made.");
    const sources = models.children.filter((entry) => child(entry, "id")?.value === SOURCE_MODEL);
    if (sources.length > 1) fail("Duplicate Sol model entries are ambiguous; no changes made.");
    if (!sources.length) continue;
    if (models.children.some((entry) => child(entry, "id")?.value === TARGET_MODEL)) {
      fail("Astra model entry already exists beside Sol; resolve the collision before migration.");
    }
    const model = sources[0];
    const index = models.children.indexOf(model);
    const base = ["providers", provider, "models", index];
    const apis = [child(definition, "api")?.value, child(model, "api")?.value].filter((api) => api !== undefined);
    if (!apis.length || apis.some((api) => api !== "openai-responses" && api !== "openai-codex-responses")) {
      fail("Sol migration requires a Responses provider/model API; no changes made.");
    }
    const context = child(model, "contextWindow");
    if (!Number.isSafeInteger(context?.value) || context.value <= 0) {
      fail("Sol contextWindow must be a positive integer; no changes made.");
    }
    set(model, "id", TARGET_MODEL, [...base, "id"]);
    const name = child(model, "name");
    if (typeof name?.value === "string") {
      let renamed = name.value.replaceAll(SOURCE_MODEL, TARGET_MODEL).replace(/\bSol\b/gi, "Astra");
      if (context.value > 872_000) renamed = renamed.replace(/\b(?:1M|922K)\b/gi, "872K");
      set(model, "name", renamed === name.value ? "GPT-6 Astra" : renamed, [...base, "name"]);
    }
    set(model, "contextWindow", Math.min(context.value, 872_000), [...base, "contextWindow"]);
    const compat = child(model, "compat");
    if (compat) {
      object(compat, "Model compat");
      set(compat, "supportsTemperature", false, [...base, "compat", "supportsTemperature"]);
    } else set(model, "compat", { supportsTemperature: false }, [...base, "compat"]);
    const thinking = child(model, "thinkingLevelMap");
    if (thinking) object(thinking, "Model thinkingLevelMap");
    const levels = new Set([...LEVELS, ...Object.keys(thinking?.value ?? {})]);
    const map = Object.fromEntries([...levels].map((level) => [level, level === "medium" ? "medium" : null]));
    set(model, "thinkingLevelMap", map, [...base, "thinkingLevelMap"]);
  }
  return finish();
}

function transformSettings(text) {
  const { root, set, finish } = jsonEditor(text);
  const target = replaceModel(child(root, "defaultModel")?.value);
  if (!target) return finish();
  if (child(root, "defaultThinkingLevel")?.value !== "high") {
    fail("Sol defaultModel requires defaultThinkingLevel high; no changes made.");
  }
  set(root, "defaultModel", target, ["defaultModel"]);
  set(root, "defaultThinkingLevel", "medium", ["defaultThinkingLevel"]);
  return finish();
}

function transformRoles(text) {
  const { root, set, finish } = jsonEditor(text);
  const changedRoles = [];
  const overrides = child(root, "model_overrides");
  if (overrides) {
    object(overrides, "model_overrides");
    for (const [role, model] of overrides.children) {
      const target = replaceModel(model.value);
      if (!target) continue;
      set(overrides, role, target, ["model_overrides", role]);
      changedRoles.push(role);
    }
  }
  const profiles = child(root, "model_profile_overrides");
  if (profiles) object(profiles, "model_profile_overrides");
  const pi = child(profiles, "pi");
  let migratedOpus = false;
  if (pi) {
    object(pi, "model_profile_overrides.pi");
    for (const [role, model] of pi.children) {
      const target = replaceModel(model.value);
      if (!target) continue;
      if (role !== "opus") fail("Sol in a non-opus Pi profile slot requires explicit effort migration; no changes made.");
      set(pi, role, target, ["model_profile_overrides", "pi", role]);
      if (role === "opus") migratedOpus = true;
    }
  }
  if (!changedRoles.length && !migratedOpus) return finish();
  const effort = child(root, "effort");
  if (!effort) fail("Sol role migration requires verified high effort; no changes made.");
  object(effort, "effort");
  const agents = child(effort, "agent_overrides");
  if (agents) object(agents, "effort.agent_overrides");
  const defaults = child(effort, "routing_tier_defaults");
  if (defaults) object(defaults, "effort.routing_tier_defaults");
  const heavy = child(defaults, "heavy")?.value;
  for (const role of changedRoles) {
    const explicit = child(agents, role);
    if ((explicit ? explicit.value : heavy) !== "high") {
      fail("Sol role migration requires high effort from its override or heavy default; no changes made.");
    }
  }
  if (migratedOpus && heavy !== "high") fail("Sol pi.opus requires heavy effort high; no changes made.");
  if (changedRoles.length) {
    if (agents) {
      for (const role of changedRoles) set(agents, role, "medium", ["effort", "agent_overrides", role]);
    } else set(effort, "agent_overrides", Object.fromEntries(changedRoles.map((role) => [role, "medium"])), ["effort", "agent_overrides"]);
  }
  if (migratedOpus) {
    set(defaults, "heavy", "medium", ["effort", "routing_tier_defaults", "heavy"]);
  }
  return finish();
}

function yamlScalar(line) {
  const match = /^( *)(?:([-\w]+)|"([-\w]+)"|'([-\w]+)')\s*:\s*(.*)$/.exec(line);
  if (!match) return undefined;
  const rest = match[5];
  const scalar = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^#]*?)(\s*(?:#.*)?)$/.exec(rest);
  if (!scalar) return undefined;
  const raw = scalar[1].trimEnd();
  let value = raw;
  if (raw.startsWith('"')) {
    try { value = JSON.parse(raw); } catch { return undefined; }
  } else if (raw.startsWith("'")) value = raw.slice(1, -1).replaceAll("''", "'");
  return { indent: match[1].length, key: match[2] ?? match[3] ?? match[4], value, start: line.length - rest.length, raw };
}

function transformPreferences(text) {
  const lines = text.split(/(?<=\n)/);
  const parsed = lines.map((line) => yamlScalar(line.replace(/\r?\n$/, "")));
  const eligible = new Set();
  let firstLine = 0;
  let lastLine = lines.length;
  if (/^---\s*$/.test(lines[0])) {
    firstLine = 1;
    lastLine = lines.findIndex((line, index) => index > 0 && /^(---|\.\.\.)\s*$/.test(line));
    if (lastLine < 0) fail("Preferences frontmatter is not closed; no changes made.");
  }
  let scalarIndent;
  for (let index = firstLine; index < lastLine; index++) {
    const line = lines[index];
    if (scalarIndent !== undefined) {
      if (!line.trim() || (line.match(/^ */)?.[0].length ?? 0) > scalarIndent) {
        parsed[index] = undefined;
        continue;
      }
      scalarIndent = undefined;
    }
    eligible.add(index);
    const entry = parsed[index];
    if (!entry && /^ *[-\w]+\s*:\s*["']/.test(line)) {
      fail(`Unsupported multiline or malformed quoted YAML on line ${index + 1}; no changes made.`);
    }
    if (entry && /^[&!*]/.test(entry.raw)) {
      fail(`YAML anchors, aliases, and tags on line ${index + 1} require manual review; no changes made.`);
    }
    if (entry && /^[|>](?:[1-9][+-]?|[+-][1-9]?)?$/.test(entry.value)) scalarIndent = entry.indent;
  }
  const replacements = new Map();
  const changes = [];
  const scheduled = new Set();
  for (let index = 0; index < lines.length; index++) {
    if (!eligible.has(index)) continue;
    const entry = parsed[index];
    const target = entry?.key === "model" ? replaceModel(entry.value) : undefined;
    if (!target) continue;
    let start = index;
    let end = index + 1;
    while (start > firstLine) {
      const candidate = parsed[start - 1];
      if (candidate && candidate.indent < entry.indent) break;
      if (/^\s*(---|\.\.\.)\s*$/.test(lines[start - 1])) break;
      start--;
    }
    while (end < lastLine) {
      const candidate = parsed[end];
      if (candidate && candidate.indent < entry.indent) break;
      if (/^\s*(---|\.\.\.)\s*$/.test(lines[end])) break;
      end++;
    }
    const siblings = parsed.slice(start, end).flatMap((item, offset) => item?.indent === entry.indent ? [{ ...item, index: start + offset }] : []);
    const models = siblings.filter((item) => item.key === "model");
    const efforts = siblings.filter((item) => item.key === "thinking");
    if (models.length !== 1 || efforts.length !== 1 || efforts[0].value !== "high") {
      fail(`Sol model on line ${index + 1} requires one sibling thinking: high; no changes made.`);
    }
    for (const [lineIndex, item, value] of [[index, entry, target], [efforts[0].index, efforts[0], "medium"]]) {
      const quote = item.raw[0] === '"' ? '"' : item.raw[0] === "'" ? "'" : "";
      const replacement = quote ? `${quote}${value}${quote}` : value;
      replacements.set(lineIndex, lines[lineIndex].slice(0, item.start) + replacement + lines[lineIndex].slice(item.start + item.raw.length));
      scheduled.add(lineIndex);
      changes.push(`/lines/${lineIndex + 1}/${item.key}`);
    }
  }
  for (let index = 0; index < lines.length; index++) {
    if (!eligible.has(index)) continue;
    const uncommented = lines[index].trimStart().startsWith("#") ? "" : lines[index].split(/\s+#/)[0];
    if (uncommented.includes(SOURCE_MODEL) && !scheduled.has(index)) {
      fail(`Unmatched Sol reference on line ${index + 1}; no changes made.`);
    }
  }
  return { text: lines.map((line, index) => replacements.get(index) ?? line).join(""), changes };
}

/** Pure, formatting-preserving transform. Changes contain paths only, never values. */
export function transformConfig(kind, text) {
  if (!KINDS.has(kind)) fail("Unknown migration kind.");
  if (typeof text !== "string") fail("Migration input must be text.");
  return ({ models: transformModels, preferences: transformPreferences, settings: transformSettings, roles: transformRoles })[kind](text);
}

async function assertNoSymlinks(file) {
  if (!path.isAbsolute(file) || path.resolve(file) !== file) fail("--file must be a normalized absolute path.");
  let current = path.parse(file).root;
  for (const component of file.slice(current.length).split(path.sep)) {
    current = path.join(current, component);
    if ((await fs.lstat(current)).isSymbolicLink()) fail("Symlink paths are not eligible for migration.");
  }
}

async function readSnapshot(file) {
  await assertNoSymlinks(file);
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat({ bigint: true });
    if (!stat.isFile()) fail("Migration target must be a regular file.");
    let text;
    try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await handle.readFile()); }
    catch { fail("Migration target must contain valid UTF-8 text."); }
    return { text, stat };
  } finally { await handle.close(); }
}

function sameSnapshot(first, second) {
  return first.text === second.text && ["dev", "ino", "size", "mtimeNs", "ctimeNs"].every((field) => first.stat[field] === second.stat[field]);
}

/** Preview by default. beforeCommit is an offline-test seam, never a CLI option. */
export async function migrateFile({ kind, file, apply = false, beforeCommit }) {
  const snapshot = await readSnapshot(file);
  const transformed = transformConfig(kind, snapshot.text);
  const summary = { kind, file, mode: apply ? "apply" : "preview", changeCount: transformed.changes.length, paths: transformed.changes, applied: false };
  if (!apply || !transformed.changes.length) return summary;

  const lockPath = path.join(path.dirname(file), `.${path.basename(file)}.astra-migration.lock`);
  let lock;
  try { lock = await fs.open(lockPath, "wx", 0o600); }
  catch (error) {
    if (error.code === "EEXIST") fail("Migration lock exists; another migration may be active.");
    throw error;
  }
  let temporary;
  let backupDirectory;
  try {
    if (!sameSnapshot(snapshot, await readSnapshot(file))) fail("Target changed after preview; no changes applied.");
    backupDirectory = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), "gsd-astra-backup-"));
    await fs.chmod(backupDirectory, 0o700);
    const backupFile = path.join(backupDirectory, "original");
    await fs.writeFile(backupFile, snapshot.text, { mode: 0o600, flag: "wx" });
    const temporaryDirectory = await fs.mkdtemp(path.join(path.dirname(file), ".gsd-astra-write-"));
    temporary = { directory: temporaryDirectory, file: path.join(temporaryDirectory, "replacement") };
    const output = await fs.open(temporary.file, "wx", 0o600);
    try {
      await output.writeFile(transformed.text, "utf8");
      await output.chmod(Number(snapshot.stat.mode & 0o777n));
      await output.sync();
    } finally { await output.close(); }
    if (beforeCommit) await beforeCommit();
    if (!sameSnapshot(snapshot, await readSnapshot(file))) fail("Target changed before commit; no changes applied.");
    // Atomic replacement plus an immediate identity/content check. Node exposes no
    // kernel compare-and-rename; non-cooperating writers must be paused for apply.
    await fs.rename(temporary.file, file);
    return { ...summary, applied: true, backupFile };
  } catch (error) {
    if (backupDirectory && error instanceof MigrationError) {
      error.message += ` Backup retained at ${path.join(backupDirectory, "original")}.`;
    }
    throw error;
  } finally {
    if (temporary) {
      await fs.unlink(temporary.file).catch((error) => { if (error.code !== "ENOENT") throw error; });
      await fs.rmdir(temporary.directory);
    }
    await lock.close();
    await fs.unlink(lockPath);
  }
}

export async function main(args = process.argv.slice(2)) {
  const options = { apply: false };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--apply") options.apply = true;
    else if (argument === "--kind" || argument === "--file") {
      const key = argument.slice(2);
      if (options[key] !== undefined || !args[index + 1] || args[index + 1].startsWith("--")) fail("Each --kind and --file option requires one value.");
      options[key] = args[++index];
    } else fail("Usage: --kind models|preferences|settings|roles --file /absolute/path [--apply]");
  }
  if (!KINDS.has(options.kind) || typeof options.file !== "string") fail("--kind and --file are required.");
  return migrateFile(options);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((summary) => process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)).catch((error) => {
    process.stderr.write(`${error instanceof MigrationError ? error.message : `Migration failed (${error.code ?? "operation error"}); inspect the target before retrying.`}\n`);
    process.exitCode = 1;
  });
}
