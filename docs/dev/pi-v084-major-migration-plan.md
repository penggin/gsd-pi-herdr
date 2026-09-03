# Pi v0.84 harness/session migration plan

Date: 2026-09-03

Status: P3.0–P3.4, P3.5a–P3.5b, and P3.5c1–P3.5c2a complete; P3.5c runtime adoption in progress; no v4 cutover

Upstream reference: `refs/pi-upstream/v0.84.4`

## Purpose

Adopt useful v0.84 harness and session-storage behavior without replacing GSD
or Herdr authority, corrupting existing version-3 session logs, or importing a
provider-specific architecture wholesale.

The reviewed upstream delta is not a patch-sized update:

- harness plus harness tests: 69 files, about 11,228 insertions and 4,465
  deletions between v0.80.10 and v0.84.4;
- AI provider source: 111 files, about 5,601 insertions and 20,344 deletions;
- upstream harness JSONL uses a version-4 `kind: "header"` format, while both
  downstream `SessionManager` and the existing `pi-agent-core` harness store use
  the version-3 `type: "session"` format.

This plan therefore uses adapters and dual readers. It does not rewrite a live
session in place.

## Authority boundaries

These boundaries are release blockers, not prompt guidance:

- GSD remains authoritative for project, milestone, slice, task, Task Attempt,
  validation, remediation, recovery, and assessment records.
- `SessionManager` or its eventual adapter owns conversation persistence only.
- Herdr continues to own tabs, panes, PTYs, focus, and visible worker state.
- The subagent common runner continues to own result parsing, retry, usage,
  cancellation semantics, and final success/failure.
- Assessment Gates remain separate isolated `AssessmentRun` records; harness
  sessions cannot turn them into Task Attempts or grant mutation tools.
- OpenAI/Codex compaction checkpoints and downstream extension `details` fields
  must round-trip without being interpreted by the session storage layer.

## Current downstream constraints

The migration must preserve these concrete surfaces:

- `packages/pi-coding-agent/src/core/session-manager*.ts` and its public
  `SessionManager` API;
- `packages/pi-agent-core/src/harness/`, currently a 19-file harness/storage
  implementation with a version-3 JSONL backend;
- root CLI/headless callers in `src/cli.ts` and `src/headless.ts`;
- browser/session subprocess imports in `src/web/bridge-service.ts`;
- version-3 fixtures across web bridge, onboarding, multi-project, and session
  parity tests;
- Herdr private workers launched in JSON mode and their artifact relay;
- extension messages, custom entries, labels, compaction entries, usage fields,
  and downstream structured-compaction details.

## Decisions before implementation

1. **Keep v3 readable indefinitely.** Existing logs are user data. Unsupported
   or corrupt records fail explicitly; they are never silently discarded.
2. **Write one format per session file.** A v3 file stays v3. New v4 sessions
   may be enabled only after the adapter and rollback gates pass.
3. **No automatic bulk migration.** A future explicit migration command may
   copy v3 to a new v4 file, verify it, and retain the source. Startup never
   rewrites all sessions.
4. **Do not import directory churn as functionality.** Provider behavior
   already adopted downstream remains in the present modules unless a move is
   required by a tested API boundary.
5. **No direct cutover to upstream coding-agent main.** The downstream CLI,
   web mode, GSD extensions, and Herdr lifecycle remain the composition root.

## Migration slices

### P3.0 — Freeze the compatibility contract

Add black-box fixtures and tests before importing runtime code.

- Record v3 behavior for create, append, branch, label, compact, custom entry,
  custom message, resume, list, fork, torn-tail repair, and read-only open.
- Record extension event ordering and compaction details preservation.
- Record headless/JSON output and usage semantics used by Herdr workers.
- Record browser session list/open responses and timestamps.
- Add fixtures containing remote compaction checkpoints and Assessment Gate
  metadata to prove they remain opaque.

Exit: the fixtures pass against the current implementation and fail if entry
types, ordering, parent linkage, or opaque details are removed.

### P3.1 — Introduce version-neutral session contracts

Define a small internal facade without changing storage:

```text
SessionRepositoryAdapter
  detect(path) -> v3 | v4 | unsupported
  list(scope)
  openReadOnly(path)
  create(format)
  append(expectedRevision, mutation)
  snapshot()
  close()
```

- Adapt the current coding-agent `SessionManager` to the facade first.
- Keep public `SessionManager` methods and serialized outputs unchanged.
- Use explicit format and capability tags rather than `instanceof` checks.
- Preserve per-session mutation queues and caller-owned cancellation.

