#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPT_DIR, "..");
const MANIFEST_PATH = join(SCRIPT_DIR, "pi-upstream.json");
const STABLE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;
const COMMIT = /^[0-9a-f]{40}$/;

export function compareStableTags(left, right) {
  const leftParts = STABLE_TAG.exec(left);
  const rightParts = STABLE_TAG.exec(right);
  if (!leftParts || !rightParts) throw new Error(`Cannot compare non-stable Pi tags: ${left}, ${right}`);
  for (let index = 1; index <= 3; index += 1) {
    const difference = Number(leftParts[index]) - Number(rightParts[index]);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function parseLsRemote(output) {
  const refs = new Map();
  const peeled = new Map();
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const [commit, ref] = line.trim().split(/\s+/, 2);
    if (!COMMIT.test(commit) || !ref) throw new Error(`Malformed git ls-remote row: ${line}`);
    if (ref.endsWith("^{}")) peeled.set(ref.slice(0, -3), commit);
    else refs.set(ref, commit);
  }
  for (const [ref, commit] of peeled) refs.set(ref, commit);
  return refs;
}

export function latestStable(refs) {
  const candidates = [...refs.entries()]
    .filter(([ref]) => STABLE_TAG.test(ref.replace("refs/tags/", "")))
    .map(([ref, commit]) => ({ ref: ref.replace("refs/tags/", ""), commit }))
    .sort((left, right) => compareStableTags(right.ref, left.ref));
  if (candidates.length === 0) throw new Error("Upstream did not advertise a stable vX.Y.Z tag");
  return candidates[0];
}

function validateAuditBaseline(manifest) {
  const baseline = manifest.upstreamAudit;
  if (!baseline || typeof baseline !== "object") {
    throw new Error("scripts/pi-upstream.json must define upstreamAudit separately from the vendor pin");
  }
  for (const key of ["reviewedStableRef", "reviewedStableCommit", "reviewedMainRef", "reviewedMainCommit", "reviewedAt", "auditDocument"]) {
    if (typeof baseline[key] !== "string" || baseline[key].length === 0) {
      throw new Error(`scripts/pi-upstream.json upstreamAudit.${key} must be a non-empty string`);
    }
  }
  if (!STABLE_TAG.test(baseline.reviewedStableRef)) throw new Error("upstreamAudit.reviewedStableRef must be a stable vX.Y.Z tag");
  if (!COMMIT.test(baseline.reviewedStableCommit) || !COMMIT.test(baseline.reviewedMainCommit)) {
    throw new Error("upstreamAudit reviewed commits must be full 40-character lowercase Git object IDs");
  }
  return baseline;
}

export function buildAuditReport({ manifest, lsRemoteOutput, generatedAt = new Date().toISOString() }) {
  const baseline = validateAuditBaseline(manifest);
  const refs = parseLsRemote(lsRemoteOutput);
  const observedStable = latestStable(refs);
  const observedMainCommit = refs.get(baseline.reviewedMainRef);
  if (!observedMainCommit) throw new Error(`Upstream did not advertise ${baseline.reviewedMainRef}`);

  const changes = [];
  if (observedStable.ref !== baseline.reviewedStableRef || observedStable.commit !== baseline.reviewedStableCommit) {
    changes.push({
      kind: "stable-release-changed",
      reviewed: { ref: baseline.reviewedStableRef, commit: baseline.reviewedStableCommit },
      observed: observedStable,
    });
  }
  if (observedMainCommit !== baseline.reviewedMainCommit) {
    changes.push({
      kind: "main-changed",
      reviewed: { ref: baseline.reviewedMainRef, commit: baseline.reviewedMainCommit },
      observed: { ref: baseline.reviewedMainRef, commit: observedMainCommit },
    });
  }

  return {
    schemaVersion: 1,
    generatedAt,
    repository: manifest.repository,
    vendorPin: { ref: manifest.pinnedRef, commit: manifest.pinnedCommit ?? null },
    baseline,
    observed: {
      latestStable: observedStable,
      main: { ref: baseline.reviewedMainRef, commit: observedMainCommit },
    },
    current: changes.length === 0,
    changes,
  };
}

export function renderMarkdown(report) {
  const lines = [
    "# Pi upstream audit status",
    "",
    `- Repository: \`${report.repository}\``,
    `- Vendor pin: \`${report.vendorPin.ref}\``,
    `- Reviewed stable: \`${report.baseline.reviewedStableRef}\` (\`${report.baseline.reviewedStableCommit}\`)`,
    `- Observed stable: \`${report.observed.latestStable.ref}\` (\`${report.observed.latestStable.commit}\`)`,
    `- Reviewed main: \`${report.baseline.reviewedMainCommit}\``,
    `- Observed main: \`${report.observed.main.commit}\``,
    `- Status: **${report.current ? "current" : "review required"}**`,
    `- Prior analysis: \`${report.baseline.auditDocument}\``,
    "",
  ];
  if (report.changes.length === 0) {
    lines.push("No upstream ref changed since the recorded review.");
  } else {
    lines.push("## Changes requiring review", "");
    for (const change of report.changes) {
      lines.push(`- ${change.kind}: \`${change.reviewed.ref}\` ${change.reviewed.commit} → \`${change.observed.ref}\` ${change.observed.commit}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function usage() {
  return [
    "Usage: node scripts/audit-pi-upstream.mjs [--markdown] [--no-fail]",
    "",
    "Queries the configured Pi repository with git ls-remote. It never fetches,",
    "checks out, vendors, or modifies upstream code. Exit code 2 means that a",
    "stable tag or main has changed since the recorded audit baseline.",
    "",
  ].join("\n");
}

function main(argv) {
  const allowed = new Set(["--markdown", "--no-fail", "--help"]);
  const unknown = argv.filter((argument) => !allowed.has(argument));
  if (unknown.length) throw new Error(`Unknown argument(s): ${unknown.join(", ")}`);
  if (argv.includes("--help")) {
    process.stdout.write(usage());
    return;
  }
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const lsRemoteOutput = execFileSync("git", ["ls-remote", "--heads", "--tags", manifest.repository], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
  });
  const report = buildAuditReport({ manifest, lsRemoteOutput });
  process.stdout.write(argv.includes("--markdown") ? renderMarkdown(report) : `${JSON.stringify(report, null, 2)}\n`);
  if (!report.current && !argv.includes("--no-fail")) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`[audit-pi-upstream] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
