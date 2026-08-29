import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

export const HERDR_WORKER_SCHEMA_VERSION = 1 as const;
export const HERDR_WORKER_RUNTIME_VERSION_DIR = "v1";

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export type HerdrWorkerStatus =
  | "queued"
  | "starting"
  | "working"
  | "retrying"
  | "blocked"
  | "completed"
  | "failed"
  | "aborted"
  | "orphaned";

export interface HerdrWorkerIdentity {
  rootSessionId: string;
  dispatchId: string;
  childId: string;
}

export interface HerdrWorkerArtifactPaths {
  runtimeRoot: string;
  workerDir: string;
  launchPath: string;
  envPath: string;
  stdoutPath: string;
  stderrPath: string;
  statePath: string;
  heartbeatPath: string;
  exitPath: string;
}

export interface HerdrWorkerLaunchSpecV1 extends HerdrWorkerIdentity {
  schemaVersion: typeof HERDR_WORKER_SCHEMA_VERSION;
  agent: string;
  trackingName?: string;
  taskPreview?: string;
  model?: string;
  thinking?: string;
  cwd: string;
  executable: string;
  args: string[];
  stdoutPath: string;
  stderrPath: string;
  statePath: string;
  heartbeatPath: string;
  exitPath: string;
  envPath: string;
}

export interface HerdrWorkerEnvV1 {
  schemaVersion: typeof HERDR_WORKER_SCHEMA_VERSION;
  env: Record<string, string>;
}

export interface HerdrWorkerActivityV1 {
  kind: "status" | "tool" | "retry" | "error";
  label: string;
}

export interface HerdrWorkerStateV1 {
  schemaVersion: typeof HERDR_WORKER_SCHEMA_VERSION;
  status: HerdrWorkerStatus;
  updatedAt: string;
  pid?: number;
  childPid?: number;
  paneId?: string;
  lastActivity?: HerdrWorkerActivityV1;
}

export interface HerdrWorkerHeartbeatV1 {
  schemaVersion: typeof HERDR_WORKER_SCHEMA_VERSION;
  updatedAt: string;
  pid: number;
  childPid?: number;
  status: HerdrWorkerStatus;
}

export interface HerdrWorkerExitV1 {
  schemaVersion: typeof HERDR_WORKER_SCHEMA_VERSION;
  exitCode: number;
  signal: NodeJS.Signals | null;
  aborted: boolean;
  completedAt: string;
}

export interface CreateHerdrWorkerLaunchInput extends HerdrWorkerIdentity {
  agent: string;
  trackingName?: string;
  taskPreview?: string;
  model?: string;
  thinking?: string;
  cwd: string;
  executable: string;
  args: string[];
}

export function herdrWorkerRuntimeRoot(gsdHome: string): string {
  if (!isAbsolute(gsdHome)) throw new Error("GSD home must be an absolute path");
  return resolve(gsdHome, "runtime", "herdr", HERDR_WORKER_RUNTIME_VERSION_DIR);
}

export function inferHerdrWorkerRuntimeRootFromLaunchPath(launchPath: string): string {
  const resolvedLaunch = resolve(launchPath);
  if (basename(resolvedLaunch) !== "launch.json") {
    throw new Error("Herdr worker launch spec must be named launch.json");
  }
  const childDir = dirname(resolvedLaunch);
  const dispatchDir = dirname(childDir);
  const rootSessionDir = dirname(dispatchDir);
  const runtimeRoot = dirname(rootSessionDir);
  if (basename(runtimeRoot) !== HERDR_WORKER_RUNTIME_VERSION_DIR) {
    throw new Error("Herdr worker launch spec is not under a supported runtime version root");
  }
  return runtimeRoot;
}

export function resolveHerdrWorkerArtifactPaths(
  runtimeRoot: string,
  identity: HerdrWorkerIdentity,
): HerdrWorkerArtifactPaths {
  if (!isAbsolute(runtimeRoot)) throw new Error("Herdr runtime root must be an absolute path");
  assertSafeGeneratedId(identity.rootSessionId, "rootSessionId");
  assertSafeGeneratedId(identity.dispatchId, "dispatchId");
  assertSafeGeneratedId(identity.childId, "childId");

  const root = resolve(runtimeRoot);
  const workerDir = resolve(root, identity.rootSessionId, identity.dispatchId, identity.childId);
  assertContainedPath(root, workerDir, "worker directory");

  return {
    runtimeRoot: root,
    workerDir,
    launchPath: join(workerDir, "launch.json"),
    envPath: join(workerDir, "env.json"),
    stdoutPath: join(workerDir, "stdout.jsonl"),
    stderrPath: join(workerDir, "stderr.log"),
    statePath: join(workerDir, "state.json"),
    heartbeatPath: join(workerDir, "heartbeat.json"),
    exitPath: join(workerDir, "exit.json"),
  };
}

