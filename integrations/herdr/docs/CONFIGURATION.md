# Herdr Integration Configuration

> This schema is proposed and remains subject to M0.8 code-placement and compatibility findings.

## Goals

Configuration must make backend selection, observability guarantees, layout, output policy, retention, and recovery behavior explicit. A user must be able to tell whether a worker may ever run without a visible pane.

## Proposed preference shape

```yaml
subagents:
  runtime: herdr             # auto | local | cmux | herdr
  monitoring_required: true
  max_parallel: 4

herdr:
  enabled: true
  worker_tab: true
  preserve_main_focus: true

  layout:
    mode: pool               # pool | per-dispatch
    max_panes: 4

  display:
    level: activity          # status | activity | verbose
    show_model: true
    show_task_preview: true
    show_elapsed: true
    show_final_summary: true
    show_raw_json: false
    max_command_chars: 120

  retention:
    success_minutes: 10
    aborted_minutes: 10
    failure_minutes: null    # null = manual cleanup
    log_hours: 72

  recovery:
    heartbeat_ms: 5000
    interrupt_grace_ms: 5000
    terminate_grace_ms: 5000
    orphan_policy: retain

  fallback:
    on_unavailable: error    # error | local
```

## Backend resolution

1. An explicit `subagents.runtime` wins.
2. `auto` may select Herdr only when the process is in a valid Herdr pane and required capabilities pass.
3. `auto` may then select cmux when its environment and CLI are valid.
4. Otherwise it selects local execution.
5. When `monitoring_required: true`, a requested monitored backend may not silently fall through to local execution.

## Required-mode invariant

```text
monitoring_required == true
AND selected backend cannot establish a known worker
→ fail before an unmonitored child starts
```

If a launch result is ambiguous, the system reconciles pane/process state. It must not start a second local copy.

## Herdr environment

The main process may receive:

```text
HERDR_ENV
HERDR_SOCKET_PATH
HERDR_WORKSPACE_ID
HERDR_TAB_ID
HERDR_PANE_ID
```

A worker child must not reuse the main pane identifiers. The worker runner strips inherited Herdr-managed keys and reapplies the values injected into its own pane.

## State locations

Proposed integration-owned state root:

```text
~/.local/state/gsd-herdr/
```

A future setting may override it, but the resolved path must pass ownership and containment checks. Project source directories are not used for secret-bearing launch artifacts.

## Environment overrides

Emergency and diagnostic overrides may include:

```text
GSD_HERDR_DISABLE=1
GSD_HERDR_REQUIRED=1
GSD_HERDR_STATE_DIR=/absolute/path
GSD_HERDR_LOG_LEVEL=debug
```

Environment values override preferences only when documented. Secret or full environment values are never printed by `doctor`.

## Migration

Until the final schema is implemented, existing `cmux` preferences remain unchanged. The backend refactor must provide a deterministic migration path and preserve prior behavior when no Herdr settings are present.
