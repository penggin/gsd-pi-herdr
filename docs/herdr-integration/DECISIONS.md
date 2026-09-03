# Herdr Integration Architecture Decisions

This file records decisions that materially constrain the downstream Herdr implementation. Historical decisions from the original `penggin/gsd-herdr` overlay plan are retained where useful; decisions made obsolete by moving into a managed GSD-Pi fork are explicitly marked superseded.

## ADR-H001 — Manage `penggin/gsd-pi-herdr` as the downstream distribution

**Status:** Accepted
**Date:** 2026-08-29

### Context

The first plan attempted to keep official GSD-Pi untouched and maintain a small version-specific external-backend patch from a separate integration repository. Because this fork is intended to be the long-term runtime and AI-assisted upstream maintenance cost is acceptable, constraining the architecture to a tiny seam provides less value than implementing the clean internal design.

### Decision

`penggin/gsd-pi-herdr` is the canonical downstream distribution. It may contain deliberate Herdr integration, fixes, refactors, and experimental functionality. Source lineage is historical provenance; active runtime and automation use downstream endpoints and refs only.

Use `main` for downstream integration and `feature/*` for focused work.

### Supersedes

The original overlay-repository decision and the requirement that all GSD changes fit into a minimal patch queue.

---

## ADR-H002 — Keep Herdr core unpatched initially

**Status:** Accepted

Herdr v0.8.2 already exposes the required workspace/tab/pane lifecycle, command submission, state reporting, metadata, snapshot, events, and plugin surfaces. Use official Herdr binaries and APIs unless a concrete requirement is proven impossible.

A Herdr fork requires a separate reproduced limitation and plan update.

---

## ADR-H003 — Refactor subagent execution behind runtime backends

**Status:** Accepted

The current implementation has local execution and a separate cmux execution path. The downstream fork will introduce an explicit runtime abstraction rather than adding a third duplicated Herdr path.

Target shape:

```text
Subagent execution semantics
        │
        └── SubagentExecutionBackend
            ├── LocalBackend
            ├── CmuxBackend
            └── HerdrBackend
```

Result parsing, usage accounting, missing-final-response checks, retry semantics, session/fork handling, isolation/merge decisions, and orchestration stay above the runtime-specific layer whenever possible.

---

## ADR-H004 — Keep GSD subagents in JSON mode

**Status:** Accepted

JSON mode is the structured contract the parent currently uses to recover assistant messages, tool results, usage, model metadata, stop reasons, and errors. Herdr integration must preserve that structured stream rather than replacing child execution with a second interactive TUI.

---

## ADR-H005 — Filter worker presentation; never mirror raw JSON/token deltas

**Status:** Accepted

Worker panes display identity, lifecycle, concise tool activity, retries, failures, elapsed time, and optional bounded summaries. Raw JSONL remains an artifact for parent/result processing.

Do not `tee` child JSON-mode stdout directly to the terminal.

---

## ADR-H006 — Use an internal GSD worker runner

**Status:** Accepted

Rather than a shell pipeline or an independently versioned external executable, this managed fork should provide an internal worker entrypoint, tentatively:

```text
gsd __herdr-worker <spec-path>
```

The exact CLI spelling is private and may change before implementation stabilizes.

The runner receives only a validated spec path, spawns the existing GSD child with argv arrays and `shell: false`, captures streams, renders filtered activity, reports worker state, and writes durable artifacts.

---

## ADR-H007 — Separate root-pane and worker-pane authority

**Status:** Accepted

The root reporter activates only for the visible root GSD TUI and must ignore `GSD_SUBAGENT_CHILD=1`. Worker state is reported by the worker runtime against the Herdr pane that actually hosts it.

Parent `HERDR_*` variables must not be blindly inherited as worker identity. The worker pane's Herdr-managed environment is authoritative.

---

## ADR-H008 — Monitoring failure is fatal when Herdr is required

**Status:** Accepted

If configuration requires Herdr monitoring and the backend cannot reserve/launch the worker, the dispatch fails visibly. It must not silently create a local worker that is no longer observable.

Optional fallback may be supported only as an explicit configuration and only before an external launch may have occurred.

---

## ADR-H009 — Use Herdr CLI `pane run` for atomic command submission

**Status:** Accepted for initial implementation

