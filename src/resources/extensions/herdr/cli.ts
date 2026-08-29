import { execFile } from "node:child_process";

const DEFAULT_CLI_TIMEOUT_MS = 1500;
const DEFAULT_MAX_BUFFER_BYTES = 64 * 1024;

export interface HerdrCliOptions {
  env?: NodeJS.ProcessEnv;
  binary?: string;
  timeoutMs?: number;
}

export interface HerdrCliResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  notFound: boolean;
}

export function resolveHerdrBinary(env: NodeJS.ProcessEnv = process.env): string {
  return env.HERDR_BIN_PATH?.trim() || "herdr";
}

/**
 * Bounded argv-only Herdr CLI execution. This is the seam M4 will use for the
 * CLI-only `pane run` helper; no shell interpolation is permitted here.
 */
export function runHerdrCli(args: readonly string[], options: HerdrCliOptions = {}): Promise<HerdrCliResult> {
  const env = options.env ?? process.env;
  const binary = options.binary ?? resolveHerdrBinary(env);
  const timeoutMs = options.timeoutMs ?? DEFAULT_CLI_TIMEOUT_MS;

  return new Promise((resolve) => {
    execFile(
      binary,
      [...args],
      {
        env,
        timeout: timeoutMs,
        maxBuffer: DEFAULT_MAX_BUFFER_BYTES,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const code = typeof (error as NodeJS.ErrnoException | null)?.code === "number"
          ? (error as NodeJS.ErrnoException & { code: number }).code
          : null;
        const errorCode = (error as NodeJS.ErrnoException | null)?.code;
        const killed = Boolean(error && "killed" in error && (error as { killed?: boolean }).killed);
        resolve({
          ok: !error,
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          exitCode: code,
          timedOut: killed,
          notFound: errorCode === "ENOENT",
        });
      },
    );
  });
}

export async function probeHerdrCli(options: HerdrCliOptions = {}): Promise<HerdrCliResult> {
  return runHerdrCli(["--version"], options);
}
