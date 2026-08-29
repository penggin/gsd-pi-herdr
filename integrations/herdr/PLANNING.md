# GSD-Pi Herdr Living Plan

> **Status:** M0.6 complete; current GSD execution-path audit next  
> **Last updated:** 2026-08-29  
> **Current milestone:** M0 — downstream baseline and feasibility validation  
> **Canonical rule:** every Herdr implementation session begins by reading this file and ends by updating it.

## 1. Mission

Build and maintain `penggin/gsd-pi-herdr` as a downstream GSD-Pi distribution in which every active subagent can run in a persistent, observable Herdr pane without changing GSD's result semantics.

The integration must provide:

- accurate main-session `working`, `blocked`, and `idle` state;
- a visible pane for each running subagent, with bounded readable activity;
- complete JSONL and stderr evidence for GSD's existing parser;
- single, parallel, chain, retry, background, fork-context, and isolation support;
- explicit cancellation, failure, pane-loss, and orphan handling;
- detach/reattach durability;
- regular upstream GSD-Pi synchronization;
- reproducible build, canary, rollback, and release procedures.

## 2. Repository model

### GSD-Pi

`penggin/gsd-pi-herdr` is the runtime distribution. We may refactor or extend GSD-Pi where doing so creates a cleaner, testable downstream architecture. Changes should still be focused, documented, and upstream-aware.

### Herdr

`herdrdev/herdr` remains external. The integration uses Herdr's plugin, CLI, and socket APIs. A Herdr fork requires a reproduced public-API limitation and a new accepted ADR.

### Historical planning repository

The initial overlay-repository plan from `penggin/gsd-herdr@d13fbe85ad584dd7505a5420d668c780ac137726` was migrated here. Relevant evidence and constraints are preserved, while assumptions about maintaining only a tiny GSD patch are superseded.

## 3. Branch model

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

Current repository state:

- fork `main` was at `c2e61def5d6d3d8c516d115a53654b229f658915`;
- upstream `main` was at `4b26a642c0121ae6161abbb6f2dc6937c78874dd`, 29 commits ahead;
- downstream `main` and `upstream-main` were fast-forwarded to `4b26a642c0121ae6161abbb6f2dc6937c78874dd` before migration;
- migration and M0 work are on `integration/herdr-foundation`;
- `fix/cmux-split-cli` remains at `5b74d301b6d1599df5fe0a385b90a28b48492b9a` and will be re-evaluated against the unified backend architecture.

## 4. Core design principles

1. **One owned GSD distribution.** Avoid architecture compromises made only to minimize patch size.
2. **Herdr through public APIs.** Do not fork Herdr preemptively.
3. **One execution contract.** Local, cmux, and Herdr paths share launch, stream, result, cancellation, and lifecycle semantics.
4. **GSD owns meaning.** Backend code must not take over orchestration or decide task success independently.
5. **Herdr owns terminal state.** Pane creation, persistence, focus, visible state, and terminal input belong to Herdr.
6. **Readable monitoring.** Keep raw JSONL off the terminal; render lifecycle and concise tool activity.
7. **No invisible fallback.** Required monitoring is part of correctness, not decoration.
8. **Durable evidence.** Never infer success without an authoritative process/result artifact.
9. **Semantic upstream sync.** Passing compilation is not proof that downstream behavior survived an upstream merge.
10. **Document as code changes.** Update this plan and ADRs as architecture evolves.

## 5. Target code layout

The exact file placement is finalized during M0, but the intended separation is:

```text
src/resources/extensions/subagent/
├── common launch/result/event logic
├── execution backend contract and registry
└── backends/
    ├── local
    ├── cmux
    └── herdr adapter or registration seam

src/resources/extensions/herdr/
├── main GSD pane state reporter
├── Herdr client/capability detection
├── preferences and diagnostics
└── backend registration/integration glue

integrations/herdr/
├── planning and technical docs
├── Herdr plugin assets
├── worker-runner source/packaging
├── setup and operations scripts
└── cross-runtime E2E fixtures
```