Herdr v0.8.2 documents `pane run` as an atomic command-submission helper that respects bracketed-paste mode. The raw socket API exposes `pane.send_text` and `pane.send_keys` but no raw `pane.run` method.

For starting a worker in a pre-existing shell pane, use the CLI wrapper through the known Herdr binary path rather than racing separate text + Enter operations. Use the raw socket API where direct semantic state, metadata, snapshot, or subscriptions are more suitable.

This decision may be revisited if a future Herdr raw command-launch method is added.

---

## ADR-H010 — Use a persistent worker-pane pool

**Status:** Accepted

Associate a worker tab with the root GSD session and default to four reusable slots. Parallel workers reserve slots; chain steps/retries should reuse a stable pane where practical.

M4 must validate usability, queueing behavior, retention, and multi-session separation before this becomes Accepted.

M4 validated the four-slot queue, successful affinity reuse, failed-pane retention, pane-loss recovery, and root-focus preservation against real Herdr v0.8.2.

---

## ADR-H011 — Use durable versioned worker artifacts

**Status:** Accepted

Long-running work needs evidence across detach/reattach and process crashes. Launch data, stdout JSONL, stderr, state, heartbeat, and final exit evidence will live under an integration-owned versioned runtime root with restrictive permissions and atomic mutable-state updates.

---

## ADR-H012 — Capability-check Herdr, synchronize GSD by upstream lineage

**Status:** Superseded in part by ADR-H018

Herdr compatibility is checked against actual API/CLI capability behavior and the schema bundled with the supported Herdr binary.

The historical source-base commit remains recorded. The earlier routine
`upstream-main` synchronization policy is no longer active; ADR-H018 requires
downstream-only automation unless the user explicitly authorizes a new source
import. Version/fingerprint-only patch application is not a production model.

---

## ADR-H013 — Target macOS arm64 first

**Status:** Accepted

The initial production target is macOS arm64. Keep process/filesystem abstractions portable where inexpensive, but Windows/Linux support does not block the first stable Herdr integration.

---

## ADR-H014 — Preserve the M0.6 package-overlay investigation as historical evidence

**Status:** Accepted / historical

The previous investigation proved that a published GSD package prefers built `dist/resources`, synchronizes them into the managed agent directory, and can skip resource refresh based on its content fingerprint. Therefore a `src/resources`-only overlay was unsafe.

The downstream fork no longer needs that overlay approach, but the finding is retained under `spikes/M0.6-GSD-PACKAGE-LOADING.md` because it documents GSD's packaging behavior and explains why source-built downstream releases are the cleaner path.

---

## ADR-H015 — Keep the operations plugin observational and use owner-consumed cleanup requests

**Status:** Accepted
**Date:** 2026-08-30

Herdr plugin commands run in separate processes and cannot safely mutate the root GSD process's in-memory pane leases. The plugin may inspect GSD-owned artifacts plus `session.snapshot`, focus live resources, clear stale Herdr presentation authority, and write an owner-only `cleanup.json` request into a terminal worker directory.

Only the matching root GSD pane pool consumes that identity-bound request and changes a retained slot back to reusable. The plugin never launches workers, chooses retry/chain/parallel behavior, deletes live or ambiguous evidence, or treats a pane state as the GSD semantic result.

---

## ADR-H016 — Recover from durable, instance-bound ownership and use an orphan handshake

**Status:** Accepted
**Date:** 2026-08-30

Root runtimes publish an instance-bound lease and heartbeat. Worker reservations
publish pane/affinity ownership before submission and advance it through the
runner lifecycle. A replacement runtime reconstructs conservative slot state
from this evidence: active recovered affinity is queued, never duplicate-launched;
failed/orphaned slots remain retained; settled success may be reclaimed.

When reconciliation proves the root owner unavailable while a worker is still
alive, the out-of-process plugin writes an identity-bound, owner-only
`orphan.json`. The internal runner—not the plugin—consumes this request, performs
bounded process-tree cancellation, and publishes final orphan/abort evidence.
This preserves GSD's orchestration authority while making root crash recovery
work across process and Herdr restart boundaries.

---

## ADR-H017 — Make compatibility/release automation observational until promotion

**Status:** Accepted
**Date:** 2026-08-30

