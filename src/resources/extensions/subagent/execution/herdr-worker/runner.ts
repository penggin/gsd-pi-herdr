import {
  closeSync,
  constants as fsConstants,
  fsyncSync,
  openSync,
  writeSync,
} from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import type {
  HerdrWorkerActivityV1,
  HerdrWorkerArtifactPaths,
  HerdrWorkerLaunchSpecV1,
  HerdrWorkerStatus,
} from "./artifacts.js";
import {
  HERDR_WORKER_SCHEMA_VERSION,
  readHerdrWorkerEnvAndDelete,
  writeHerdrWorkerExit,
  writeHerdrWorkerHeartbeat,
  writeHerdrWorkerState,
} from "./artifacts.js";
import { HerdrWorkerActivityRenderer } from "./activity.js";
import { HerdrWorkerReporter } from "./herdr-reporting.js";
import { JsonlLineFramer } from "./jsonl.js";

const DEFAULT_HEARTBEAT_MS = 5000;
const DEFAULT_INTERRUPT_GRACE_MS = 5000;
const DEFAULT_TERMINATE_GRACE_MS = 5000;

const HERDR_IDENTITY_ENV_KEYS = [
  "HERDR_ENV",
  "HERDR_SOCKET_PATH",
  "HERDR_BIN_PATH",
  "HERDR_WORKSPACE_ID",
  "HERDR_TAB_ID",
  "HERDR_PANE_ID",
] as const;

export interface WorkerReporterLike {
  initialize(): Promise<void>;
  reportStatus(status: HerdrWorkerStatus, message?: string): Promise<void>;
  reportFinal(status: "completed" | "failed" | "aborted"): Promise<void>;
}

export interface RunHerdrWorkerOptions {
  hostEnv?: NodeJS.ProcessEnv;
  onJsonlLine?: (line: string) => void;
  activityWrite?: (text: string) => void;
  reporter?: WorkerReporterLike;
  now?: () => Date;
  heartbeatMs?: number;
  interruptGraceMs?: number;
  terminateGraceMs?: number;
}

export interface HerdrWorkerTerminationOptions {
  interruptGraceMs?: number;
  terminateGraceMs?: number;
  platform?: NodeJS.Platform;
  sendSignal?: (pid: number, signal: NodeJS.Signals) => void;
  killWindowsTree?: (pid: number) => Promise<void>;
  wait?: (ms: number) => Promise<void>;
}

