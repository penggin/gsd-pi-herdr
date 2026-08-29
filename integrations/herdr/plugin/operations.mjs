import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import net from "node:net";

const SCHEMA_VERSION = 1;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ACTIVE = new Set(["queued", "starting", "working", "retrying", "blocked"]);
const TERMINAL = new Set(["completed", "failed", "aborted", "orphaned"]);
const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIRECTORY_MODE = 0o700;
const STALE_AUTHORITY_MS = 30_000;

export function resolveRuntimeRoot(env = process.env) {
  const gsdHome = env.GSD_HOME?.trim() || join(homedir(), ".gsd");
  if (!isAbsolute(gsdHome)) throw new Error("GSD_HOME must be absolute");
  return resolve(gsdHome, "runtime", "herdr", "v1");
}

export function scanWorkers(runtimeRoot = resolveRuntimeRoot()) {
  if (!existsSync(runtimeRoot)) return [];
  assertPrivateDirectory(runtimeRoot, "runtime root");
  const records = [];
  for (const rootSessionId of safeDirectories(runtimeRoot)) {
    const rootDir = join(runtimeRoot, rootSessionId);
    for (const dispatchId of safeDirectories(rootDir)) {
      const dispatchDir = join(rootDir, dispatchId);
      for (const childId of safeDirectories(dispatchDir)) {
        const workerDir = join(dispatchDir, childId);
        const statePath = join(workerDir, "state.json");
        if (!existsSync(statePath)) continue;
        try {
          const state = readPrivateJson(statePath, "worker state");
          validateState(state);
          records.push({
            rootSessionId,
            dispatchId,
            childId,
            workerDir,
            statePath,
            heartbeatPath: join(workerDir, "heartbeat.json"),
            exitPath: join(workerDir, "exit.json"),
            cleanupPath: join(workerDir, "cleanup.json"),
            state,
          });
        } catch (error) {
          records.push({
            rootSessionId,
            dispatchId,
            childId,
            workerDir,
            statePath,
            heartbeatPath: join(workerDir, "heartbeat.json"),
            exitPath: join(workerDir, "exit.json"),
            cleanupPath: join(workerDir, "cleanup.json"),
            state: { schemaVersion: SCHEMA_VERSION, status: "orphaned", updatedAt: new Date(0).toISOString() },
            diagnostic: bounded(error instanceof Error ? error.message : String(error)),
          });
        }
      }
    }
  }
  return records.sort((left, right) => Date.parse(right.state.updatedAt) - Date.parse(left.state.updatedAt));
}

export async function requestHerdr(method, params = {}, env = process.env, timeoutMs = 2_000) {
  const socketPath = env.HERDR_SOCKET_PATH?.trim();
  if (env.HERDR_ENV !== "1" || !socketPath) throw new Error("Herdr plugin socket environment is unavailable");
  const endpoint = process.platform === "win32" && !socketPath.startsWith("\\\\.\\pipe\\")
    ? `\\\\.\\pipe\\${socketPath}`
    : socketPath;
  const id = `gsd-plugin:${process.pid}:${Date.now()}:${randomUUID()}`;
  return new Promise((resolvePromise, reject) => {
    let buffer = "";
    let settled = false;
    const socket = net.createConnection(endpoint);
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolvePromise(value);
    };
    const timer = setTimeout(() => finish(new Error(`Herdr ${method} timed out`)), timeoutMs);
    socket.on("error", (error) => finish(error));
    socket.on("connect", () => socket.write(`${JSON.stringify({ id, method, params })}\n`));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      while (!settled) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) break;
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let response;
        try { response = JSON.parse(line); } catch { continue; }
        if (response?.id !== id) continue;
        if (response.error) finish(new Error(`Herdr ${method} failed: ${response.error.message ?? response.error.code ?? "unknown error"}`));
        else finish(undefined, response.result);
      }
    });
    socket.on("end", () => finish(new Error(`Herdr ${method} closed without a response`)));
  });
}

export async function sessionSnapshot(env = process.env) {
  const result = await requestHerdr("session.snapshot", {}, env);
  if (result?.type !== "session_snapshot" || !result.snapshot) {
    throw new Error("Herdr session.snapshot returned an unexpected response");
  }
  return result.snapshot;
}