Repository impact checks operate on downstream refs already present in the
checkout and produce review artifacts; they never fetch, merge, rebase, or push.
Herdr canaries resolve exact official Herdr release assets, capability-check
their bundled schema/CLI/plugin contract, and build/test the downstream checkout
without promoting it.

Release stamping is likewise observational except for its explicit output file.
It refuses dirty promotion worktrees and source bases outside downstream ancestry, embeds
the prior known-good tuple, and never rewrites that rollback target. A human or a
separately authorized release workflow promotes a candidate only after the live
E2E and package gates are recorded.

---

## ADR-H018 — Isolate downstream package and network identity

**Status:** Accepted
**Date:** 2026-08-30

The distributable package is `@penggin/gsd-pi-herdr`. Runtime update checks,
release notes, model-catalog refreshes, issue guidance, Docker images, npm
automation, and Herdr canaries must use downstream-owned endpoints and refs.
They may not fetch, publish to, modify, or create issues against the original
project without a new explicit user authorization and decision record.

Every tarball carries `dist/herdr-release.json`; `gsd --build-info` exposes that
identity after installation; and the package gate verifies both from an isolated
prefix. The source-base commit remains recorded as lineage only, not as an
instruction to contact the source repository.

---

## ADR-H019 — Publish only downstream-owned artifacts

**Status:** Accepted
**Date:** 2026-08-30

The release set contains `@penggin/gsd-pi-herdr`, its five
`@penggin/gsd-pi-herdr-engine-*` platform packages, and explicitly approved
optional downstream resource packs such as
`@penggin/gsd-assessment-pack-gstack`. Inherited internal workspaces keep their
compatibility import names but are `private`, have no `publishConfig`, and ship
only as bundled content inside the downstream root tarball. Release discovery
must exclude private/native workspace manifests from the generic
workspace-publish path and must reject any release inventory outside the
`@penggin` scope.

The CI builder and runtime images likewise use the `ghcr.io/penggin/` namespace.
Installer paths, support links, issue/project prompts, local comparison defaults,
and release documentation target this repository. Historical attribution may
retain source-project references in archived design evidence and regression
fixtures, but executable runtime, install, CI, support, and publication paths
must never address or mutate source-project assets.

---

## ADR-H020 — Keep warm panes, release settled presentation authority, and self-heal stale topology

**Status:** Accepted
**Date:** 2026-08-31

Successful/aborted worker shell panes remain in the bounded pool for reuse, but
their Herdr agent authority is cleared only after final lifecycle/metadata
reporting and immutable exit evidence have settled. Failed or ambiguous workers
remain visible and retained for review.

The in-memory pool is a lease cache, not topology authority. Before reservation
it reconciles cached tab/pane IDs against live Herdr state, removes missing
non-leased slots, and recreates a missing worker tab when no execution lease
remains. A reserved pane is probed before command submission and may be safely
re-reserved once when already absent. Once `pane run` may have been submitted,
the no-duplicate-launch rule remains absolute: the current execution fails or
reconciles explicitly, and only a later distinct GSD dispatch may use repaired
capacity.

---

## ADR-H021 — Keep lifecycle notifications best-effort and Herdr-owned

**Status:** Accepted
**Date:** 2026-09-01

Root GSD turns and Herdr workers request native `notification.show` delivery at
human-attention boundaries. Normal root-turn and worker completion use sound
`done`; the first transition into a user/action-required or durable-failure
`blocked` interval uses sound `request`. Repeated updates while an agent remains
blocked are deduplicated, and a blocked request that settles before its report
returns cannot publish a stale notification.

Notifications are presentation only. Fixed titles and bounded, redacted bodies
exclude question text, choices, answers, secure-input details, and credentials.
Herdr owns enablement, rate limiting, foreground-client availability, position,
sound playback, and final delivery. A disabled, busy, rate-limited, unavailable,
or failed notification must never alter GSD lifecycle state, retry policy,
semantic results, or immutable worker exit evidence.

Each notification uses one bounded socket attempt. It is not retried after an
ambiguous timeout because the first request may already have displayed a toast;
at-most-once presentation is preferred over duplicate completion/attention
alerts.

---

## ADR-H022 — Project model output as coalesced, bounded pane activity

**Status:** Accepted
**Date:** 2026-09-02

