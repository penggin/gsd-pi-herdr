# Herdr Integration Security Model

## Threat model

The Herdr integration executes coding agents with the same broad filesystem/process authority as GSD itself. Security work therefore focuses on preventing accidental credential disclosure, command injection, path escape, stale process execution, and cross-pane authority confusion.

## 1. Command construction

The real GSD child must be spawned with argv arrays and `shell: false`.

The Herdr pane receives only a fixed internal runner command plus a generated spec path. User task text, prompts, model names, and arbitrary environment values must not be interpolated into a shell command.

Preferred pattern:

```text
herdr pane run <pane> "<known gsd binary> __herdr-worker <generated-safe-spec-path>"
```

The command string still passes through a shell pane, so both binary/spec paths require correct shell escaping. No user-controlled task data should be present in it.

## 2. Runtime directories and permissions

Proposed runtime root:

```text
~/.gsd/runtime/herdr/v1/
```

Requirements:

- directories: owner-only (`0700`) where supported;
- launch/env/stdout/stderr/state/exit files: owner-only (`0600`) where supported;
- generated IDs only for path segments;
- no path derived directly from agent names, task text, repository branch names, or model output;
- every resolved artifact path must remain inside the expected runtime root;
- do not follow attacker-controlled symlinks during cleanup or overwrite operations.

## 3. Environment handling

GSD subagent launch environments can contain credentials and provider tokens.

Rules:

- never print the complete environment;
- never place environment values in Herdr metadata;
- if a temporary `env.json` handoff is used, create it `0600`, validate ownership/path, read it once, and delete it immediately;
- do not retain secrets solely for convenience/debugging;
- diagnostic support bundles must redact environment values by default.

## 4. Herdr identity variables

A root GSD process inside Herdr has values such as:

```text
HERDR_ENV
HERDR_SOCKET_PATH
HERDR_WORKSPACE_ID
HERDR_TAB_ID
HERDR_PANE_ID
```

A child launch plan may inherit these root values. A worker process running in a different Herdr pane must not use the root IDs as its own identity.

Before spawning the real JSON-mode GSD child, the worker runner must:

1. remove inherited Herdr-managed identity values from the parent launch environment;
2. apply the values injected into the actual worker pane process;
3. preserve `GSD_SUBAGENT_CHILD=1`;
4. ensure the root-session reporter remains disabled in the headless child.

This prevents workers from overwriting root-pane state/session authority.

## 5. Herdr socket trust

`HERDR_SOCKET_PATH` is local-control authority over the running Herdr session. Treat it as sensitive runtime context:

- do not expose it unnecessarily in logs;
- connect only when `HERDR_ENV=1` and the runtime context is expected;
- apply bounded connection/request timeouts;
- validate response IDs/types where used;
- handle socket replacement/restart conservatively.

## 6. Metadata and display redaction

Worker display must be intentionally lossy.

Potentially sensitive content to suppress/redact:

- authorization headers;
- cookies;
- API keys/tokens/password-like assignments;
- URL query credentials/tokens;
- entire `.env` contents;
- full tool result bodies;
- full prompts/system prompts.

Tool command summaries must be bounded in length. File paths may be shortened for display while raw artifacts remain protected.

## 7. Raw JSONL artifacts

`stdout.jsonl` can contain source code, model responses, file contents, tool arguments/results, and usage metadata.

Therefore:

- artifacts are private local runtime evidence;
- they are never uploaded automatically;
- they are not emitted to Herdr metadata;
- retention is bounded/configurable;
- support collection requires explicit user action and redaction.

## 8. Process groups and cancellation

On macOS/Unix, the internal runner should create/control the child process group so cancellation does not leave descendants editing the repository after the parent believes execution stopped.

Expected escalation:

```text
SIGINT
  wait grace period
SIGTERM
  wait grace period
SIGKILL
```

The runner must record final evidence even when cancellation succeeds.

## 9. Ambiguous launch outcomes

If Herdr command submission times out after the command may have been accepted, the backend must not immediately start a local replacement.

It should reconcile using pane process/output/artifact evidence. The safe state is unknown/failed/orphaned until resolved.

## 10. Cleanup safety

Cleanup code must:

- operate only inside the integration-owned runtime root;
- realpath/check containment before recursive deletion;
- avoid deleting live/ambiguous worker artifacts;
- not follow symlinks outside the root;
- use worker ownership/state records rather than broad filename patterns.

## 11. Plugin trust

Any optional Herdr plugin runs as the user and can invoke the full Herdr CLI. Keep it small, inspectable, and versioned with this downstream distribution. Do not use remote dynamic code loading for core worker execution.

## 12. Required security tests

Before stable release, cover:

- task text containing shell metacharacters does not alter the worker command;
- model/agent/tracking names cannot escape paths;
- parent Herdr IDs are replaced by worker IDs;
- secret-like strings are redacted from pane output/metadata;
- env handoff is owner-only and removed after read;
- cleanup rejects paths outside runtime root and symlink escapes;
- cancellation kills child descendants;
- ambiguous command submission never causes duplicate execution;
- stale sequence/state reports cannot overwrite newer Herdr state.
