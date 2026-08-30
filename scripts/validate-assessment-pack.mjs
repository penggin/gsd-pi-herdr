#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packageDir = join(root, "packages", "gsd-assessment-pack-gstack");
const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
const rootManifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

if (manifest.version !== rootManifest.version) {
  throw new Error(`assessment pack version ${manifest.version} must match release version ${rootManifest.version}`);
}
if (manifest.publishConfig?.access !== "public") {
  throw new Error("assessment pack must opt into public workspace publishing");
}
if (Object.keys(manifest.dependencies ?? {}).length > 0) {
  throw new Error("assessment pack must remain runtime dependency-free");
}

const temporaryRoot = mkdtempSync(join(tmpdir(), "gsd-assessment-pack-"));
try {
  const packOutput = execFileSync(
    "npm",
    ["pack", "--ignore-scripts", "--json", "--pack-destination", temporaryRoot],
    { cwd: packageDir, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  const packed = JSON.parse(packOutput)[0];
  if (!packed?.filename || !Array.isArray(packed.files)) throw new Error("npm pack returned no file inventory");
  const files = new Set(packed.files.map((entry) => entry.path));
  const required = [
    "package.json",
    "README.md",
    "manifest.json",
    "UPSTREAM.md",
    "LICENSES/GSTACK-MIT.txt",
    "skills/gstack-design-review/SKILL.md",
    "skills/gstack-second-opinion/SKILL.md",
  ];
  const missing = required.filter((path) => !files.has(path));
  if (missing.length > 0) throw new Error(`assessment pack tarball is missing: ${missing.join(", ")}`);

  const tarball = realpathSync(join(temporaryRoot, packed.filename));
  const installRoot = join(temporaryRoot, "install");
  execFileSync(
    "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--prefix", installRoot, tarball],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  const installed = join(installRoot, "node_modules", "@penggin", "gsd-assessment-pack-gstack");
  for (const path of required) readFileSync(join(installed, path));

  const projectRoot = join(temporaryRoot, "project");
  mkdirSync(projectRoot);
  const gsdBinary = join(root, "dist", "loader.js");
  execFileSync(process.execPath, [gsdBinary, "install", installed, "--local"], {
    cwd: projectRoot,
    stdio: ["ignore", "pipe", "inherit"],
  });
  const listed = execFileSync(process.execPath, [gsdBinary, "list"], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (!listed.includes("gsd-assessment-pack-gstack")) {
    throw new Error("GSD package manager did not discover the installed assessment pack");
  }
  process.stdout.write(
    `Assessment pack is publishable, installable, and GSD-discoverable: ${manifest.name}@${manifest.version} (${files.size} files).\n`,
  );
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
