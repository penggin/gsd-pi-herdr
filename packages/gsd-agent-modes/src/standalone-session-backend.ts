/**
 * The package-level CLI is a compatibility entry point and still constructs
 * legacy SessionManager directly. The root GSD CLI owns the internal v4
 * composition selector; never pretend this entry point selected v4.
 */
export function assertStandaloneSessionBackend(value: string | undefined): void {
	if (value === undefined || value === "legacy-v3") return;
	throw new Error(
		`@gsd/agent-modes standalone entry only supports legacy-v3 sessions; `
		+ `run the root GSD CLI for GSD_INTERNAL_SESSION_BACKEND=${value}`,
	);
}
