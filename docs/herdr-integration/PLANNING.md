# GSD–Herdr Living Plan

> **Status:** Repository migration and M0 feasibility validation  
> **Last updated:** 2026-08-29  
> **Current milestone:** M0 — Downstream-fork foundation and feasibility validation  
> **Canonical rule:** Every Herdr-integration development session starts by reading this file and ends by updating it.

## 1. Purpose

`penggin/gsd-pi-herdr` is a managed downstream fork of `open-gsd/gsd-pi` that adds first-class Herdr support and may carry other deliberate fork-specific improvements.

The Herdr work must let GSD run subagents in persistent Herdr-managed panes while preserving GSD's existing orchestration semantics: retries, fresh/fork context, isolated worktrees, merge decisions, result parsing, usage accounting, cancellation, and run-state behavior.

The user-facing target is:

- the root GSD TUI is visible in Herdr as `working`, `blocked`, or `idle`;
- every active subagent is observable in a Herdr worker pane;
- worker panes show readable lifecycle/tool activity, not raw JSONL token updates;
- detach/reattach does not terminate the work;
- retries, cancellation, pane loss, failures, and orphan states are explicit;
- upstream GSD-Pi can be synchronized regularly without losing downstream behavior.

## 2. Strategy change and migration history

The original plan lived in `penggin/gsd-herdr` and assumed:

```text
official GSD-Pi + small patch + external integration repository
```

That assumption has been superseded. Because this fork will be maintained as the actual long-term GSD distribution, the integration can use proper internal abstractions instead of constraining itself to a tiny patch seam.

Current model:

```text
open-gsd/gsd-pi:main
        │
        ▼
penggin/gsd-pi-herdr
        ├── upstream GSD functionality
        ├── downstream fixes/customizations
        └── first-class Herdr runtime support
                 │
                 ▼
          official Herdr runtime
          + optional Herdr plugin
```

The earlier M0.6 package-overlay investigation is preserved as historical evidence because it explains why patching a published package's `src/resources` would have been unsafe. It no longer determines our production distribution mechanism.

## 3. Branch policy

- `upstream-main`: pristine mirror target for `open-gsd/gsd-pi:main`.
- `main`: downstream integration branch and intended releasable fork line.
- `feature/*`: focused downstream work.
- `compat/herdr-*`: temporary Herdr compatibility work if needed.
- existing `fix/cmux-split-cli`: retained historical cmux fix branch; integrate intentionally during the backend refactor rather than merging blindly.

Upstream synchronization must preserve commit intent and be followed by targeted downstream tests. See `UPSTREAM_MAINTENANCE.md`.

## 4. Design principles

1. **GSD remains authoritative for work semantics.** Herdr must not independently decide whether a GSD subagent succeeded.
2. **Herdr owns terminal persistence and presentation.** Pane creation, persistence, focus, terminal input, and visible agent state belong to Herdr.
3. **Use first-class downstream architecture.** Since this repository is the maintained distribution, prefer clean abstractions over load-order tricks or tiny patch seams.
4. **Preserve upstream behavior by default.** Fork-specific behavior is explicit and tested.
5. **No raw JSON flood.** Structured output is preserved for GSD but not mirrored directly to worker terminals.
6. **No silent loss of observability.** When Herdr monitoring is required, launch failure is a dispatch failure rather than an invisible local fallback.
7. **Separate root and worker authority.** A headless child may never mark the root GSD pane idle or replace its session identity.
8. **Capability-check Herdr.** Depend on verified Herdr API/CLI capabilities, not only version strings.
9. **Recover conservatively.** Unknown or lost execution becomes explicit `orphaned`/`failed`, never guessed-success.
10. **Keep upstream synchronization cheap through tests and structure.** AI-assisted conflict resolution is useful, but semantic parity must be proven by tests.

## 5. Target architecture

```text
GSD main process in Herdr pane
│
├── bundled Herdr integration module
│   ├── root session state reporter
│   ├── Herdr capability/client layer
│   └── worker pane pool coordinator
│
└── bundled subagent tool
    └── SubagentExecutionBackend abstraction
        ├── LocalBackend
        ├── CmuxBackend
        └── HerdrBackend
              │
              ├── reserve/create Herdr worker pane
              ├── run internal worker command
              └── tail worker artifacts / propagate cancellation
                       │
                       ▼
              Herdr-managed worker pane
                       │
                       └── gsd __herdr-worker <spec>
                           ├── spawn existing GSD child --mode json
                           ├── persist stdout.jsonl / stderr
                           ├── parse events for display
                           ├── report worker semantic state/metadata
                           └── write heartbeat/state/exit artifacts
```

A Herdr plugin may later provide dashboard, cleanup, focus, and startup reconciliation actions, but GSD-side runtime execution should not depend on a Herdr core fork.

## 6. Proposed code placement