export function formatStatus(records, snapshot, env = process.env) {
  const workspaceId = invocationWorkspace(env);
  const scoped = workspaceId
    ? records.filter((record) => paneById(snapshot, record.state.paneId)?.workspace_id === workspaceId)
    : records;
  const counts = new Map();
  for (const record of scoped) counts.set(record.state.status, (counts.get(record.state.status) ?? 0) + 1);
  const lines = [
    "GSD Herdr workers",
    `  Herdr: ${snapshot.version ?? "unknown"} · protocol ${snapshot.protocol ?? "unknown"}`,
    `  scope: ${workspaceId ?? "all workspaces"}`,
    `  workers: ${scoped.length} · ${[...counts.entries()].map(([status, count]) => `${status}=${count}`).join(" · ") || "none"}`,
  ];
  for (const record of scoped.slice(0, 20)) {
    const pane = paneById(snapshot, record.state.paneId);
    const marker = record.diagnostic ? "!" : TERMINAL.has(record.state.status) ? "•" : "→";
    lines.push(`  ${marker} ${record.state.paneId ?? "missing-pane"} ${record.state.status} ${record.dispatchId}/${record.childId}${pane ? "" : " · pane missing"}`);
  }
  if (scoped.length > 20) lines.push(`  … ${scoped.length - 20} more`);
  return lines.join("\n");
}

export async function reconcileWorkers({ env = process.env, runtimeRoot = resolveRuntimeRoot(env), now = Date.now() } = {}) {
  const snapshot = await sessionSnapshot(env);
  const records = scanWorkers(runtimeRoot);
  let orphaned = 0;
  let released = 0;
  for (const record of records) {
    const pane = paneById(snapshot, record.state.paneId);
    const childAlive = isProcessAlive(record.state.childPid);
    if (ACTIVE.has(record.state.status) && (!pane || (record.state.childPid && !childAlive))) {
      writeWorkerState(record, {
        ...record.state,
        status: "orphaned",
        updatedAt: new Date(now).toISOString(),
        lastActivity: { kind: "error", label: !pane ? "worker pane missing during reconciliation" : "worker process missing during reconciliation" },
      });
      record.state.status = "orphaned";
      orphaned += 1;
    }
    const age = Math.max(0, now - Date.parse(record.state.updatedAt));
    const cleanupRequested = existsSync(record.cleanupPath);
    const staleTerminalAuthority = TERMINAL.has(record.state.status)
      && age >= STALE_AUTHORITY_MS
      && (pane?.agent_status === "working" || pane?.agent_status === "unknown");
    if (pane && (cleanupRequested || staleTerminalAuthority)) {
      await requestHerdr("pane.clear_agent_authority", { pane_id: pane.pane_id }, env);
      released += 1;
    }
  }
  return { snapshot, records, orphaned, released };
}

export async function focusWorkers({ env = process.env } = {}) {
  const snapshot = await sessionSnapshot(env);
  const workspaceId = invocationWorkspace(env);
  const tabs = (snapshot.tabs ?? []).filter((tab) =>
    typeof tab?.label === "string"
    && tab.label.startsWith("GSD Workers · ")
    && (!workspaceId || tab.workspace_id === workspaceId));
  if (tabs.length === 0) throw new Error("No GSD worker tab exists in the current scope");
  const tab = tabs.find((item) => item.tab_id === env.HERDR_TAB_ID) ?? tabs[0];
  await requestHerdr("tab.focus", { tab_id: tab.tab_id }, env);
  return tab.tab_id;
}

export async function focusFailedWorker({ env = process.env, runtimeRoot = resolveRuntimeRoot(env) } = {}) {
  const snapshot = await sessionSnapshot(env);
  const workspaceId = invocationWorkspace(env);
  const record = scanWorkers(runtimeRoot).find((item) => {
    if (!new Set(["failed", "orphaned", "blocked"]).has(item.state.status)) return false;
    const pane = paneById(snapshot, item.state.paneId);
    return pane && (!workspaceId || pane.workspace_id === workspaceId);
  });
  if (!record?.state.paneId) throw new Error("No failed GSD worker pane exists in the current scope");
  await requestHerdr("agent.focus", { target: record.state.paneId }, env);
  return record.state.paneId;
}

export async function cleanupRetained({ env = process.env, runtimeRoot = resolveRuntimeRoot(env), now = Date.now() } = {}) {
  const snapshot = await sessionSnapshot(env);
  const workspaceId = invocationWorkspace(env);
  const contextPane = invocationPane(env);
  const records = scanWorkers(runtimeRoot);
  const contextTargetsWorker = Boolean(contextPane && records.some((record) => record.state.paneId === contextPane));
  const cleaned = [];
  for (const record of records) {
    if (!TERMINAL.has(record.state.status)) continue;
    const pane = paneById(snapshot, record.state.paneId);
    if (!pane) continue;
    if (contextTargetsWorker && pane.pane_id !== contextPane) continue;
    if (!contextTargetsWorker && workspaceId && pane.workspace_id !== workspaceId) continue;
    if (isProcessAlive(record.state.childPid)) continue;
    writePrivateJsonAtomic(record.cleanupPath, {
      schemaVersion: SCHEMA_VERSION,
      action: "release-retained",
      requestedAt: new Date(now).toISOString(),
      paneId: pane.pane_id,
      rootSessionId: record.rootSessionId,
      dispatchId: record.dispatchId,
      childId: record.childId,
    });
    await requestHerdr("pane.clear_agent_authority", { pane_id: pane.pane_id }, env);
    cleaned.push(pane.pane_id);
  }
  return cleaned;
}

