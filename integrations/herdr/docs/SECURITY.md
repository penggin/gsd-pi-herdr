# Herdr Integration Security Model

## 1. Trust boundaries

The integration executes coding agents with the user's permissions. GSD extensions, worker runners, and Herdr plugins are trusted code, not sandboxes.

Primary boundaries:

```text
main GSD process
execution backend
Herdr control socket/CLI
worker runner
child GSD process
runtime artifacts
project worktrees
```

## 2. Secrets and environment

- Never put API keys, cookies, authorization headers, or the full environment in argv, pane titles, metadata, logs, or diagnostics.
- Protected environment transfer must use owner-only files or inherited process environment.
- If an environment artifact is used, create it with mode `0600`, read it once, and delete it immediately.
- Runtime directories use mode `0700`.
- Herdr-managed variables inherited from the main pane are removed before child launch and replaced with the worker pane values.

Managed keys include at least:

```text
HERDR_ENV
HERDR_SOCKET_PATH
HERDR_WORKSPACE_ID
HERDR_TAB_ID
HERDR_PANE_ID
```

## 3. Process spawning

- Use argv arrays and `shell: false` for the child.
- Do not interpolate task text, paths, model names, or prompts into shell commands.
- Validate executable and working-directory paths.
- Use a dedicated process group on Unix when needed for targeted cancellation.
- Treat launch acknowledgement as distinct from child success.

## 4. Path safety

- Generate dispatch/child IDs; do not use user text as path segments.
- Resolve and verify all artifact paths remain beneath the configured state root.
- Do not follow untrusted symlinks during cleanup.
- Atomic updates write to a temporary sibling and rename.
- Cleanup removes only integration-owned records with valid schemas and ownership markers.

## 5. Terminal and metadata redaction

Renderers redact or omit:

```text
Authorization and Cookie headers
known API-key formats
URL query tokens
full environment assignments
prompt/system content
large tool results
sensitive file contents
```

Tool commands are bounded and may be summarized. Full output stays in protected artifacts only when necessary for GSD parsing or debugging.

## 6. Socket safety

- Use the socket path injected by Herdr or verified configuration.
- Validate request and response IDs and schemas.
- Apply bounded timeouts and response-size limits.
- Do not retry mutating launch requests blindly after an ambiguous timeout.
- Sequence state reports so late events cannot roll back newer state.

## 7. Cancellation and cleanup

Cancellation targets the recorded worker process/pane only. Signal escalation is bounded. Cleanup must not kill a process solely because a stale file claims its PID; verify process identity and runtime ownership first.

## 8. Failure policy

When monitoring is required, failing closed is safer than starting an invisible local worker. An ambiguous external launch must be reconciled before any alternate execution is considered.

## 9. Required security tests

```text
shell metacharacters in task/path/model values
malicious path traversal IDs
symlink cleanup attacks
wrong/stale PID reuse
secret-pattern redaction
main-pane Herdr identity leakage
partial environment artifact reads
socket timeout and oversized response
SIGINT/SIGTERM/SIGKILL targeting
ambiguous launch duplicate prevention
artifact permission checks
```

Security-sensitive changes require focused tests and a plan log entry.