Exact names may change during implementation, but the preferred ownership is:

```text
src/resources/extensions/subagent/
├── index.ts
├── launch.ts
└── backends/
    ├── types.ts
    ├── resolver.ts
    ├── local.ts
    ├── cmux.ts
    └── herdr.ts

src/resources/extensions/herdr/
├── index.ts
├── client.ts
├── capabilities.ts
├── root-state.ts
├── pane-pool.ts
├── artifacts.ts
├── renderer.ts
└── tests/

src/
└── internal-herdr-worker.ts       # or equivalent internal CLI entrypoint

integrations/herdr/
└── plugin/                        # optional Herdr operations plugin
```

The worker implementation may move under an existing package if build/packaging constraints make that cleaner; M1/M2 must verify the lowest-friction placement before committing the public surface.

## 7. Compatibility baseline

| Component | Initial target |
|---|---|
| Platform | macOS arm64 |
| Node.js | repository requirement (`>=22.18.0`) |
| GSD-Pi upstream baseline | current downstream sync at `4b26a642c0121ae6161abbb6f2dc6937c78874dd` |
| Herdr | `v0.8.2` initially |
| Herdr socket protocol at v0.8.2 | `20` |
| Herdr API schema | `1` |
| Downstream worker artifact schema | `1` proposed |

The GSD baseline follows upstream through the managed-fork process; Herdr compatibility remains capability-tested.

## 8. Milestones

### M0 — Downstream-fork foundation and feasibility validation

**Goal:** Migrate the previous integration plan, synchronize the fork, verify Herdr capabilities, and finalize the new first-class downstream architecture.

**Status:** `IN PROGRESS`

Tasks:

- [x] M0.1 Create the original integration plan and architecture documents in `penggin/gsd-herdr`.
- [x] M0.2 Investigate released GSD-Pi package/resource loading (historical M0.6 evidence).
- [x] M0.3 Decide to maintain `penggin/gsd-pi-herdr` as the long-term downstream distribution.
- [x] M0.4 Fast-forward downstream `main` to upstream commit `4b26a642c0121ae6161abbb6f2dc6937c78874dd` before integration work.
- [x] M0.5 Maintain `upstream-main` as the pristine upstream synchronization line.
- [x] M0.6 Migrate Herdr planning/design documentation into `docs/herdr-integration/` and mark it from the root README.
- [x] M0.7 Validate the required Herdr `v0.8.2` API/CLI capabilities and document request/behavior constraints. See `spikes/M0.7-HERDR-API.md`.
- [x] M0.8 Supersede the old package-overlay distribution decision: production will be built from this managed source fork; resource-overlay installation is no longer the primary architecture.
- [ ] M0.9 Inspect current subagent execution paths after the 29-commit upstream sync and produce a concrete refactor map for Local/Cmux/Herdr backends.
- [ ] M0.10 Produce the final M0 technical-spike summary, revised implementation estimates, and exact M1 entry tasks.

Exit criteria:

- The downstream repository topology and upstream sync policy are explicit.
- Herdr v0.8.2 provides the runtime capabilities needed for the first implementation without a core fork.
- The old minimal-patch/overlay design has been explicitly superseded where necessary.
- The current GSD subagent execution code has a reviewed refactor map with no lost mode (single/parallel/chain/background/retry/fork/isolation).
- M1 can begin without reopening repository/distribution strategy.

### M1 — Root GSD ↔ Herdr integration

**Goal:** Make the root GSD TUI a correctly reported Herdr agent and establish reusable Herdr client/capability infrastructure.

Tasks:

- [ ] M1.1 Define downstream `HerdrPreferences` and defaults without changing non-Herdr behavior.
- [ ] M1.2 Implement Herdr environment/capability detection.
- [ ] M1.3 Implement reusable Herdr socket/CLI client helpers with bounded failures.
- [ ] M1.4 Add a bundled Herdr integration extension/module.
- [ ] M1.5 Gate root authority on TUI mode and `GSD_SUBAGENT_CHILD !== "1"`.
- [ ] M1.6 Report root session identity and semantic `working`/`blocked`/`idle` state.
- [ ] M1.7 Report milestone/slice/task context through bounded metadata/state messages.
- [ ] M1.8 Release root authority on shutdown/reload.
- [ ] M1.9 Add `/gsd herdr status` or equivalent diagnostics.
- [ ] M1.10 Add unit/integration tests for state ownership and failure behavior.

Exit criteria:

- Root GSD state is correct through normal turns, blocked prompts, retries, reload, and shutdown.
- Headless children cannot claim root-pane authority.
- GSD behaves identically outside Herdr when the feature is disabled/unavailable.

### M2 — Subagent execution backend abstraction

**Goal:** Refactor existing execution code into one semantic path with Local, Cmux, and Herdr runtime backends.

Tasks:

