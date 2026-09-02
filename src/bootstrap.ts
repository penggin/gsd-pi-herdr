#!/usr/bin/env node
// GSD Bootstrap
//
// Installs made with --ignore-scripts never run the workspace-package link
// step. Restore the shipped @gsd/* packages before loading the real CLI.

import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const distDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(distDir, "..");

export interface EnsureWorkspaceLinksOptions {
  symlinkImpl?: typeof symlinkSync;
  cpSyncImpl?: typeof cpSync;
}

export function ensureWorkspaceLinks(
  root: string = packageRoot,
  options: EnsureWorkspaceLinksOptions = {},
): { repaired: string[]; failed: string[] } {
  const repaired: string[] = [];
  const failed: string[] = [];
  const packagesDir = join(root, "packages");
  const scopeDir = join(root, "node_modules", "@gsd");
  if (!existsSync(packagesDir)) return { repaired, failed };

  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const manifestPath = join(packagesDir, entry.name, "package.json");
    if (!existsSync(manifestPath)) continue;

    let packageName: string | undefined;
    try {
      packageName = JSON.parse(readFileSync(manifestPath, "utf8")).name;
    } catch {
      continue;
    }
    if (typeof packageName !== "string" || !packageName.startsWith("@gsd/")) continue;

    const target = join(scopeDir, packageName.slice("@gsd/".length));
    if (existsSync(target)) {
      try {
        const stat = lstatSync(target);
        if (stat.isSymbolicLink()) {
          const linkTarget = readlinkSync(target);
          const intended = join(packagesDir, entry.name);
          const resolvedLink = resolve(dirname(target), linkTarget);
          if (resolvedLink === intended) continue;
          rmSync(target, { force: true });
        } else if (stat.isDirectory()) {
          continue;
        } else {
          rmSync(target, { force: true });
        }
      } catch {
        continue;
      }
    }

    try {
      mkdirSync(scopeDir, { recursive: true });
      (options.symlinkImpl ?? symlinkSync)(join(packagesDir, entry.name), target, "junction");
      repaired.push(packageName);
    } catch {
      try {
        mkdirSync(scopeDir, { recursive: true });
        (options.cpSyncImpl ?? cpSync)(join(packagesDir, entry.name), target, { recursive: true });
        repaired.push(packageName);
      } catch (err) {
        failed.push(`${packageName}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  return { repaired, failed };
}

const invokedDirectly = (() => {
  try {
    return process.argv[1] !== undefined
      && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const { repaired, failed } = ensureWorkspaceLinks(packageRoot);
  if (failed.length > 0) {
    console.error("GSD could not repair its internal package links (this happens when installs skip lifecycle scripts).");
    for (const failure of failed) console.error(`  - ${failure}`);
    console.error(
      "Run: node "
      + JSON.stringify(join(packageRoot, "scripts", "link-workspace-packages.cjs"))
      + " from the install directory, or reinstall without --ignore-scripts.",
    );
    process.exit(1);
  }
  if (repaired.length > 0) {
    console.error(`GSD repaired ${repaired.length} internal package link(s) on first run.`);
  }
  await import("./loader.js");
}