Exit: all P3.0 tests pass through the facade with only the v3 adapter enabled.

### P3.2 — Add an isolated v4 codec and read-only backend

Port the minimum upstream modules from
`packages/agent/src/harness/session/jsonl/` into `pi-agent-core` with downstream
package names and error types.

- Validate `kind: "header"`, version 4, IDs, parent linkage, and mutation
  records before exposing them.
- Bound line length, record count, and error payloads.
- Retain torn-tail truncation rules and symlink/path containment protections.
- Implement list, metadata, snapshot, and branch reads only.
- Do not expose v4 writes or wire the CLI yet.

Exit: upstream codec fixtures and downstream corruption/security fixtures pass;
opening v3 still selects only the v3 adapter.

### P3.3 — Complete v4 memory/JSONL conformance

- Port repository/storage separation, state reduction, branch queries, fork,
  labels, names, compaction, and custom entries.
- Run one shared conformance suite against memory and JSONL backends.
- Verify atomic append, concurrent mutation serialization, cancellation, and
  crash recovery.
- Keep SQLite/search optional and out of the first cutover. It may follow only
  after JSONL parity because GSD already has a separate canonical database.

Exit: memory and JSONL produce equivalent snapshots and deterministic errors;
no GSD database or projection is touched.

### P3.4 — Reconcile AgentHarness behavior

- Diff the current downstream harness against upstream event, reducer, result,
  tool, compaction, and shutdown contracts.
- Import behavior by capability, not by replacing the package tree.
- Preserve downstream provider-header hooks, scoped provider environment,
  retry classification, remote/synthetic compaction, and dynamic tools.
- Map harness phases to existing Pi/GSD events; do not create a second lifecycle
  authority.

Exit: prompt, tool loop, steer/follow-up, retry, compact, branch summary,
abort, and shutdown parity pass on memory plus v4 JSONL.

### P3.5 — Add an opt-in coding-agent adapter

Design gate (2026-09-03): the deployed coding-agent `SessionManager` contract is
synchronous, while the validated v4 repositories and storage adapters are
asynchronous. The latest upstream harness at `4e69b0c28` still throws
`HarnessNotImplemented` for production prompt, compaction, and navigation
operations. P3.5 must therefore first move the production composition root onto
the working downstream asynchronous harness contract. It must not introduce a
second synchronous v4 writer or advertise a non-functional upstream scaffold as
an opt-in backend.

- Add an internal construction option selecting `legacy-v3` or `harness-v4`.
- Default to `legacy-v3`; do not add a global user migration prompt yet.
- Preserve public `SessionManager` list/open/create and extension contexts
  through an adapter.
- Reject format mismatch instead of falling back to a new empty session.

Exit: the same CLI/headless characterization matrix passes for both backends,
and legacy v3 remains the default.

#### P3.5a — Awaitable production construction seam (complete 2026-09-03)

- Added one typed, awaitable session-manager factory for create, open,
  continue-recent, and memory targets.
- Routed print/JSON-worker and interactive startup through that factory.
- Routed the replacement-oriented `AgentSessionRuntime` `/new`, `/resume`,
  `/fork`, and import construction through the same injected factory.
- Kept the only selectable backend as `legacy-v3`; recognized v4 files still
  fail closed instead of becoming empty legacy sessions.
- Proved replacement preparation fails before the active session is aborted or
  disposed.

This establishes the I/O completion boundary required by ADR-H028 but does not
make the legacy `AgentSession` navigation module asynchronous.

#### P3.5b — Interactive runtime ownership and rebinding (complete 2026-09-03)

- Moved the interactive composition root onto `AgentSessionRuntime`; `/new`,
  `/resume`, and `/fork` now use its replacement boundary while legacy direct
  calls remain available only when an embedding host does not provide a runtime.
- Added an explicit pre-invalidation/rebind contract: unsubscribe and remove old
  extension UI before disposal, then bind the replacement session, footer,
  branch watcher, autocomplete, themes, extensions, and agent subscription.
- Recreate cwd-bound settings and resources for the replacement workspace while
  preserving the selected model, thinking level, scoped models, and active tool
  set.
- Surface replacement extension errors/warnings and model fallback diagnostics
  in the rebound TUI instead of losing them on the asynchronous construction
  path.
- Proved replacement preparation precedes teardown and successful replacement
  follows prepare → abort → UI invalidation → dispose → create → rebind order.

#### P3.5c — Version-neutral session capabilities (in progress)

