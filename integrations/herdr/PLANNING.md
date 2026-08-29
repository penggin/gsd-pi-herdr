# GSD-Pi Herdr Living Plan

> **Status:** M0 complete; M1 implementation is ready to begin  
> **Last updated:** 2026-08-29  
> **Current milestone:** M1 — unified subagent execution contract  
> **Canonical rule:** every Herdr implementation session begins by reading this file and ends by updating it.

## 1. Mission

Build and maintain `penggin/gsd-pi-herdr` as a downstream GSD-Pi distribution in which every active subagent can run in a persistent, observable Herdr pane without changing GSD's semantic result behavior.

The integration must provide:

- accurate root-session `working`, `blocked`, and `idle` state;
- a visible pane for every running subagent, with bounded human-readable activity;
- complete JSONL and stderr evidence for GSD's existing parser and diagnostics;
- single, parallel, chain, retry, background, resume, fork-context, and isolation support;
- explicit cancellation, launch ambiguity, failure, pane-loss, and orphan handling;
- detach/reattach durability;
- regular semantic synchronization with upstream GSD-Pi;
- reproducible build, canary, rollback, and downstream release procedures.

## 2. Repository model

### GSD-Pi

`penggin/gsd-pi-herdr` is the owned runtime distribution. It may refactor or extend GSD-Pi where that creates a cleaner, testable downstream architecture. Changes remain focused, documented, and upstream-aware.

### Herdr

`herdrdev/herdr` remains external. The integration consumes its public plugin, CLI, and socket APIs. A Herdr fork requires a reproduced public-API limitation and a new accepted ADR.

### Historical planning repository

The initial overlay-repository plan from `penggin/gsd-herdr@d13fbe85ad584dd7505a5420d668c780ac137726` was migrated under `integrations/herdr/`. Preserved evidence remains relevant; the former assumption that GSD-Pi should receive only a tiny out-of-tree patch is superseded.

## 3. Branch model and baseline

```text
upstream-main
  exact mirror of a reviewed open-gsd/gsd-pi main commit

main
  releasable downstream line: upstream + accepted Herdr/custom changes

integration/herdr-*
  feature and integration work

sync/upstream-*
  temporary semantic merge and validation branches

release/*
  release preparation and immutable downstream tags
```

Current recorded baseline:

```text
open-gsd/gsd-pi main:      4b26a642c0121ae6161abbb6f2dc6937c78874dd
penggin/gsd-pi-herdr main:  4b26a642c0121ae6161abbb6f2dc6937c78874dd
upstream-main:              4b26a642c0121ae6161abbb6f2dc6937c78874dd
planning branch:            integration/herdr-foundation
historical cmux branch:     fix/cmux-split-cli @ 5b74d301b6d1599df5fe0a385b90a28b48492b9a
```

The 29 upstream commits that existed at migration time were fast-forwarded before downstream planning changes were added.

## 4. Core design principles

1. **One owned GSD distribution.** Do not accept poor architecture merely to minimize downstream diff size.
2. **Herdr through public APIs.** Do not fork Herdr preemptively.
3. **One execution contract.** Local, cmux, and Herdr paths share launch, stream, result, cancellation, handle, and lifecycle semantics.
4. **GSD owns meaning.** Backends do not choose prompts, models, retries, sessions, isolation, merge outcomes, or task success.
5. **Herdr owns terminal state.** Pane creation, persistence, focus, visible state, and terminal input belong to Herdr.
6. **Readable monitoring.** Preserve raw JSONL as evidence; never render token-delta JSON directly in panes.
7. **No invisible fallback.** Required monitoring is part of correctness, not decoration.
8. **Durable evidence.** Never infer success without authoritative process and result evidence.
9. **Semantic upstream sync.** A clean merge or compile is not proof that downstream behavior survived upstream change.
10. **Documentation follows code.** Update this plan and ADRs whenever implementation changes architecture or scope.

## 5. Final target code layout

