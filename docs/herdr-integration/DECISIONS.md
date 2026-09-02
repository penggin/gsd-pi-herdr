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
