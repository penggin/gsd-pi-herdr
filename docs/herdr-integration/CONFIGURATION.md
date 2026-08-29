# Herdr Integration Configuration

The downstream fork can expose Herdr as a first-class preference instead of keeping an external integration-only config file. Exact naming must align with GSD preference conventions during implementation.

## Proposed schema

```yaml
herdr:
  enabled: true
  required: true

  workers:
    enabled: true
    max_panes: 4
    placement: worker-tab
    preserve_main_focus: true
    reuse_completed_panes: true

  display:
    level: activity
    show_model: true
    show_task_preview: true
    show_elapsed: true
    show_final_summary: true
    show_raw_json: false
    max_command_chars: 120

  retention:
    success_minutes: 10
    aborted_minutes: 10
    failure_minutes: null
    log_hours: 72

  runtime:
    heartbeat_ms: 5000
    interrupt_grace_ms: 5000
    terminate_grace_ms: 5000
```

## Defaults

Recommended first-stable behavior:

- `enabled`: auto-enable only when explicitly configured or when a safe migration/opt-in policy is accepted. Do not unexpectedly change upstream default execution for every user.
- `required`: `true` once Herdr execution is selected; failure to create/launch a monitored worker should fail visibly.
- `workers.max_panes`: `4`, matching the existing practical parallelism target.
- `placement`: one dedicated worker tab associated with the root GSD session.
- `preserve_main_focus`: `true`.
- `display.level`: `activity`.
- `show_raw_json`: always `false` in normal UI; raw JSONL remains in artifacts.
- failed worker panes remain until review/cleanup by default.

## Backend selection

If a general subagent runtime preference is cleaner after the M0.9 refactor inspection, Herdr may be selected through a shared runtime block instead:

```yaml
subagents:
  runtime: herdr

herdr:
  required: true
  workers:
    max_panes: 4
```

Do not commit to the exact public shape until M2 identifies how existing cmux preferences can migrate without breaking users.

## Existing cmux compatibility

The fork must preserve current `cmux` preferences for existing users. Possible migration strategies:

1. keep `cmux` as-is and add `herdr` alongside it;
2. add a new generic `subagent_runtime` preference with backward-compatible translation from `cmux.splits`;
3. temporarily support both and warn only on ambiguous simultaneous activation.

M2 must choose one and add migration/validation tests.

## Required mode and fallback

If Herdr is selected and `required: true`:

```text
Herdr unavailable before launch -> dispatch error
worker pane cannot be reserved   -> dispatch error
worker command submission fails  -> dispatch error
ambiguous launch outcome         -> dispatch error / reconciliation
```

Do not silently spawn a local worker after an external launch may have started.

Optional fallback, if implemented, must be explicit and safe:

```yaml
herdr:
  required: false
```

## Display levels

Proposed:

- `status`: identity, lifecycle, elapsed, final outcome only.
- `activity`: status plus bounded tool activity; recommended default.
- `verbose`: more tool lifecycle details but still no raw token/JSON stream.

`show_raw_json` is documented only as an internal/debug escape hatch if ever added; it should not become normal UX.

## Environment overrides

Potential debugging overrides:

```text
GSD_HERDR_DISABLE=1
GSD_HERDR_REQUIRED=1
GSD_HERDR_LOG_LEVEL=debug
GSD_HERDR_RUNTIME_ROOT=/path
```

Environment variables must not silently override core security invariants such as path containment or secret redaction.

## Runtime state location

Prefer a GSD-owned path under the existing application root, for example:

```text
~/.gsd/runtime/herdr/v1/
```

rather than inventing a second unrelated application root. The final path should use existing `app-paths` helpers where possible.

## Validation rules

- `max_panes`: integer, initially `1..4` unless later concurrency supports more.
- heartbeat/grace periods: bounded positive integers.
- retention values: non-negative minutes or `null` where infinite/manual retention is allowed.
- unknown config keys follow existing GSD preference validation policy.
- an enabled Herdr runtime must fail diagnostics if required CLI/API capabilities are absent.

## Diagnostics

A future status/doctor command should report effective configuration and capability status without exposing secrets:

```text
Herdr: detected v0.8.2 · protocol 20
Root pane: w1:p1
Worker runtime: enabled · required
Worker tab: w1:t3
Slots: 2 running / 2 available
Command submit: pane run ✅
Semantic state API ✅
Metadata API ✅
Session snapshot ✅
```