- [ ] M2.1 Define `SubagentExecutionBackend` and execution request/result contracts.
- [ ] M2.2 Extract local spawn behavior without semantic changes.
- [ ] M2.3 Adapt current cmux behavior to the backend interface.
- [ ] M2.4 Incorporate/revalidate the earlier `fix/cmux-split-cli` changes against current upstream.
- [ ] M2.5 Centralize result parsing, usage accounting, abort semantics, and `markMissingFinalResponse` above runtime-specific code.
- [ ] M2.6 Route single mode through the abstraction.
- [ ] M2.7 Route parallel mode through the abstraction.
- [ ] M2.8 Route chain mode through the abstraction.
- [ ] M2.9 Verify background/retry/fork/isolation behavior reaches the same execution seam.
- [ ] M2.10 Add local-vs-refactored result parity tests.

Exit criteria:

- Local behavior is semantically unchanged.
- Cmux remains functional and no longer requires a separate duplicate result-processing pipeline.
- Every supported subagent mode has an explicit test proving which backend path it uses.

### M3 — Internal Herdr worker runner

**Goal:** Run one GSD child inside a Herdr pane while preserving structured output and presenting readable activity.

Tasks:

- [ ] M3.1 Define versioned launch/state/heartbeat/exit artifact schemas.
- [ ] M3.2 Add an internal GSD worker entrypoint that receives only a validated spec path.
- [ ] M3.3 Spawn the existing GSD child with argv arrays, `shell: false`, and JSON mode.
- [ ] M3.4 Persist raw stdout JSONL and stderr with restrictive permissions.
- [ ] M3.5 Parse chunked JSONL safely and tolerate unknown events.
- [ ] M3.6 Render bounded lifecycle/tool activity; suppress token deltas and large payloads.
- [ ] M3.7 Strip parent Herdr-managed environment and use worker-pane context.
- [ ] M3.8 Report worker semantic state and metadata to its own pane.
- [ ] M3.9 Implement heartbeat and atomic final exit evidence.
- [ ] M3.10 Implement SIGINT → SIGTERM → SIGKILL escalation on macOS/Unix process groups.

Exit criteria:

- Raw JSON exists in artifacts but not in terminal output.
- The parent can reconstruct the same GSD result as local execution.
- Cancellation reliably terminates the intended child process group.

### M4 — Herdr backend and worker pane pool

**Goal:** Execute real GSD subagents through persistent Herdr worker panes.

Tasks:

- [ ] M4.1 Create/reuse one worker tab per root GSD session.
- [ ] M4.2 Support one-, two-, and four-slot deterministic layouts.
- [ ] M4.3 Implement slot reservation, queueing, reuse, and retention.
- [ ] M4.4 Use Herdr CLI `pane run` for atomic command submission to an existing shell pane.
- [ ] M4.5 Use Herdr semantic reporting/metadata APIs for worker state.
- [ ] M4.6 Tail/relay worker JSONL incrementally to the shared GSD result parser.
- [ ] M4.7 Keep retries and chain steps in stable panes where practical.
- [ ] M4.8 Preserve root-pane focus by default.
- [ ] M4.9 Treat required-backend loss as explicit dispatch failure.
- [ ] M4.10 Run local-vs-Herdr result parity and cancellation tests.

Exit criteria:

- Single, parallel, and chain modes are observable and complete correctly.
- No unmonitored local fallback occurs in required mode.
- Parent result/usage/error semantics match local execution.

### M5 — Herdr operations plugin and diagnostics

**Goal:** Make long-lived workers easy to locate, focus, inspect, and clean up.

Tasks:

- [ ] M5.1 Add `integrations/herdr/plugin/` using Herdr's plugin manifest.
- [ ] M5.2 Add status/dashboard action.
- [ ] M5.3 Add focus-workers/focus-failed-worker actions.
- [ ] M5.4 Add cleanup controls for retained completed workers.
- [ ] M5.5 Add startup reconciliation against `session.snapshot`.
- [ ] M5.6 Release stale lifecycle authority safely.
- [ ] M5.7 Expose orphaned/missing-pane state clearly.

### M6 — Durability and recovery

**Goal:** Survive detach/reattach, pane closure, root crashes, and Herdr restarts without invisible work.

Tasks:

- [ ] M6.1 Persist run/worker records under a versioned GSD/Herdr runtime root.
- [ ] M6.2 Add root/worker heartbeat semantics.
- [ ] M6.3 Reconcile against `session.snapshot` after reconnect/restart.
- [ ] M6.4 Detect pane closure/process loss while waiting.
- [ ] M6.5 Mark uncertain workers `orphaned` and retain evidence.
- [ ] M6.6 Prevent duplicate launch during reload/reconnect.
- [ ] M6.7 Add crash-injection and detach/reattach E2E tests.
- [ ] M6.8 Define retention/cleanup policy.

