import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import type { HerdrEnvironment } from "./client.js";

export const HERDR_ROOT_RUNTIME_SCHEMA_VERSION = 1 as const;
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const DEFAULT_HEARTBEAT_MS = 5_000;

export type HerdrRootRuntimeStatus = "active" | "stopped" | "crashed";

export interface HerdrRootRuntimeRecordV1 {
  schemaVersion: typeof HERDR_ROOT_RUNTIME_SCHEMA_VERSION;
  rootRuntimeId: string;
  rootSessionId: string;
  instanceId: string;
  source: string;
  pid: number;
  paneId: string;
  workspaceId?: string;
  tabId?: string;
  cwd: string;
  status: HerdrRootRuntimeStatus;
  startedAt: string;
  updatedAt: string;
}

export interface HerdrRootHeartbeatV1 {
  schemaVersion: typeof HERDR_ROOT_RUNTIME_SCHEMA_VERSION;
  rootRuntimeId: string;
  instanceId: string;
  pid: number;
  status: HerdrRootRuntimeStatus;
  updatedAt: string;
}

export interface HerdrRootRuntimePaths {
  runtimeRoot: string;
  rootDir: string;
  recordPath: string;
  heartbeatPath: string;
}

export interface HerdrRootRuntimeLeaseOptions {
  gsdHome: string;
  rootSessionId: string;
  source: string;
  cwd: string;
  environment: HerdrEnvironment;
  heartbeatMs?: number;
  now?: () => Date;
  pid?: number;
  instanceId?: string;
}

export function herdrRootRuntimeId(rootSessionId: string): string {
  if (!rootSessionId.trim()) throw new Error("Herdr root session id is required");
  return `root-${createHash("sha256").update(rootSessionId).digest("hex").slice(0, 20)}`;
}

export function resolveHerdrRootRuntimePaths(gsdHome: string, rootSessionId: string): HerdrRootRuntimePaths {
  if (!isAbsolute(gsdHome)) throw new Error("GSD home must be absolute");
  const runtimeRoot = resolve(gsdHome, "runtime", "herdr", "v1");
  const rootDir = join(runtimeRoot, herdrRootRuntimeId(rootSessionId));
  return {
    runtimeRoot,
    rootDir,
    recordPath: join(rootDir, "root.json"),
    heartbeatPath: join(rootDir, "root-heartbeat.json"),
  };
}

export function readHerdrRootRuntimeRecord(paths: HerdrRootRuntimePaths): HerdrRootRuntimeRecordV1 {
  assertPrivateFile(paths.recordPath, "root record");
  const value = JSON.parse(readFileSync(paths.recordPath, "utf8")) as Partial<HerdrRootRuntimeRecordV1>;
  if (value.schemaVersion !== HERDR_ROOT_RUNTIME_SCHEMA_VERSION) throw new Error("Unsupported Herdr root runtime schema");
  if (value.rootRuntimeId !== basename(paths.rootDir) || typeof value.rootSessionId !== "string" || !value.rootSessionId) {
    throw new Error("Invalid Herdr root runtime identity");
  }
  for (const key of ["instanceId", "source", "paneId", "cwd", "startedAt", "updatedAt"] as const) {
    if (typeof value[key] !== "string" || !value[key]) throw new Error(`Invalid Herdr root runtime ${key}`);
  }
  if (!Number.isSafeInteger(value.pid) || Number(value.pid) <= 0) throw new Error("Invalid Herdr root runtime pid");
  if (!new Set(["active", "stopped", "crashed"]).has(String(value.status))) throw new Error("Invalid Herdr root runtime status");
  if (!Number.isFinite(Date.parse(value.startedAt!)) || !Number.isFinite(Date.parse(value.updatedAt!))) {
    throw new Error("Invalid Herdr root runtime timestamp");
  }
  return value as HerdrRootRuntimeRecordV1;
}

export class HerdrRootRuntimeLease {
  readonly paths: HerdrRootRuntimePaths;
  readonly instanceId: string;
  private readonly options: HerdrRootRuntimeLeaseOptions;
  private readonly now: () => Date;
  private readonly pid: number;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private startedAt: string | undefined;

