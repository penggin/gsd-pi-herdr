import type { FileSystem } from "../types.js";

export const LEGACY_JSONL_SESSION_VERSION = 3 as const;
export const HARNESS_JSONL_SESSION_VERSION = 4 as const;

export type JsonlSessionFormat = "legacy-v3" | "harness-v4";
export type JsonlSessionHeaderFamily = "legacy" | "harness";

export type JsonlSessionFormatDetection =
	| {
			status: "supported";
			format: JsonlSessionFormat;
			version: typeof LEGACY_JSONL_SESSION_VERSION | typeof HARNESS_JSONL_SESSION_VERSION;
	  }
	| {
			status: "unsupported";
			family: JsonlSessionHeaderFamily;
			version: number;
	  }
	| {
			status: "invalid";
			reason:
				| "missing-header"
				| "malformed-json"
				| "invalid-header"
				| "ambiguous-header"
				| "not-file"
				| "symlink"
				| "unreadable";
			message: string;
	  };

type JsonlVersionDetectionFileSystem = Pick<FileSystem, "fileInfo" | "readTextLines">;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(
	reason: Extract<JsonlSessionFormatDetection, { status: "invalid" }>["reason"],
	message: string,
): JsonlSessionFormatDetection {
	return { status: "invalid", reason, message };
}

/**
 * Detect the session format from its first JSONL line without interpreting any
 * entries or mutating the source. Full header and entry validation belongs to
 * the selected format codec.
 */
export function detectJsonlSessionHeader(line: string): JsonlSessionFormatDetection {
	if (!line.trim()) return invalid("missing-header", "session header is empty");

	let value: unknown;
	try {
		value = JSON.parse(line);
	} catch {
		return invalid("malformed-json", "session header is not valid JSON");
	}
	if (!isRecord(value)) return invalid("invalid-header", "session header must be a JSON object");

	const isLegacy = value.type === "session";
	const isHarness = value.kind === "header";
	if (isLegacy && isHarness) {
		return invalid("ambiguous-header", "session header contains both legacy and harness discriminators");
	}
	if (!isLegacy && !isHarness) {
		return invalid("invalid-header", "session header has no recognized format discriminator");
	}
	if (!Number.isSafeInteger(value.version) || (value.version as number) <= 0) {
		return invalid("invalid-header", "session header has an invalid version");
	}

	const version = value.version as number;
	if (isLegacy && version === LEGACY_JSONL_SESSION_VERSION) {
		return { status: "supported", format: "legacy-v3", version: LEGACY_JSONL_SESSION_VERSION };
	}
	if (isHarness && version === HARNESS_JSONL_SESSION_VERSION) {
		return { status: "supported", format: "harness-v4", version: HARNESS_JSONL_SESSION_VERSION };
	}
	return { status: "unsupported", family: isLegacy ? "legacy" : "harness", version };
}

/**
 * Inspect one session file without following symlinks. This is deliberately a
 * read-only compatibility seam: it selects no writer and never repairs data.
 */
export async function detectJsonlSessionFormat(
	fs: JsonlVersionDetectionFileSystem,
	filePath: string,
): Promise<JsonlSessionFormatDetection> {
	const info = await fs.fileInfo(filePath);
	if (!info.ok) return invalid("unreadable", `cannot inspect session file: ${info.error.message}`);
	if (info.value.kind === "symlink") return invalid("symlink", "session path must not be a symbolic link");
	if (info.value.kind !== "file") return invalid("not-file", "session path is not a regular file");

	const lines = await fs.readTextLines(filePath, { maxLines: 1 });
	if (!lines.ok) return invalid("unreadable", `cannot read session header: ${lines.error.message}`);
	const header = lines.value[0];
	return header === undefined ? invalid("missing-header", "session file has no header") : detectJsonlSessionHeader(header);
}