function invocationContext(env) {
  try { return JSON.parse(env.HERDR_PLUGIN_CONTEXT_JSON ?? "{}"); } catch { return {}; }
}

function invocationWorkspace(env) {
  return env.HERDR_WORKSPACE_ID?.trim() || invocationContext(env)?.workspace_id || undefined;
}

function invocationPane(env) {
  return env.HERDR_PANE_ID?.trim() || invocationContext(env)?.focused_pane_id || undefined;
}

function paneById(snapshot, paneId) {
  if (!paneId) return undefined;
  return (snapshot.panes ?? []).find((pane) => pane?.pane_id === paneId);
}

function safeDirectories(parent) {
  return readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && SAFE_ID.test(entry.name))
    .map((entry) => entry.name);
}

function assertContained(root, path, label) {
  const rel = relative(resolve(root), resolve(path));
  if (!rel || (!rel.startsWith("..") && !isAbsolute(rel))) return;
  throw new Error(`${label} escapes the GSD Herdr runtime root`);
}

function assertPrivateDirectory(path, label) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be a real directory`);
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) throw new Error(`${label} must be owner-only`);
}

function readPrivateJson(path, label) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular file`);
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) throw new Error(`${label} must be owner-only`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function validateState(state) {
  if (!state || state.schemaVersion !== SCHEMA_VERSION || !new Set([...ACTIVE, ...TERMINAL]).has(state.status)) {
    throw new Error("Invalid GSD Herdr worker state");
  }
  if (!Number.isFinite(Date.parse(state.updatedAt))) throw new Error("Invalid GSD Herdr worker timestamp");
  if (state.paneId !== undefined && typeof state.paneId !== "string") throw new Error("Invalid GSD Herdr worker pane id");
  for (const key of ["pid", "childPid"]) {
    if (state[key] !== undefined && (!Number.isSafeInteger(state[key]) || state[key] <= 0)) throw new Error(`Invalid GSD Herdr worker ${key}`);
  }
}

function writeWorkerState(record, state) {
  assertContained(record.workerDir, record.statePath, "worker state");
  writePrivateJsonAtomic(record.statePath, state);
}

function writePrivateJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  chmodSync(dirname(path), PRIVATE_DIRECTORY_MODE);
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
  const descriptor = openSync(temporary, "wx", PRIVATE_FILE_MODE);
  try { writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`); } finally { closeSync(descriptor); }
  renameSync(temporary, path);
  chmodSync(path, PRIVATE_FILE_MODE);
}

function isProcessAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === "EPERM"; }
}

function bounded(value) {
  const text = String(value).replace(/[\r\n\t]+/g, " ").trim();
  return text.length <= 160 ? text : `${text.slice(0, 159)}…`;
}

async function main() {
  const command = process.argv[2];
  if (command === "status") {
    const snapshot = await sessionSnapshot();
    process.stdout.write(`${formatStatus(scanWorkers(), snapshot)}\n`);
    return;
  }
  if (command === "reconcile") {
    const result = await reconcileWorkers();
    process.stdout.write(`GSD worker reconciliation: workers=${result.records.length} orphaned=${result.orphaned} authority_released=${result.released}\n`);
    return;
  }
  if (command === "focus-workers") {
    process.stdout.write(`Focused ${await focusWorkers()}\n`);
    return;
  }
  if (command === "focus-failed-worker") {
    process.stdout.write(`Focused ${await focusFailedWorker()}\n`);
    return;
  }
  if (command === "cleanup-retained") {
    const panes = await cleanupRetained();
    process.stdout.write(`Released ${panes.length} retained GSD worker pane(s)${panes.length ? `: ${panes.join(", ")}` : ""}\n`);
    return;
  }
  throw new Error("Usage: node operations.mjs <status|reconcile|focus-workers|focus-failed-worker|cleanup-retained>");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`[gsd-herdr-plugin] ${bounded(error instanceof Error ? error.message : String(error))}\n`);
    process.exitCode = 1;
  });
}
