import {
	detectJsonlSessionHeader,
	type JsonlSessionFormatDetection,
} from "@gsd/pi-agent-core";
import { closeSync, lstatSync, openSync, readSync } from "node:fs";

const MAX_SESSION_HEADER_BYTES = 64 * 1024;

export type SessionFileOpenErrorCode = "invalid-session" | "unsupported-session-format";

export class SessionFileOpenError extends Error {
	readonly code: SessionFileOpenErrorCode;
	readonly sessionFile: string;
	readonly detection: JsonlSessionFormatDetection;

	constructor(code: SessionFileOpenErrorCode, sessionFile: string, detection: JsonlSessionFormatDetection) {
		const detail =
			detection.status === "invalid"
				? detection.message
				: detection.status === "unsupported"
					? `${detection.family} session version ${detection.version} is not supported`
					: `${detection.format} sessions are recognized but not readable by this runtime`;
		super(`Cannot open session ${sessionFile}: ${detail}`);
		this.name = "SessionFileOpenError";
		this.code = code;
		this.sessionFile = sessionFile;
		this.detection = detection;
	}
}

function readBoundedFirstLine(sessionFile: string): string {
	const fd = openSync(sessionFile, "r");
	try {
		const buffer = Buffer.allocUnsafe(MAX_SESSION_HEADER_BYTES + 1);
		const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
		const newline = buffer.subarray(0, bytesRead).indexOf(0x0a);
		if (newline < 0 && bytesRead > MAX_SESSION_HEADER_BYTES) {
			return "";
		}
		return buffer.toString("utf8", 0, newline < 0 ? bytesRead : newline).replace(/\r$/u, "");
	} finally {
		closeSync(fd);
	}
}

/** Inspect only the bounded first record. The source file is never modified. */
export function inspectSessionFileFormat(sessionFile: string): JsonlSessionFormatDetection {
	try {
		if (lstatSync(sessionFile).isSymbolicLink()) {
			return {
				status: "invalid",
				reason: "symlink",
				message: "session path must not be a symbolic link",
			};
		}
		const line = readBoundedFirstLine(sessionFile);
		if (!line) {
			return {
				status: "invalid",
				reason: "missing-header",
				message: "session file has no bounded header",
			};
		}
		return detectJsonlSessionHeader(line);
	} catch (error) {
		return {
			status: "invalid",
			reason: "unreadable",
			message: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Assert that the existing coding-agent reader can safely own this file.
 * Harness-v4 is detected explicitly but remains read-only until its codec lands.
 */
export function requireLegacySessionFile(sessionFile: string): void {
	const detection = inspectSessionFileFormat(sessionFile);
	if (detection.status === "supported" && detection.format === "legacy-v3") return;
	throw new SessionFileOpenError(
		detection.status === "invalid" ? "invalid-session" : "unsupported-session-format",
		sessionFile,
		detection,
	);
}
