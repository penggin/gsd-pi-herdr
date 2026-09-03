import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

import { isMain, parseArgs, parseJsonFileText, writeJsonAtomic } from "./shared.mjs";

export const P3_V4_MARKERS = Object.freeze({
  single: "P3V4_SINGLE_OK",
  affinityOne: "P3V4_AFFINITY_ONE",
  affinityTwo: "P3V4_AFFINITY_TWO",
  parallel: Object.freeze(Array.from({ length: 5 }, (_, index) => `P3V4_PARALLEL_${index + 1}`)),
  afterPaneLoss: "P3V4_AFTER_PANE_LOSS_OK",
  afterRestart: "P3V4_AFTER_RESTART_OK",
});

const ALL_SUCCESS_MARKERS = Object.freeze([
  P3_V4_MARKERS.single,
  P3_V4_MARKERS.affinityOne,
  P3_V4_MARKERS.affinityTwo,
  ...P3_V4_MARKERS.parallel,
  P3_V4_MARKERS.afterPaneLoss,
  P3_V4_MARKERS.afterRestart,
]);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIRECTORY_MODE = 0o700;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_TAIL_BYTES = 16 * 1024 * 1024;
const MAX_TAIL_LINES = 50_000;
const MAX_SIGNAL_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_PANE_CAPTURE_BYTES = 1024 * 1024;
const MAX_DIRECTORY_COUNT = 128;
const MAX_WORKER_COUNT = 64;
const MAX_PANE_READS = 8;
const RAW_PANE_PATTERNS = [
  /"type"\s*:\s*"message_update"/,
  /"type"\s*:\s*"agent_end"/,
  /"usage"\s*:\s*\{/,
  /"cacheRead"\s*:/,
  /"toolCallId"\s*:/,
];

export function herdrRootRuntimeId(rootSessionId) {
  if (typeof rootSessionId !== "string" || !rootSessionId.trim()) throw new Error("Root session id is required");
  return `root-${createHash("sha256").update(rootSessionId).digest("hex").slice(0, 20)}`;
}

export function evaluateP3V4WorkerMatrix({ workers, rootAssistantText, finalSnapshot, paneReads = [] }) {
  const errors = [];
  const snapshot = snapshotValue(finalSnapshot);
  if (snapshot?.version !== "0.8.2" || snapshot?.protocol !== 20 || !Array.isArray(snapshot?.panes)) {
    errors.push("Final Herdr snapshot must be v0.8.2/protocol 20 with a pane list");
  }
  const markerWorkers = new Map();
  for (const marker of ALL_SUCCESS_MARKERS) {
    const matches = workers.filter((worker) => worker.assistantText.includes(marker));
    if (matches.length !== 1) errors.push(`Marker ${marker} must appear in exactly one worker final response (found ${matches.length})`);
    else markerWorkers.set(marker, matches[0]);
    if (!rootAssistantText.includes(marker)) errors.push(`Root v4 session is missing assistant acknowledgement for ${marker}`);
  }

  for (const [marker, worker] of markerWorkers) {
    if (!worker.exit || worker.exit.exitCode !== 0 || worker.exit.aborted !== false) {
      errors.push(`Successful marker ${marker} does not have exitCode=0 and aborted=false`);
    }
    if (worker.state.status !== "completed") errors.push(`Successful marker ${marker} has state ${worker.state.status}`);
    if (worker.ownership.status !== "settled") errors.push(`Successful marker ${marker} has ownership ${worker.ownership.status}`);
    if (!(worker.usageTotalTokens > 0)) errors.push(`Successful marker ${marker} has no positive common child usage evidence`);
  }

  const affinityOne = markerWorkers.get(P3_V4_MARKERS.affinityOne);
  const affinityTwo = markerWorkers.get(P3_V4_MARKERS.affinityTwo);
  if (affinityOne && affinityTwo) {
    if (affinityOne.ownership.paneId !== affinityTwo.ownership.paneId) errors.push("Affinity chain did not reuse the same pane");
    if (affinityOne.ownership.affinityKey !== affinityTwo.ownership.affinityKey) errors.push("Affinity chain did not reuse the same affinity key");
    if (affinityTwo.launchMtimeMs < Date.parse(affinityOne.exit.completedAt)) {
      errors.push("Affinity step two launched before step one published final exit evidence");
    }
  }

  const parallelWorkers = P3_V4_MARKERS.parallel.map((marker) => markerWorkers.get(marker)).filter(Boolean);
  if (parallelWorkers.length === P3_V4_MARKERS.parallel.length) {
    const dispatches = new Set(parallelWorkers.map((worker) => worker.dispatchId));
    if (dispatches.size !== 1) errors.push("Parallel markers do not belong to one public dispatch");
    const panes = new Set(parallelWorkers.map((worker) => worker.ownership.paneId));
    if (panes.size !== 4) errors.push(`Five-way parallel dispatch must use exactly four panes (found ${panes.size})`);
    const ordered = [...parallelWorkers].sort((left, right) => left.launchMtimeMs - right.launchMtimeMs);
    const firstCompletion = Math.min(...ordered.slice(0, 4).map((worker) => Date.parse(worker.exit.completedAt)));
    if (ordered[4].launchMtimeMs < firstCompletion) errors.push("Fifth parallel worker launched before any of the first four slots settled");
  }

  const aborted = workers.filter(
    (worker) => worker.exit?.aborted === true && worker.state.status === "aborted" && worker.ownership.status === "settled",
  );
  if (aborted.length < 1) errors.push("No canonical aborted worker artifact was found");
  if (!rootAssistantText.includes("Subagent was aborted")) errors.push("Root v4 session is missing canonical Subagent was aborted semantics");

  const livePaneIds = new Set(snapshot?.panes?.map((pane) => pane?.pane_id).filter(Boolean) ?? []);
  const paneLoss = workers.filter(
    (worker) => !worker.exit && worker.state.paneId && !livePaneIds.has(worker.state.paneId),
  );
  if (paneLoss.length < 1) errors.push("No missing-exit worker correlated with a missing final Herdr pane was found");
  if (!/Herdr worker pane disappeared before final exit evidence was produced/.test(rootAssistantText)) {
    errors.push("Root v4 session is missing the explicit pane-loss runtime error");
  }

  const expectedPaneReads = new Set(
    workers
      .filter((worker) => worker.exit?.exitCode === 0 && livePaneIds.has(worker.ownership.paneId))
      .map((worker) => worker.ownership.paneId),
  );
  const capturedPaneIds = new Set(paneReads.map((item) => item.paneId));
  for (const paneId of expectedPaneReads) {
    if (!capturedPaneIds.has(paneId)) errors.push(`Missing bounded pane-output capture for live worker pane ${paneId}`);
  }
  for (const paneRead of paneReads) {
    if (!paneRead.text.includes("working")) errors.push(`Pane capture ${paneRead.paneId} does not contain bounded working activity`);
    for (const pattern of RAW_PANE_PATTERNS) {
      if (pattern.test(paneRead.text)) errors.push(`Pane capture ${paneRead.paneId} contains forbidden raw JSON/event output`);
    }
  }

  return {
    ready: errors.length === 0,
    errors,
    counts: {
      workers: workers.length,
      successfulMarkers: markerWorkers.size,
      aborted: aborted.length,
      paneLoss: paneLoss.length,
      parallelPanes: new Set(parallelWorkers.map((worker) => worker.ownership.paneId)).size,
      paneReads: paneReads.length,
    },
  };
}

export function auditSessionV4LiveEvidence(manifest) {
  validateManifest(manifest);
  const sessionPath = resolve(manifest.rootSessionFile);
  const session = readV4SessionEvidence(sessionPath);
  const runtimeRoot = resolve(manifest.gsdHome, "runtime", "herdr", "v1");
  const rootRuntimeId = herdrRootRuntimeId(session.header.id);
  const rootDir = resolve(runtimeRoot, rootRuntimeId);
  assertContained(runtimeRoot, rootDir, "root runtime directory");
  assertPrivateDirectory(runtimeRoot, "Herdr runtime root");
  assertPrivateDirectory(rootDir, "Herdr root directory");
  const rootRecord = readPrivateJson(join(rootDir, "root.json"), "root record");
  if (rootRecord.schemaVersion !== 1 || rootRecord.rootRuntimeId !== rootRuntimeId || rootRecord.rootSessionId !== session.header.id) {
    throw new Error("Root runtime record does not match the v4 session header");
  }
  const workers = readWorkers(rootDir, rootRuntimeId);
  const finalSnapshot = readJsonFileBounded(resolve(manifest.finalSnapshotFile), "final Herdr snapshot");
  const paneReads = manifest.paneReads.map((item) => ({
    paneId: item.paneId,
    text: readPrivateText(resolve(item.path), `pane capture ${item.paneId}`, MAX_PANE_CAPTURE_BYTES),
  }));
  const evaluation = evaluateP3V4WorkerMatrix({
    workers,
    rootAssistantText: session.assistantText,
    finalSnapshot,
    paneReads,
  });
  return {
    schemaVersion: 1,
    auditedAt: new Date().toISOString(),
    ...evaluation,
    root: {
      sessionId: session.header.id,
      runtimeId: rootRuntimeId,
      paneId: rootRecord.paneId,
      status: rootRecord.status,
      backend: "harness-v4",
    },
    workers: workers.map((worker) => ({
      dispatchId: worker.dispatchId,
      childId: worker.childId,
      paneId: worker.ownership.paneId,
      affinityKeyHash: createHash("sha256").update(worker.ownership.affinityKey).digest("hex").slice(0, 12),
      state: worker.state.status,
      ownership: worker.ownership.status,
      exitCode: worker.exit?.exitCode,
      aborted: worker.exit?.aborted,
      usagePresent: worker.usageTotalTokens > 0,
      markers: ALL_SUCCESS_MARKERS.filter((marker) => worker.assistantText.includes(marker)),
    })),
  };
}

function validateManifest(manifest) {
  if (!manifest || manifest.schemaVersion !== 1) throw new Error("Unsupported P3.7 live evidence manifest schema");
  for (const key of ["gsdHome", "rootSessionFile", "finalSnapshotFile"]) {
    if (typeof manifest[key] !== "string" || !isAbsolute(manifest[key])) throw new Error(`${key} must be an absolute path`);
  }
  if (!Array.isArray(manifest.paneReads)) throw new Error("paneReads must be an array");
  if (manifest.paneReads.length > MAX_PANE_READS) throw new Error(`paneReads exceeds ${MAX_PANE_READS} captures`);
  const paneIds = new Set();
  for (const item of manifest.paneReads) {
    if (!item || typeof item.paneId !== "string" || typeof item.path !== "string" || !isAbsolute(item.path)) {
      throw new Error("Each paneReads item requires a paneId and absolute path");
    }
    if (paneIds.has(item.paneId)) throw new Error(`Duplicate paneReads paneId: ${item.paneId}`);
    paneIds.add(item.paneId);
  }
}

function readV4SessionEvidence(path) {
  assertPrivateFile(path, "root v4 session");
  const lines = readJsonlTail(path, MAX_TAIL_BYTES);
  const firstLine = readFirstLine(path, MAX_JSON_BYTES);
  const header = parseJsonFileText(firstLine, "root v4 session header");
  if (header?.kind !== "header" || header?.version !== 4 || typeof header?.id !== "string" || !header.id) {
    throw new Error("Root session is not a version-4 harness session");
  }
  return { header, assistantText: collectAssistantText(lines) };
}

function readWorkers(rootDir, rootRuntimeId) {
  const workers = [];
  for (const dispatchId of safeDirectories(rootDir)) {
    const dispatchDir = join(rootDir, dispatchId);
    for (const childId of safeDirectories(dispatchDir)) {
      const workerDir = join(dispatchDir, childId);
      assertPrivateDirectory(workerDir, "worker directory");
      const launchPath = join(workerDir, "launch.json");
      const statePath = join(workerDir, "state.json");
      const ownershipPath = join(workerDir, "ownership.json");
      const stdoutPath = join(workerDir, "stdout.jsonl");
      const stderrPath = join(workerDir, "stderr.log");
      const heartbeatPath = join(workerDir, "heartbeat.json");
      for (const [path, label] of [
        [launchPath, "launch artifact"],
        [statePath, "state artifact"],
        [ownershipPath, "ownership artifact"],
        [heartbeatPath, "heartbeat artifact"],
        [stdoutPath, "stdout artifact"],
        [stderrPath, "stderr artifact"],
      ]) assertPrivateFile(path, label);
      if (existsSync(join(workerDir, "env.json"))) throw new Error(`Worker ${dispatchId}/${childId} retained one-time env.json`);
      const launch = readPrivateJson(launchPath, "launch artifact");
      const state = readPrivateJson(statePath, "state artifact");
      const ownership = readPrivateJson(ownershipPath, "ownership artifact");
      for (const value of [launch, ownership]) {
        if (value.rootSessionId !== rootRuntimeId || value.dispatchId !== dispatchId || value.childId !== childId) {
          throw new Error(`Worker identity does not match artifact path ${dispatchId}/${childId}`);
        }
      }
      if (state.schemaVersion !== 1 || typeof state.status !== "string") throw new Error(`Invalid worker state ${dispatchId}/${childId}`);
      if (ownership.schemaVersion !== 1 || typeof ownership.paneId !== "string" || typeof ownership.affinityKey !== "string") {
        throw new Error(`Invalid worker ownership ${dispatchId}/${childId}`);
      }
      const exitPath = join(workerDir, "exit.json");
      const exit = existsSync(exitPath) ? readPrivateJson(exitPath, "exit artifact") : undefined;
      if (exit && (exit.schemaVersion !== 1 || !Number.isInteger(exit.exitCode) || typeof exit.aborted !== "boolean" || !Number.isFinite(Date.parse(exit.completedAt)))) {
        throw new Error(`Invalid worker exit ${dispatchId}/${childId}`);
      }
      const events = readJsonlTail(stdoutPath, MAX_TAIL_BYTES);
      workers.push({
        dispatchId,
        childId,
        workerDir,
        launchMtimeMs: lstatSync(launchPath).mtimeMs,
        launch,
        state,
        ownership,
        exit,
        assistantText: collectAssistantText(events),
        usageTotalTokens: collectUsageTotal(events),
      });
      if (workers.length > MAX_WORKER_COUNT) throw new Error(`Worker evidence exceeds ${MAX_WORKER_COUNT} records`);
    }
  }
  if (workers.length === 0) throw new Error("No Herdr worker artifacts exist for the v4 root session");
  return workers;
}

function collectAssistantText(values) {
  const text = [];
  for (const value of values) {
    const message = value?.kind === "entry" && value?.type === "message" ? value.message : value?.message;
    if (message?.role !== "assistant") continue;
    collectTextParts(message.content, text);
  }
  const combined = text.join("\n");
  return combined.length > MAX_SIGNAL_TEXT_BYTES ? combined.slice(-MAX_SIGNAL_TEXT_BYTES) : combined;
}

function collectTextParts(value, output) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) for (const item of value) collectTextParts(item, output);
  else if (value && typeof value === "object" && typeof value.text === "string") output.push(value.text);
}

