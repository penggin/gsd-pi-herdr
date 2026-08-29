# GSD–Herdr Living Plan

> **Status:** M0–M1 complete; M2 subagent backend parity/refactor in progress
> **Last updated:** 2026-08-30
> **Current milestone:** M1 — Root GSD ↔ Herdr integration  
> **Canonical rule:** Every Herdr-integration development session starts by reading this file and ends by updating it.

## 1. Mission

`penggin/gsd-pi-herdr` is a managed downstream fork of `open-gsd/gsd-pi` that adds first-class Herdr support and may carry other deliberate fork-specific fixes, refactors, and experiments.

The Herdr integration must provide observable, persistent subagent execution without changing GSD's authority over orchestration semantics.

Target UX:

- root GSD TUI reports `working`, `blocked`, or `idle` in Herdr;
- every active subagent can be observed in a Herdr worker pane;
- worker panes show concise lifecycle/tool activity rather than raw JSON/token deltas;
- Herdr detach/reattach does not stop work;
- retries, cancellation, pane loss, failures, and orphan states are explicit;
- upstream GSD-Pi can be synchronized routinely while downstream behavior remains testable.

## 2. Repository/branch model

```text
open-gsd/gsd-pi:main
        │
        ▼
upstream-main              # pristine upstream mirror target
        │
        ▼
main                       # downstream integration/release line
        │
        └── feature/*      # focused work branches
```

Current GSD upstream base for this planning cycle:

```text
4b26a642c0121ae6161abbb6f2dc6937c78874dd
```

Historical branch retained for later deliberate integration:

```text
fix/cmux-split-cli
└── 5b74d301b6d1599df5fe0a385b90a28b48492b9a
```

## 3. Architecture invariants

1. **GSD owns semantics:** dispatch, retry, fresh/fork context, isolation, result parsing, usage, run-state, and final outcome.
2. **Herdr owns terminal runtime:** panes/tabs, terminal persistence, focus, input delivery, visible state, detach/reattach.
3. **One child semantic path:** Local/Cmux/Herdr are runtime backends below one common GSD result-processing path.
4. **JSON mode remains authoritative:** children continue to run in structured JSON mode.
5. **No raw JSON pane flood:** token deltas/raw event JSON are artifact data, not normal terminal UI.
6. **Root/worker authority is separate:** `GSD_SUBAGENT_CHILD=1` can never claim root-pane state/session authority.
7. **Required observability is correctness:** once required Herdr execution is selected, launch failure does not silently become invisible local execution.
8. **Official Herdr first:** no Herdr core fork unless a reproduced public-API gap blocks correctness.
9. **Capability-based compatibility:** test actual Herdr API/CLI behavior, not only version strings.
10. **Tests protect upstream sync:** AI-assisted merge/conflict work is acceptable, but semantic parity is evidence-driven.

## 4. Current target architecture

```text
GSD root TUI in Herdr
│
├── bundled Herdr integration
│   ├── environment/capability detection
│   ├── socket/CLI client
│   ├── root session reporter
│   └── later: worker pane pool
│
└── bundled subagent tool
    └── common one-child semantic runner
        └── SubagentExecutionBackend
            ├── LocalBackend
            ├── CmuxBackend
            └── HerdrBackend
                  │
                  ▼
            Herdr worker pane
                  └── internal GSD Herdr worker
                      └── GSD child --mode json
```

Detailed design: [`ARCHITECTURE.md`](ARCHITECTURE.md).

## 5. Compatibility baseline

| Component | Initial target |
|---|---|
| Platform | macOS arm64 |
| Node | repository requirement (`>=22.18.0`) |
| GSD upstream base | `4b26a642c0121ae6161abbb6f2dc6937c78874dd` |
| Herdr | `v0.8.2` |
| Herdr tag commit | `9eb521456ac0d19d3ab3d9d7cea3cca10baa8a4c` |
| Herdr socket protocol | `20` |
| Herdr schema version | `1` |
| Proposed worker artifact schema | `1` |

## 6. Milestones

### M0 — Downstream-fork foundation and feasibility validation

**Status:** `COMPLETE`