M0 selected the following ownership boundaries:

```text
src/resources/extensions/subagent/
├── index.ts
├── launch.ts
├── isolation.ts
├── run-store.ts
├── execution/
│   ├── types.ts
│   ├── collector.ts
│   ├── selector.ts
│   ├── execute.ts
│   └── backends/
│       ├── local.ts
│       ├── cmux.ts
│       └── herdr.ts
└── tests/

src/resources/extensions/herdr/
├── extension-manifest.json
├── index.ts
├── preferences.ts
├── main-session-state.ts
├── diagnostics.ts
└── tests/

packages/herdr-runtime/
├── bin/gsd-herdr-worker.js
├── src/client/
├── src/protocol/
├── src/worker/
└── tests/build metadata

integrations/herdr/
├── planning and technical documentation
├── Herdr plugin assets
├── compatibility fixtures
└── real-Herdr contract and E2E tests
```

Dependency direction:

```text
subagent orchestration
  → execution contract and collector
    → local backend
    → cmux backend → low-level cmux client
    → Herdr backend → @gsd/herdr-runtime

bundled Herdr root extension
  → @gsd/herdr-runtime

Herdr plugin / E2E
  → public Herdr APIs and installed downstream GSD build
```

The GSD run store remains the semantic status/result projection. `@gsd/herdr-runtime` owns protected raw process evidence.

## 6. Milestones

### M0 — Downstream baseline and feasibility validation

**Goal:** consolidate planning, synchronize the fork, verify Herdr and GSD surfaces, and remove unresolved runtime ownership before implementation.

**Status:** `COMPLETE`

- [x] M0.1 Inspect `penggin/gsd-pi-herdr` and identify downstream changes.
- [x] M0.2 Confirm `main` had no custom commits and record the retained cmux feature branch.
- [x] M0.3 Create `upstream-main` and fast-forward the fork baseline to current upstream `main`.
- [x] M0.4 Migrate and re-home the `penggin/gsd-herdr` planning corpus under `integrations/herdr/`.
- [x] M0.5 Add root-level repository guidance and README visibility for the downstream integration.
- [x] M0.6 Verify required Herdr methods and request/response shapes against `v0.8.2` and current `master` schemas. See [`docs/spikes/M0.6-HERDR-API-CAPABILITIES.md`](docs/spikes/M0.6-HERDR-API-CAPABILITIES.md).
- [x] M0.7 Audit current GSD subagent, cmux, extension-loading, packaging, persistence, isolation, shutdown, and test paths. See [`docs/spikes/M0.7-GSD-EXECUTION-AUDIT.md`](docs/spikes/M0.7-GSD-EXECUTION-AUDIT.md).
- [x] M0.8 Decide source/package locations for the execution layer, Herdr client, root extension, worker runner, plugin, configuration, persistence, and tests. See [`docs/spikes/M0.8-CODE-PLACEMENT.md`](docs/spikes/M0.8-CODE-PLACEMENT.md).
- [x] M0.9 Decide migration of `fix/cmux-split-cli`. See [`docs/spikes/M0.9-CMUX-MIGRATION.md`](docs/spikes/M0.9-CMUX-MIGRATION.md).
- [x] M0.10 Write the consolidated technical plan, implementation slices, risk changes, gates, and revised effort. See [`docs/spikes/M0.10-CONSOLIDATED-TECHNICAL-PLAN.md`](docs/spikes/M0.10-CONSOLIDATED-TECHNICAL-PLAN.md).

Exit evidence:

- Herdr stable protocol 20 and canary protocol 21 were compared by checked-in schemas.
- Every current subagent dispatch call site and execution asymmetry was catalogued.
- Code, package, configuration, persistence, and test ownership were selected.
- The historical cmux patch has an explicit reimplementation decision.
- M1 has an ordered implementation plan and no unresolved architectural owner.

