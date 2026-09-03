# Pi v0.84 harness/session migration plan

Date: 2026-09-03

Status: P3.0–P3.7 complete with an explicit v4 opt-in; legacy-v3 remains default

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
use the synchronous extension-facing API through a new mutation drain: legacy
writes begin immediately, v4 writes serialize, and command/input/Agent/prompt
boundaries await and surface any recorded durability failure. This is a queue
over the selected adapter, not a second writer. Navigation query/export and
tree navigation now uses the capability contract exclusively for leaf/entry
queries, branch-summary publication, labels, movement, and context rebuilding.
Session transition and runtime teardown drain pending extension mutations before
invalidating the outgoing session. An atomic read-only compatibility snapshot
now supplies footer, selector, stats, export, print, and extension-context reads;
normal appends update it incrementally while tree/name/label changes refresh the
whole projection. Legacy new/open/fork construction surfaces still require
conversion. The only production backend remains `legacy-v3`; no v4 preference,
write cutover, or automatic migration is exposed.

P3.5c3 replaces bare `SessionManager` factory results with one coherently
prepared runtime object containing the selected backend identity, awaitable
capability adapter, synchronous read snapshot, and a transitional legacy handle.
CLI print/JSON-worker and interactive startup pass the whole prepared bundle
into the SDK, and `/new`, `/resume`, `/fork`, and import replacement paths keep
that bundle intact through prepare → teardown → create → rebind. SDK restoration
and initial model/thinking persistence use the selected capability adapter and
refresh the same snapshot before publishing the `AgentSession`. The legacy
handle remains required for construction/fork operations that have not yet been
expressed as version-neutral capabilities, so harness-v4 remains fail-closed.

Next: add version-neutral construction and fork operations to the runtime
factory/capability boundary, remove replacement semantics' dependency on the
transitional legacy handle, then run the complete CLI/print/JSON/headless parity
matrix. Do not remove the harness-v4 guard until that matrix passes.

P3.5c4 moves new-session parent identity and fork construction behind the
runtime factory. `AgentSessionRuntime` now supplies a typed parent reference or
source runtime plus target leaf and no longer calls legacy `newSession()` or
`createBranchedSession()` itself. The legacy factory rejects a v4 session-ID
parent instead of silently serializing it as a file path, creates persisted
forks without mutating the active source, and preserves the established
shutdown-before-mutation order for in-memory legacy forks. Session cwd and
target-file reads use the prepared snapshot; the sole remaining legacy unwrap
inside replacement is the centralized `createRuntime()` compatibility bridge.

Next: implement a harness-v4 prepared-runtime factory over the validated v4
memory/JSONL repositories, then replace the centralized legacy construction
bridge and extension `newSession({ setup })` compatibility surface with an
explicit backend-aware contract. Keep v4 unselectable until both changes and
CLI/headless parity are complete.

P3.5c5 adds that harness-v4 factory without making it selectable. It provisions,
opens, resumes, and forks the validated v4 JSONL repository and provides an
isolated v4 memory repository for no-session runs. Both return the same prepared
capability/snapshot shape as legacy-v3, never expose a legacy manager, preserve
session-ID parentage, and reject legacy path parents. A cwd metadata override on
the v4 harness storage adapter gives memory sessions and explicit open overrides
the same runtime cwd semantics without modifying durable headers.

Next: remove `AgentSession` construction's mandatory legacy manager and define
how the backward-compatible extension setup callback behaves on non-legacy
backends. Then run the same AgentSession lifecycle suite over prepared legacy
and v4 memory runtimes before exposing any preference or CLI selector.

P3.5c6 removes that construction dependency. `AgentSession` now accepts the
selected capability adapter and snapshot without a legacy manager; its legacy
getter remains source-compatible but fails explicitly on harness-v4. Runtime
fork, switch, and new-session replacement execute on real v4 JSONL sessions.
The legacy-only `setup(sessionManager)` option is rejected before teardown on
v4, while `withSession` remains the backend-neutral post-replacement path.

P3.5c7 adds an internal-only composition selector through
`GSD_INTERNAL_SESSION_BACKEND`. It accepts only `legacy-v3` or `harness-v4`,
rejects unknown values instead of silently falling back, and leaves an unset
environment on the deployed `legacy-v3` default. Root print/JSON and interactive
construction receive the selected prepared runtime without unwrapping a legacy
manager. Harness-v4 startup also skips the legacy flat-session migration so a
validation run cannot mutate v3 storage. A network-free built-CLI smoke proves
that JSON no-session mode constructs AgentSession and emits a version-4 session
header; an additional real Codex JSON turn completed through the same path.

Next: make session listing/resume selection and headless/web session queries use
the version-neutral catalog rather than legacy `SessionManager.list()`, then run
the full print/JSON/RPC/headless matrix against both internal backends. Do not
add a public preference or change the default until GSD and Herdr gates pass.

P3.5c8 adds catalog and rename operations to the selected session runtime
factory. The root `sessions` picker, interactive `/resume` and rename actions,
headless `--resume`, and web session list/rename subprocesses now resolve through
that boundary. Legacy-v3 delegates to its existing manager; harness-v4 reads and
validates its JSONL repository and projects the established `SessionInfo` view
without creating a parallel index or writer. The default web boot path retains
its existing fast legacy reader while the explicit harness-v4 selector uses the
version-neutral subprocess.

Next: run the complete print, JSON, RPC, and headless command matrix against both
internal backends, then cover GSD lifecycle and browser command surfaces. The
standalone `@gsd/agent-modes` executable and custom legacy `sessionDir` semantics
remain explicit adapter work; neither is grounds for exposing a public v4
preference yet.

