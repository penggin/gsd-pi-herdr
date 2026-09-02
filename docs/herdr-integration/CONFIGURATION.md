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