export function ensureHerdrWorkerArtifactDirectory(paths: HerdrWorkerArtifactPaths): void {
  const root = resolve(paths.runtimeRoot);
  assertContainedPath(root, paths.workerDir, "worker directory");
  ensureRuntimeRootDirectoryChain(root);

  const rel = relative(root, resolve(paths.workerDir));
  const segments = rel.split(/[\\/]+/).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    ensurePrivateDirectory(current, false);
  }
}

export function createHerdrWorkerLaunchSpec(
  input: CreateHerdrWorkerLaunchInput,
  paths: HerdrWorkerArtifactPaths,
): HerdrWorkerLaunchSpecV1 {
  if (!isAbsolute(input.cwd)) throw new Error("Herdr worker cwd must be absolute");
  if (!isAbsolute(input.executable)) throw new Error("Herdr worker executable must be absolute");
  if (!Array.isArray(input.args) || input.args.some((arg) => typeof arg !== "string")) {
    throw new Error("Herdr worker args must be a string array");
  }

  const expected = resolveHerdrWorkerArtifactPaths(paths.runtimeRoot, input);
  assertSameWorkerPaths(paths, expected);

  return {
    schemaVersion: HERDR_WORKER_SCHEMA_VERSION,
    rootSessionId: input.rootSessionId,
    dispatchId: input.dispatchId,
    childId: input.childId,
    agent: requireNonEmptyText(input.agent, "agent"),
    ...(input.trackingName ? { trackingName: input.trackingName } : {}),
    ...(input.taskPreview ? { taskPreview: input.taskPreview } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.thinking ? { thinking: input.thinking } : {}),
    cwd: resolve(input.cwd),
    executable: resolve(input.executable),
    args: [...input.args],
    stdoutPath: expected.stdoutPath,
    stderrPath: expected.stderrPath,
    statePath: expected.statePath,
    heartbeatPath: expected.heartbeatPath,
    exitPath: expected.exitPath,
    envPath: expected.envPath,
  };
}

export function writeHerdrWorkerLaunchBundle(
  paths: HerdrWorkerArtifactPaths,
  input: CreateHerdrWorkerLaunchInput,
  env: NodeJS.ProcessEnv,
): HerdrWorkerLaunchSpecV1 {
  ensureHerdrWorkerArtifactDirectory(paths);
  const spec = createHerdrWorkerLaunchSpec(input, paths);
  const serializedEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") serializedEnv[key] = value;
  }

  writePrivateJsonAtomic(paths.envPath, {
    schemaVersion: HERDR_WORKER_SCHEMA_VERSION,
    env: serializedEnv,
  } satisfies HerdrWorkerEnvV1);
  writePrivateJsonAtomic(paths.launchPath, spec);
  return spec;
}

export function writeHerdrWorkerState(paths: HerdrWorkerArtifactPaths, state: HerdrWorkerStateV1): void {
  assertSchemaVersion(state.schemaVersion, "state.json");
  assertIsoTimestamp(state.updatedAt, "state.updatedAt");
  writePrivateJsonAtomic(paths.statePath, state);
}

export function writeHerdrWorkerHeartbeat(
  paths: HerdrWorkerArtifactPaths,
  heartbeat: HerdrWorkerHeartbeatV1,
): void {
  assertSchemaVersion(heartbeat.schemaVersion, "heartbeat.json");
  assertIsoTimestamp(heartbeat.updatedAt, "heartbeat.updatedAt");
  writePrivateJsonAtomic(paths.heartbeatPath, heartbeat);
}

export function writeHerdrWorkerExit(paths: HerdrWorkerArtifactPaths, exit: HerdrWorkerExitV1): void {
  assertSchemaVersion(exit.schemaVersion, "exit.json");
  assertIsoTimestamp(exit.completedAt, "exit.completedAt");
  writePrivateJsonImmutable(paths.exitPath, exit);
}