- [x] M0.1 Original integration planning/documentation created.
- [x] M0.2 GSD v1.16.2 package/resource-loading investigation completed.
- [x] M0.3 Managed downstream fork strategy selected.
- [x] M0.4 Downstream `main` synchronized to upstream `4b26a642...` before Herdr work.
- [x] M0.5 `upstream-main` established as pristine upstream line.
- [x] M0.6 Herdr planning/design docs migrated under `docs/herdr-integration/`.
- [x] M0.7 Herdr v0.8.2 API/CLI capability validation completed.
- [x] M0.8 Old published-package overlay strategy superseded by source-built downstream distribution.
- [x] M0.9 Current subagent runtime paths mapped into a Local/Cmux/Herdr refactor plan.
- [x] M0.10 Final feasibility summary, estimates, and M1 entry checklist completed.

Evidence:

- [`spikes/M0.6-GSD-PACKAGE-LOADING.md`](spikes/M0.6-GSD-PACKAGE-LOADING.md)
- [`spikes/M0.7-HERDR-API.md`](spikes/M0.7-HERDR-API.md)
- [`spikes/M0.9-SUBAGENT-BACKEND-REFACTOR.md`](spikes/M0.9-SUBAGENT-BACKEND-REFACTOR.md)
- [`spikes/M0.10-M0-FINAL-SUMMARY.md`](spikes/M0.10-M0-FINAL-SUMMARY.md)

Exit assessment: all M0 criteria satisfied. No Herdr core fork is required for the initial design, and the GSD runtime refactor boundary is identified.

### M1 — Root GSD ↔ Herdr integration

**Status:** `COMPLETE`

**Goal:** Make the root GSD TUI a correctly reported Herdr agent and establish reusable Herdr client/capability infrastructure without yet moving subagents into Herdr panes.

- [x] M1.1 Define `HerdrPreferences` and validation/default behavior without changing non-Herdr execution.
- [x] M1.2 Implement Herdr environment detection and typed resolved config.
- [x] M1.3 Implement reusable Herdr socket client with bounded connect/request retry/timeouts.
- [x] M1.4 Implement CLI capability helper for operations that are CLI-only (`pane run` later).
- [x] M1.5 Add bundled `herdr` integration module/extension and packaging/discovery metadata.
- [x] M1.6 Gate root authority on visible TUI mode and `GSD_SUBAGENT_CHILD !== "1"`.
- [x] M1.7 Report root native session identity through `pane.report_agent_session` where available.
- [x] M1.8 Report semantic root `working` / `blocked` / `idle` lifecycle with ordered `seq` values.
- [x] M1.9 Project milestone/slice/task context into bounded Herdr metadata/message fields.
- [x] M1.10 Release/replace root lifecycle authority safely on shutdown/reload.
- [x] M1.11 Add GSD-native Herdr status/doctor diagnostics.
- [x] M1.12 Add unit/integration tests for detection, protocol requests, state ownership, ordering, and non-Herdr regression.
- [x] M1.13 Validate the root reporter against real Herdr v0.8.2 in an isolated session.

Exit criteria:

- root state is correct through idle → working → idle, blocked interactions, reload, and shutdown;
- JSON/headless child sessions cannot overwrite root state or root session identity;
- disabled/non-Herdr GSD behavior is unchanged;
- missing/broken Herdr integration produces bounded diagnostics rather than hanging GSD;
- focused tests and one real v0.8.2 integration smoke scenario pass.

### M2 — Subagent execution backend abstraction

**Status:** `IN PROGRESS`

**Goal:** Replace duplicated local/cmux execution semantics with one common child runner and runtime backends before Herdr worker execution is introduced.

- [x] M2.1 Add deterministic tests around current local `runSingleAgent()` semantic output.
- [x] M2.2 Define backend execution request/callback/evidence types.
- [x] M2.3 Extract direct `spawn()` mechanics to `LocalBackend` with no caller-selection change.
- [x] M2.4 Introduce common `runSingleAgentWithBackend()` semantic runner and prove local parity.
- [ ] M2.5 Route resume through the common runner/backend resolver.
- [ ] M2.6 Route background single through the common runner and execution registry.
- [ ] M2.7 Route chain through the common runner while preserving `{previous}`/stop-on-error semantics.
- [ ] M2.8 Route parallel/retry through the common runner while preserving concurrency/retry policy.
- [ ] M2.9 Route foreground single through resolver/common runner.
- [ ] M2.10 Extract `CmuxBackend` and remove duplicate result/parsing pipeline.
- [ ] M2.11 Reapply/revalidate `fix/cmux-split-cli` against the new backend.
- [ ] M2.12 Remove raw JSON `tee`, normalize abort classification, and prevent runtime-specific silent fallback.
- [ ] M2.13 Move cmux shell escaping/env composition out of general `launch.ts`.
- [ ] M2.14 Add mode-to-backend, local parity, cmux regression, phase-conflict, shutdown, and cancellation tests.

