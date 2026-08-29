import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function run(command, args, { cwd = repositoryRoot, env = process.env, allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
  });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    const detail = (result.stderr || result.stdout || `exit ${result.status}`).trim();
    throw new Error(`${command} ${args.join(" ")} failed: ${detail}`);
  }
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export function git(args, options) {
  return run("git", args, options).stdout.trim();
}

export function resolveGitRef(candidates, { cwd = repositoryRoot } = {}) {
  for (const candidate of candidates.filter(Boolean)) {
    const result = run("git", ["rev-parse", "--verify", `${candidate}^{commit}`], { cwd, allowFailure: true });
    if (result.status === 0) return { ref: candidate, commit: result.stdout.trim() };
  }
  throw new Error(`None of the required git refs exists: ${candidates.filter(Boolean).join(", ")}`);
}

export function parseArgs(argv) {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      result._.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) result[key] = true;
    else {
      result[key] = next;
      index += 1;
    }
  }
  return result;
}

export function writeJsonAtomic(path, value) {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  const temporary = `${absolute}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, absolute);
  return absolute;
}

export function parseJsonFileText(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function isMain(importMetaUrl) {
  return process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(importMetaUrl));
}
