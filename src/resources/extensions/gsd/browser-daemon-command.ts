import { execFileSync } from "node:child_process";
import { closeSync, constants, fstatSync, mkdtempSync, openSync, readSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GsdBrowserMcpLaunchConfig } from "../shared/gsd-browser-cli.js";

const MAX_DAEMON_STDERR_BYTES = 4 * 1024;

/** Read bounded diagnostics from the capture descriptor, even if its path changes. */
export function readBoundedDaemonStderr(fd: number): string {
  const readSection = (position: number, length: number): Buffer => {
    const buffer = Buffer.allocUnsafe(length);
    const bytesRead = readSync(fd, buffer, 0, length, position);
    return buffer.subarray(0, bytesRead);
  };
  try {
    const size = fstatSync(fd).size;
    if (size <= MAX_DAEMON_STDERR_BYTES) return readSection(0, size).toString("utf8").trim();
    const marker = Buffer.from("\n…[truncated]\n");
    const retainedBytes = MAX_DAEMON_STDERR_BYTES - marker.byteLength;
    const headBytes = Math.floor(retainedBytes / 2);
    const tailBytes = retainedBytes - headBytes;
    return Buffer.concat([
      readSection(0, headBytes), marker, readSection(size - tailBytes, tailBytes),
    ]).toString("utf8").trim();
  } catch {
    return "";
  }
}

/** A daemon's descendants may outlive its launcher; never wait on inherited pipes. */
export function runBrowserDaemonCommand(
  invocation: Pick<GsdBrowserMcpLaunchConfig, "command" | "args" | "cwd" | "env">,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): { ok: true } | { ok: false; error: string } {
  let captureDir: string | undefined;
  let captureFd: number | undefined;
  try {
    captureDir = mkdtempSync(join(tmpdir(), "gsd-browser-daemon-"));
    captureFd = openSync(join(captureDir, "stderr"), constants.O_RDWR | constants.O_CREAT | constants.O_EXCL, 0o600);
  } catch {
    // Diagnostic capture is optional; partial setup is cleaned in finally.
  }
  try {
    execFileSync(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: { ...process.env, ...env, ...(invocation.env ?? {}) },
      stdio: ["ignore", "ignore", captureFd ?? "ignore"],
      timeout: timeoutMs,
      windowsHide: true,
    });
    return { ok: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const stderr = captureFd === undefined ? "" : readBoundedDaemonStderr(captureFd);
    return { ok: false, error: stderr ? `${detail}: ${stderr}` : detail };
  } finally {
    if (captureFd !== undefined) {
      try { closeSync(captureFd); } catch { /* best-effort diagnostics */ }
    }
    if (captureDir) {
      try { rmSync(captureDir, { recursive: true, force: true }); } catch { /* a descendant may retain the file on Windows */ }
    }
  }
}