Deferred existing behavior: chain-mode `isolated` handling is tracked separately after pure parity extraction unless the refactor makes a fix unavoidable.

### M3 — Internal Herdr worker runner

**Status:** `NOT STARTED`

- [ ] M3.1 Define versioned launch/state/heartbeat/exit artifacts.
- [ ] M3.2 Add private/internal GSD Herdr-worker entrypoint receiving a validated spec path.
- [ ] M3.3 Spawn the existing JSON-mode child with argv arrays and `shell:false`.
- [ ] M3.4 Persist raw JSONL/stderr with restrictive permissions.
- [ ] M3.5 Parse chunked JSONL safely and relay complete lines.
- [ ] M3.6 Render bounded lifecycle/tool activity and suppress token deltas.
- [ ] M3.7 Strip root Herdr identity from child launch env and apply worker-pane identity.
- [ ] M3.8 Report worker semantic state/metadata to its own pane.
- [ ] M3.9 Add heartbeat and atomic final exit evidence.
- [ ] M3.10 Add SIGINT → SIGTERM → SIGKILL process-group escalation.
- [ ] M3.11 Add security/redaction/path/process tests.

### M4 — Herdr backend and persistent worker pane pool

**Status:** `NOT STARTED`

- [ ] M4.1 Create/reuse one worker tab per root GSD session.
- [ ] M4.2 Create deterministic one/two/four-slot layouts.
- [ ] M4.3 Implement bounded slot reservation, queueing, reuse, and retention.
- [ ] M4.4 Launch the internal worker with Herdr CLI `pane run`.
- [ ] M4.5 Tail/relay worker JSONL into the common GSD parser.
- [ ] M4.6 Use Herdr semantic state/session/metadata APIs for worker visibility.
- [ ] M4.7 Keep retry/chain work in stable slots where safe.
- [ ] M4.8 Preserve root-pane focus.
- [ ] M4.9 Fail visibly when required Herdr runtime is unavailable/ambiguous.
- [ ] M4.10 Add Local-vs-Herdr result parity, cancellation, pane-loss, and >4-task queue tests.

M4 exit = first practically usable monitored Herdr-subagent runtime.

### M5 — Herdr operations plugin and diagnostics

**Status:** `NOT STARTED`

- [ ] M5.1 Add `integrations/herdr/plugin/` manifest.
- [ ] M5.2 Add status/dashboard action.
- [ ] M5.3 Add focus-workers/focus-failed-worker actions.
- [ ] M5.4 Add retained-worker cleanup controls.
- [ ] M5.5 Add startup reconciliation using `session.snapshot`.
- [ ] M5.6 Release stale lifecycle authority safely.
- [ ] M5.7 Expose orphan/missing-pane state clearly.

### M6 — Durability and recovery

**Status:** `NOT STARTED`

- [ ] M6.1 Persist versioned run/worker runtime records.
- [ ] M6.2 Add root/worker heartbeats.
- [ ] M6.3 Reconcile durable state with `session.snapshot`.
- [ ] M6.4 Detect manual pane closure/process loss.
- [ ] M6.5 Mark uncertain workers `orphaned` and retain evidence.
- [ ] M6.6 Prevent duplicate launch during reload/reconnect.
- [ ] M6.7 Add root-crash, worker-crash, Herdr restart, detach/reattach E2E.
- [ ] M6.8 Finalize retention and cleanup policy.

### M7 — Downstream release/upstream maintenance automation

**Status:** `NOT STARTED`

- [ ] M7.1 Automate upstream-main change detection and impact reports.
- [ ] M7.2 Automate supported/canary Herdr capability checks.
- [ ] M7.3 Stamp downstream releases with exact upstream base metadata.
- [ ] M7.4 Add canary builds before major upstream/Herdr adoption.
- [ ] M7.5 Preserve prior known-good downstream release for rollback.
- [ ] M7.6 Document downstream install/update/release identity.

## 7. Important findings to preserve

Current upstream subagent behavior at M0 completion:

| Operation | Runtime today |
|---|---|
| resume | local only |
| background single | local only |
| chain | local only |
| parallel | local or cmux |
| foreground single | local or cmux |
| parallel retry | repeats selected local/cmux path |

Structural gaps discovered:

