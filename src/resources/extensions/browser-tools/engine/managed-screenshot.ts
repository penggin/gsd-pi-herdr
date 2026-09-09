import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

import type { GsdBrowserMcpLaunchConfig } from "../../shared/gsd-browser-cli.js";
import { constrainScreenshot, resolveSharpFactory } from "../screenshot-constraints.js";

export const MAX_MANAGED_SCREENSHOT_BYTES = 16 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 24 * 1024 * 1024;
const MAX_INPUT_PIXELS = 64 * 1024 * 1024;
const SCREENSHOT_TIMEOUT_MS = 60_000;

export class ManagedScreenshotError extends Error {}

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ManagedScreenshotError("Screenshot capture aborted.");
}

/** Reuse the established MCP launch verbatim, replacing only its subcommand. */
export function buildManagedScreenshotArgs(launch: GsdBrowserMcpLaunchConfig, args: Record<string, unknown>): string[] {
  const mcpIndex = launch.args.indexOf("mcp");
  if (mcpIndex < 0 || launch.args.lastIndexOf("mcp") !== mcpIndex) {
    throw new ManagedScreenshotError("Screenshot capture requires an unambiguous gsd-browser mcp launch command.");
  }
  const cliArgs = [...launch.args.slice(0, mcpIndex), "screenshot", ...launch.args.slice(mcpIndex + 1)];
  if (!cliArgs.includes("--json")) cliArgs.push("--json");
  if (args.selector !== undefined) {
    if (typeof args.selector !== "string" || args.selector.trim().length === 0 || args.selector.includes("\0")) {
      throw new ManagedScreenshotError("Screenshot selector must be a non-empty string.");
    }
    cliArgs.push(`--selector=${args.selector}`);
  }
  if (args.fullPage !== undefined && typeof args.fullPage !== "boolean") {
    throw new ManagedScreenshotError("Screenshot fullPage must be a boolean.");
  }
  if (args.fullPage === true) cliArgs.push("--full-page");
  if (args.quality !== undefined) {
    if (typeof args.quality !== "number" || !Number.isInteger(args.quality) || args.quality < 1 || args.quality > 100) {
      throw new ManagedScreenshotError("Screenshot quality must be an integer between 1 and 100.");
    }
    cliArgs.push("--quality", String(args.quality));
  }
  if (args.format !== undefined) {
    if (args.format !== "jpeg" && args.format !== "png") {
      throw new ManagedScreenshotError("Screenshot format must be jpeg or png.");
    }
    cliArgs.push("--format", args.format);
  }
  // Never forward output/path or other arbitrary tool parameters. All evidence
  // arrives in bounded stdout; no filesystem path from the CLI is trusted.
  return cliArgs;
}