P3.5c1 adds the first production-shaped, awaitable capability boundary over the
existing legacy-v3 `SessionManager` and validated harness-v4 `Session`. It
covers metadata, branch/context queries, messages, model/thinking changes,
compaction, custom entries, labels, names, and navigation without owning a
second writer. Parent references explicitly distinguish legacy file paths from
v4 session IDs. A parity scenario proves equivalent branch/context, label, and
name behavior and rejects non-v4 metadata at the v4 factory boundary.

The parity work also corrected v4 label projection to preserve the established
legacy behavior for non-empty labels instead of silently trimming them. Session
name trimming remains unchanged in both formats.

P3.5c2a adopts this boundary for Agent lifecycle message persistence, deferred
custom messages, model changes, and manual/automatic compaction. Agent listener
promises already participate in run settlement, so message writes now complete
before their events settle; compaction writes complete before rebuilt entries
and context are read. Harness-only lane movement records are hidden from the
legacy-compatible entry facade. The AgentSession constructor explicitly rejects
a harness-v4 capability adapter while synchronous bash, thinking, navigation,
and extension callback paths remain.

P3.5c2b has also converted direct and deferred bash-result persistence to an
awaitable public operation; interactive command handling and prompt settlement
now wait for it. Thinking, navigation, and extension callback mutations still
need an explicit compatibility contract without fire-and-forget writes. The
only production backend remains `legacy-v3`; no v4 preference, write cutover,
or automatic migration is exposed.

### P3.6 — Integrate GSD, web, and Assessment Gates

- Route root CLI, headless session queries, and web bridge subprocesses through
  the version-neutral facade.
- Keep GSD task/attempt and AssessmentRun persistence in their existing DBs.
- Verify compaction events, custom entries, and gate isolation across reload.
- Add stale-session diagnostics without mutating workflow state.

Exit: auto, quick, debug, forensics, verdict, validation, ship, recovery,
assessment-gate commands, and browser session surfaces pass with both formats.

### P3.7 — Herdr live E2E and controlled cutover

- Run a real root GSD session under the pinned Herdr version.
- Dispatch single, affinity reuse, parallel >4, cancellation, and pane-loss
  subagents against the v4 opt-in backend.
- Verify worker artifact relay and common-runner semantic output are unchanged.
- Exercise detach/reattach and process restart with a v4 root session.
- Only then consider making v4 the default for newly created sessions.

Exit: real Herdr evidence passes; existing v3 sessions open without rewrite;
rollback to `legacy-v3` requires no data conversion.

### P3.8 — Optional explicit migration tooling

This slice is optional and comes after cutover.

- Preview source path, destination path, entry counts, and unsupported records.
- Copy into a new v4 file, fsync, reopen, compare semantic snapshots, and only
  then publish the destination.
- Never delete or overwrite the v3 source automatically.

Exit: migration is idempotent, cancellable, and recoverable after interruption.

## Provider-directory policy

The v0.84 provider directory reorganization is not an independent goal. Import
only behavior that is still missing after the completed v0.80 compatibility
work. In particular:

- retain current API identifiers and extension registration contracts;
- retain OpenCodex/Codex Responses and scoped environment support;
- do not rename modules merely to match upstream layout;
- require provider-specific payload and result parity tests for every move;
- never combine a provider move with a session-format cutover commit.

## Required verification matrix

Every implementation slice runs its focused tests plus, when its boundary is
touched:

- `pnpm run typecheck:extensions`
- `pnpm run test:changed:src`
- `pnpm run test:packages`
- `pnpm run build:core`
- subagent Local/Herdr semantic parity and cancellation tests
- compaction/retry/JSONL recovery tests
- web session bridge and headless JSON tests
- Assessment Gate isolation and persistence tests
- `git diff --check`

Packaging is required before default cutover. The known local package-size
failure caused by retained native development binaries must be separated from
code correctness and rerun in a clean release checkout.

## Rollback and observability

- Each v4 session records format/backend in diagnostics and list metadata.
- Adapter selection, decode failure, stale/corrupt state, and recovery action
  are visible without printing conversation content or credentials.
- Before default cutover, `legacy-v3` remains a supported explicit selection.
- A failed v4 open never creates a replacement session silently.
- Rollback changes the default for new sessions only; it does not rewrite files.

## First implementation task

Implement P3.0 only: add immutable v3 compatibility fixtures and a
version-detection matrix covering valid v3, valid upstream v4, unsupported
future version, malformed header, torn tail, symlink, and opaque downstream
entries. Do not add a v4 writer in the same change.