export function readHerdrWorkerExit(paths: HerdrWorkerArtifactPaths): HerdrWorkerExitV1 {
  const runtimeRoot = resolve(paths.runtimeRoot);
  assertSafeWorkerDirectoryChain(runtimeRoot, paths.workerDir);
  if (dirname(resolve(paths.exitPath)) !== resolve(paths.workerDir) || basename(paths.exitPath) !== "exit.json") {
    throw new Error("Herdr worker exit artifact must be the worker-local exit.json");
  }
  assertRegularPrivateFile(paths.exitPath, "exit artifact");
  const value = parseJsonFile(paths.exitPath, "exit artifact");
  if (!isRecord(value)) throw new Error("Invalid Herdr worker exit artifact");
  assertSchemaVersion(value.schemaVersion, "exit.json");
  if (typeof value.exitCode !== "number" || !Number.isInteger(value.exitCode)) {
    throw new Error("Invalid Herdr worker exit code");
  }
  if (value.signal !== null && typeof value.signal !== "string") {
    throw new Error("Invalid Herdr worker exit signal");
  }
  if (typeof value.aborted !== "boolean") throw new Error("Invalid Herdr worker aborted flag");
  const completedAt = requireString(value.completedAt, "completedAt");
  assertIsoTimestamp(completedAt, "exit.completedAt");
  return {
    schemaVersion: HERDR_WORKER_SCHEMA_VERSION,
    exitCode: value.exitCode,
    signal: value.signal as NodeJS.Signals | null,
    aborted: value.aborted,
    completedAt,
  };
}

export function readHerdrWorkerLaunchSpec(
  launchPath: string,
  runtimeRoot: string,
): { spec: HerdrWorkerLaunchSpecV1; paths: HerdrWorkerArtifactPaths } {
  const root = resolve(runtimeRoot);
  const resolvedLaunch = resolve(launchPath);
  assertContainedPath(root, resolvedLaunch, "launch spec");
  if (basename(resolvedLaunch) !== "launch.json") {
    throw new Error("Herdr worker launch spec must be named launch.json");
  }
  assertSafeWorkerDirectoryChain(root, dirname(resolvedLaunch));
  assertRegularPrivateFile(resolvedLaunch, "launch spec");

  const value = parseJsonFile(resolvedLaunch, "launch spec");
  const spec = validateLaunchSpec(value);
  const paths = resolveHerdrWorkerArtifactPaths(root, spec);
  if (paths.launchPath !== resolvedLaunch) {
    throw new Error("Herdr worker launch spec identity does not match its path");
  }
  assertLaunchArtifactPaths(spec, paths);
  return { spec, paths };
}

export function readHerdrWorkerEnvAndDelete(
  envPath: string,
  expectedWorkerDir: string,
): Record<string, string> {
  const resolvedEnv = resolve(envPath);
  const workerDir = resolve(expectedWorkerDir);
  assertContainedPath(workerDir, resolvedEnv, "worker environment");
  if (dirname(resolvedEnv) !== workerDir || basename(resolvedEnv) !== "env.json") {
    throw new Error("Herdr worker environment must be the worker-local env.json");
  }
  const runtimeRoot = dirname(dirname(dirname(workerDir)));
  assertSafeWorkerDirectoryChain(runtimeRoot, workerDir);
  assertRegularPrivateFile(resolvedEnv, "worker environment");
  const value = parseJsonFile(resolvedEnv, "worker environment");
  if (!isRecord(value)) throw new Error("Invalid Herdr worker environment artifact");
  assertSchemaVersion(value.schemaVersion, "env.json");
  if (!isRecord(value.env)) throw new Error("Invalid Herdr worker environment map");
  const env: Record<string, string> = {};
  for (const [key, item] of Object.entries(value.env)) {
    if (typeof item !== "string") throw new Error(`Invalid Herdr worker environment value for ${key}`);
    env[key] = item;
  }
  unlinkSync(resolvedEnv);
  return env;
}