P3.5c9 completes the built-CLI command matrix for the migration seam. Both
legacy-v3 and harness-v4 pass text print startup, JSON session headers, RPC v2
init/shutdown, and headless resume-catalog resolution. The standalone
`@gsd/agent-modes` compatibility entry remains legacy-owned and now rejects an
internal v4 selector explicitly instead of silently running a v3 manager. Its
package test command also includes root-level contract tests, which had
previously been skipped by the recursive-only glob.

Next: begin P3.6 with GSD lifecycle, Assessment Gate, and browser session command
regressions on both internal backends. Preserve the internal-only selector and
legacy default until P3.7 supplies real Herdr worker evidence.

### P3.6 — Integrate GSD, web, and Assessment Gates

- Route root CLI, headless session queries, and web bridge subprocesses through
  the version-neutral facade.
- Keep GSD task/attempt and AssessmentRun persistence in their existing DBs.
- Verify compaction events, custom entries, and gate isolation across reload.
- Add stale-session diagnostics without mutating workflow state.

Exit: auto, quick, debug, forensics, verdict, validation, ship, recovery,
assessment-gate commands, and browser session surfaces pass with both formats.

P3.6a proves the common command/bootstrap boundary. Both internal backends run
`/gsd status`, `/gsd gate list`, and `/gsd gate status` through the built JSON
CLI without a provider request. Browser boot lists v4 sessions and inactive
rename now reopens and mutates the selected v4 repository rather than assuming
legacy records. The focused GSD authority suite for Assessment Gates, auto
recovery, quick, validation, verdict, ship, and read-only forensics remains
green, confirming those domains still use their canonical DB/state paths.

Next: validate persisted custom/compaction records across v4 reload and run the
remaining debug/recovery/browser command surfaces. Then proceed to the real
Herdr worker matrix; no public backend preference is added in P3.6.

P3.6b completes that integration gate. A persisted harness-v4 session now has
explicit reopen coverage for ordinary custom entries, displayed custom
messages, and compaction records. The built two-backend command matrix also
runs status, Assessment Gate list/status, debug list, noninteractive forensics,
quick usage, validation, verdict, and recovery surfaces without provider
access. The focused GSD authority suite and combined browser contracts remain
green, including inactive v4 rename.

P3.5c10 closes the custom `sessionDir` compatibility gap discovered during the
P3.6 audit. An explicit directory is now a flat backend-owned root for v4, just
as it is for legacy-v3, while the default global v4 root remains partitioned by
cwd. Create, explicit-path open, continue, list, fork, and rename all use the
same scoped repository and retain v4 containment/atomicity checks. The root
composition resolves `--session-dir`, the GSD environment variable, the legacy
Pi environment alias, and settings in one deterministic precedence order.
Print/JSON `--continue` now actually reopens the most recent selected session
instead of silently creating another one.

P3.7 is now the sole active cutover gate. The production default is still
legacy-v3 and the v4 selector remains internal-only.

### P3.7 — Herdr live E2E and controlled cutover

- Follow the exact isolated-path, marker, scenario, capture, and closeout
  procedure in
  `docs/herdr-integration/spikes/P3.7-SESSION-V4-LIVE-RUNBOOK.md`. A partial
  matrix is retained as diagnostic evidence but cannot authorize cutover.
- Run `pnpm run herdr:session-v4-live-audit -- --manifest <path>` after the
  worker matrix. The bounded auditor validates v4/root identity, private
  artifacts, exact semantic markers, usage, affinity reuse, four-pane queueing,
  cancellation, pane loss, raw-pane suppression, stable detach topology, root
  lease replacement, and append-only v4 restart without copying transcript
  content. Original captures remain required for operator review.
- Run `pnpm run herdr:session-v4-live-preflight` from the candidate root pane
  before dispatching work. The preflight fails closed outside Herdr, from a
  child agent, when the internal v4 selector is absent, when inherited/current
  pane identity differs, or when the pinned v0.8.2/protocol-20 capability
  contract is not present. Use `--output <path>` to retain its JSON evidence.
- Run a real root GSD session under the pinned Herdr version.
- Dispatch single, affinity reuse, parallel >4, cancellation, and pane-loss
  subagents against the v4 opt-in backend.
- Verify worker artifact relay and common-runner semantic output are unchanged.
- Exercise detach/reattach and process restart with a v4 root session.
- Only then consider making v4 the default for newly created sessions.

Exit: real Herdr evidence passes; existing v3 sessions open without rewrite;
rollback to `legacy-v3` requires no data conversion.

Live gate result (2026-09-03): passed on macOS arm64 with Herdr v0.8.2 and
protocol 20. The public subagent path passed single, chain affinity, five-way
parallel queueing at four panes, cancellation, pane loss/recovery,
detach/reattach, and append-only root restart under `harness-v4`. The bounded
auditor returned `ready=true` with all ten required markers, positive usage,
private artifacts, and no raw worker-pane JSON. This authorizes design of a
public opt-in; it does not by itself authorize changing the default.

Controlled selection result (2026-09-03): the root CLI now exposes
`--session-backend legacy-v3|harness-v4`, with `GSD_SESSION_BACKEND` for
automation. The value is propagated through headless/RPC and web launches;
unknown values fail startup. Unset selection and explicit rollback remain
`legacy-v3`. Existing session files stay format-bound and a mismatched open
fails without rewrite, conversion, or empty-session fallback. No default
cutover or automatic migration was added.

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