Known M0 evidence limit: no GSD dependency build, real Herdr binary, or real cmux binary was executed. Those are implementation-phase promotion gates, not claimed M0 results.

### M1 — Unified subagent execution contract

**Goal:** remove duplicated local/cmux execution semantics and place local, cmux, and future Herdr execution behind one internal contract.

**Status:** `READY`

#### M1A — Runtime package and protocol foundation

- [ ] M1.1 Scaffold `packages/herdr-runtime` as a private, linkable workspace package.
- [ ] M1.2 Add protocol/version and stable/canary capability fixtures.
- [ ] M1.3 Implement a minimal typed Herdr request client and capability parser with bounded errors/timeouts.
- [ ] M1.4 Add the `gsd-herdr-worker` executable stub and installed-package smoke coverage.
- [ ] M1.5 Add root build, workspace, version-sync, and test inclusion for the package.

#### M1B — Backend-neutral execution core

- [ ] M1.6 Define backend probe, launch-state, execution request, callbacks, handle, interrupt, and outcome types.
- [ ] M1.7 Extract JSONL framing, stderr accumulation, current-result state, update emission, and finalization into a reusable collector.
- [ ] M1.8 Define explicit states for not-attempted, known pre-launch failure, known launch, ambiguous launch, completion, and abort.
- [ ] M1.9 Implement backend selection and monitored fallback policy.
- [ ] M1.10 Move cmux shell serialization out of backend-neutral `launch.ts`.

#### M1C — Local parity and call-site migration

- [ ] M1.11 Implement `LocalSubagentBackend` with unchanged direct-spawn behavior.
- [ ] M1.12 Add local old-vs-new deterministic result-parity tests.
- [ ] M1.13 Add a common external/local execution-handle registry for targeted abort and session shutdown.
- [ ] M1.14 Route resume through the shared one-attempt executor.
- [ ] M1.15 Route background single through the shared executor while preserving immediate run-ID return.
- [ ] M1.16 Route chain through the shared executor without changing current chain-isolation behavior.
- [ ] M1.17 Route parallel, retry, fork context, and isolation wrappers through the shared executor.
- [ ] M1.18 Route single through the shared executor.

#### M1D — Cmux normalization

- [ ] M1.19 Reimplement direct `new-split` surface parsing, `send`, and `send-key ctrl+c` from historical commit `5b74d301...`.
- [ ] M1.20 Remove `list-surfaces`, `send-surface`, and the before/after discovery race.
- [ ] M1.21 Remove raw JSON terminal mirroring and completion-only parent parsing.
- [ ] M1.22 Replace silent or ambiguous post-split local fallback with explicit launch classification.
- [ ] M1.23 Replace self-reimplemented layout tests with tests that invoke production cmux methods.
- [ ] M1.24 Add local/cmux result parity, interrupt, shutdown, partial-grid, send-failure, ambiguity, and raw-JSON-suppression tests.

Exit criteria:

- No GSD business semantics are duplicated in backend implementations.
- Existing local behavior is semantically unchanged under deterministic parity tests.
- All supported dispatch call sites use one one-attempt executor.
- Cmux uses current CLI commands, launches the intended visible worker, streams structured records to the parent, and does not print raw JSON.
- Required monitored execution never falls back after a known or ambiguous external launch.

### M2 — Herdr client and main-session integration

**Goal:** connect a root GSD TUI session to Herdr and establish the production Herdr control client.

**Status:** `NOT STARTED`

- [ ] M2.1 Complete socket/CLI capability discovery against `gsd-herdr-runtime-v1`.
- [ ] M2.2 Implement bounded request handling, response validation, and typed ambiguity errors.
- [ ] M2.3 Add a bundled `src/resources/extensions/herdr/` extension and preference schema.
- [ ] M2.4 Activate root reporting only for TUI, non-subagent sessions.
- [ ] M2.5 Report session identity and `working`/`blocked`/`idle` state.
- [ ] M2.6 Report milestone/slice/task context through bounded metadata.
- [ ] M2.7 Release authority on shutdown and reload.
- [ ] M2.8 Add `/gsd herdr status` and `/gsd herdr doctor` diagnostics and tests.
- [ ] M2.9 Run a real Herdr `v0.8.2` schema, state-report, release, and reconnect smoke test.