The worker runner may move into a workspace package if build and reuse requirements justify it. M0 must choose based on current package boundaries rather than aesthetics.

## 6. Milestones

### M0 — Downstream baseline and feasibility validation

**Goal:** consolidate the previous plan, establish a clean upstream baseline, and validate the exact Herdr/GSD integration surface before implementation.

**Status:** `IN PROGRESS`

- [x] M0.1 Inspect `penggin/gsd-pi-herdr` and identify downstream changes.
- [x] M0.2 Confirm `main` had no custom commits and record the retained cmux feature branch.
- [x] M0.3 Create `upstream-main` and fast-forward the fork baseline to current upstream `main`.
- [x] M0.4 Migrate and re-home the `penggin/gsd-herdr` planning corpus under `integrations/herdr/`.
- [x] M0.5 Add root-level repository guidance and README visibility for the downstream integration.
- [x] M0.6 Verify required Herdr methods and request/response shapes against `v0.8.2` and current `master` API schemas. See [`docs/spikes/M0.6-HERDR-API-CAPABILITIES.md`](docs/spikes/M0.6-HERDR-API-CAPABILITIES.md).
- [ ] M0.7 Audit the latest GSD subagent, cmux, extension-loading, packaging, and test paths against the proposed unified backend model.
- [ ] M0.8 Decide final source/package locations for the Herdr client, backend, worker runner, plugin, configuration, and E2E tests.
- [ ] M0.9 Re-evaluate `fix/cmux-split-cli`: upstream status, correctness, and whether to reimplement it as part of the backend refactor.
- [ ] M0.10 Write a consolidated technical-spike report with implementation slices, risk changes, and revised estimates.

Exit criteria:

- Herdr capabilities are verified from actual schemas.
- Every affected GSD execution mode and call site is catalogued.
- Final code placement and build/package changes are selected.
- The cmux fix has an explicit migration decision.
- M1 can start without unresolved runtime ownership.

### M1 — Unified subagent execution contract

**Goal:** remove duplicated execution semantics and place local/cmux/Herdr behind one internal contract.

- [ ] M1.1 Define launch, stream, lifecycle, cancellation, and result interfaces.
- [ ] M1.2 Extract common parsing and finalization from local and cmux paths.
- [ ] M1.3 Implement the local backend with unchanged behavior.
- [ ] M1.4 Port cmux to the contract using current CLI commands.
- [ ] M1.5 Remove raw JSON terminal mirroring from cmux.
- [ ] M1.6 Add backend selection and explicit fallback policy.
- [ ] M1.7 Route single, parallel, chain, background, retry, fork, and isolation through the shared path.
- [ ] M1.8 Add local/cmux parity and regression tests.

Exit criteria:

- No business semantics are duplicated in backend implementations.
- Existing local behavior is unchanged.
- Cmux panes execute the intended worker and show readable output.
- All supported dispatch modes use one executor entry point.

### M2 — Herdr client and main-session integration

**Goal:** connect a root GSD TUI session to Herdr and establish a tested Herdr control client.

- [ ] M2.1 Implement socket/CLI capability discovery.
- [ ] M2.2 Implement bounded request handling and typed errors.
- [ ] M2.3 Add a bundled Herdr extension/feature flag.
- [ ] M2.4 Activate root reporting only for TUI, non-subagent sessions.
- [ ] M2.5 Report session identity and `working`/`blocked`/`idle` state.
- [ ] M2.6 Report milestone/slice/task context.
- [ ] M2.7 Release authority on shutdown and reload.
- [ ] M2.8 Add status/doctor diagnostics and tests.

### M3 — Herdr worker runner

**Goal:** execute one JSON-mode GSD child in a Herdr pane with complete evidence and readable monitoring.

