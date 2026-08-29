# M3 Closeout — Internal Herdr Worker Runner

Status: **COMPLETE** on 2026-08-30.

## Scope

M3 builds the process that runs *inside* a Herdr worker pane. It deliberately does not own worker-tab creation, pane pooling, queueing, or backend selection; those remain M4 concerns.

The worker boundary is:

```text
Herdr pane
  -> gsd __herdr-worker /absolute/.../launch.json
  -> validate versioned/private artifacts
  -> consume + delete env.json
  -> spawn existing GSD JSON-mode child (argv, shell:false)
  -> stdout.jsonl / stderr.log
  -> bounded activity renderer + Herdr semantic reporting
  -> heartbeat/state
  -> immutable exit.json
```

## Artifact contract

Runtime root:

```text
${GSD_HOME}/runtime/herdr/v1/
  <rootSessionId>/
    <dispatchId>/
      <childId>/
        launch.json
        env.json
        stdout.jsonl
        stderr.log
        state.json
        heartbeat.json
        exit.json
```

Generated IDs are restricted to safe path-segment characters. The private entry verifies that the inferred runtime root exactly matches the active `GSD_HOME/runtime/herdr/v1`; a valid-looking spec in another `.../v1` tree is rejected.

On POSIX, integration-owned directories/files are `0700`/`0600`. Existing symlink path components, non-private launch/env files, future schema versions, and artifact-path substitution are rejected. `env.json` is deleted immediately after a successful parse. `exit.json` uses no-overwrite publication so a second final outcome cannot replace the first.

## Process/runtime behavior

- child spawn uses `spec.executable` + `spec.args`, `shell:false`;
- copied root `HERDR_*` values are removed and replaced by Herdr-managed values from the actual worker pane;
- `GSD_SUBAGENT_CHILD=1` is forced for the real JSON child;
- stdout/stderr are never `tee`d to the pane;
- exact raw bytes are persisted while a UTF-8-aware framer relays complete JSONL records;
- malformed JSON does not crash the renderer and remains present in raw evidence;
- shell metacharacters in argv remain literal and cannot create a shell side effect.

## Human activity projection

The pane receives only bounded status information such as:

```text
[16:42:44] working
[16:42:44] → bash curl https://example.test/?token=[REDACTED] API_TOKEN=[REDACTED]
[16:42:45] ↻ retry attempt 2
[16:42:45] ✓ retry recovered
[16:42:46] ✓ bash
```

The renderer suppresses raw JSON, text/token deltas, tool update bodies, and tool result contents. Credential-shaped assignments, Authorization values, and common URL query credentials are redacted before presentation. Task previews are also redacted before becoming Herdr status messages.

## Herdr authority

Each loaded worker gets a unique `custom:gsd-worker:<uuid>` source and monotonically increasing seq values. Reports are serialized through a single queue so final lifecycle/metadata cannot race earlier activity reports.

Mapping:

| Worker state | Herdr report |
|---|---|
| starting / working / retrying | `working` |
| failed / blocked | `blocked` |
| completed / aborted | `idle` |
| orphaned | `unknown` |

The worker reports title/display-agent metadata and model/thinking tokens at start. Final metadata adds `outcome=completed|failed|aborted`. Retention/release is intentionally deferred to the M4/M5 policy layer.

## Heartbeat and cancellation

State and heartbeat records contain runner PID, child PID, worker pane ID, status, and last bounded activity. The heartbeat is periodically refreshed during a live child run.

POSIX workers spawn the real child in a detached process group. Cancellation is:

```text
SIGINT
  -> interrupt grace
SIGTERM
  -> terminate grace
SIGKILL
```

The regression suite creates a real descendant process and proves group termination removes both the leader and descendant. On Windows the equivalent is immediate `taskkill /F /T`, matching the existing GSD policy for hidden console process trees.

## Real Herdr v0.8.2 smoke

The official Linux x86_64 `herdr 0.8.2` release was run in an isolated headless session. A real Herdr workspace/pane launched the source private worker through `herdr pane run`.

Observed during execution:

```text
agent          gsd-worker
agent_status   working
display_agent  GSD worker
title          hawk / scout
tokens         model=fixture/model, thinking=high
```

After successful completion Herdr exposed effective `agent_status=done` (the v0.8.2 read-side presentation derived from reported idle) and `tokens.outcome=completed`.

The pane showed only the bounded activity sample above, while `stdout.jsonl` retained the full machine events, including the intentionally secret fixture values. No secret fixture value appeared in pane text.

## Validation evidence

- worker + loader changed-source compiled tests: **28/28 pass**;
- `typecheck:extensions`: pass;
- `verify:extension-coverage`: pass;
- `build:core`: pass;
- built-JS private runner smoke: pass;
- real Herdr v0.8.2 worker-pane smoke: pass;
- `validate-pack`: **Package is installable. Safe to publish.**

## M4 handoff

M4 can now treat the internal runner as a stable executable contract. The backend should create/reuse a bounded pane slot, write the M3 launch bundle, invoke only:

```text
gsd __herdr-worker /absolute/path/to/launch.json
```

and relay `stdout.jsonl` into the already-shared GSD semantic parser. M4 must not duplicate JSON parsing or move retry/chain/parallel policy into Herdr.