### M7 — Downstream release and upstream maintenance automation

**Goal:** Make this fork easy to update, validate, and roll back.

Tasks:

- [ ] M7.1 Automate upstream-main update detection and downstream compatibility reporting.
- [ ] M7.2 Add Herdr capability checks against supported stable/canary versions.
- [ ] M7.3 Add downstream release metadata identifying upstream base commit.
- [ ] M7.4 Add canary builds before adopting significant upstream changes.
- [ ] M7.5 Preserve at least one known-good downstream release for rollback.
- [ ] M7.6 Document install/update behavior for the downstream distribution.

## 9. Accepted decisions summary

| ID | Decision | Status |
|---|---|---|
| D001 | Herdr core remains unpatched initially | Accepted |
| D002 | Keep GSD child execution in JSON mode | Accepted |
| D003 | Do not display raw JSON/token deltas in worker panes | Accepted |
| D004 | Use a dedicated internal Node/GSD worker runner rather than shell `tee` pipelines | Accepted |
| D005 | Separate root-pane and worker-pane authority | Accepted |
| D006 | Monitoring failure is fatal in required mode | Accepted |
| D007 | Use durable versioned worker artifacts | Accepted |
| D008 | Target macOS arm64 first | Accepted |
| D009 | Maintain this repository as the full downstream GSD distribution | Accepted |
| D010 | Refactor subagent execution into Local/Cmux/Herdr backends | Accepted |
| D011 | Track pristine upstream in `upstream-main`, downstream behavior in `main` | Accepted |
| D012 | Prefer Herdr public API/CLI capabilities; no Herdr fork unless a reproduced gap exists | Accepted |

See `DECISIONS.md` for rationale and superseded historical decisions.

## 10. Current risks

| Risk | Impact | Mitigation |
|---|---|---|
| Upstream subagent semantics change | Downstream integration compiles but behaves incorrectly | Backend abstraction + parity/E2E tests + semantic review on upstream sync |
| Herdr API changes | Worker launch/state management breaks | Capability checks from actual installed schema and supported-version tests |
| Parent Herdr vars leak to child | Worker reports against root pane | Strip/reapply Herdr-managed variables in internal runner |
| High-frequency worker output | Rendering regressions and unreadable panes | Event filtering, dedupe, throttling, no token deltas |
| Root crashes while worker continues | Orphaned code modification | Durable artifacts, heartbeats, explicit orphan state, reconciliation |
| Pane is closed manually | Parent waits indefinitely | pane/process monitoring, exit artifact timeout, explicit failure |
| Fork accumulates unrelated changes | Harder upstream merges | Focused commits, `upstream-main`, downstream decision log, strong CI |
| AI resolves conflicts incorrectly | Semantic regression despite clean merge | Treat tests/parity as required evidence, not optional validation |

## 11. Current execution queue

1. **M0.9:** inspect the current post-sync subagent code and map every runtime-specific branch/mode into the proposed backend abstraction.
2. Update `ARCHITECTURE.md`/`INTEGRATION_CONTRACT.md` with any findings from that inspection.
3. **M0.10:** write final M0 spike summary and exact M1 implementation entry checklist.
4. Begin M1 only after the M0 exit criteria are satisfied.

## 12. Progress log

### 2026-08-29 — Original integration planning

- Created `penggin/gsd-herdr` as a documentation-first overlay integration project.
- Defined root/worker authority, filtered JSON-mode monitoring, durability, Herdr plugin operations, security, and test strategy.
- Investigated GSD-Pi v1.16.2 package resource loading and established that `src/resources`-only overlaying would be unsafe for a published-package approach.

### 2026-08-29 — Move to managed downstream fork

- Selected `penggin/gsd-pi-herdr` as the long-term managed GSD distribution.
- Confirmed the fork's `main` had no custom commits and was at upstream commit `c2e61def5d6d3d8c516d115a53654b229f658915`.
- Confirmed the only custom historical branch was `fix/cmux-split-cli` at `5b74d301b6d1599df5fe0a385b90a28b48492b9a`.
- Fast-forwarded `main` to current upstream commit `4b26a642c0121ae6161abbb6f2dc6937c78874dd`, a 29-commit upstream advance.
- Established `upstream-main` at the same pristine upstream commit.
- Migrated the Herdr planning/documentation set under `docs/herdr-integration/` and added repository-level agent instructions.
- Validated Herdr v0.8.2 tag commit `9eb521456ac0d19d3ab3d9d7cea3cca10baa8a4c`, socket protocol 20, schema version 1, pane/tab/layout/session APIs, plugin APIs, semantic state reporting, metadata, and CLI atomic `pane run` behavior.
- Superseded the old package-overlay distribution question because this fork will be built and released directly.
- Next: M0.9, current subagent runtime-path/refactor mapping.