function collectUsageTotal(values) {
  let total = 0;
  for (const value of values) {
    const usage = value?.usage ?? value?.message?.usage;
    const candidate = usage?.totalTokens ?? ((usage?.input ?? 0) + (usage?.output ?? 0) + (usage?.cacheRead ?? 0) + (usage?.cacheWrite ?? 0));
    if (Number.isFinite(candidate)) total = Math.max(total, candidate);
  }
  return total;
}

function snapshotValue(value) {
  return value?.result?.snapshot ?? value?.snapshot ?? value?.result?.result?.snapshot ?? value;
}

function safeDirectories(parent) {
  assertPrivateDirectory(parent, "artifact directory");
  const result = [];
  for (const entry of readdirSync(parent, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error(`Artifact directory contains a symbolic link: ${entry.name}`);
    if (!entry.isDirectory()) continue;
    if (!SAFE_ID.test(entry.name)) throw new Error(`Artifact directory contains an unsafe identifier: ${entry.name}`);
    result.push(entry.name);
  }
  if (result.length > MAX_DIRECTORY_COUNT) throw new Error(`Artifact directory exceeds ${MAX_DIRECTORY_COUNT} child directories`);
  return result;
}

function readJsonlTail(path, maximumBytes) {
  const descriptor = openSync(path, "r");
  try {
    const stat = fstatSync(descriptor);
    const start = Math.max(0, stat.size - maximumBytes);
    const buffer = Buffer.alloc(stat.size - start);
    readSync(descriptor, buffer, 0, buffer.length, start);
    let text = buffer.toString("utf8");
    if (start > 0) text = text.slice(Math.max(0, text.indexOf("\n") + 1));
    const lines = text.split("\n").filter(Boolean);
    if (lines.length > MAX_TAIL_LINES) throw new Error(`${basename(path)} tail exceeds ${MAX_TAIL_LINES} records`);
    return lines.map((line, index) => parseJsonFileText(line, `${basename(path)} tail line ${index + 1}`));
  } finally {
    closeSync(descriptor);
  }
}

function readFirstLine(path, maximumBytes) {
  const descriptor = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(maximumBytes);
    const count = readSync(descriptor, buffer, 0, buffer.length, 0);
    const text = buffer.subarray(0, count).toString("utf8");
    const newline = text.indexOf("\n");
    if (newline < 0) throw new Error(`${basename(path)} header exceeds ${maximumBytes} bytes or has no newline`);
    return text.slice(0, newline);
  } finally {
    closeSync(descriptor);
  }
}

