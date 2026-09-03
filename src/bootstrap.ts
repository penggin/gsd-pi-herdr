#!/usr/bin/env node
// GSD Bootstrap
//
// Installs made with --ignore-scripts never run the workspace-package link
// step. Restore every canonically linkable shipped package before loading the
// real CLI, including both @gsd/* and @opengsd/* scopes.

import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const distDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(distDir, "..");
const require = createRequire(import.meta.url);

interface LinkableWorkspacePackage {
  path: string;
  scope: "@gsd" | "@opengsd";
  name: string;
  packageName: string;
}

const workspaceManifest = require(join(packageRoot, "scripts", "lib", "workspace-manifest.cjs")) as {
  getLinkablePackages(root?: string): LinkableWorkspacePackage[];
};

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
  if (!existsSync(packagesDir)) return { repaired, failed };

  for (const workspacePackage of workspaceManifest.getLinkablePackages(root)) {
    const scopeDir = join(root, "node_modules", workspacePackage.scope);
    const target = join(scopeDir, workspacePackage.name);
    if (existsSync(target)) {
      try {
        const stat = lstatSync(target);
        if (stat.isSymbolicLink()) {
          const linkTarget = readlinkSync(target);
          const intended = workspacePackage.path;
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
      (options.symlinkImpl ?? symlinkSync)(workspacePackage.path, target, "junction");
      repaired.push(workspacePackage.packageName);
    } catch {
      try {
        mkdirSync(scopeDir, { recursive: true });
        (options.cpSyncImpl ?? cpSync)(workspacePackage.path, target, { recursive: true });
        repaired.push(workspacePackage.packageName);
      } catch (err) {
        failed.push(`${workspacePackage.packageName}: ${err instanceof Error ? err.message : String(err)}`);
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