- [ ] M3.1 Define versioned launch/state/heartbeat/exit artifacts.
- [ ] M3.2 Spawn with argv arrays and `shell: false`.
- [ ] M3.3 Replace inherited main-pane Herdr variables with worker-pane values.
- [ ] M3.4 Capture complete stdout JSONL and stderr.
- [ ] M3.5 Render bounded lifecycle/tool/retry activity and suppress token deltas.
- [ ] M3.6 Report worker state to its own pane.
- [ ] M3.7 Implement heartbeat and atomic final evidence.
- [ ] M3.8 Implement process-group signal escalation.
- [ ] M3.9 Add redaction, permissions, malformed-stream, and failure tests.

### M4 — Persistent pane pool and complete dispatch support

**Goal:** make Herdr the production subagent backend for every GSD dispatch mode.

- [ ] M4.1 Create or reuse a worker tab per root GSD session.
- [ ] M4.2 Implement bounded pane-slot allocation and queueing.
- [ ] M4.3 Support one-, two-, and four-worker layouts.
- [ ] M4.4 Preserve main-pane focus by default.
- [ ] M4.5 Keep chain steps and retries in stable panes.
- [ ] M4.6 Define success/failure/blocked retention and safe reuse.
- [ ] M4.7 Relay complete JSONL records to GSD's existing parser.
- [ ] M4.8 Validate final output, usage, error, session, isolation, and merge parity.
- [ ] M4.9 Fail visibly when required Herdr execution is unavailable.

### M5 — Durability, recovery, and operations

**Goal:** survive detach/reattach, pane loss, parent crashes, and Herdr restarts without invisible work.

- [ ] M5.1 Add durable run and worker records.
- [ ] M5.2 Add parent and worker heartbeats.
- [ ] M5.3 Reconcile records against `session.snapshot` and process information.
- [ ] M5.4 Detect closed panes, missing processes, and missing final artifacts.
- [ ] M5.5 Mark orphaned workers conservatively and retain evidence.
- [ ] M5.6 Prevent duplicate launch after reload/reconnect.
- [ ] M5.7 Add Herdr plugin actions for status, focus, cleanup, and reconciliation.
- [ ] M5.8 Add crash-injection and detach/reattach E2E tests.

### M6 — Downstream distribution and upstream maintenance

**Goal:** make the fork reproducible to build, install, update, test, and roll back.

- [ ] M6.1 Choose downstream package/binary naming and versioning.
- [ ] M6.2 Add Herdr assets to package/release validation.
- [ ] M6.3 Add stable and canary build profiles.
- [ ] M6.4 Add upstream sync automation and semantic risk reports.
- [ ] M6.5 Add macOS arm64 release artifacts and checksums.
- [ ] M6.6 Document install, migration, rollback, and recovery.
- [ ] M6.7 Preserve one previous known-good downstream release.

## 7. Current execution queue

1. Complete M0.7: audit all current subagent execution paths and tests at upstream commit `4b26a642c0121ae6161abbb6f2dc6937c78874dd`.
2. Decide M0.8 code/package placement from that audit.
3. Resolve M0.9 cmux branch migration.
4. Write M0.10 consolidated technical-spike report.
5. Begin M1 only after those decisions are recorded.

## 8. Accepted decisions

| ID | Decision |
|---|---|
| D001 | Use `penggin/gsd-pi-herdr` as the managed downstream runtime distribution. |
| D002 | Keep Herdr external and use its public plugin/CLI/socket APIs initially. |
| D003 | Introduce one internal execution-backend contract rather than an out-of-tree event-bus seam. |
| D004 | Keep GSD children in JSON mode and preserve complete JSONL. |
| D005 | Never display token-delta JSON in worker panes. |
| D006 | Use a dedicated worker runner with argv-based spawning. |
| D007 | Separate main-pane and worker-pane authority. |
| D008 | Default production behavior forbids silent unmonitored fallback. |
| D009 | Synchronize upstream through a dedicated `upstream-main` mirror and semantic test gates. |
| D010 | Target macOS arm64 first. |
| D011 | Support Herdr by required capability sets; `v0.8.2` protocol 20 is sufficient for the initial runtime, while protocol 21 is canary coverage. |
| D012 | Prefer schema-backed `layout.apply` command arrays for fresh worker layouts; retain `pane.split` for incremental repair and do not treat CLI `pane run` as a raw socket method. |
| D013 | Schema validation is feasibility evidence; real-binary tests remain mandatory before promoting runtime support. |