function readPrivateJson(path, label) {
  return parseJsonFileText(readPrivateText(path, label, MAX_JSON_BYTES), label);
}

function readJsonFileBounded(path, label) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular file`);
  if (stat.size > MAX_TAIL_BYTES) throw new Error(`${label} exceeds ${MAX_TAIL_BYTES} bytes`);
  return parseJsonFileText(readFileSync(path, "utf8"), label);
}

function readPrivateText(path, label, maximumBytes) {
  assertPrivateFile(path, label);
  const stat = lstatSync(path);
  if (stat.size > maximumBytes) throw new Error(`${label} exceeds ${maximumBytes} bytes`);
  return readFileSync(path, "utf8");
}

function assertPrivateFile(path, label) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular file`);
  if (process.platform !== "win32" && (stat.mode & 0o777) !== PRIVATE_FILE_MODE) throw new Error(`${label} must have mode 0600`);
}

function assertPrivateDirectory(path, label) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be a real directory`);
  if (process.platform !== "win32" && (stat.mode & 0o777) !== PRIVATE_DIRECTORY_MODE) throw new Error(`${label} must have mode 0700`);
}

function assertContained(root, path, label) {
  const rel = relative(resolve(root), resolve(path));
  if (rel && (rel.startsWith("..") || isAbsolute(rel))) throw new Error(`${label} escapes its runtime root`);
}

if (isMain(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (typeof args.manifest !== "string") throw new Error("Usage: --manifest /absolute/path/to/manifest.json [--output /absolute/path]");
    const manifest = readJsonFileBounded(resolve(args.manifest), "P3.7 evidence manifest");
    const report = auditSessionV4LiveEvidence(manifest);
    if (args.output) writeJsonAtomic(args.output, report);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ready) process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`[herdr-session-v4-live-audit] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