function validateLaunchSpec(value: unknown): HerdrWorkerLaunchSpecV1 {
  if (!isRecord(value)) throw new Error("Invalid Herdr worker launch spec");
  assertSchemaVersion(value.schemaVersion, "launch.json");
  const rootSessionId = requireString(value.rootSessionId, "rootSessionId");
  const dispatchId = requireString(value.dispatchId, "dispatchId");
  const childId = requireString(value.childId, "childId");
  assertSafeGeneratedId(rootSessionId, "rootSessionId");
  assertSafeGeneratedId(dispatchId, "dispatchId");
  assertSafeGeneratedId(childId, "childId");
  const args = value.args;
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
    throw new Error("Invalid Herdr worker args");
  }
  const cwd = requireString(value.cwd, "cwd");
  const executable = requireString(value.executable, "executable");
  if (!isAbsolute(cwd) || !isAbsolute(executable)) {
    throw new Error("Herdr worker cwd/executable must be absolute");
  }

  return {
    schemaVersion: HERDR_WORKER_SCHEMA_VERSION,
    rootSessionId,
    dispatchId,
    childId,
    agent: requireNonEmptyText(value.agent, "agent"),
    ...optionalStringProperty(value, "trackingName"),
    ...optionalStringProperty(value, "taskPreview"),
    ...optionalStringProperty(value, "model"),
    ...optionalStringProperty(value, "thinking"),
    cwd: resolve(cwd),
    executable: resolve(executable),
    args: [...args] as string[],
    stdoutPath: requireString(value.stdoutPath, "stdoutPath"),
    stderrPath: requireString(value.stderrPath, "stderrPath"),
    statePath: requireString(value.statePath, "statePath"),
    heartbeatPath: requireString(value.heartbeatPath, "heartbeatPath"),
    exitPath: requireString(value.exitPath, "exitPath"),
    envPath: requireString(value.envPath, "envPath"),
  };
}

function optionalStringProperty(
  value: Record<string, unknown>,
  key: "trackingName" | "taskPreview" | "model" | "thinking",
): Partial<Pick<HerdrWorkerLaunchSpecV1, typeof key>> {
  const item = value[key];
  if (item === undefined) return {};
  if (typeof item !== "string") throw new Error(`Invalid Herdr worker ${key}`);
  return { [key]: item } as Partial<Pick<HerdrWorkerLaunchSpecV1, typeof key>>;
}

function assertLaunchArtifactPaths(spec: HerdrWorkerLaunchSpecV1, paths: HerdrWorkerArtifactPaths): void {
  const expected: Array<[keyof HerdrWorkerLaunchSpecV1, string]> = [
    ["stdoutPath", paths.stdoutPath],
    ["stderrPath", paths.stderrPath],
    ["statePath", paths.statePath],
    ["heartbeatPath", paths.heartbeatPath],
    ["exitPath", paths.exitPath],
    ["envPath", paths.envPath],
  ];
  for (const [key, path] of expected) {
    if (resolve(String(spec[key])) !== path) {
      throw new Error(`Herdr worker ${String(key)} does not match the worker artifact directory`);
    }
  }
}

function assertSameWorkerPaths(actual: HerdrWorkerArtifactPaths, expected: HerdrWorkerArtifactPaths): void {
  for (const key of Object.keys(expected) as Array<keyof HerdrWorkerArtifactPaths>) {
    if (resolve(actual[key]) !== expected[key]) {
      throw new Error(`Herdr worker artifact path mismatch for ${key}`);
    }
  }
}

function ensurePrivateDirectory(path: string, recursive: boolean): void {
  if (!existsSync(path)) mkdirSync(path, { recursive, mode: PRIVATE_DIRECTORY_MODE });
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`Unsafe Herdr worker directory: ${path}`);
  }
  try {
    chmodSync(path, PRIVATE_DIRECTORY_MODE);
  } catch {
    if (process.platform !== "win32") throw new Error(`Unable to secure Herdr worker directory: ${path}`);
  }
}

function ensureRuntimeRootDirectoryChain(runtimeRoot: string): void {
  const root = resolve(runtimeRoot);
  const herdrDir = dirname(root);
  const runtimeDir = dirname(herdrDir);
  const gsdHome = dirname(runtimeDir);
  if (basename(root) !== HERDR_WORKER_RUNTIME_VERSION_DIR || basename(herdrDir) !== "herdr" || basename(runtimeDir) !== "runtime") {
    throw new Error("Invalid Herdr worker runtime root layout");
  }
  const homeStat = lstatSync(gsdHome);
  if (!homeStat.isDirectory()) throw new Error("Invalid GSD home for Herdr worker runtime");
  ensureDirectoryWithoutSymlink(runtimeDir, false);
  ensurePrivateDirectory(herdrDir, false);
  ensurePrivateDirectory(root, false);
}

function ensureDirectoryWithoutSymlink(path: string, recursive: boolean): void {
  if (!existsSync(path)) mkdirSync(path, { recursive, mode: PRIVATE_DIRECTORY_MODE });
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`Unsafe Herdr worker directory: ${path}`);
  }
}