See [`docs/DECISIONS.md`](docs/DECISIONS.md) for rationale and superseded decisions.

## 9. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Fast upstream change rate | downstream behavior silently drifts | mirror branch, focused merge review, parity/E2E suites |
| Backend refactor changes GSD semantics | task/retry/result regressions | common executor, golden parity, mode matrix |
| Child inherits main pane identity | worker corrupts parent state | strip/reapply Herdr-managed variables |
| Raw JSON floods panes | unusable monitoring and render load | dedicated filtered runner |
| Parent/pane failure creates invisible work | unsafe code changes | required monitoring, heartbeats, reconciliation, no success guesses |
| Herdr API changes | runtime failures | named capability sets, schema checks, tolerant additive parsing, canary tests |
| Schema says an operation exists but runtime behavior differs | false confidence in feasibility | mandatory real `v0.8.2` binary/socket smoke and failure-injection tests |
| CLI helper is confused with a socket method | fictitious requests or fragile shell coupling | keep CLI and socket adapters distinct; validate `layout.apply`/split-and-input paths |
| Existing cmux branch is stale | duplicate or conflicting fixes | audit and reimplement under shared backend contract |
| Downstream customization grows without structure | merge cost and unclear ownership | ADRs, component boundaries, tests, upstream-change ledger |

## 10. Progress log

### 2026-08-29 — Original planning repository

- Created `penggin/gsd-herdr` as an overlay-integration planning repository.
- Completed documentation foundation and the GSD-Pi package-loading investigation.
- Established JSON-mode preservation, filtered monitoring, strict fallback, and durability principles.

### 2026-08-29 — Consolidation into managed downstream fork

- Inspected `penggin/gsd-pi-herdr`.
- Confirmed its `main` branch matched upstream commit `c2e61def...` with no downstream commit on main.
- Confirmed `fix/cmux-split-cli` contains one downstream commit, `5b74d301...`.
- Found upstream `main` 29 commits ahead at `4b26a642...`.
- Created `upstream-main` and fast-forwarded downstream `main` to the same upstream commit.
- Created `integration/herdr-foundation` for the migration.
- Migrated the planning corpus under `integrations/herdr/` and changed the architecture from minimal external patching to a managed in-tree backend design.

### 2026-08-29 — M0.6 Herdr API capability validation

- Inspected Herdr `v0.8.2` at commit `9eb521456ac0d19d3ab3d9d7cea3cca10baa8a4c`, schema blob `f9642ffa...`, protocol `20`.
- Inspected current Herdr `master` at commit `c2637dc182ddc5425108824d5ed15d24ce38c4e3`, schema blob `aa0a8c22...`, protocol `21`.
- Confirmed protocol 20 already includes the required session snapshot, tab, pane, layout, process, input, state-authority, event, and plugin operations.
- Established `gsd-herdr-runtime-v1` and `gsd-herdr-plugin-v1` capability sets.
- Selected `layout.apply` with pane command arrays as the preferred fresh worker-grid strategy and `pane.split` plus validated command delivery as the incremental fallback.
- Corrected the design assumption that `pane.run` is a raw socket method; it is a CLI convenience and must be isolated behind a CLI adapter if used.
- Recorded request/response shape findings and the remaining real-binary verification gap in [`docs/spikes/M0.6-HERDR-API-CAPABILITIES.md`](docs/spikes/M0.6-HERDR-API-CAPABILITIES.md).
- Updated the integration contract and ADRs H016–H018.
- No Herdr process was started in this session; this was schema/source validation only. Runtime smoke, signal, detach/reattach, and plugin tests remain mandatory in later milestones.
- Completed M0.6.
- Next: M0.7 audit of all current GSD subagent, cmux, loading, packaging, and test paths.