Herdr worker panes display provider-emitted thinking and assistant text in
addition to lifecycle/tool activity. The renderer never prints raw
`message_update` records or individual token fragments: it accumulates deltas
until a complete line or content-block boundary, then emits labelled,
line-wrapped output. Each thinking/text stream has a per-message character cap,
credential redaction, and terminal-control stripping.

This is presentation only. The exact JSONL stream remains privately persisted
and relayed unchanged to the common GSD semantic parser. Model-output activity
does not change worker status, usage aggregation, retry policy, final result, or
pane release authority. Only reasoning content explicitly emitted by the
provider can be shown; the integration does not infer or recover hidden model
state.

---

## ADR-H023 — Never downgrade an adopted Task lifecycle to legacy completion

**Status:** Accepted
**Date:** 2026-09-02

Once a Task has a canonical workflow lifecycle, every completion or blocker
submission remains bound to a held running Task Attempt. A late
`blockerDiscovered` call from a provider-timed-out or otherwise surviving agent
turn must fail closed with the recorded recovery instruction; it cannot route
through the legacy completion writer.

The legacy writer marks Tasks complete and renders SUMMARY projections without
canonical Attempt authority. Allowing that downgrade after the supervisor has
already settled an Attempt can leave an open DB lifecycle beside a completion
artifact and trip `artifact-db-status-divergence`. Truly legacy Tasks with no
adopted lifecycle retain their compatibility path. Canonical Tasks instead
consume their recorded retry/recovery action through the GSD orchestrator.

---

## ADR-H024 — Make ModelsStore canonical for refreshed provider catalogs

**Status:** Accepted
**Date:** 2026-09-03

Provider model discovery persists complete, provider-keyed model snapshots
through the provider-neutral `ModelsStore` contract. The coding-agent file
implementation serializes concurrent writers under the existing owner-only
locked storage boundary, supports caller cancellation, and keeps validator
metadata (`etag`, `lastModified`, and `checkedAt`) alongside the models.

`models-store.json` is canonical for refreshed catalogs. The older
`discovery-cache.json` may be read once as a compatibility input and promoted
to the new store, but it is not a second source of truth. Bundled models,
downstream catalog overlay, `models.json`, and extension provider composition
remain under `ModelRegistry` until the next migration slice establishes and
tests one explicit precedence pipeline. Network refresh stays opt-in through
the existing discovery command paths; normal startup does not gain an upstream
or provider network dependency.

---

## ADR-H025 — Compose providers deterministically and adapt credentials incrementally

**Status:** Accepted
**Date:** 2026-09-03

Provider models are reconstructed from stable layers in this order:
`built-in < downstream catalog overlay < models.json < extension provider`.
Repeated extension registrations merge defined fields and trigger a rebuild
from those inputs; they do not mutate an already-mutated catalog. Unregistering
an extension restores the lower layers exactly. `models.json` request settings
remain separate from extension registration state.

The v0.80 `CredentialStore` contract is introduced through an adapter over the
existing locked `AuthStorage`, not through a second credential file. Its
metadata listing cannot expose secret values, and `modify` performs the OAuth-
safe read/modify/write inside the storage lock. Existing login, runtime override,
command-backed key, and provider request resolution remain authoritative until
their consumers migrate to the adapter.

---

## ADR-H026 — Defer dynamic tools only through explicit provider capabilities

**Status:** Accepted
**Date:** 2026-09-03

Dynamic tool activation is recorded as optional `addedToolNames` provenance on
the canonical tool-result transcript. A provider may move those definitions out
of the stable request prefix only when its model compatibility metadata names a
native deferred-tool wire contract. OpenAI Responses and Codex-compatible
endpoints therefore require `supportsAdditionalTools` or `supportsToolSearch`;
an arbitrary Responses-compatible proxy is never assumed to implement either.

First-party Anthropic Claude 4.5+ models, except Haiku, use the documented
`defer_loading`/`tool_reference` contract by default. Anthropic-compatible
proxies require `supportsToolReferences: true`. Providers and old transcripts
without the marker keep the complete active tool list. Mixed tool-set
contractions are never represented as append-only provenance, and an Anthropic
request with no immediate definition falls back to an eager tool list. These
fallbacks preserve replay correctness ahead of prompt-cache optimization.

---

## ADR-H027 — Migrate session formats through dual readers, never startup rewrite

