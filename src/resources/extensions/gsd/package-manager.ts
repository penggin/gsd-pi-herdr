/**
 * Package Manager Detection — Shared utilities for detecting and using
 * the correct package manager in a project.
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { minimatch } from "minimatch";
import { parse as parseYaml } from "yaml";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

/**
 * Make a relative package-manager executable path safe for cmd.exe.
 *
 * cmd.exe does not reliably treat `app/pnpm.cmd` as a path in command
 * position. Keep Unix commands untouched, but on Windows emit the native,
 * explicitly-relative form (`.\\app\\pnpm.cmd`).
 */
export function normalizeWindowsPackageManagerCommand(
  command: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== "win32") return command;

  const match = command.match(/^(\s*)(?:(["'])(.*?)\2|(\S+))(.*)$/s);
  if (!match) return command;

  const executable = match[3] ?? match[4] ?? "";
  if (!executable.includes("/") || !/(?:^|[\\/])(?:npm|pnpm|yarn|bun)(?:\.cmd|\.bat|\.exe)?$/i.test(executable)) {
    return command;
  }

  let nativeExecutable = executable.replaceAll("/", "\\");
  const isExplicitPath =
    nativeExecutable.startsWith(".\\") ||
    nativeExecutable.startsWith("..\\") ||
    nativeExecutable.startsWith("\\") ||
    /^[A-Za-z]:\\/.test(nativeExecutable);
  if (!isExplicitPath) nativeExecutable = `.\\${nativeExecutable}`;

  const quote = match[2] ?? "";
  return `${match[1]}${quote}${nativeExecutable}${quote}${match[5]}`;
}

/**
 * Detect the package manager used by a project.
 *
 * Detection order (first match wins):
 * 1. Lock files (most reliable — reflects actual installed state)
 * 2. packageManager field in package.json (Corepack)
 * 3. The nearest workspace's manager, only for an explicitly included member
 * 4. Fallback to npm if package.json exists
 *
 * @param cwd - Project root directory
 * @returns Detected package manager, or undefined if no supported marker exists
 */
export function detectPackageManager(cwd: string): PackageManager | undefined {
  const lockedManager = detectLockFileManager(cwd);
  if (lockedManager) return lockedManager;

  if (!existsSync(join(cwd, "package.json"))) return undefined;
  try {
    const pkg = readPackageManifest(cwd);
    if (!pkg) return "npm";
    const declaredManager = detectDeclaredManager(pkg);
    if (declaredManager) return declaredManager;
    // Invalid explicit configuration must not select an ancestor's manager.
    if (pkg.packageManager !== undefined) return "npm";
    // A workspace root keeps its own fallback, even inside another workspace.
    if (hasWorkspaceDeclaration(cwd, pkg)) return "npm";
    return detectWorkspaceManager(cwd) ?? "npm";
  } catch {
    // Malformed or unreadable metadata retains the existing npm fallback.
    return "npm";
  }
}

function detectLockFileManager(cwd: string): PackageManager | undefined {
  // Lock files take precedence — they reflect actual installed state
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(cwd, "yarn.lock"))) return "yarn";
  if (existsSync(join(cwd, "bun.lockb")) || existsSync(join(cwd, "bun.lock"))) return "bun";
  if (existsSync(join(cwd, "package-lock.json"))) return "npm";

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readPackageManifest(cwd: string): Record<string, unknown> | undefined {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) return undefined;
  const pkg: unknown = JSON.parse(readFileSync(pkgPath, "utf-8"));
  if (!isRecord(pkg)) throw new Error("Invalid package.json object");
  return pkg;
}

function detectDeclaredManager(pkg: Record<string, unknown>): PackageManager | undefined {
  // Corepack format: "pnpm@9.12.2" or "yarn@4.0.0".
  if (typeof pkg.packageManager !== "string") return undefined;
  return pkg.packageManager.match(/^(npm|pnpm|yarn|bun)@/)?.[1] as PackageManager | undefined;
}

function hasWorkspaceDeclaration(cwd: string, pkg: Record<string, unknown> | undefined): boolean {
  return existsSync(join(cwd, "pnpm-workspace.yaml")) || pkg?.workspaces !== undefined;
}

/** Read only workspace metadata; never enumerate directories or run a manager. */
function workspacePatterns(cwd: string, pkg: Record<string, unknown> | undefined): string[] {
  let patterns: unknown;
  const yamlPath = join(cwd, "pnpm-workspace.yaml");
  if (existsSync(yamlPath)) {
    // pnpm's workspace file is authoritative when both forms are present.
    const workspace: unknown = parseYaml(readFileSync(yamlPath, "utf-8"), { logLevel: "silent" });
    if (!isRecord(workspace)) throw new Error("Invalid pnpm workspace object");
    patterns = workspace.packages === undefined ? [] : workspace.packages;
  } else if (pkg?.workspaces !== undefined) {
    patterns = isRecord(pkg.workspaces) ? pkg.workspaces.packages : pkg.workspaces;
  } else {
    return [];
  }

  if (!Array.isArray(patterns)) throw new Error("Invalid workspace package patterns");
  return patterns.map((value: unknown) => {
    if (typeof value !== "string") throw new Error("Invalid workspace package pattern");
    const excluded = value.startsWith("!");
    const pattern = (excluded ? value.slice(1) : value).replace(/^\.\//, "").replace(/\/+$/, "");
    if (!pattern.trim() || pattern.startsWith("/") || /^[A-Za-z]:/.test(pattern) || pattern.split("/").includes("..")) {
      throw new Error("Workspace patterns must be relative to their root");
    }
    return excluded ? `!${pattern}` : pattern;
  });
}

function detectWorkspaceManager(cwd: string): PackageManager | undefined {
  // A symlink alias must not claim membership through its lexical parent or
  // bypass an exclusion on the real package directory.
  const packageDirectory = realpathSync(cwd);
  let directory = packageDirectory;
  while (!existsSync(join(directory, ".git"))) {
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;

    const pkg = readPackageManifest(directory);
    if (!hasWorkspaceDeclaration(directory, pkg)) continue;
    const patterns = workspacePatterns(directory, pkg);
    const member = relative(directory, packageDirectory).split(sep).join("/");
    const matches = (pattern: string): boolean => minimatch(member, pattern, { nonegate: true, nocomment: true });
    const included = patterns.some(pattern => !pattern.startsWith("!") && matches(pattern));
    const excluded = patterns.some(pattern => pattern.startsWith("!") && matches(pattern.slice(1)));
    if (included && !excluded) {
      return detectLockFileManager(directory) ?? (pkg ? detectDeclaredManager(pkg) ?? "npm" : undefined);
    }
    // The nearest declaration owns membership, including exclusions. An outer
    // workspace must not claim packages this workspace leaves independent.
    return undefined;
  }
  return undefined;
}

/**
 * Build a canonical command to run a package.json script.
 *
 * - npm: `npm test` for the test script, otherwise `npm run <script>`
 * - pnpm/yarn: `<pm> <script>` (implicit run is idiomatic)
 * - bun: `bun run <script>` (avoids collisions with built-in commands)
 *
 * This matches the project’s package-manager conventions and the verification
 * rules used when interpreting shell commands.
 *
 * @param pm - Package manager to use
 * @param script - Script name from package.json
 * @returns Full command string
 */
export function buildScriptCommand(pm: PackageManager, script: string): string {
  if (pm === "npm") {
    if (script === "test") return "npm test";
    return `npm run ${script}`;
  }
  if (pm === "bun") return `bun run ${script}`;
  // pnpm and yarn support implicit run — more idiomatic
  return `${pm} ${script}`;
}