function assertSafeWorkerDirectoryChain(runtimeRoot: string, workerDir: string): void {
  const root = resolve(runtimeRoot);
  const target = resolve(workerDir);
  assertContainedPath(root, target, "worker directory");
  assertExistingDirectoryWithoutSymlink(dirname(dirname(root)), "runtime directory");
  assertExistingDirectoryWithoutSymlink(dirname(root), "Herdr runtime directory");
  assertExistingDirectoryWithoutSymlink(root, "Herdr version directory");
  const rel = relative(root, target);
  let current = root;
  for (const segment of rel.split(/[\\/]+/).filter(Boolean)) {
    current = join(current, segment);
    assertExistingDirectoryWithoutSymlink(current, "worker directory");
  }
}

function assertExistingDirectoryWithoutSymlink(path: string, label: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Unsafe Herdr worker ${label}`);
}

function writePrivateJsonAtomic(path: string, value: unknown): void {
  assertParentDirectorySafe(path);
  const content = `${JSON.stringify(value, null, 2)}\n`;
  const tmpPath = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  writePrivateTemp(tmpPath, content);
  try {
    renameSync(tmpPath, path);
    try {
      chmodSync(path, PRIVATE_FILE_MODE);
    } catch {
      if (process.platform !== "win32") throw new Error(`Unable to secure Herdr worker artifact: ${path}`);
    }
  } catch (error) {
    try { unlinkSync(tmpPath); } catch { /* best effort */ }
    throw error;
  }
}

function writePrivateJsonImmutable(path: string, value: unknown): void {
  assertParentDirectorySafe(path);
  if (existsSync(path)) throw new Error(`Herdr worker exit artifact already exists: ${path}`);
  const content = `${JSON.stringify(value, null, 2)}\n`;
  const tmpPath = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  writePrivateTemp(tmpPath, content);
  try {
    linkSync(tmpPath, path);
    unlinkSync(tmpPath);
    try {
      chmodSync(path, PRIVATE_FILE_MODE);
    } catch {
      if (process.platform !== "win32") throw new Error(`Unable to secure Herdr worker artifact: ${path}`);
    }
  } catch (error) {
    try { unlinkSync(tmpPath); } catch { /* best effort */ }
    throw error;
  }
}

function writePrivateTemp(path: string, content: string): void {
  const noFollow = "O_NOFOLLOW" in fsConstants ? fsConstants.O_NOFOLLOW : 0;
  const fd = openSync(
    path,
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | noFollow,
    PRIVATE_FILE_MODE,
  );
  try {
    writeFileSync(fd, content, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function assertParentDirectorySafe(path: string): void {
  const parent = dirname(path);
  const stat = lstatSync(parent);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`Unsafe Herdr worker artifact parent: ${parent}`);
  }
}

function assertRegularPrivateFile(path: string, label: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Unsafe Herdr worker ${label}`);
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
    throw new Error(`Herdr worker ${label} must be owner-only`);
  }
}

function parseJsonFile(path: string, label: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to parse Herdr worker ${label}: ${message}`);
  }
}

function assertSafeGeneratedId(value: string, label: string): void {
  if (!SAFE_ID_RE.test(value) || value === "." || value === "..") {
    throw new Error(`Invalid generated Herdr worker ${label}`);
  }
}

function assertContainedPath(root: string, candidate: string, label: string): void {
  const rel = relative(resolve(root), resolve(candidate));
  if (rel === "" && resolve(root) !== resolve(candidate)) return;
  if (rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(rel)) {
    throw new Error(`Herdr worker ${label} escapes the runtime root`);
  }
}

function assertSchemaVersion(value: unknown, label: string): asserts value is typeof HERDR_WORKER_SCHEMA_VERSION {
  if (value !== HERDR_WORKER_SCHEMA_VERSION) {
    throw new Error(`Unsupported Herdr worker schema version in ${label}`);
  }
}

function assertIsoTimestamp(value: string, label: string): void {
  if (Number.isNaN(Date.parse(value))) throw new Error(`Invalid Herdr worker timestamp: ${label}`);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`Invalid Herdr worker ${label}`);
  return value;
}

function requireNonEmptyText(value: unknown, label: string): string {
  const text = requireString(value, label).trim();
  if (!text) throw new Error(`Invalid Herdr worker ${label}`);
  return text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