**Status:** Accepted
**Date:** 2026-09-03

The Pi v0.84 harness/session-v4 migration must preserve existing version-3
conversation logs as user data. Runtime startup may detect and read both
formats, but it cannot rewrite a v3 file in place, silently replace a failed
open with an empty session, or mix v3 and v4 records in one file. A session is
written only in the format selected when that file is created.

The migration proceeds behind a version-neutral repository adapter. The
legacy-v3 implementation remains the default and rollback path until v4 memory
and JSONL conformance, coding-agent/headless/web parity, GSD lifecycle
regressions, Assessment Gate isolation, and real Herdr worker E2E all pass. Any
later migration command must copy to a new file, validate semantic equivalence,
and retain the source.

Provider directory reorganization is explicitly independent of session format.
Provider behavior may be imported when a tested semantic gap exists, but file
moves or API renames are not a migration goal and may not share a cutover commit
with session persistence changes. GSD databases and AssessmentRun records remain
canonical for workflow state; Herdr remains authoritative for terminal runtime.

---

## ADR-H028 — Require an asynchronous production seam before session-v4 opt-in

**Status:** Accepted
**Date:** 2026-09-03

The validated version-4 memory and JSONL stores remain asynchronous and are not
adapted behind a duplicate synchronous writer. The deployed coding-agent
`SessionManager` surface is synchronous, and current GSD session callers depend
on those immediate append, branch, and query results. Pretending that the v4
backend fits that surface would either weaken durability or create two
independent persistence implementations.

P3.5 therefore requires an asynchronous production composition seam using the
working downstream `AgentHarness` contract before `harness-v4` can be exposed as
an opt-in runtime. The latest primary upstream at `4e69b0c28` is not a shortcut:
its new `AgentHarness` still reports `HarnessNotImplemented` for production
prompt, compaction, and navigation operations. Legacy v3 remains the runtime
default and existing v3 files remain untouched while this seam is designed and
characterized.

Independent upstream correctness fixes may continue to land when they preserve
the current session authority boundary and have focused regressions. They do not
constitute or imply a session-format cutover.

---

## ADR-H029 — Drain synchronous extension mutations at awaited runtime boundaries

**Status:** Accepted
**Date:** 2026-09-03

Existing Pi extensions use synchronous `appendEntry`, `setSessionName`,
`setLabel`, and `setThinkingLevel` callbacks. Breaking those signatures would
invalidate installed extensions, while ignoring the Promise from an
asynchronous harness-v4 store would falsely report completion before durability
and could lose or reorder mutations.

The production session seam therefore owns a mutation drain, not a second
writer. Legacy-v3 mutations begin immediately so established read-after-write
behavior remains intact. Harness-v4 mutations are serialized through the one
validated capability adapter. Failures are retained and rethrown when the
enclosing extension command, input hook, Agent event, prompt settlement, or
explicit lifecycle boundary drains the queue. No rejection may be silently
discarded, and disposal/cutover cannot be enabled for v4 until every external
entry point has such an awaited boundary.

The drain does not make extension state authoritative and does not add a new
session log. The selected session backend remains the only durability owner.
GSD lifecycle state and Herdr runtime authority remain unchanged.

---

## ADR-H030 — Serve synchronous session reads from an atomic compatibility snapshot

**Status:** Accepted
**Date:** 2026-09-03

Pi's footer, selectors, export commands, and installed extension contexts expose
synchronous session reads, while the harness-v4 repository contract is
asynchronous. Production therefore maintains one read-only compatibility
snapshot beside the selected capability adapter. The snapshot contains no
mutation methods, never writes a session file, and is atomically replaced only
after a backend read or mutation succeeds. Returned entries and trees are
defensive copies so callers cannot mutate the projection in place.

Common append operations update the projection from the newly persisted entry;
tree movement, labels, and names perform a complete refresh. This avoids
rescanning a long transcript after every normal message while preserving one
coherent view at UI and extension boundaries. Legacy-v3 synchronous extension
mutations also refresh directly from the same manager before the callback
returns, preserving existing read-after-write behavior; their durability or
policy failures still surface through ADR-H029's awaited drain.

The snapshot is not a second writer and does not change authority: the selected
session backend remains canonical, GSD owns workflow state, and Herdr owns
terminal runtime. A harness-v4 production opt-in remains forbidden until
new/open/fork construction and CLI/headless parity use the same capability-
backed runtime object.