- cmux duplicates result/launch/parsing/finalization logic;
- cmux path skips the local phase-conflict guard;
- local streams JSON events; cmux parses them only after completion;
- cmux abort classification differs from local;
- cmux raw JSON is currently `tee`d into the pane;
- cmux can silently fall back to local;
- `liveSubagentProcesses` tracks only direct local children;
- chain currently does not apply the top-level `isolated` option;
- an 8-task cmux batch may create more panes after the initially pre-created four rather than reusing slots;
- current `main` still has the stale cmux CLI implementation; historical `fix/cmux-split-cli` is retained for M2.

## 8. Current risks

| Risk | Impact | Mitigation |
|---|---|---|
| upstream subagent semantic changes | clean merge but broken downstream runtime | common backend abstraction + mode/parity/E2E tests |
| Herdr API changes | launch/state/recovery failure | schema/capability tests against exact supported releases |
| root Herdr IDs leak to worker child | worker overwrites root pane authority | strip/reapply worker-pane managed env |
| high-frequency output | unreadable panes/render cost | filter/dedupe/throttle; no raw token events |
| root dies while workers continue | unobserved/orphaned edits | durable state + heartbeat + explicit orphan reconciliation |
| pane closes mid-run | parent waits forever | pane/process/artifact monitoring and bounded failure |
| AI resolves upstream conflicts incorrectly | semantic regression | mandatory focused/parity tests and recorded evidence |

## 9. Current execution queue

1. **M2.5:** add the backend resolver seam and route resume through `runSingleAgentWithBackend()` without enabling cmux/Herdr selection for resume yet.
2. Preserve current local-only resume behavior while making the selected backend explicit and testable.
3. Then migrate background single (M2.6), chain (M2.7), parallel/retry (M2.8), and foreground single (M2.9) through the same resolver/common-runner path before extracting CmuxBackend.

## 10. Progress log

### 2026-08-29 — Original planning and package investigation

- Built the original documentation-first `penggin/gsd-herdr` plan.
- Defined root/worker authority, filtered JSON monitoring, worker artifacts, pane pooling, security, testing, and operations strategy.
- Investigated GSD v1.16.2 package/resource loading and rejected `src/resources`-only overlaying as a safe published-package installation strategy.

### 2026-08-29 — Migration into managed downstream fork

- Chose `penggin/gsd-pi-herdr` as the long-term GSD distribution.
- Verified old fork `main` had no custom commit and was at `c2e61def...`.
- Fast-forwarded `main` by 29 upstream commits to `4b26a642...`.
- Established/verified `upstream-main` at the same pristine upstream SHA.
- Preserved `fix/cmux-split-cli` separately.
- Migrated/adapted planning documents under `docs/herdr-integration/`.
- Added root `AGENTS.md` with downstream synchronization and Herdr-plan workflow rules.

### 2026-08-29 — M0.7 Herdr capability validation

- Verified exact Herdr v0.8.2 tag target `9eb52145...`, protocol 20, schema version 1.
- Verified tab/pane/layout, process inspection, input, semantic state/session/metadata, release, snapshot, event, and plugin capabilities.
- Confirmed `pane run` is a CLI helper rather than a raw socket method in v0.8.2 and should be used for atomic shell command submission.
- Concluded no Herdr core fork is required for M1–M4 initial scope.

### 2026-08-29 — M0.9/M0.10 subagent refactor mapping and feasibility closeout

- Traced current local and cmux single-child implementations and every top-level mode selection.
- Identified runtime/semantic duplication and existing local-vs-cmux divergences.
- Chose the common-semantic-runner / LocalBackend / CmuxBackend / HerdrBackend architecture.
- Recorded exact call-site migration order and new parity/regression tests.
- Completed the M0 feasibility summary with revised implementation estimates and first M1 tasks.
- **M0 complete; M1 is now in progress.**

### 2026-08-30 — M1 root integration implementation and local validation

