import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { git, isMain, parseArgs, parseJsonFileText, repositoryRoot, resolveGitRef, run, writeJsonAtomic } from "./shared.mjs";

export function buildReleaseMetadata({
  cwd = repositoryRoot,
  upstreamRef,
  capabilityPath,
  knownGoodPath = resolve(repositoryRoot, "integrations/herdr/release/known-good.json"),
  now = new Date(),
  allowDirty = false,
} = {}) {
  const packageManifest = parseJsonFileText(readFileSync(resolve(cwd, "package.json"), "utf8"), "package.json");
  const compatibility = parseJsonFileText(readFileSync(resolve(cwd, "integrations/herdr/compatibility.json"), "utf8"), "Herdr compatibility matrix");
  const knownGood = parseJsonFileText(readFileSync(knownGoodPath, "utf8"), "Herdr known-good release");
  const upstream = resolveGitRef([upstreamRef, process.env.HERDR_UPSTREAM_BASE_REF, "upstream-main", "origin/upstream-main", "main"], { cwd });
  const downstream = resolveGitRef(["HEAD"], { cwd });
  if (!allowDirty && git(["status", "--porcelain"], { cwd })) throw new Error("Refusing to stamp release metadata from a dirty worktree");
  if (run("git", ["merge-base", "--is-ancestor", upstream.commit, downstream.commit], { cwd, allowFailure: true }).status !== 0) {
    throw new Error(`Recorded upstream base ${upstream.commit} is not an ancestor of downstream ${downstream.commit}`);
  }
  const capability = capabilityPath
    ? parseJsonFileText(readFileSync(capabilityPath, "utf8"), "Herdr capability report")
    : undefined;
  if (capability && !capability.compatible) throw new Error("Refusing to stamp a release from a failed Herdr capability report");
  return {
    schemaVersion: 1,
    createdAt: now.toISOString(),
    downstream: {
      repository: "penggin/gsd-pi-herdr",
      package: packageManifest.name,
      version: packageManifest.version,
      commit: downstream.commit,
      ref: git(["symbolic-ref", "--short", "-q", "HEAD"], { cwd, allowFailure: true }) || "detached",
    },
    upstream: {
      repository: "open-gsd/gsd-pi",
      ref: upstream.ref,
      commit: upstream.commit,
    },
    herdr: {
      integrationSchemaVersion: 1,
      compatibility,
      ...(capability ? { capability } : {}),
    },
    rollback: {
      previousKnownGood: knownGood,
      preservesRuntimeArtifacts: true,
    },
    verification: {
      required: [
        "pnpm run typecheck:extensions",
        "pnpm run test:changed:src",
        "pnpm run test:herdr-integration",
        "pnpm run build:core",
        "pnpm run validate-pack",
        "git diff --check",
      ],
    },
  };
}

if (isMain(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const output = args.output ?? resolve(repositoryRoot, "dist/herdr-release.json");
    const metadata = buildReleaseMetadata({
      upstreamRef: args["upstream-ref"],
      capabilityPath: args.capability,
      knownGoodPath: args["known-good"],
      allowDirty: args["allow-dirty"] === true,
    });
    writeJsonAtomic(output, metadata);
    process.stdout.write(`${JSON.stringify({ output: resolve(output), ...metadata }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`[herdr-release-stamp] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