### M3 — Herdr worker runner

**Goal:** execute one JSON-mode GSD child in a Herdr pane with complete evidence and readable monitoring.

**Status:** `NOT STARTED`

- [ ] M3.1 Define versioned launch/state/heartbeat/exit artifacts.
- [ ] M3.2 Spawn with argv arrays and `shell: false`.
- [ ] M3.3 Replace inherited main-pane Herdr variables with worker-pane values.
- [ ] M3.4 Capture complete stdout JSONL and stderr.
- [ ] M3.5 Relay complete JSONL records to the common GSD collector.
- [ ] M3.6 Render bounded lifecycle/tool/retry activity and suppress token deltas.
- [ ] M3.7 Report worker state to its own pane.
- [ ] M3.8 Implement heartbeat and atomic final evidence.
- [ ] M3.9 Implement process-group SIGINT → SIGTERM → SIGKILL escalation.
- [ ] M3.10 Add redaction, permissions, malformed-stream, path, signal, and failure tests.

### M4 — Persistent pane pool and complete dispatch support

**Goal:** make Herdr the production subagent backend for every supported GSD dispatch mode.

**Status:** `NOT STARTED`

- [ ] M4.1 Create or reuse a worker tab per root GSD session.
- [ ] M4.2 Implement bounded pane-slot allocation and queueing.
- [ ] M4.3 Support deterministic one-, two-, and four-worker layouts.
- [ ] M4.4 Preserve main-pane focus by default.
- [ ] M4.5 Keep chain steps and retries in stable panes where safe.
- [ ] M4.6 Define success/failure/blocked retention and safe reuse.
- [ ] M4.7 Support single, parallel, chain, background, resume, retry, fork, and isolation through Herdr.
- [ ] M4.8 Validate final output, usage, error, session, isolation, and merge parity.
- [ ] M4.9 Fail visibly when required Herdr execution is unavailable or ambiguous.
- [ ] M4.10 Run real-Herdr parallel, interrupt, and detach/reattach tests.

### M5 — Durability, recovery, and operations

**Goal:** survive detach/reattach, pane loss, parent crashes, and Herdr restarts without invisible work.

**Status:** `NOT STARTED`

- [ ] M5.1 Add durable runtime run/worker records and additive GSD run-store references.
- [ ] M5.2 Add parent and worker heartbeats.
- [ ] M5.3 Reconcile records against `session.snapshot`, events, process information, and final artifacts.
- [ ] M5.4 Detect closed panes, missing processes, missing final artifacts, and stale authority.
- [ ] M5.5 Mark orphaned workers conservatively and retain evidence.
- [ ] M5.6 Prevent duplicate launch after reload/reconnect.
- [ ] M5.7 Add Herdr plugin actions for status, focus, cleanup, and reconciliation.
- [ ] M5.8 Add crash-injection, pane-close, Herdr-restart, and detach/reattach E2E tests.

### M6 — Downstream distribution and upstream maintenance

**Goal:** make the fork reproducible to build, install, update, test, and roll back.

**Status:** `NOT STARTED`

- [ ] M6.1 Choose downstream package/binary naming and versioning.
- [ ] M6.2 Add Herdr runtime and plugin assets to root package and release validation.
- [ ] M6.3 Add stable and canary build profiles.
- [ ] M6.4 Add upstream sync automation and semantic risk reports.
- [ ] M6.5 Add macOS arm64 release artifacts and checksums.
- [ ] M6.6 Document install, migration, rollback, support, and recovery.
- [ ] M6.7 Preserve at least one previous known-good downstream release.

## 7. Current execution queue

Perform the next work in this order:

1. Create `feature/herdr-runtime-foundation` from the reviewed `integration/herdr-foundation` head.
2. Complete M1.1–M1.5: scaffold `packages/herdr-runtime`, protocol/capability fixtures, minimal client, worker stub, and build/test inclusion.
3. Complete M1.6–M1.10: backend types, collector, launch-state/fallback model, and launch-module decoupling.
4. Do not port cmux or launch a real Herdr worker until local parity in M1.11–M1.13 is green.
5. Update this file at each implementation checkpoint.

## 8. Accepted decisions

| ID | Decision |
|---|---|
| D001 | Use `penggin/gsd-pi-herdr` as the managed downstream runtime distribution. |
| D002 | Keep Herdr external and use its public plugin/CLI/socket APIs initially. |
| D003 | Introduce one internal execution-backend contract rather than an out-of-tree event-bus seam. |
| D004 | Keep GSD children in JSON mode and preserve complete JSONL. |
| D005 | Never display token-delta JSON in worker panes. |
| D006 | Use a dedicated Node worker runner with argv-based spawning. |
| D007 | Separate main-pane and worker-pane authority. |
| D008 | Default production behavior forbids silent unmonitored fallback. |
| D009 | Synchronize upstream through `upstream-main` and semantic test gates. |
| D010 | Target macOS arm64 first. |
| D011 | Support Herdr by named capability sets; `v0.8.2` protocol 20 is sufficient for the first runtime and protocol 21 is canary coverage. |
| D012 | Prefer schema-backed `layout.apply` command arrays for fresh worker layouts; retain `pane.split` for incremental repair. |
| D013 | Treat CLI `pane run` separately from raw socket methods. |
| D014 | Schema validation proves public-contract feasibility, not runtime promotion. |
| D015 | Place shared Herdr client/protocol/worker code in private workspace package `@gsd/herdr-runtime`. |
| D016 | Place backend-neutral execution logic under the bundled subagent extension and root lifecycle integration in a bundled Herdr extension. |
| D017 | Keep plugin assets, long-form integration docs, and real-Herdr E2E under `integrations/herdr/`. |
| D018 | Do not merge the old cmux branch; reimplement its valid CLI changes inside M1. |
| D019 | Require local old-vs-new result parity before cmux or Herdr external execution work. |

See [`docs/DECISIONS.md`](docs/DECISIONS.md) for rationale and superseded decisions.

## 9. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Fast upstream change rate | downstream behavior silently drifts | mirror branch, focused semantic review, parity/E2E suites |
| Backend extraction changes GSD semantics | task/retry/result regressions | common collector, local old-vs-new parity gate, full mode matrix |
| A dispatch path bypasses the shared executor | hidden backend inconsistency | explicit resume/background/chain/parallel/single call-site tests |
| Child inherits main pane identity | worker corrupts parent state | strip/reapply Herdr-managed variables and test both authorities |
| Raw JSON floods panes | unusable monitoring and render load | dedicated filtered runner and terminal-output assertions |
| External launch is ambiguous | duplicate agents modify the project | explicit launch-state model and no post-attempt fallback |
| Parent/pane failure creates invisible work | unsafe code changes | required monitoring, durable artifacts, heartbeats, reconciliation |
| Herdr API changes | runtime failures | named capability sets, schema checks, tolerant additive parsing, canary tests |
| Schema differs from runtime behavior | false confidence | mandatory real `v0.8.2` binary/socket and failure-injection tests |
| CLI helper is confused with socket API | fictitious request or shell coupling | distinct CLI/socket adapters and schema-backed paths |
| Cmux branch is stale | duplicate/conflicting fixes | reimplement validated behavior under shared backend contract |
| New workspace package is omitted from build/tarball | installed worker missing | explicit root build step, version sync, validate-pack, installed-bin smoke |
| Downstream customization grows without structure | merge cost and unclear ownership | ADRs, ownership boundaries, focused commits, downstream ledger |