- Added the opt-in `herdr.enabled` / `herdr.required` preference surface, strict validation, effective preference merging, and environment overrides for diagnostics/required mode.
- Reworked root authority detection around the actual extension contract (`ctx.hasUI`) plus `HERDR_ENV`, pane/socket identity, and `GSD_SUBAGENT_CHILD !== "1"`; non-Herdr execution remains inactive unless explicitly enabled.
- Completed the bounded newline-framed Herdr socket client, including matching-response parsing, idempotent request retry with stable request IDs, `pane.get` probing, session/state/metadata/release wrappers, and monotonic source-local sequence reporting.
- Added a shell-free bounded Herdr CLI helper using argv execution. This is the M4 seam for the v0.8.2 CLI-only `pane run` helper.
- Added the bundled `src/resources/extensions/herdr/` extension, manifest, lifecycle wiring, `/herdr-status`, `/herdr-doctor`, and bounded milestone/slice/task + phase projection.
- Root lifecycle now uses `agent_end.willRetry` when available: explicit retry remains `working`, explicit terminal provider errors become `blocked`, and only unknown retry intent uses the short compatibility grace window. Normal completion debounces back to `idle`.
- Added a shutdown/reload race guard so a delayed `session_start` identity request cannot publish lifecycle state after `release_agent` relinquishes authority.
- Verified Herdr v0.8.2 source semantics directly at tag `9eb52145...`: `pane.release_agent` advances but does not clear the source sequence watermark. Reporter replacements therefore share one monotonic allocator inside a loaded extension runtime, while each newly loaded runtime gets a unique `custom:gsd:<runtime-id>` source so a restarted local sequence cannot be rejected as stale.
- Added focused Herdr tests for environment/root ownership, fake Unix socket request/retry behavior, CLI argv isolation, preferences, workflow labels, session identity, lifecycle ordering/retry/blocking, shutdown release ordering, and the delayed-start shutdown race.
- Local validation evidence:
  - `pnpm run typecheck:extensions` — pass after building required workspace packages;
  - focused source suite (`herdr` tests + GSD preferences) — **153/153 pass**;
  - compiled Herdr suite — **18/18 pass**;
  - `pnpm run test:changed:src` — pass;
  - `pnpm run verify:extension-coverage` — pass;
  - bundled extension import smoke — pass;
  - resource-loader bundled-extension manifest tracking test — pass;
  - `pnpm run build:core` plus staged standalone web build — pass;
  - `pnpm run validate-pack` — pass through isolated tarball install/global-install checks with final result `Package is installable. Safe to publish.`;
  - `git diff --check` — pass.
- `copy-resources` produced the expected compiled Herdr extension and `extension-manifest.json` under `dist/resources/extensions/herdr/`.
- The base Linux DevSpace image did not ship Herdr, so the official v0.8.2 Linux x86_64 release binary was downloaded to an isolated `/tmp` path for the real-session smoke; no Herdr installation was added to the repository or persistent runtime configuration.

### 2026-08-30 — M1.13 real Herdr v0.8.2 smoke and M1 closeout

- Ran the official `herdr 0.8.2` Linux x86_64 release as an isolated headless server with separate XDG config/state roots and socket path.
- Created a real Herdr-managed workspace/pane and verified Herdr injected the authoritative `HERDR_ENV`, `HERDR_SOCKET_PATH`, `HERDR_BIN_PATH`, `HERDR_WORKSPACE_ID`, `HERDR_TAB_ID`, and `HERDR_PANE_ID` values into pane processes.
- Connected the compiled downstream `HerdrClient` + `HerdrRootReporter` directly to the real v0.8.2 socket and observed the complete lifecycle contract: `idle → working → idle`, terminal provider error → `blocked`, retry error → `working`, retry restart → `working`, and shutdown release → `unknown`.
- The first 30 ms observation window was intentionally too aggressive for fire-and-forget event reporting; with a 300 ms observation bound every semantic transition was stable. No request-shape correction was required.
- Launched the actual bundled downstream `dist/loader.js` TUI inside a Herdr-managed pane with Herdr enabled. `pane.get` reported `agent=gsd` and `agent_status=idle` without test-only reporter calls.
- Verified real TUI diagnostics:
  - `/herdr-status` → configured enabled, environment detected, root reporter active, child session no, correct pane identity;
  - `/herdr-doctor` → root authority eligible, socket `pane.get` ok, CLI `herdr 0.8.2` detected.
- Verified `/new` preserves active root reporting and `idle` state, `/reload` replaces/reloads extension authority without a stale sequence regression, and `/quit` releases authority while leaving the shell/pane alive with `agent_status=unknown`.
- A temporary DevSpace-global `~/.gsd/PREFERENCES.md` used only to enable the live smoke was created only after confirming no file existed and was removed immediately after the test.
- Detailed evidence: [`spikes/M1.13-REAL-HERDR-SMOKE.md`](spikes/M1.13-REAL-HERDR-SMOKE.md).
- **M1 is complete. M2.1 characterization tests are now the active work item.**
- macOS-specific focus preservation, foreground process-group cancellation, detach/reattach, manual pane closure, and Herdr restart remain later backend/durability E2E concerns in M4–M6; they are not required to prove the M1 root socket/lifecycle contract.