---

## ADR-H031 — Keep session creation and fork semantics inside the selected runtime factory

**Status:** Accepted
**Date:** 2026-09-03

New-session parentage and forks are backend operations, not AgentSession or UI
operations. Parent identity is therefore typed as either a legacy file path or
a harness-v4 session ID, and the selected runtime factory must reject the wrong
identity kind. The factory owns create/open/continue/memory and source-to-leaf
fork construction and returns one prepared capability/snapshot bundle.

The harness-v4 test factory uses the validated v4 JSONL and memory repositories
directly; it does not translate v4 writes through `SessionManager`. Legacy-v3
persisted forks are prepared without mutating the active source. The exceptional
legacy in-memory fork still reuses its manager, so runtime teardown must precede
that mutation to preserve shutdown callback semantics.

Providing this factory does not enable v4 production selection. `AgentSession`
construction and the extension `newSession({ setup(sessionManager) })` callback
still require an explicit backend-neutral compatibility decision and full
CLI/headless parity. Until then, selection remains fail-closed and legacy-v3 is
the only deployed backend.

---

## ADR-H032 — Expose legacy setup callbacks only when a legacy manager exists

**Status:** Accepted
**Date:** 2026-09-03

`AgentSession` may be constructed from a capability adapter plus its coherent
read snapshot without a legacy `SessionManager`. Read-only extension context
continues to receive that snapshot, and all common persistence uses the selected
capability adapter. The public legacy manager getter remains available for
existing legacy embeddings but throws a backend-specific diagnostic on v4.

The historical `newSession({ setup(sessionManager) })` callback is inherently
legacy because it grants direct mutation access to `SessionManager`. It is not
silently emulated and is not passed a fake manager. On harness-v4 the runtime
rejects this option before tearing down the active session. Callers that need to
act after a backend-neutral replacement must use `withSession` and the normal
AgentSession/extension capability surface.

This policy preserves installed legacy extensions, avoids a second v4 writer,
and makes incompatibility explicit. It does not yet enable a global v4 default;
CLI/headless/GSD/Herdr parity and controlled selection remain separate gates.

---

## ADR-H033 — Validate v4 composition through an internal fail-closed selector

**Status:** Accepted
**Date:** 2026-09-03

The root composition may select `harness-v4` only through the internal
`GSD_INTERNAL_SESSION_BACKEND` environment variable while migration parity is
being established. The accepted values are exactly `legacy-v3` and
`harness-v4`; an unknown value is an error, and an unset value retains the
deployed legacy-v3 behavior. This is a test and operator-validation seam, not a
documented user preference or automatic format migration.

The selected factory prepares the entire capability/snapshot/runtime bundle for
print, JSON-worker, and interactive startup. Harness-v4 validation must not run
legacy flat-session migration as a startup side effect. Format mismatch or v4
open failure remains explicit and cannot create a replacement legacy session.

The selector is not a cutover decision. Session catalog/resume, headless/web
queries, GSD lifecycle commands, and real Herdr worker flows must pass their
two-backend matrices before a public opt-in or default change is considered.

---

## ADR-H034 — Keep session catalog and rename authority in the selected backend

**Status:** Accepted
**Date:** 2026-09-03

Session discovery and display metadata are backend operations. The selected
runtime factory therefore owns list and rename operations in addition to
create/open/continue/fork. Legacy-v3 delegates to `SessionManager`; harness-v4
lists and validates its JSONL repository, opens each accepted session, and
projects the existing `SessionInfo` contract from the authoritative snapshot.
No second catalog, migration table, or independent metadata writer is created.

Root CLI session selection, interactive `/resume` and rename, headless resume,
and web list/rename subprocesses must use this boundary. A legacy fallback may
remain only for backward-compatible embeddings that construct interactive mode
without `AgentSessionRuntime`, and the unset/legacy web boot path may retain its
existing bounded local reader for startup performance. Selecting harness-v4
must never route those operations through a v3 parser.

This decision does not make harness-v4 public or default. Custom legacy
`sessionDir` behavior, standalone package entry points, the full two-backend
command matrix, GSD lifecycle regressions, and real Herdr worker evidence remain
cutover gates.
