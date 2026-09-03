import { homedir } from "node:os";
import { join } from "node:path";

export const GSD_SESSION_DIRECTORY_ENV = "GSD_CODING_AGENT_SESSION_DIR";
export const LEGACY_PI_SESSION_DIRECTORY_ENV = "PI_CODING_AGENT_SESSION_DIR";

function expandTilde(path: string, homeDirectory: string): string {
  if (path === "~") return homeDirectory;
  if (path.startsWith("~/") || (process.platform === "win32" && path.startsWith("~\\"))) {
    return join(homeDirectory, path.slice(2));
  }
  return path;
}

/** Resolve the documented session-directory precedence without touching disk. */
export function resolveConfiguredSessionDirectory(options: {
  cli?: string;
  env?: NodeJS.ProcessEnv;
  settings?: string;
  homeDirectory?: string;
}): string | undefined {
  const env = options.env ?? process.env;
  const selected = options.cli
    ?? env[GSD_SESSION_DIRECTORY_ENV]
    ?? env[LEGACY_PI_SESSION_DIRECTORY_ENV]
    ?? options.settings;
  return selected ? expandTilde(selected, options.homeDirectory ?? homedir()) : undefined;
}