### 2026-08-30 — M2.1/M2.2 local parity baseline and backend contract

- Added deterministic characterization tests around the existing local `runSingleAgent()` using a real spawned fake Node child rather than mocking `spawn()`.
- The baseline now locks these current local semantics before extraction:
  - malformed stdout lines are ignored while complete `message_end` / `tool_result_end` JSONL records stream into the shared parser;
  - a complete final JSON record without a trailing newline is processed on child close;
  - assistant usage accumulates input/output/cache/cost/turns while `contextTokens` tracks the latest assistant total and the first resolved model is retained;
  - `onUpdate` fires on consumed semantic events while the result still has `running=true` / `exitCode=-1`; local finalization does not emit an additional completion update;
  - exit `0` without assistant final text is rewritten to the canonical `Subagent produced no valid final response.` failure;
  - nonzero child exit codes are preserved and are not rewritten as missing-final failures;
  - forked launch session files are copied onto the semantic result;
  - unknown-agent and active-phase conflict failures return before child spawn;
  - `liveSubagentProcesses` contains direct local children while running and is cleared after shutdown termination;
  - AbortSignal cancellation terminates the child and rejects the local runner with `Subagent was aborted` rather than returning a `SingleResult`.
- Added only a narrow `__subagentLocalRunnerTestHooks` export so the tests exercise the existing private runner without moving production behavior ahead of the planned refactor.
- M2.1 validation: characterization **9/9 pass**, compiled **9/9 pass**, existing subagent focused suite **44/44 pass**, `typecheck:extensions` pass, and changed-source gate selects the new `subagent/index.ts` regression suite.
- Added `src/resources/extensions/subagent/execution/types.ts` for M2.2. The runtime-neutral contract carries resolved `SubagentLaunchPlan`, child/run identity, AbortSignal, complete stdout-line/stderr callbacks, opaque backend handles, and explicit `{ exitCode, aborted, signal?, runtimeError?, metadata? }` evidence.
- The backend contract explicitly excludes retry/chain/parallel policy, model selection, JSON semantic parsing, usage aggregation, final-response validation, run-store truth, and isolation merge policy.
- M2.2 contract tests **2/2 pass** together with the M2.1 suite and `typecheck:extensions`.
- M2.3 extracted the existing direct process mechanics into `src/resources/extensions/subagent/execution/local-backend.ts` while leaving `runSingleAgent()` responsible for all GSD semantic behavior.
- `LocalBackend` now owns only process spawn, complete stdout-line framing (including final-buffer flush), stderr forwarding, direct local process registry/shutdown, and the existing AbortSignal termination behavior. It returns runtime evidence through the M2.2 contract.
- The pre-existing SIGTERM/SIGKILL fallback check was deliberately preserved rather than fixed during parity extraction; cancellation hardening remains a later M2 regression task.
- `runSingleAgent()` still owns agent lookup, phase guard, effective model/thinking, prompt/session launch planning, `SingleResult`, semantic JSON parsing, usage/update aggregation, abort-to-error mapping, missing-final validation, and prompt cleanup.
- M2.1 characterization remained unchanged and passed **9/9** through the extracted backend; M2.2 contract tests remained **2/2**; new direct LocalBackend mechanics tests **2/2**; `typecheck:extensions` passed.
- Added the nested `subagent/execution/tests/*.test.js` path to normal compiled unit and coverage test globs so backend contract/mechanics tests are part of the standard suite.
- M2.4 generalized the semantic body to `runSingleAgentWithBackend(..., backend)` while retaining `runSingleAgent()` as a LocalBackend wrapper, so no caller/backend selection changed.
- Added backend-neutral semantic tests proving a fake backend that supplies only stdout/stderr callbacks and execution evidence produces the same GSD-visible parsing/usage/update/finalization behavior, and that `{ aborted: true }` maps to the existing `Subagent was aborted` rejection.
- M2.4 focused validation: M2.1 parity **9/9 unchanged**, backend contract/mechanics **4/4**, backend-neutral common-runner tests **2/2**, `typecheck:extensions` pass.
- **M2.5 resume resolver migration is now the active work item.**

## 11. Working-session protocol

For every Herdr session:

1. read this file;
2. identify exact current task IDs;
3. inspect relevant current upstream/downstream code;
4. make the smallest coherent change;
5. run required focused/contract/parity/security tests;
6. update this plan before stopping;
7. record the exact next task and any changed decisions/risks.
