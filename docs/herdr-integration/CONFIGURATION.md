# Herdr Integration Configuration

## Supported preference surface

Add this block to the normal GSD preferences file:

```yaml
herdr:
  enabled: true
  required: true
```

- `enabled` defaults to `false`; installing the downstream package alone does
  not change subagent execution.
- `required` defaults to `true` once enabled. A missing or ambiguous Herdr
  launch fails visibly and never starts a duplicate local worker.

Environment overrides used for operations/testing:

```text
GSD_HERDR_DISABLE=1   # force Herdr selection off
GSD_HERDR_REQUIRED=1  # force required semantics on
```

## Backend selection

```text
herdr.enabled && Herdr available
    -> HerdrBackend

herdr.enabled && herdr.required && unavailable
    -> explicit Herdr launch failure

herdr.enabled && !herdr.required && unavailable before launch
    -> pre-launch fallback may select another backend

otherwise cmux.splits
    -> CmuxBackend

otherwise
    -> LocalBackend
```

No fallback is permitted after an external launch may have started.

## Root session format opt-in

New root sessions remain `legacy-v3` by default. To opt a new session into the
validated v4 harness, select it explicitly:

```bash
gsd --session-backend harness-v4
```

The same selection is available to automation and web-mode child processes:

```bash
GSD_SESSION_BACKEND=harness-v4 gsd
gsd headless --session-backend harness-v4 auto
gsd --session-backend harness-v4 --web /path/to/project
```

Only `legacy-v3` and `harness-v4` are accepted. CLI selection takes precedence
over `GSD_SESSION_BACKEND`; the internal validation variable
`GSD_INTERNAL_SESSION_BACKEND` remains a lower-precedence test seam. An unknown
value fails startup instead of silently selecting a different format.

Session files remain format-bound. Opening a v4 file with the v3 backend (or a
v3 file with the v4 backend) fails without rewriting the file or creating an
empty replacement. Use the same backend when reopening or continuing a
session, for example:

```bash
gsd --session-backend harness-v4 --continue
gsd --session-backend harness-v4 --session /absolute/path/to/session.jsonl
```

Rollback affects only subsequent selections and requires no data conversion:

```bash
gsd --session-backend legacy-v3
unset GSD_SESSION_BACKEND
```

There is no automatic migration and the deployed default has not changed.

## Fixed v1 worker policy

The current version deliberately keeps worker tuning out of the public
preference schema:

- one `GSD Workers · <root-hash>` tab per root GSD session;
- deterministic 1 → 2 → 4 pane topology;
- maximum four active worker panes;
- fifth and later tasks queue until a successful slot is reclaimed;
- successful retry/chain affinity can reuse a settled slot;
- completed/aborted agent authority is cleared after final evidence while the
  physical pane stays warm for reuse;
- failed or ambiguous panes remain retained until explicit cleanup;
- manually removed idle/retained panes are reconciled and replaced before the
  next launch; in-flight pane loss still fails the current execution explicitly;
- root-pane focus is preserved;
- pane output includes bounded lifecycle/tool activity plus coalesced
  provider-emitted thinking and assistant text, never raw JSON or individual
  token deltas.

## Runtime state

Worker evidence lives under:

```text
${GSD_HOME:-~/.gsd}/runtime/herdr/v1/
  <rootSessionId>/<dispatchId>/<childId>/
```

Directories are owner-only (`0700`) and files are owner-only (`0600`) on
POSIX. Launch, environment, stdout JSONL, stderr, state, heartbeat, ownership,
orphan/cleanup requests, and immutable exit evidence are versioned and
path-contained.

## Diagnostics

Inside the root GSD TUI:

```text
/herdr-status
/herdr-doctor
```

The optional operations plugin adds status, focus, retained cleanup, startup
reconciliation, and dashboard actions. Diagnostics redact environment values
and secrets.
