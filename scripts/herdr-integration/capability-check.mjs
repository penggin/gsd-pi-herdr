import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

import { isMain, parseArgs, parseJsonFileText, repositoryRoot, run, writeJsonAtomic } from "./shared.mjs";

export const REQUIRED_METHODS = [
  "tab.create",
  "pane.split",
  "pane.get",
  "pane.list",
  "pane.process_info",
  "pane.read",
  "pane.send_keys",
  "pane.report_agent",
  "pane.report_agent_session",
  "pane.report_metadata",
  "pane.release_agent",
  "notification.show",
  "pane.close",
  "session.snapshot",
];

export function collectMethodConstants(value, methods = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectMethodConstants(item, methods);
  } else if (value && typeof value === "object") {
    if (typeof value.method?.const === "string") methods.add(value.method.const);
    for (const item of Object.values(value)) collectMethodConstants(item, methods);
  }
  return methods;
}

function parseVersion(output) {
  const match = output.trim().match(/(?:^|\s)v?(\d+\.\d+\.\d+)(?:[-+][^\s]+)?(?:\s|$)/);
  if (!match) throw new Error(`Unable to parse Herdr version from: ${output.trim()}`);
  return match[1];
}

function compareVersions(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

export function evaluateCapabilities({ version, protocol, schemaVersion, methods, paneRunHelp, pluginLinkHelp, pluginMinVersion, matrix, mode = "supported" }) {
  if (!new Set(["supported", "canary"]).has(mode)) throw new Error(`Unknown Herdr capability mode: ${mode}`);
  const supported = matrix.supported;
  const missingMethods = REQUIRED_METHODS.filter((method) => !methods.has(method));
  const checks = {
    version: mode === "supported" ? version === supported.version : compareVersions(version, matrix.minimumVersion) >= 0,
    protocol: mode === "supported" ? protocol === supported.protocol : protocol >= matrix.minimumProtocol,
    schema: Number.isInteger(schemaVersion) && schemaVersion >= 1,
    requiredMethods: missingMethods.length === 0,
    paneRun: /Run a command in a pane|pane run/i.test(paneRunHelp),
    pluginLink: /Link a local plugin|plugin link/i.test(pluginLinkHelp),
    pluginManifest: typeof pluginMinVersion === "string" && compareVersions(version, pluginMinVersion) >= 0,
  };
  return { checks, missingMethods, compatible: Object.values(checks).every(Boolean) };
}

export function inspectHerdrCapabilities({
  binary = process.env.HERDR_BIN_PATH || "herdr",
  mode = "supported",
  matrixPath = resolve(repositoryRoot, "integrations/herdr/compatibility.json"),
  pluginManifestPath = resolve(repositoryRoot, "integrations/herdr/plugin/herdr-plugin.toml"),
} = {}) {
  const matrix = parseJsonFileText(readFileSync(matrixPath, "utf8"), "Herdr compatibility matrix");
  const versionResult = run(binary, ["--version"]);
  const version = parseVersion(`${versionResult.stdout}\n${versionResult.stderr}`);
  const schemaText = run(binary, ["api", "schema", "--json"]).stdout;
  const schema = parseJsonFileText(schemaText, "Herdr API schema");
  const methods = collectMethodConstants(schema);
  const paneRunResult = run(binary, ["pane", "run", "--help"]);
  const pluginLinkResult = run(binary, ["plugin", "link", "--help"]);
  const paneRunHelp = `${paneRunResult.stdout}\n${paneRunResult.stderr}`;
  const pluginLinkHelp = `${pluginLinkResult.stdout}\n${pluginLinkResult.stderr}`;
  const pluginManifest = readFileSync(pluginManifestPath, "utf8");
  const pluginMinVersion = pluginManifest.match(/^min_herdr_version\s*=\s*"([^"]+)"/m)?.[1];
  const evaluation = evaluateCapabilities({
    version,
    protocol: schema.protocol,
    schemaVersion: schema.schema_version,
    methods,
    paneRunHelp,
    pluginLinkHelp,
    pluginMinVersion,
    matrix,
    mode,
  });
  return {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    mode,
    binary,
    version,
    protocol: schema.protocol,
    apiSchemaVersion: schema.schema_version,
    apiSchemaSha256: createHash("sha256").update(schemaText).digest("hex"),
    pluginMinVersion,
    methodCount: methods.size,
    requiredMethods: REQUIRED_METHODS,
    ...evaluation,
  };
}

if (isMain(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const report = inspectHerdrCapabilities({
      binary: args.binary,
      mode: args.mode ?? "supported",
      matrixPath: args.matrix,
      pluginManifestPath: args.plugin,
    });
    if (args.output) writeJsonAtomic(args.output, report);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.compatible) process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`[herdr-capability-check] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
