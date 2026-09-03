import { resolve } from "node:path";

import { inspectHerdrCapabilities } from "./capability-check.mjs";
import { isMain, parseArgs, parseJsonFileText, repositoryRoot, run, writeJsonAtomic } from "./shared.mjs";

export const REQUIRED_HERDR_ENVIRONMENT = [
  "HERDR_ENV",
  "HERDR_SOCKET_PATH",
  "HERDR_BIN_PATH",
  "HERDR_WORKSPACE_ID",
  "HERDR_TAB_ID",
  "HERDR_PANE_ID",
];

export function evaluateSessionV4LiveEnvironment(environment) {
  const missingEnvironment = REQUIRED_HERDR_ENVIRONMENT.filter((name) => {
    const value = environment[name];
    return typeof value !== "string" || value.trim().length === 0;
  });
  const errors = [];
  if (environment.HERDR_ENV !== "1") {
    errors.push("P3.7 must run from an actual Herdr-managed pane (HERDR_ENV=1)");
  }
  if (missingEnvironment.length > 0) {
    errors.push(`Missing Herdr pane environment: ${missingEnvironment.join(", ")}`);
  }
  if (environment.GSD_INTERNAL_SESSION_BACKEND !== "harness-v4") {
    errors.push("GSD_INTERNAL_SESSION_BACKEND must be exactly harness-v4");
  }
  if (environment.GSD_SUBAGENT_CHILD === "1") {
    errors.push("P3.7 root validation cannot run from a GSD subagent child");
  }
  return { ready: errors.length === 0, errors, missingEnvironment };
}

export function extractCurrentPaneId(response) {
  const candidates = [
    response?.result?.pane?.pane_id,
    response?.result?.pane_id,
    response?.pane?.pane_id,
    response?.pane_id,
  ];
  return candidates.find((value) => typeof value === "string" && value.length > 0);
}

export function evaluateSessionV4LivePreflight({ environment, currentPaneId, capabilities, buildInfo }) {
  const base = evaluateSessionV4LiveEnvironment(environment);
  const errors = [...base.errors];
  const warnings = [];
  if (base.ready && currentPaneId !== environment.HERDR_PANE_ID) {
    errors.push(
      `Herdr current pane ${currentPaneId ?? "<missing>"} does not match inherited HERDR_PANE_ID ${environment.HERDR_PANE_ID}`,
    );
  }
  if (!capabilities?.compatible) errors.push("Pinned Herdr capability contract did not pass");
  if (capabilities?.version !== "0.8.2" || capabilities?.protocol !== 20) {
    errors.push(
      `P3.7 requires pinned Herdr 0.8.2/protocol 20, received ${capabilities?.version ?? "unknown"}/${capabilities?.protocol ?? "unknown"}`,
    );
  }
  if (buildInfo?.package !== "@penggin/gsd-pi-herdr" || buildInfo?.herdrIntegration !== true) {
    errors.push("Selected GSD executable is not an identified Herdr-integrated downstream build");
  }
  if (buildInfo?.releaseMetadata?.downstream?.dirty === true) {
    warnings.push("GSD build metadata is dirty; evidence cannot be promoted as a release candidate");
  }
  if (buildInfo?.releaseMetadata?.herdr?.capabilityVerified !== true) {
    warnings.push("Embedded release metadata is not capability-stamped; this live preflight is the current capability evidence");
  }
  return {
    ready: errors.length === 0,
    errors,
    warnings,
    missingEnvironment: base.missingEnvironment,
  };
}

export function runSessionV4LivePreflight({
  environment = process.env,
  gsdBinary = resolve(repositoryRoot, "dist/bootstrap.js"),
  herdrBinary = environment.HERDR_BIN_PATH || "herdr",
  output,
} = {}) {
  const environmentResult = evaluateSessionV4LiveEnvironment(environment);
  if (!environmentResult.ready) {
    const report = {
      schemaVersion: 1,
      checkedAt: new Date().toISOString(),
      ready: false,
      phase: "environment",
      errors: environmentResult.errors,
      warnings: [],
      missingEnvironment: environmentResult.missingEnvironment,
    };
    if (output) writeJsonAtomic(output, report);
    return report;
  }

  const capabilities = inspectHerdrCapabilities({ binary: herdrBinary, mode: "supported", env: environment });
  const paneResponse = parseJsonFileText(
    run(herdrBinary, ["pane", "current", "--current"], { env: environment }).stdout,
    "Herdr current pane response",
  );
  const currentPaneId = extractCurrentPaneId(paneResponse);
  const buildInfo = parseJsonFileText(
    run(process.execPath, [gsdBinary, "--build-info"], { env: environment }).stdout,
    "GSD build info",
  );
  const evaluation = evaluateSessionV4LivePreflight({
    environment,
    currentPaneId,
    capabilities,
    buildInfo,
  });
  const report = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    phase: "preflight",
    ...evaluation,
    root: {
      workspaceId: environment.HERDR_WORKSPACE_ID,
      tabId: environment.HERDR_TAB_ID,
      paneId: environment.HERDR_PANE_ID,
      currentPaneId,
      sessionBackend: environment.GSD_INTERNAL_SESSION_BACKEND,
    },
    capabilities,
    build: {
      package: buildInfo.package,
      version: buildInfo.version,
      commit: buildInfo.releaseMetadata?.downstream?.commit,
      dirty: buildInfo.releaseMetadata?.downstream?.dirty,
      buildKind: buildInfo.releaseMetadata?.downstream?.buildKind,
      capabilityVerified: buildInfo.releaseMetadata?.herdr?.capabilityVerified,
    },
  };
  if (output) writeJsonAtomic(output, report);
  return report;
}

if (isMain(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const report = runSessionV4LivePreflight({
      gsdBinary: args.gsd ? resolve(args.gsd) : undefined,
      herdrBinary: args.herdr,
      output: args.output,
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ready) process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`[herdr-session-v4-live-preflight] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