## 10. Progress log

### 2026-08-29 — Original planning repository

- Created `penggin/gsd-herdr` as an overlay-integration planning repository.
- Completed documentation foundation and the GSD-Pi package-loading investigation.
- Established JSON-mode preservation, filtered monitoring, strict fallback, and durability principles.

### 2026-08-29 — Consolidation into managed downstream fork

- Inspected `penggin/gsd-pi-herdr` and confirmed its old `main` contained no custom downstream commit.
- Recorded the historical `fix/cmux-split-cli` branch and commit `5b74d301...`.
- Found upstream 29 commits ahead, created `upstream-main`, and fast-forwarded downstream `main` to `4b26a642...`.
- Created `integration/herdr-foundation` for migration and M0 work.
- Migrated the planning corpus under `integrations/herdr/`.
- Added root repository instructions and a prominent root README section.
- Rebased the architecture from an external tiny-patch overlay to a managed in-tree downstream runtime.

### 2026-08-29 — M0.6 Herdr API capability validation

- Compared Herdr `v0.8.2` commit `9eb52145...`, protocol 20, with current `master` commit `c2637dc1...`, protocol 21.
- Confirmed protocol 20 exposes the required snapshot, tab, pane, layout, process, input, authority, event, and plugin operations.
- Defined `gsd-herdr-runtime-v1` and `gsd-herdr-plugin-v1` capability sets.
- Selected `layout.apply` as the preferred fresh worker-layout strategy and `pane.split` plus validated command delivery for incremental repair.
- Corrected the assumption that `pane.run` is a raw socket method; it is a CLI convenience.
- Recorded the remaining real-binary evidence gap.

### 2026-08-29 — M0.7 GSD execution audit

- Audited the synchronized subagent, launch, isolation, run-store, worker-registry, cmux, preferences, loader, resource build, package, workspace, and existing test paths.
- Catalogued direct execution call sites for resume, background, chain, parallel/retry, and single modes.
- Confirmed local and cmux duplicate result setup/finalization and that only local streams JSONL to the parent in real time.
- Confirmed cmux still uses raw `tee`, obsolete commands, temporary completion polling, and unsafe local fallback.
- Identified the need for a shared result collector, execution-handle registry, explicit launch-state model, and call-site migration.
- Identified existing test gaps and package/build requirements.

### 2026-08-29 — M0.8 code placement

- Assigned backend-neutral types, collector, selector, executor, and local/cmux/Herdr backends to `src/resources/extensions/subagent/execution/`.
- Assigned root lifecycle reporting and preferences to bundled `src/resources/extensions/herdr/`.
- Selected one private, linkable `@gsd/herdr-runtime` package for the typed client, schemas, artifacts, and worker executable.
- Kept Herdr plugin assets, long-form docs, and real-Herdr E2E under `integrations/herdr/`.
- Kept user configuration in GSD preferences and semantic status in the existing subagent run store.

### 2026-08-29 — M0.9 cmux migration decision

- Verified current upstream still contains `list-surfaces` and `send-surface`.
- Preserved the old branch's valid direct `new-split` output parsing, `send`, and `send-key ctrl+c` behavior.
- Rejected direct merge/cherry-pick because the implementation will be replaced by the shared backend, filtered runner transport, streaming collector, and explicit fallback model.
- Required production-method tests rather than tests that duplicate the layout algorithm.

### 2026-08-29 — M0.10 consolidated technical plan

- Broke implementation into eleven independently testable slices from runtime package scaffolding through downstream release.
- Made local old-vs-new result parity the gate before external backend work.
- Recorded non-negotiable result, output, authority, launch-ambiguity, and ownership invariants.
- Updated milestone mapping, test gates, risk register, and effort estimates.
- Completed M0.
- No runtime tests were executed during M0; all evidence came from repository, schema, source, release, and test-structure inspection.
- Next: create `feature/herdr-runtime-foundation` and begin M1.1–M1.10.
