# Canonical project snapshot

`gsd_project_snapshot` provides a bounded observation of the GSD database, not
a lifecycle command, validation verdict, database backup, or browser screenshot.
It does not create tasks, complete work, authorize recovery, or modify projections.

## Public entry points

- Native GSD tool: `gsd_project_snapshot`, with optional `projectDir`; otherwise
  the session working directory is used. A relative override is resolved against
  that session directory, not an unrelated process working directory.
- MCP: `gsd_project_snapshot`, with optional `projectDir`; otherwise the MCP
  server working directory is used.
- CLI: `gsd read snapshot --project /absolute/project/path --json`.

The tools return the complete JSON snapshot once in text content. Native details
and MCP structured metadata identify the operation, revision, truncation and
consistency; they do not duplicate the complete snapshot. CLI JSON wraps the
snapshot in `data`, alongside `integration_version`, `kind` and `projectDir`.
Without `--json`, the CLI prints the snapshot itself.

## Data and consistency

The shared reader returns:

- `authority`: project ID, database schema version, project revision and authority
  epoch;
- `current`: active milestone/slice/task, phase and next action, using the same
  state-projection rules as normal runtime dispatch;
- `progress`: project-wide milestone, slice and task counts;
- open `blockers` and `openQuestions`;
- `verification`: assessment and verification-evidence counts, not a new pass/fail
  decision;
- ordered milestone summaries, capture time, truncation and consistency metadata.

One isolated read-only SQLite connection and one read transaction cover database
queries. Concurrent writes cannot mix old authority metadata with new hierarchy
rows in a successful result. Existing caller connections and prepared statements
are not closed, swapped or reused as writable snapshot connections. No schema
migrations, queue-order repair, missing-database creation or Markdown import run
as a side effect. Normal GSD runtime startup still owns its established migration
and queue-repair behavior.

Execution scope affects current focus, not project-wide counts. Public adapters
retain the caller's captured scope for the same canonical project database;
an explicit different project does not inherit the caller's milestone/slice lock.
Symlink aliases of the same database are not different projects. Internal callers
may supply an explicit scope, including `{}` for an unscoped project observation;
no process-global environment mutation is used.

Some inherited escalation decisions consult auxiliary files. They are explicitly
labelled `consistency.auxiliaryFiles: "not-revision-bound"`; the database revision
does not attest to their contents. A snapshot is an observation at capture time,
not a lease or permission to mutate later state.

## Bounds and errors

- Up to 50 milestone summaries, 100 open blockers and 100 open questions.
- Human-readable text is capped at 2,048 UTF-16 code units without splitting a
  valid surrogate pair. Identifiers are never silently shortened into different
  action targets.
- The pretty-printed core snapshot is at most 262,144 UTF-8 bytes. Optional rows
  are removed deterministically if necessary; flags report collection, text and
  byte-budget truncation. Aggregate hierarchy counts remain complete.
- Serialized tool envelopes have an additional JSON-escaping cost: the tested
  native/MCP bound is 540 KiB, and the CLI JSON envelope bound is 270 KiB. These
  are transport bounds, not a claim that every request returns that much data.

Consumers must check truncation before interpreting an empty or partial collection
as an exhaustive result. Oversized essential identity fields fail explicitly.

Missing or unavailable databases return `db_unavailable`, future schemas return
`schema_too_new`, oversized essential output returns `snapshot_too_large`, and
unexpected boundary failures return a generic `query_error`. Tools set `isError`.
The CLI exits nonzero, emits a diagnostic on stderr and, with `--json`, emits an
`error` envelope without `data`. Older schemas are not migrated by this read;
open the project normally to perform an authorized normal-startup migration.
Raw unexpected SQL errors are not copied into public diagnostics.

## Scope and provenance

This downstream feature adapts upstream `1af48f0d1`, `f0c4ac525` and `59d5a3588`.
It replaces their global-handle/mixed-retry approach with the existing isolated
read surface and a shared adapter-bound projection. It adds no provider dependency,
App Server executor or mandatory VS Code UI.

Implementation status and exact verification results are tracked in
[the deferred-upstream goal](gsd-upstream-deferred-implementation.md).