export async function runHerdrWorker(
  spec: HerdrWorkerLaunchSpecV1,
  paths: HerdrWorkerArtifactPaths,
  options: RunHerdrWorkerOptions = {},
): Promise<number> {
  const now = options.now ?? (() => new Date());
  const hostEnv = options.hostEnv ?? process.env;
  const launchEnv = readHerdrWorkerEnvAndDelete(spec.envPath, paths.workerDir);
  const childEnv = buildHerdrWorkerChildEnv(launchEnv, hostEnv);
  const stdoutFd = openPrivateOutput(paths.stdoutPath);
  let stderrFd: number;
  try {
    stderrFd = openPrivateOutput(paths.stderrPath);
  } catch (error) {
    syncAndClose(stdoutFd);
    throw error;
  }
  const reporter = options.reporter ?? new HerdrWorkerReporter(spec, { env: hostEnv });
  const renderer = new HerdrWorkerActivityRenderer({ write: options.activityWrite });

  let currentStatus: HerdrWorkerStatus = "starting";
  let lastActivity: HerdrWorkerActivityV1 | undefined;
  let childPid: number | undefined;
  let receivedSignal: NodeJS.Signals | null = null;
  let childClosed = false;
  let cancellationPromise: Promise<void> | undefined;

  const writeRuntimeArtifacts = (status = currentStatus, activity = lastActivity) => {
    currentStatus = status;
    lastActivity = activity;
    const updatedAt = now().toISOString();
    writeHerdrWorkerState(paths, {
      schemaVersion: HERDR_WORKER_SCHEMA_VERSION,
      status,
      updatedAt,
      pid: process.pid,
      ...(childPid ? { childPid } : {}),
      ...(hostEnv.HERDR_PANE_ID ? { paneId: hostEnv.HERDR_PANE_ID } : {}),
      ...(activity ? { lastActivity: activity } : {}),
    });
    writeHerdrWorkerHeartbeat(paths, {
      schemaVersion: HERDR_WORKER_SCHEMA_VERSION,
      status,
      updatedAt,
      pid: process.pid,
      ...(childPid ? { childPid } : {}),
    });
  };

  const consumeJsonlLine = (line: string) => {
    options.onJsonlLine?.(line);
    const projected = renderer.consumeLine(line);
    if (projected) {
      const nextStatus = projected.status ?? currentStatus;
      writeRuntimeArtifacts(nextStatus, projected.activity);
      if (projected.status) {
        void safeReporterCall(() => reporter.reportStatus(nextStatus, projected.activity.label));
      }
    }
  };
  const framer = new JsonlLineFramer({ onLine: consumeJsonlLine });

  writeRuntimeArtifacts("starting");
  await safeReporterCall(() => reporter.initialize());
  await safeReporterCall(() => reporter.reportStatus("starting", spec.taskPreview ?? "starting"));

  const heartbeatMs = boundedPositiveMs(options.heartbeatMs, DEFAULT_HEARTBEAT_MS);
  const heartbeatTimer = setInterval(() => {
    try {
      const updatedAt = now().toISOString();
      writeHerdrWorkerHeartbeat(paths, {
        schemaVersion: HERDR_WORKER_SCHEMA_VERSION,
        status: currentStatus,
        updatedAt,
        pid: process.pid,
        ...(childPid ? { childPid } : {}),
      });
    } catch {
      // A heartbeat write failure must not kill the worker's real child. State
      // reconciliation can classify the missing heartbeat later.
    }
  }, heartbeatMs);
  heartbeatTimer.unref?.();

  let childExitCode = 1;
  let childSignal: NodeJS.Signals | null = null;
  let closePromise: Promise<{ code: number; signal: NodeJS.Signals | null }> | undefined;
  let child: ChildProcess | undefined;

  const beginCancellation = () => {
    if (!receivedSignal || !child?.pid || childClosed || cancellationPromise) return;
    cancellationPromise = terminateHerdrWorkerProcessGroup(
      child.pid,
      () => childClosed,
      {
        interruptGraceMs: options.interruptGraceMs,
        terminateGraceMs: options.terminateGraceMs,
      },
    );
  };
  const requestCancellation = (signal: NodeJS.Signals) => {
    if (receivedSignal) return;
    receivedSignal = signal;
    lastActivity = { kind: "status", label: `cancelling after ${signal}` };
    writeRuntimeArtifacts(currentStatus, lastActivity);
    beginCancellation();
  };
  const onSigint = () => requestCancellation("SIGINT");
  const onSigterm = () => requestCancellation("SIGTERM");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  try {
    closePromise = new Promise((resolveClose) => {
      let settled = false;
      const finish = (code: number, signal: NodeJS.Signals | null) => {
        if (settled) return;
        settled = true;
        childClosed = true;
        resolveClose({ code, signal });
      };

      child = spawn(spec.executable, spec.args, {
        cwd: spec.cwd,
        env: childEnv,
        shell: false,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
      childPid = child.pid;
      if (receivedSignal) beginCancellation();

      child.once("spawn", () => {
        if (!receivedSignal) {
          writeRuntimeArtifacts("working");
          void safeReporterCall(() => reporter.reportStatus("working", spec.taskPreview ?? "working"));
        }
      });
      child.stdout?.on("data", (chunk: Buffer) => {
        writeSync(stdoutFd, chunk);
        framer.push(chunk);
      });
      child.stderr?.on("data", (chunk: Buffer) => writeSync(stderrFd, chunk));
      child.once("error", (error) => {
        try { writeSync(stderrFd, Buffer.from(`[gsd-herdr-worker] spawn error: ${error.message}\n`)); } catch { /* best effort */ }
        finish(1, null);
      });
      child.once("close", (code, signal) => finish(code ?? 1, signal));
    });

    const result = await closePromise;
    childExitCode = result.code;
    childSignal = result.signal;
    if (cancellationPromise) await cancellationPromise;
    framer.end();
  } finally {
    clearInterval(heartbeatTimer);
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    syncAndClose(stdoutFd);
    syncAndClose(stderrFd);
  }

  const aborted = receivedSignal !== null;
  const finalStatus: "completed" | "failed" | "aborted" = aborted
    ? "aborted"
    : childExitCode === 0
      ? "completed"
      : "failed";
  writeRuntimeArtifacts(finalStatus, lastActivity);
  // Exit evidence is the backend's release/reuse boundary. Publish it only
  // after the final Herdr lifecycle/metadata report has settled so a reusable
  // pane cannot start a replacement worker while the previous source is still
  // finishing its visibility updates.
  await safeReporterCall(() => reporter.reportFinal(finalStatus));
  writeHerdrWorkerExit(paths, {
    schemaVersion: HERDR_WORKER_SCHEMA_VERSION,
    exitCode: childExitCode,
    signal: childSignal,
    aborted,
    completedAt: now().toISOString(),
  });

  if (aborted) return receivedSignal === "SIGTERM" ? 143 : 130;
  return normalizeProcessExitCode(childExitCode);
}

export function buildHerdrWorkerChildEnv(
  launchEnv: Record<string, string>,
  workerPaneEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { ...launchEnv };
  for (const key of HERDR_IDENTITY_ENV_KEYS) delete result[key];
  for (const key of HERDR_IDENTITY_ENV_KEYS) {
    const value = workerPaneEnv[key];
    if (typeof value === "string" && value.length > 0) result[key] = value;
  }
  result.GSD_SUBAGENT_CHILD = "1";
  return result;
}

export async function terminateHerdrWorkerProcessGroup(
  pid: number,
  isClosed: () => boolean,
  options: HerdrWorkerTerminationOptions = {},
): Promise<void> {
  const interruptGraceMs = boundedPositiveMs(options.interruptGraceMs, DEFAULT_INTERRUPT_GRACE_MS);
  const terminateGraceMs = boundedPositiveMs(options.terminateGraceMs, DEFAULT_TERMINATE_GRACE_MS);
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    if (!isClosed()) await (options.killWindowsTree ?? forceKillWindowsProcessTree)(pid);
    return;
  }
  const sendSignal = options.sendSignal ?? sendProcessGroupSignal;
  const wait = options.wait ?? delay;

  if (isClosed()) return;
  try { sendSignal(pid, "SIGINT"); } catch { /* process may already be gone */ }
  if (await waitUntilClosed(isClosed, interruptGraceMs, wait)) return;
  try { sendSignal(pid, "SIGTERM"); } catch { /* process may already be gone */ }
  if (await waitUntilClosed(isClosed, terminateGraceMs, wait)) return;
  try { sendSignal(pid, "SIGKILL"); } catch { /* best effort final escalation */ }
}

function sendProcessGroupSignal(pid: number, signal: NodeJS.Signals): void {
  process.kill(-pid, signal);
}

function forceKillWindowsProcessTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    try {
      const killer = spawn("taskkill", ["/F", "/T", "/PID", String(pid)], {
        stdio: "ignore",
        windowsHide: true,
      });
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      killer.once("error", finish);
      killer.once("close", finish);
    } catch {
      resolve();
    }
  });
}

async function waitUntilClosed(
  isClosed: () => boolean,
  timeoutMs: number,
  wait: (ms: number) => Promise<void>,
): Promise<boolean> {
  const step = Math.max(10, Math.min(100, timeoutMs));
  let elapsed = 0;
  while (elapsed < timeoutMs) {
    if (isClosed()) return true;
    const next = Math.min(step, timeoutMs - elapsed);
    await wait(next);
    elapsed += next;
  }
  return isClosed();
}

function openPrivateOutput(path: string): number {
  const noFollow = "O_NOFOLLOW" in fsConstants ? fsConstants.O_NOFOLLOW : 0;
  return openSync(
    path,
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | noFollow,
    0o600,
  );
}

function syncAndClose(fd: number): void {
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function normalizeProcessExitCode(code: number): number {
  if (!Number.isFinite(code)) return 1;
  const integer = Math.trunc(code);
  if (integer < 0 || integer > 255) return 1;
  return integer;
}

function boundedPositiveMs(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? Math.max(1, Math.trunc(value!)) : fallback;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeReporterCall(run: () => Promise<void>): Promise<void> {
  try { await run(); } catch { /* Herdr visibility must not break child execution */ }
}