  constructor(options: HerdrRootRuntimeLeaseOptions) {
    if (!options.environment.available || !options.environment.paneId) {
      throw new Error("Herdr root runtime lease requires a managed pane identity");
    }
    this.options = options;
    this.paths = resolveHerdrRootRuntimePaths(options.gsdHome, options.rootSessionId);
    this.instanceId = options.instanceId ?? randomUUID();
    this.now = options.now ?? (() => new Date());
    this.pid = options.pid ?? process.pid;
  }

  start(): void {
    ensureRuntimeDirectory(this.paths);
    this.startedAt = this.now().toISOString();
    this.publish("active");
    const heartbeatMs = normalizeHeartbeatMs(this.options.heartbeatMs);
    this.heartbeatTimer = setInterval(() => {
      try {
        if (!this.isCurrentOwner()) return;
        this.publishHeartbeat("active");
      } catch {
        // Root reporting remains usable if a heartbeat write fails. Startup
        // reconciliation treats the missing/stale heartbeat conservatively.
      }
    }, heartbeatMs);
    this.heartbeatTimer.unref?.();
  }

  stop(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
    if (!this.startedAt || !this.isCurrentOwner()) return;
    this.publish("stopped");
  }

  private publish(status: HerdrRootRuntimeStatus): void {
    const updatedAt = this.now().toISOString();
    const environment = this.options.environment;
    writePrivateJsonAtomic(this.paths.recordPath, {
      schemaVersion: HERDR_ROOT_RUNTIME_SCHEMA_VERSION,
      rootRuntimeId: basename(this.paths.rootDir),
      rootSessionId: this.options.rootSessionId,
      instanceId: this.instanceId,
      source: this.options.source,
      pid: this.pid,
      paneId: environment.paneId!,
      ...(environment.workspaceId ? { workspaceId: environment.workspaceId } : {}),
      ...(environment.tabId ? { tabId: environment.tabId } : {}),
      cwd: resolve(this.options.cwd),
      status,
      startedAt: this.startedAt!,
      updatedAt,
    } satisfies HerdrRootRuntimeRecordV1);
    this.publishHeartbeat(status, updatedAt);
  }

  private publishHeartbeat(status: HerdrRootRuntimeStatus, updatedAt = this.now().toISOString()): void {
    writePrivateJsonAtomic(this.paths.heartbeatPath, {
      schemaVersion: HERDR_ROOT_RUNTIME_SCHEMA_VERSION,
      rootRuntimeId: basename(this.paths.rootDir),
      instanceId: this.instanceId,
      pid: this.pid,
      status,
      updatedAt,
    } satisfies HerdrRootHeartbeatV1);
  }

  private isCurrentOwner(): boolean {
    try { return readHerdrRootRuntimeRecord(this.paths).instanceId === this.instanceId; }
    catch { return false; }
  }
}

function ensureRuntimeDirectory(paths: HerdrRootRuntimePaths): void {
  const runtimeDir = dirname(dirname(paths.runtimeRoot));
  const herdrDir = dirname(paths.runtimeRoot);
  for (const [path, strict] of [[runtimeDir, false], [herdrDir, true], [paths.runtimeRoot, true], [paths.rootDir, true]] as const) {
    if (!existsSync(path)) mkdirSync(path, { recursive: false, mode: PRIVATE_DIRECTORY_MODE });
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Unsafe Herdr root runtime directory: ${path}`);
    if (strict) chmodSync(path, PRIVATE_DIRECTORY_MODE);
  }
}

function writePrivateJsonAtomic(path: string, value: unknown): void {
  const parent = dirname(path);
  const stat = lstatSync(parent);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Unsafe Herdr root runtime parent");
  const temporary = join(parent, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  const noFollow = "O_NOFOLLOW" in fsConstants ? fsConstants.O_NOFOLLOW : 0;
  const descriptor = openSync(temporary, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | noFollow, PRIVATE_FILE_MODE);
  try {
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  try {
    renameSync(temporary, path);
    chmodSync(path, PRIVATE_FILE_MODE);
  } catch (error) {
    try { unlinkSync(temporary); } catch { /* best effort */ }
    throw error;
  }
}

function assertPrivateFile(path: string, label: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Unsafe Herdr ${label}`);
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) throw new Error(`Herdr ${label} must be owner-only`);
}

function normalizeHeartbeatMs(value: number | undefined): number {
  const resolved = value ?? DEFAULT_HEARTBEAT_MS;
  if (!Number.isInteger(resolved) || resolved < 100 || resolved > 60_000) throw new Error("Herdr root heartbeat interval is out of range");
  return resolved;
}