/** Bounded argv-only subprocess; raw output and stderr never appear in errors. */
export function runManagedScreenshotCli(
  launch: GsdBrowserMcpLaunchConfig,
  args: string[],
  env: Record<string, string>,
  signal?: AbortSignal,
  limits = { timeoutMs: SCREENSHOT_TIMEOUT_MS, maxOutputBytes: MAX_OUTPUT_BYTES },
): Promise<string> {
  checkAborted(signal);
  if (process.platform === "win32") {
    throw new ManagedScreenshotError("Managed screenshot capture is not supported on Windows because CLI process-tree cancellation is unavailable.");
  }
  return new Promise((resolve, reject) => {
    let child: ChildProcessByStdio<null, Readable, Readable>;
    try {
      child = spawn(launch.command, args, {
        cwd: launch.cwd,
        env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        // The npm launcher uses spawnSync. A separate POSIX group lets aborts
        // terminate its native child too, without touching the managed daemon.
        detached: true,
        windowsHide: true,
      });
    } catch {
      reject(new ManagedScreenshotError("Screenshot CLI could not be started."));
      return;
    }
    const chunks: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    const cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    const fail = (message: string): void => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        // It may have exited between the failure and the kill.
      }
      child.stdout.destroy();
      child.stderr.destroy();
      reject(new ManagedScreenshotError(message));
    };
    const abort = (): void => fail("Screenshot capture aborted.");
    const timer = setTimeout(() => fail("Screenshot capture timed out."), limits.timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();

    const consume = (chunk: Buffer, isStdout: boolean): void => {
      if (settled) return;
      outputBytes += chunk.length;
      if (outputBytes > limits.maxOutputBytes) {
        fail("Screenshot capture exceeded the output limit.");
      } else if (isStdout) {
        chunks.push(chunk);
      }
    };
    child.stdout.on("data", (chunk: Buffer) => consume(chunk, true));
    child.stderr.on("data", (chunk: Buffer) => consume(chunk, false));
    child.on("error", () => fail("Screenshot CLI could not be started."));
    child.on("close", (code) => {
      if (settled) return;
      if (code !== 0) {
        fail("Screenshot CLI failed; no image evidence was returned.");
        return;
      }
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}

export async function decodeManagedScreenshot(output: string, quality: number, signal?: AbortSignal): Promise<{ type: "image"; data: string; mimeType: string }> {
  checkAborted(signal);
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(output);
  } catch {
    throw new ManagedScreenshotError("Screenshot CLI returned invalid JSON image evidence.");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)
    || typeof payload.data !== "string" || payload.data.length === 0
    || payload.data.length > Math.ceil(MAX_MANAGED_SCREENSHOT_BYTES / 3) * 4
    || (payload.mimeType !== "image/png" && payload.mimeType !== "image/jpeg")) {
    throw new ManagedScreenshotError("Screenshot CLI returned missing or invalid image evidence.");
  }
  const buffer = Buffer.from(payload.data, "base64");
  if (buffer.length === 0 || buffer.length > MAX_MANAGED_SCREENSHOT_BYTES || buffer.toString("base64") !== payload.data
    || payload.byteLength !== buffer.length) {
    throw new ManagedScreenshotError("Screenshot CLI returned invalid image bytes.");
  }
  const format = payload.mimeType === "image/png" ? "png" : "jpeg";
  // libvips can decode a PNG whose final IEND chunk was cut off. Require the
  // complete native PNG/JPEG framing as well as a successful pixel decode.
  const completeFraming = format === "png"
    ? buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
      && buffer.subarray(-12).equals(Buffer.from("0000000049454e44ae426082", "hex"))
    : buffer.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"))
      && buffer.subarray(-2).equals(Buffer.from("ffd9", "hex"));
  if (!completeFraming) throw new ManagedScreenshotError("Screenshot CLI returned an invalid or incomplete image.");
  // Signatures alone and sharp.metadata() accept truncated files. Force an
  // actual pixel decode before accepting even a small image requiring no resize.
  let sharp;
  try {
    sharp = resolveSharpFactory(await import("sharp"));
  } catch {
    throw new ManagedScreenshotError("Screenshot image validation is unavailable; install the sharp dependency.");
  }
  if (!sharp) throw new ManagedScreenshotError("Screenshot image validation is unavailable; install the sharp dependency.");
  let constrained: Buffer;
  try {
    const decoder = sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "warning" });
    const metadata = await decoder.metadata();
    if (metadata.format !== format || metadata.width !== payload.width || metadata.height !== payload.height
      || !metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1) {
      throw new Error("Image metadata does not match the screenshot envelope");
    }
    await decoder.stats();
    checkAborted(signal);
    constrained = await constrainScreenshot(null, buffer, payload.mimeType, quality);
  } catch (error) {
    if (error instanceof ManagedScreenshotError) throw error;
    throw new ManagedScreenshotError("Screenshot CLI returned an invalid or undecodable image.");
  }
  checkAborted(signal);
  if (constrained.length > MAX_MANAGED_SCREENSHOT_BYTES) throw new ManagedScreenshotError("Screenshot image exceeds the size limit.");
  return { type: "image", data: constrained.toString("base64"), mimeType: payload.mimeType };
}

export async function captureManagedScreenshot(
  launch: GsdBrowserMcpLaunchConfig,
  args: Record<string, unknown>,
  env: Record<string, string>,
  signal?: AbortSignal,
): Promise<{ content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>; isError: false }> {
  const cliArgs = buildManagedScreenshotArgs(launch, args);
  const output = await runManagedScreenshotCli(launch, cliArgs, env, signal);
  const image = await decodeManagedScreenshot(output, typeof args.quality === "number" ? args.quality : 80, signal);
  return { content: [{ type: "text", text: "Screenshot captured from the managed browser session." }, image], isError: false };
}
