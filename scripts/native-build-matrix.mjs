import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const NATIVE_BUILD_PLATFORMS = Object.freeze([
  { os: "macos-14", target: "aarch64-apple-darwin", platform: "darwin-arm64" },
  { os: "macos-14", target: "x86_64-apple-darwin", platform: "darwin-x64" },
  { os: "ubuntu-latest", target: "x86_64-unknown-linux-gnu", platform: "linux-x64-gnu" },
  {
    os: "blacksmith-4vcpu-ubuntu-2404-arm",
    target: "aarch64-unknown-linux-gnu",
    platform: "linux-arm64-gnu",
    cross: true,
  },
  { os: "windows-latest", target: "x86_64-pc-windows-msvc", platform: "win32-x64-msvc" },
]);

export function buildNativeMatrix({ selected = "all", publish = false } = {}) {
  if (publish && selected !== "all") {
    throw new Error("publish requires platform=all so every optional native package is built");
  }

  const include = selected === "all"
    ? [...NATIVE_BUILD_PLATFORMS]
    : NATIVE_BUILD_PLATFORMS.filter((entry) => entry.platform === selected);
  if (include.length === 0) throw new Error(`Unknown native platform: ${selected}`);
  return { include };
}

function main() {
  const matrix = buildNativeMatrix({
    selected: process.env.SELECTED_PLATFORM || "all",
    publish: process.env.PUBLISH === "true",
  });
  const output = `matrix=${JSON.stringify(matrix)}\n`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output);
  else process.stdout.write(output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`[native-build-matrix] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
