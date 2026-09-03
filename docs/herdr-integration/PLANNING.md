# GSD–Herdr Living Plan

> **Status:** M0–M7 and final downstream-isolation revalidation complete
> **Last updated:** 2026-09-03
> **Current milestone:** Complete — downstream-only install and release validation passed
> **Canonical rule:** Every Herdr-integration development session starts by reading this file and ends by updating it.

## 1. Mission

`penggin/gsd-pi-herdr` is the canonical, self-contained downstream distribution. It adds first-class Herdr support and carries its own package identity, runtime endpoints, automation, release evidence, and operational documentation.

The Herdr integration must provide observable, persistent subagent execution without changing GSD's authority over orchestration semantics.

Target UX:

- root GSD TUI reports `working`, `blocked`, or `idle` in Herdr;
- every active subagent can be observed in a Herdr worker pane;
- worker panes show concise lifecycle/tool activity rather than raw JSON/token deltas;
- Herdr detach/reattach does not stop work;
- retries, cancellation, pane loss, failures, and orphan states are explicit;
- source lineage remains recorded without runtime, CI, or release automation contacting or modifying the original project.

## 2. Repository/branch model

```text
main                       # downstream integration/release line
  │
  └── feature/*            # focused work branches
```

The recorded source-base SHA is historical provenance. Development may perform
read-only upstream fetches, release research, and source comparisons. Runtime,
canary, package, and release automation must not contact the original project,
and upstream mutation remains prohibited unless the user explicitly requests it.

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
10. **Tests protect repository evolution:** semantic parity is evidence-driven and active automation remains downstream-only.

## 4. Current target architecture

```text
GSD root TUI in Herdr
│
├── bundled Herdr integration
│   ├── environment/capability detection
│   ├── socket/CLI client
│   ├── root session reporter
│   └── persistent four-slot worker pane pool
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

**Status:** `COMPLETE`

**Goal:** Replace duplicated local/cmux execution semantics with one common child runner and runtime backends before Herdr worker execution is introduced.

- [x] M2.1 Add deterministic tests around current local `runSingleAgent()` semantic output.
- [x] M2.2 Define backend execution request/callback/evidence types.
- [x] M2.3 Extract direct `spawn()` mechanics to `LocalBackend` with no caller-selection change.
- [x] M2.4 Introduce common `runSingleAgentWithBackend()` semantic runner and prove local parity.
- [x] M2.5 Route resume through the common runner/backend resolver.
- [x] M2.6 Route background single through the common runner and execution registry.
- [x] M2.7 Route chain through the common runner while preserving `{previous}`/stop-on-error semantics.
- [x] M2.8 Route parallel/retry through the common runner while preserving concurrency/retry policy.
- [x] M2.9 Route foreground single through resolver/common runner.
- [x] M2.10 Extract `CmuxBackend` and remove duplicate result/parsing pipeline.
- [x] M2.11 Reapply/revalidate `fix/cmux-split-cli` against the new backend.
- [x] M2.12 Remove raw JSON `tee`, normalize abort classification, and prevent runtime-specific silent fallback.
- [x] M2.13 Move cmux shell escaping/env composition out of general `launch.ts`.
- [x] M2.14 Add mode-to-backend, local parity, cmux regression, phase-conflict, shutdown, and cancellation tests.

Deferred existing behavior: chain-mode `isolated` handling is tracked separately after pure parity extraction unless the refactor makes a fix unavoidable.

### M3 — Internal Herdr worker runner

**Status:** `COMPLETE`

- [x] M3.1 Define versioned launch/state/heartbeat/exit artifacts.
- [x] M3.2 Add private/internal GSD Herdr-worker entrypoint receiving a validated spec path.
- [x] M3.3 Spawn the existing JSON-mode child with argv arrays and `shell:false`.
- [x] M3.4 Persist raw JSONL/stderr with restrictive permissions.
- [x] M3.5 Parse chunked JSONL safely and relay complete lines.
- [x] M3.6 Render bounded lifecycle/tool activity and suppress token deltas.
- [x] M3.7 Strip root Herdr identity from child launch env and apply worker-pane identity.
- [x] M3.8 Report worker semantic state/metadata to its own pane.
- [x] M3.9 Add heartbeat and atomic final exit evidence.
- [x] M3.10 Add SIGINT → SIGTERM → SIGKILL process-group escalation.
- [x] M3.11 Add security/redaction/path/process tests.

### M4 — Herdr backend and persistent worker pane pool

**Status:** `COMPLETE`

- [x] M4.1 Create/reuse one worker tab per root GSD session.
- [x] M4.2 Create deterministic one/two/four-slot layouts.
- [x] M4.3 Implement bounded slot reservation, queueing, reuse, and retention.
- [x] M4.4 Launch the internal worker with Herdr CLI `pane run`.
- [x] M4.5 Tail/relay worker JSONL into the common GSD parser.
- [x] M4.6 Use Herdr semantic state/session/metadata APIs for worker visibility.
- [x] M4.7 Keep retry/chain work in stable slots where safe.
- [x] M4.8 Preserve root-pane focus.
- [x] M4.9 Fail visibly when required Herdr runtime is unavailable/ambiguous.
- [x] M4.10 Add Local-vs-Herdr result parity, cancellation, pane-loss, and >4-task queue tests.

Live closeout: the complete parent-GSD → HerdrBackend → real Herdr pane → private worker path passed against official Herdr v0.8.2 on macOS arm64, including single result/usage parity, affinity reuse, five-task queueing at four-pane capacity, cancellation, pane loss, and post-loss capacity recovery. Detailed evidence is recorded in the 2026-08-30 M4 closeout progress entry below.

M4 exit = first practically usable monitored Herdr-subagent runtime proven in a real Herdr session.

### M5 — Herdr operations plugin and diagnostics

**Status:** `COMPLETE`

- [x] M5.1 Add `integrations/herdr/plugin/` manifest.
- [x] M5.2 Add status/dashboard action.
- [x] M5.3 Add focus-workers/focus-failed-worker actions.
- [x] M5.4 Add retained-worker cleanup controls.
- [x] M5.5 Add startup reconciliation using `session.snapshot`.
- [x] M5.6 Release stale lifecycle authority safely.
- [x] M5.7 Expose orphan/missing-pane state clearly.

### M6 — Durability and recovery

**Status:** `COMPLETE`

- [x] M6.1 Persist versioned run/worker runtime records.
- [x] M6.2 Add root/worker heartbeats.
- [x] M6.3 Reconcile durable state with `session.snapshot`.
- [x] M6.4 Detect manual pane closure/process loss.
- [x] M6.5 Mark uncertain workers `orphaned` and retain evidence.
- [x] M6.6 Prevent duplicate launch during reload/reconnect.
- [x] M6.7 Add root-crash, worker-crash, Herdr restart, detach/reattach E2E.
- [x] M6.8 Finalize retention and cleanup policy.

### M7 — Downstream release and repository maintenance automation

**Status:** `COMPLETE`

- [x] M7.1 Automate downstream base-to-head change detection and impact reports.
- [x] M7.2 Automate supported/canary Herdr capability checks.
- [x] M7.3 Stamp downstream releases with exact repository baseline and historical lineage metadata.
- [x] M7.4 Add canary builds before major upstream/Herdr adoption.
- [x] M7.5 Preserve prior known-good downstream release for rollback.
- [x] M7.6 Document downstream install/update/release identity.

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
| downstream subagent semantic changes | clean merge but broken runtime | common backend abstraction + mode/parity/E2E tests |
| Herdr API changes | launch/state/recovery failure | schema/capability tests against exact supported releases |
| root Herdr IDs leak to worker child | worker overwrites root pane authority | strip/reapply worker-pane managed env |
| high-frequency output | unreadable panes/render cost | filter/dedupe/throttle; no raw token events |
| root dies while workers continue | unobserved/orphaned edits | durable state + heartbeat + explicit orphan reconciliation |
| pane closes mid-run | parent waits forever | pane/process/artifact monitoring and bounded failure |
| compatibility edits change orchestration semantics | semantic regression | mandatory focused/parity tests and recorded evidence |

## 9. Current execution queue

All implementation and validation tasks in this plan are complete. The only
remaining action is an explicitly authorized downstream review/merge/release;
this session does not merge, push, tag, or publish.

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
- M2.5 added `execution/resolver.ts` as an explicit, testable backend-selection seam. At this stage it intentionally resolves every migrated operation to LocalBackend and does not invent the final public cmux/Herdr preference shape early.
- Resume now calls `runSingleAgentWithBackend(..., resolveSubagentExecutionBackend("resume"))` directly, preserving its existing local-only runtime while removing the hidden direct-runner dependency.
- M2.6 background single and M2.7 chain were migrated the same way with no isolation/chain orchestration changes.
- M2.8 parallel/retry and M2.9 foreground single now route their **local branches** through the common runner/resolver. Existing cmux-enabled branches remain the pre-M2 special pipeline until M2.10 extracts CmuxBackend; this is the only intentional exception to full backend convergence at this checkpoint.
- After migration, the only remaining `runSingleAgent()` production calls are three legacy cmux fallback sites inside `runSingleAgentInCmuxSplit()` (split creation/command-submission failure paths). They are explicitly queued for M2.10 because silent fallback after external-launch ambiguity must be resolved as backend policy, not preserved accidentally.
- Resolver/common-runner validation: all subagent + execution source tests **52/52 pass**, including M2.1 parity **9/9 unchanged**, resolver tests **2/2**, and `typecheck:extensions` pass.
- M2.10 extracted `CmuxBackend` and deleted the duplicate `runSingleAgentInCmuxSplit()` semantic pipeline. Foreground single and parallel/retry cmux execution now use the same `runSingleAgentWithBackend()` parser/usage/finalization path as LocalBackend.
- M2.11 revalidated and absorbed the retained `fix/cmux-split-cli` behavior against current cmux CLI forms:
  - surface enumeration uses `cmux tree` rather than removed `list-surfaces`;
  - `new-split` consumes its returned `surface:N` identity directly rather than diffing surface lists;
  - command submission uses `cmux send` rather than removed `send-surface`;
  - cancellation uses `cmux send-key ... ctrl+c` rather than manually sending ETX.
- M2.12 removed raw child JSON/stderr `tee` output from cmux panes. CmuxBackend writes machine output only to artifacts and shows bounded lifecycle text in the pane. Split creation failure and ambiguous command submission now fail visibly through `runtimeError`; no path silently launches a second local worker. Ambiguous submission triggers a best-effort interrupt of the reserved surface. AbortSignal cancellation returns backend `{ aborted: true }` and is normalized by the common runner to the existing `Subagent was aborted` rejection.
- M2.13 moved cmux-specific shell environment quoting/composition out of general `launch.ts` and into `execution/cmux-backend.ts`; general launch planning no longer imports cmux runtime helpers.
- M2.14 added/extended regression coverage for resolver preference, current cmux CLI command names, real-bash cmux artifact execution, no-`tee` pane commands, no-silent-fallback failures, abort normalization, external-backend phase-conflict gating, Local/Cmux execution registries, and session-shutdown cmux interrupt behavior.
- The original M2.1 local characterization remains **9/9 unchanged** after Local/Cmux convergence. Focused M2/cmux tests are **52/52 pass**; the complete subagent + execution + cmux source suite is **76/76 pass**; the same compiled suite is **76/76 pass**; staged `test:changed:src` is **48/48 pass**; `typecheck:extensions` and `verify:extension-coverage` pass.
- This Linux DevSpace does not provide a real `cmux` binary. M2 cmux mechanics are therefore validated with the current CLI contract fake plus a real bash execution fixture; real macOS cmux surface behavior remains a canary/E2E concern rather than an unverified claim here.
- Existing chain-mode `isolated` behavior remains intentionally deferred; M2 did not mix that unrelated behavior fix into backend parity extraction.
- **M2 is complete. M3.1 worker artifact contract is the next task.**

### 2026-08-30 — M3.1 worker artifact contract

- Added `execution/herdr-worker/artifacts.ts` with schema-v1 launch, one-time environment, mutable state, heartbeat, and immutable final-exit contracts.
- Runtime paths are derived only from generated safe IDs under `~/.gsd/runtime/herdr/v1/<root>/<dispatch>/<child>/`; relative roots, traversal IDs, substituted artifact paths, and symlinked generated directories are rejected.
- Worker directories/files are created owner-only (`0700` / `0600` on POSIX). Launch/env readers reject group/world-readable or symlinked inputs.
- `env.json` is versioned, parsed as a string-only map, and deleted immediately after successful read.
- State and heartbeat use same-directory temp + rename publication. `exit.json` uses an exclusive hard-link publication step so a second final outcome cannot overwrite the first immutable exit evidence.
- Launch validation rejects incompatible future schema versions and verifies every declared stdout/stderr/state/heartbeat/exit/env path against the worker's canonical artifact directory.
- M3.1 focused security/contract tests **6/6 pass** and `typecheck:extensions` passes. The nested worker tests are included in normal compiled unit and coverage globs.

### 2026-08-30 — M3 internal worker implementation and closeout

- Added the private `__herdr-worker <launch.json>` loader fast-path before normal GSD TUI/onboarding/provider initialization. The entry accepts exactly one owner-only launch spec under the active `GSD_HOME/runtime/herdr/v1` root and emits only bounded diagnostics on invalid input.
- The internal runner consumes/deletes one-time `env.json`, strips copied root `HERDR_*` identity, reapplies the actual worker pane's Herdr identity, forces `GSD_SUBAGENT_CHILD=1`, and launches the existing JSON-mode child with argv arrays and `shell:false`.
- Raw stdout JSONL and stderr are written verbatim to owner-only `stdout.jsonl` / `stderr.log`. UTF-8-aware line framing handles split multibyte characters, CRLF, malformed lines, and a final unterminated record without mutating the raw evidence.
- Pane presentation is deliberately lossy: only bounded agent/tool/retry/error activity is printed. `message_update`, tool update payloads, token deltas, tool result bodies, and raw JSON are suppressed. Authorization headers, credential-shaped assignments, and URL query secrets are redacted before display or Herdr status reporting.
- Worker lifecycle/metadata uses an ordered Herdr report queue with a unique worker source. Real activity drives `working` / `retrying`; final failed state maps to `blocked`; completion maps to reported `idle` (Herdr may render effective `done`). Final metadata persists an `outcome` token after all queued activity reports.
- Mutable state/heartbeat records include runner PID, child PID, pane identity, and last redacted activity. Heartbeats refresh continuously at the configured interval; `exit.json` remains immutable first-final-outcome evidence.
- POSIX child execution uses a detached process group and cancellation escalates `SIGINT → SIGTERM → SIGKILL`; a real descendant-process test verifies the whole group is reaped. Windows uses the existing platform-equivalent behavior of `taskkill /F /T` for the entire child tree because hidden console children cannot reliably receive graceful signals.
- Security tests cover generated-ID traversal, runtime-root substitution, symlinked path components, group/world-readable specs, incompatible schemas, substituted artifact paths, one-time env deletion, shell metacharacters as literal argv, secret redaction, and process-tree cleanup.
- Worker/loader focused suite: **28/28 compiled changed-source tests pass**. `typecheck:extensions` and `verify:extension-coverage` pass.
- `pnpm run build:core` passes and produces all six worker modules under `dist/resources/extensions/subagent/execution/herdr-worker/` plus the private fast-path in `dist/loader.js`. A built-JS private-worker smoke passes without the source TypeScript resolver.
- Real official Herdr v0.8.2 headless smoke: a private worker launched in a real Herdr pane reported `agent=gsd-worker`, active `working`, final effective `done`, title/display-agent metadata, model/thinking tokens, and `outcome=completed`. Pane text contained only bounded `working/tool/retry/recovered` activity with secrets redacted; raw JSON remained only in the private artifact.
- `pnpm run validate-pack` passes isolated install and global-install verification with final result **`Package is installable. Safe to publish.`**
- Detailed implementation/evidence: [`spikes/M3-INTERNAL-WORKER.md`](spikes/M3-INTERNAL-WORKER.md).
- **M3 is complete. M4.1 worker-tab ownership is the next task.**

### 2026-08-30 — M4 backend/pane-pool implementation checkpoint

- Added `execution/herdr-pane-pool.ts` with one worker tab per root session, deterministic 1/2/4-pane expansion, `focus:false` creation/splits, bounded four-slot capacity, fifth-task queueing, successful-slot reclamation, failure retention, explicit cleanup, and affinity reuse for retry/chain continuity.
- Added `execution/herdr-backend.ts`. It reserves a pane, writes the M3 launch/env bundle, submits only the private worker invocation through `herdr pane run`, tails private stdout/stderr artifacts into the common backend callbacks, consumes immutable exit evidence, probes pane existence, and records pane/tab/workspace/runtime metadata.
- Herdr runtime selection is now policy-driven: enabled+available Herdr wins over cmux; required-but-unavailable Herdr remains selected so dispatch fails visibly; optional unavailable Herdr may fall back before any external launch begins.
- All subagent operation paths carry backend execution identity/affinity so resume, chain, retry, parallel, background, and foreground single can use the common semantic runner without moving orchestration authority into Herdr.
- Session shutdown now interrupts live Local, Cmux, and Herdr executions. Herdr cancellation targets the exact reserved pane and waits for bounded M3 exit evidence rather than assuming Ctrl+C succeeded.
- M3 exit publication was tightened so a pane is not considered reusable until final ordered Herdr reporting has settled.
- Current focused validation for this checkpoint: **57/57 pass** across Herdr pane pool/backend/resolver, Local↔Herdr semantic parity, subagent characterization, launch, and changed M3 artifact/process tests; `typecheck:extensions` passes.
- This is intentionally a checkpoint, not M4 closeout: the full parent GSD → HerdrBackend → real Herdr worker E2E has not yet been run. The next agent must perform that live v0.8.2 validation before marking M4 complete or starting M5.

### 2026-08-30 — M4 real Herdr v0.8.2 live E2E and closeout

- Ran the official local `herdr 0.8.2` binary (protocol 20) on macOS arm64 as a headless server with isolated XDG config/state/data/cache roots, a private socket, and an isolated `GSD_HOME`; no permanent Herdr or GSD preferences were modified.
- Launched the actual downstream `dist/loader.js` TUI in root pane `w1:p1` with `herdr.enabled=true` / `required=true`. Herdr reported `agent=gsd`, root lifecycle `idle ↔ working`, and root focus remained on `w1:p1` through background worker-tab creation and every dispatch.
- Public `subagent` single dispatch created `GSD Workers · 01f930be` and worker pane `w1:p2`, ran `dist/loader.js __herdr-worker <launch.json>`, returned exact `E2E_SINGLE_OK`, and surfaced the common runner's one-turn usage (`input=33219`, `output=9`, `cost=0.033273`, `contextTokens=33228`). The worker pane showed only bounded `working` / `turn settled` activity; raw JSON and token deltas remained in `stdout.jsonl`.
- The single worker bundle had owner-only `0600` files, consumed/deleted `env.json`, and produced `launch.json`, `stdout.jsonl`, `stderr.log`, `state.json`, `heartbeat.json`, and immutable `exit.json`. Herdr finished the pane as effective `done` with `tokens.outcome=completed`.
- A two-step public chain reused the same `w1:p2` affinity slot only after the preceding worker's final reporting/exit evidence settled. Step 1 returned `CHAIN_ONE`; step 2 received it through `{previous}` and returned `CHAIN_TWO`, with common aggregated usage in the parent.
- A public five-task parallel batch held the worker tab at exactly four panes. At t+2/t+6 only four new launch artifacts existed and all four panes were active; the fifth launch artifact appeared 19 seconds after the first four, only after a successful slot became reclaimable. The parent returned `PARALLEL_1` through `PARALLEL_5`, 10 turns, and aggregated usage with no duplicate execution.
- The first real cancellation exposed a macOS process-tree gap: a tool-created `sleep 120` moved to its own process group and survived the JSON child's detached group kill. Cancellation now snapshots and tracks the complete POSIX descendant tree before signalling the leader, re-signals escaped descendants across `SIGINT → SIGTERM → SIGKILL`, and waits boundedly for tracked PIDs. A new real-process regression covers a descendant that creates a separate process group.
- Live cancellation also exposed two visibility/race issues and fixed both: retained-pane metadata now sends `tokens.outcome=null` at initialization so an old completed outcome is not shown during new work; the common semantic runner continues parsing late buffered JSONL after AbortSignal but suppresses its invalidated UI update callback, preventing `Agent listener invoked outside active run` crashes.
- Corrected live cancellation on worker `w1:p7` terminated runner PID `41315`, JSON child PID `41316`, and escaped `sleep 120` PID `41787`; `exit.json` recorded `aborted=true`, the run store recorded canonical `Subagent was aborted` / `status=interrupted`, the parent TUI remained alive and `idle`, and no new crash log appeared.
- The first real pane-close test exposed another detached-child gap: closing the PTY killed the internal runner but left its detached JSON child/tool process. `HerdrBackend` now validates owner-only `state.json`, terminates the recorded child tree on pane loss, and lease-safely discards the vanished pool slot while retaining failure artifacts/results.
- Corrected pane loss on `w1:p8` terminated runner PID `53460`, JSON child PID `53465`, and escaped `sleep 120` PID `53778`; the parent returned explicit `Herdr worker pane disappeared before final exit evidence was produced` without hanging and remained alive/idle. A same-root follow-up recreated the worker tab/pane as `w1:t6` / `w1:p9` and returned exact `PANE_RECOVERY_OK`, proving capacity recovery after physical pane loss.
- Final validation after the fixes:
  - complete subagent/execution/worker source regression: **107/107 pass**;
  - changed-source compiled gate: **48/48 pass**;
  - `pnpm run typecheck:extensions`: pass;
  - `pnpm run build:core`: pass;
  - `pnpm run build:web-host`: pass (required to stage the standalone web artifact for a clean checkout);
  - `NPM_CONFIG_USERCONFIG=/dev/null pnpm run validate-pack`: pass with **`Package is installable. Safe to publish.`**; the temporary config override only bypassed this machine's unrelated user-level npm `allow-scripts` setting;
  - `git diff --check`: pass after the final documentation update.
- Remaining unrelated behavior is unchanged: chain top-level `isolated` handling stays outside M4. No Herdr core fork or orchestration-authority transfer was introduced.
- **M4 is complete. M5 is ready. Exact next task: M5.1 — validate the official v0.8.2 plugin manifest/schema and add the minimal `integrations/herdr/plugin/` manifest.**

### 2026-08-30 — M5 operations plugin and diagnostics

- Added the official v0.8.2 `herdr-plugin.toml` package under `integrations/herdr/plugin/` with status, focus-workers, focus-failed-worker, retained cleanup, startup reconciliation, and popup dashboard entrypoints. Commands are argv arrays and the package has no remote runtime loading or additional dependencies.
- The plugin scans only owner-only `${GSD_HOME}/runtime/herdr/v1` records, requests live topology through `session.snapshot`, shows explicit missing-pane/orphan state, and uses bounded raw-socket requests through Herdr-injected context.
- Retained cleanup does not mutate GSD orchestration state or delete artifacts. It clears terminal pane authority and writes an identity-bound owner-only `cleanup.json`; only the matching root pane pool consumes the request and makes a non-busy retained slot reusable (ADR-H015).
- Startup reconciliation marks active records orphaned when their pane/process is missing and clears only cleanup-requested or stale terminal lifecycle authority. Focus actions use exact IDs returned by the live snapshot.
- Official Herdr v0.8.2 validation passed in an isolated config/state/data/cache environment: local link accepted all four actions, startup hook, and dashboard pane; startup reconciliation exited 0; the status action reported `Herdr: 0.8.2 · protocol 20`; plugin logs recorded both commands as succeeded. The isolated server and temporary plugin registry were removed afterward.
- Focused validation: plugin operations **4/4 pass**; pane-pool/runtime control **11/11 pass**; `typecheck:extensions` passes.
- **M5 is complete. M6 is ready. Exact next task: M6.1 — persist versioned root/run ownership and root heartbeat records alongside existing worker state.**

### 2026-08-30 — M6 durability, crash recovery, and restart closeout

- Added instance-bound, schema-v1 `root.json` and `root-heartbeat.json` leases under the same hashed root runtime directory used by HerdrBackend. A replaced root instance cannot be overwritten by an obsolete shutdown/heartbeat writer.
- Added owner-only `ownership.json` records for every reservation and durable `reserved → submitted → running → settled|orphaned` transitions. Reload reconstructs pane state and affinity from these records, queues matching recovered-busy affinity instead of duplicate-launching, and still allows unrelated work to use free capacity.
- Added root-aware plugin reconciliation against `session.snapshot`, process liveness, and heartbeats. Stale roots become `crashed`; active children receive an identity-bound `orphan.json`; the runner consumes that request, escalates its detached process tree, publishes `state=orphaned` and immutable `exit.aborted=true`, and preserves orphan ownership.
- Worker-pane loss and internal-runner loss are bounded failures even if the pane itself remains. A real runner-only kill (runner PID `73160`, JSON child `73170`, escaped descendant `73630`) returned an explicit missing-runner runtime error in about five seconds and reaped all descendants without killing the root.
- A real public-subagent root-crash run used root PID `92847`, internal runner `93886`, JSON child `93892`, and escaped `sleep 300` PID `94371`. Reconciled status marked the root `crashed`, wrote the durable orphan request, produced `state=orphaned` / `exit.aborted=true`, and left none of those processes alive. The live test also proved status must reconcile rather than merely format stale records; that behavior is now regression-covered.
- Restarted official Herdr v0.8.2 (protocol 20) from the exact isolated XDG config/state. Its persisted workspace restored all four tabs/panes with stable public IDs, the plugin startup hook succeeded (`roots=3`, `workers=3`, `authority_released=3`), and no old root/worker/descendant process relaunched. The long worker had continued while the server was headless with no TUI client before crash, covering detach/reattach persistence without transferring orchestration authority.
- Retention is conservative: completed/aborted evidence is eligible for owner-checked, symlink-refusing pruning after 72 hours; failed/orphaned evidence is retained indefinitely by default. Terminal pane cleanup remains an owner-consumed request rather than plugin mutation of in-memory leases.
- Live validation exposed and fixed capacity accounting around retained failures: unavailable slots now include busy plus failure-retained panes, allowing the pool to expand to the four-pane cap instead of leaving a waiter stuck.
- Focused validation after these fixes: Herdr/plugin/subagent compiled regression **154/154 pass**, plugin operations **7/7 pass**, and `typecheck:extensions` passes. `build:core` also passes with the durable runner changes.
- **M6 is complete. M7 is ready. Exact next task: M7.1 — automate upstream-main change detection and semantic impact reports.**

### 2026-08-30 — M7 downstream compatibility and release automation closeout (historical implementation record)

- Added `scripts/herdr-integration/upstream-impact.mjs`. It resolves immutable comparison refs without fetching or moving branches, verifies ancestry, emits exact commits/name-status files in JSON/Markdown, classifies subagent/lifecycle/process/packaging/preferences impact, and selects the corresponding downstream gates. Non-linear refs fail visibly rather than being treated as a safe sync.
- The current real report compares `origin/upstream-main` `4b26a642c0121ae6161abbb6f2dc6937c78874dd` with `upstream/main` `9555a0dc652e5942ba2f2185d7fe27ffdee9c893`: lineage is valid, the delta is 9 commits/35 files, risk is `high`, and Herdr parity is required. This is a review signal only; no upstream branch was changed or integrated.
- Added capability-based stable/canary validation against the binary's bundled API schema plus CLI/plugin contract. Official installed Herdr v0.8.2 passed protocol 20, schema v1 SHA-256 `c48f1f54ee0150ca27e11fd44455fe94aeadb20fdf4e4a62393ed822a4e5b150`, all 13 required methods, atomic `pane run`, plugin link, and `min_herdr_version=0.8.2` checks.
- Added schema-v1 `integrations/herdr/compatibility.json` and an exact release stamp that refuses dirty worktrees or an upstream base outside downstream ancestry. Clean implementation commit `166ad6b467d35d8e97bd2e94ecf1f3b4f2f45a2b` stamped upstream base `4b26a642…`, Herdr capability evidence, required gates, and prior known-good M6 commit `b7a12baae2ff4917fa0de0d6edc7ca5372d64a61` without mutating the rollback target.
- Added the scheduled/manual/PR `Herdr downstream canary` workflow. It compares remote-tracking upstream refs without merge/rebase/push, tests exact supported v0.8.2 plus latest stable and allowed-failure preview assets from official `herdrdev/herdr` releases, builds the downstream tree, stamps evidence, and runs the full package gate for the supported matrix.
- Documented downstream install/update/release/rollback identity in `integrations/herdr/README.md`, `OPERATIONS.md`, and `UPSTREAM_MAINTENANCE.md`. Release automation is observational until separately authorized promotion (ADR-H017); rollback preserves durable Herdr runtime evidence.
- Final validation:
  - M7 automation plus plugin operations: **14/14 pass**;
  - complete Herdr/root/subagent/common-runner focused regression: **154/154 pass**;
  - `pnpm run typecheck:extensions`: pass;
  - `pnpm run test:changed:src`: pass (no additional focused source selection for the M7 script/docs-only commit);
  - `pnpm run build:core`: pass;
  - `pnpm run build:web-host`: pass with the existing non-fatal Next.js `module.createRequire` trace warning;
  - `NPM_CONFIG_USERCONFIG=/dev/null pnpm run validate-pack`: pass with **`Package is installable. Safe to publish.`**;
  - workflow YAML parse and `git diff --check`: pass.
- The original closeout still treated public package identity and remote compatibility comparison as later decisions. The post-M7 hardening entry below supersedes those operational assumptions.

### 2026-08-30 — Post-M7 downstream distribution isolation and usability hardening

- Selected the concrete public package identity `@penggin/gsd-pi-herdr` and applied it to the root manifest, installer, updater, web updater, managed-resource stamps, Docker image paths, workflow registry operations, diagnostics, and shipped package metadata.
- Added `src/distribution.ts` as the runtime source of truth for downstream package/repository/issues/releases/model-catalog/registry endpoints. Active forensics and bundled GitHub workflow instructions now target `penggin/gsd-pi-herdr` only.
- Removed the original-project remote/fetch path from the Herdr canary. Repository impact compares `origin/main..HEAD`; release stamping records `sourceBase`, rejects dirty promotion by default, and development packs are explicitly marked dirty.
- Every `npm pack` now generates `dist/herdr-release.json`. `gsd --build-info` exposes installed package/version/Herdr identity and the release metadata; `validate-pack` requires and verifies all of it from an isolated installation.
- Added a downstream-network-boundary regression that scans active workflows, installer/update paths, distribution metadata, and runtime issue/release/catalog routes for inherited original-project targets.
- A development tarball of `@penggin/gsd-pi-herdr@1.16.2` was installed offline into an isolated prefix. Its `gsd --build-info` returned the downstream identity plus the expected `dirty=true`, `buildKind=development` provenance stamp. The official Herdr v0.8.2 capability check passed protocol 20, schema v1 SHA-256 `c48f1f54ee0150ca27e11fd44455fe94aeadb20fdf4e4a62393ed822a4e5b150`, all 13 required methods, pane-run, plugin-link, and plugin-manifest checks.
- The installed plugin and installed GSD were then exercised in isolated XDG/GSD state through a fresh real `herdr --no-session` TTY. `/herdr-status` and `/herdr-doctor` confirmed root pane `w1:p1`; a public single `subagent` dispatch created `GSD Workers · dd7d233c` and worker pane `w1:p2`, returned exact final `HERDR_TARBALL_E2E_OK` to the parent with input/output usage `33291/13`, deleted `env.json`, published all final artifacts with `exitCode=0` and `aborted=false`, and showed only bounded `working` / `turn settled` activity in the worker pane. Full evidence is in `spikes/M7-DOWNSTREAM-TARBALL-SMOKE.md`.
- Downstream-isolation implementation checkpoint `8aee21c142982517d02fc748881cebd7f580d1b4` was packed from a clean tree. The clean stamp recorded that exact commit, `dirty=false`, `buildKind=release-candidate`, and `capabilityVerified=true`; an offline isolated install plus explicit workspace-link repair returned the same values through installed `gsd --build-info`.
- Final validation: pre-commit changed-source regression **254/254 pass**; final `typecheck:extensions` pass; Herdr integration/automation **16/16 pass**; `build:core` pass; `build:web-host` pass with the pre-existing non-fatal Next.js trace warning; clean candidate package **9,418 entries / 51.1 MB compressed / 204.4 MB unpacked**; isolated local install, installed binary/version/build identity, standalone web host, daemon dependencies, and global `--ignore-scripts` install+repair all pass; `validate-pack` ended with **`Package is installable. Safe to publish.`**; `git diff --check` pass.
- Post-M7 distribution isolation and usability hardening is complete. Exact next task: review this feature branch and, only with separate user authorization, choose a downstream merge/release/publish action. No merge, push, tag, publish, or original-project request was performed.

### 2026-08-30 — Final downstream-only completion audit

- Audited active runtime, installer, support, CI, release, Docker, native-engine,
  VS Code, and user-documentation paths. Removed remaining operational targets
  for the source project; historical references remain only in archived design
  evidence, attribution comments, and inert regression fixtures.
- Renamed all publishable native binaries to
  `@penggin/gsd-pi-herdr-engine-*`, moved the CI builder to
  `ghcr.io/penggin/gsd-pi-herdr-ci-builder`, and made inherited
  `@opengsd/{contracts,rpc-client,mcp-server,daemon}` workspaces private and
  non-publishable. The authoritative release inventory is exactly five
  downstream engines plus `@penggin/gsd-pi-herdr`; workspace publication emits
  no entries.
- Fixed a real downstream installer defect: global/local installation installed
  `@penggin/gsd-pi-herdr` but returned the old source-package directory. All
  installer roots now resolve `node_modules/@penggin/gsd-pi-herdr`. Source
  checkout postinstall also skips nested `npm install`, preserving the pnpm
  lockfile and preventing an implicit registry lookup during local setup.
- Replaced the obsolete standalone MCP-package publish gate with a stronger
  installed-root gate. The private bundled MCP server now passes both public API
  import and real stdio MCP handshake from the installed downstream tarball.
- Official Herdr v0.8.2 capability evidence passed protocol 20, API schema v1,
  schema SHA-256
  `c48f1f54ee0150ca27e11fd44455fe94aeadb20fdf4e4a62393ed822a4e5b150`,
  all 13 required methods, pane-run, plugin-link, and plugin-manifest checks.
  The earlier installed-tarball public-subagent E2E remains the live runtime
  evidence; this audit changed distribution/release surfaces, not Herdr
  orchestration semantics.
- Fresh audit tarball `penggin-gsd-pi-herdr-1.16.2.tgz` was 53,628,161 bytes
  with SHA-256
  `706143516bcbb651836143135db2ef9a5ddb18dd6cd137ae1c28937c0f7242c0`.
  It installed with `npm --offline --ignore-scripts` into an empty prefix,
  linked 14 bundled workspaces, and reported downstream package identity,
  `herdrIntegration=true`, `capabilityVerified=true`, and the correct installer
  help URL/commands through the installed files.
- Final validation: downstream release/installer/workflow focused regression
  **53/53 pass**; Herdr integration/automation **18/18 pass**; full
  Herdr/subagent/backend parity regression **136/136 pass** (combined Herdr
  focused evidence **154/154**); changed-source regression **10/10 pass**;
  `typecheck:extensions`, `verify:version-sync`, frozen offline pnpm install,
  `build:core`, `build:web-host`, `validate-pack`, and `git diff --check` all
  pass. `validate-pack` ended with **`Package is installable. Safe to publish.`**
- The first package-gate run correctly failed because the old standalone MCP
  validator still expected a public `@opengsd/mcp-server`; that obsolete
  assumption was removed and the installed-root MCP validation above replaced
  it. No unresolved implementation risk remains for the audited scope.
- Exact next task: no engineering work remains in this plan. A human may review
  and explicitly authorize a downstream merge/release action. No source-project
  request, merge, push, tag, or publish was performed.

### 2026-08-30 — Completion re-audit: downstream PR base and bundled MCP executable

- Re-ran the completion audit over all executable workflow, script, and runtime
  files rather than relying only on the earlier curated distribution list. This
  found one live source-lineage leak: `/gsd pr-branch` preferred a historical
  `upstream/main` ref whenever it existed. It now resolves `origin/main` first
  and otherwise uses the repository's detected main branch; historical remotes
  cannot influence downstream PR construction.
- Added an integration regression with both `origin/main` and
  `upstream/main` refs present. The resolver selected `origin/main`, proving the
  fix against the exact ambiguous checkout shape.
- Exposed the bundled private MCP workspace as the root package executable
  `gsd-mcp-server`. A global `@penggin/gsd-pi-herdr` install now provides the
  command documented for external MCP clients, while `/gsd mcp init .` remains
  the recommended absolute-path configuration. Removed stale instructions to
  install the now-private MCP/RPC workspaces from npm.
- Expanded the downstream boundary regression to recursively scan uncommented
  executable source and automation for original-project targets. The broad scan
  passes in addition to the explicit distribution-file assertions.
- Focused evidence: PR-base regression **7/7 pass**; installer/boundary
  regression **12/12 pass** plus broad boundary **5/5 pass**;
  `typecheck:extensions`, changed-source regression **7/7**, `build:core`, and
  `validate-pack` all pass. The package gate confirmed the installed root
  tarball imports and handshakes with the bundled MCP server and that its global
  install exposes `gsd-mcp-server`; it again ended with
  **`Package is installable. Safe to publish.`**
- No new architecture decision was required: these changes enforce ADR-H019's
  existing downstream-only operational boundary. No request or modification was
  made against the source project. Exact next task remains an explicitly
  authorized downstream merge/release action; no push, merge, tag, or publish
  was performed.

### 2026-08-31 — Warm worker visibility and manual topology-loss recovery

- Reproduced the user-visible failure mode in focused tests: deleting a settled
  worker pane left its ID in the root process's shared pool, so the next
  dispatch attempted to launch into a non-existent pane and could poison the
  rest of the root GSD session.
- The pool now reconciles its cached worker tab and slots against live
  `tab.list`/`pane.list` state before reservation. Missing non-leased panes are
  removed, a missing tab is recreated when no lease remains, and missing leased
  panes wait for the owning backend's explicit loss classification rather than
  permitting a duplicate launch.
- HerdrBackend now probes the reserved pane before `pane run`. A pane already
  absent before submission is lease-safely discarded and re-reserved once; an
  attempted/ambiguous submission still never falls back or retries.
- Completed and aborted workers clear `pane.clear_agent_authority` only after
  the runner's final report and immutable exit evidence settle. Their physical
  shell panes remain warm for affinity/queue reuse, while failed or ambiguous
  workers remain visible and retained for review (ADR-H020).
- Final verification: pane-pool/backend regression **20/20 pass**; complete
  Herdr root/worker plus Local/Cmux/Herdr subagent parity regression **140/140
  pass**; Herdr integration/automation **19/19 pass**; compiled changed-source
  gate **20/20 pass**; `pnpm run typecheck:extensions`, `pnpm run build:core`,
  and `git diff --check` pass. `NPM_CONFIG_USERCONFIG=/dev/null pnpm run
  validate-pack` accepted **9,466 entries / 51.2 MB compressed / 204.6 MB
  unpacked**, completed isolated and global installed-root checks with
  **`Package is installable. Safe to publish.`**, and independently installed
  and discovered the 7-file optional assessment pack.
- The full Herdr integration gate exposed one stale downstream-boundary
  expectation from the prior optional assessment-pack release preparation: the
  derived publish inventory already included
  `@penggin/gsd-assessment-pack-gstack`, while ADR-H019 and one Herdr boundary
  assertion still listed only root plus five native engines. The assertion and
  ADR now recognize explicitly approved optional `@penggin` resource packs;
  private inherited workspaces remain excluded.
- No interactive real-Herdr manual-close smoke was rerun inside the user's live
  session because replacing panes there would disturb active work. Exact next
  operational check after installing the committed build is: finish one public
  subagent, confirm its agent row clears while its shell pane remains, manually
  close that idle pane/tab, and confirm the next distinct dispatch recreates
  capacity without restarting root GSD.
- Implementation commit `e173909673bb49f652242e73ffcb3fdf7abbf190` was
  pushed to `origin/feature/herdr-integration-foundation`. A clean
  release-candidate tarball from that commit was installed globally; installed
  `gsd --build-info` reports the same commit with `dirty=false`, the installed
  backend contains the pre-launch recovery and authority-clear paths, the
  `opengsd.gsd-workers` plugin remains enabled, and effective global preferences
  remain `herdr.enabled=true` / `herdr.required=true` with no diagnostics.
- Exact next task: restart the root GSD process so it loads the installed
  implementation, then perform the non-destructive operational check above in
  the existing Herdr session. No merge, tag, registry publish, or source-project
  request was performed.

### 2026-09-01 — Accepted submission startup watchdog

- Investigated a live `validate-milestone` parallel dispatch whose parent
  remained inside the public `subagent` tool for more than ten minutes while
  every visible worker row was idle. Root runtime
  `root-8bb159efa1ca5c8bc26c`, dispatch
  `dispatch-163718e51c269906fab7` contained two completed children with
  `exitCode=0`, immutable exit evidence, and `ownership.status=settled`.
  Third child `child-cba0ff9b98f83f37ca24` remained
  `ownership.status=submitted` on pane `w5:p8`; it still had `env.json` and had
  never produced `state.json`, `heartbeat.json`, `stdout.jsonl`, or `exit.json`.
  The root heartbeat remained active, proving this was a lost worker startup,
  not completed-child relay latency or a dead parent.
- Root cause: `pane run` success was treated as sufficient launch progress, but
  the liveness loop deliberately skipped checks while `state.json` was absent.
  A live idle pane could therefore keep the backend pending until the normal
  30-minute execution timeout, which also held the parent `Promise.all` open.
- HerdrBackend now requires the private worker to publish durable startup
  evidence within ten seconds after an accepted submission. Missing evidence
  sends `ctrl+c` to the exact reserved pane, records the execution as orphaned,
  failure-retains the pane/artifacts, and returns an explicit runtime error to
  the common semantic runner. It never retries the ambiguous submission or
  falls back to Local execution.
- Added a regression for an accepted submission whose pane survives but never
  starts the worker. The test also verifies exact-pane interruption, orphaned
  ownership, failure retention, and absence of successful authority cleanup.
  Stabilized the existing pane-loss fixture so it deterministically tests pane
  disappearance rather than racing an intentionally dead fake runner PID.
- Verification: HerdrBackend **8/8 pass**; execution/backend and Local↔Herdr
  semantic parity **57/57 pass**; compiled changed-source **8/8 pass**; Herdr
  integration/automation **19/19 pass**; `typecheck:extensions`, `build:core`,
  `NPM_CONFIG_USERCONFIG=/dev/null pnpm run validate-pack`, and
  `git diff --check` pass. Packaging again completed isolated and global-root
  checks with **`Package is installable. Safe to publish.`**
- Installed the verified development tarball globally and repaired/relinked its
  packaged workspace dependencies. Global `gsd --version` returns `1.16.2`,
  `@gsd/pi-coding-agent` imports successfully, and the installed backend
  contains the ten-second startup watchdog and bounded runtime error path.
- Known operational limitation: already-running root GSD processes keep the old
  backend module and cannot be repaired in place from outside their managed
  Herdr pane. The currently hung tool must be cancelled and the root GSD process
  restarted after installing this build. Exact next task is a public three-way
  parallel dispatch in that restarted root, confirming either three completed
  children or a bounded startup error in roughly ten seconds rather than an
  indefinite parent wait.

### 2026-09-01 — Herdr human-input attention state

- Implemented the existing root-state contract that maps GSD human-input
  boundaries to Herdr `blocked`. Universal `tool_execution_start` and
  `tool_execution_end` hooks now recognize native and MCP-scoped
  `ask_user_questions`/`secure_env_collect` calls, track their call IDs, and
  restore the surrounding working/idle lifecycle only after every outstanding
  input request settles.
- Added the same bounded projection to JSON-mode Herdr workers. A worker with a
  configured remote question transport now shows `awaiting user input` while
  waiting; a headless worker without that transport settles through its existing
  explicit UI-unavailable result and cannot remain falsely blocked. Worker stdin
  remains intentionally unavailable and is not an answer surface.
- The shared presentation emits only an input category and question count.
  Question text, options, answers, secure field names, and collected values are
  excluded from Herdr state and worker terminal activity. Agent end, reload,
  shutdown, cancellation, and matching tool completion clear stale attention.
- Added privacy, native/MCP normalization, nested-call, state restoration, and
  stale-cleanup regressions. Focused root/worker tests **19/19 pass**, full Herdr
  root/worker/backend/pane/runtime regression **80/80 pass**, and
  `typecheck:extensions` passes. Backend execution regression **41/41 pass**,
  Local↔Herdr semantic parity/subagent regression **16/16 pass**, compiled
  changed-source gate **21/21 pass**, and integration/automation **19/19 pass**.
  `build:core`, `validate-pack`, and `git diff --check` pass; packaging included
  the new shared module and completed isolated/global-root installation with
  **`Package is installable. Safe to publish.`** The isolated package check
  still emits the known native-addon fallback because the platform package is
  not registry-published; this does not change the attention-state contract.
- No live TUI question was triggered in the user's active Herdr workspace during
  implementation. Exact next operational check after installing the resulting
  build is to invoke one public root `ask_user_questions`, verify the root row
  changes `working → blocked → working`, then verify one configured remote
  worker question follows `working → blocked → working` without exposing prompt
  content. No new architecture decision was required because this completes the
  input-to-`blocked` mapping already specified in `ARCHITECTURE.md`.

### 2026-09-01 — Native completion and blocked notifications

- Added Herdr v0.8.2 `notification.show` to the runtime client and required
  capability contract. Live schema inspection confirmed `done`/`request` sounds
  and delivery reasons `shown`, `disabled`, `rate_limited`,
  `no_foreground_client`, and `busy`; the supported v0.8.2 capability check
  passes with all **14/14 required methods** present.
- Root normal `agent_end` now requests one `GSD finished` notification after the
  idle debounce. Duplicate terminal events for the same turn are deduplicated.
  The first transition into question/secure-input/failure
  `blocked` requests `GSD needs attention`; repeated updates inside that blocked
  interval are suppressed, returning to working resets the interval, and a
  quickly settled question cannot emit a stale delayed notification.
- Worker completion requests `GSD worker finished`; question/action/failure
  blocked intervals request `GSD worker needs attention`. Completed uses sound
  `done`, blocked uses `request`, failed-after-already-blocked is deduplicated,
  and aborted workers do not produce a misleading completion notification.
- Notification titles are fixed and bodies are single-line, 160-character
  bounded, and credential-redacted. Question text/options/answers and secure
  input details are not included. Delivery is best-effort: notification failure
  is caught and cannot change lifecycle state, backend semantics, or exit
  evidence (ADR-H021).
- Verification: notification/client/root/worker/capability focused suite **35/35
  pass**; full Herdr root/worker/backend/pane/runtime suite **89/89 pass**;
  compiled changed-source
  gate **39/39 pass**; backend regression **41/41 pass**; Local↔Herdr semantic
  parity/subagent regression **16/16 pass**; integration/automation **19/19
  pass**; `typecheck:extensions`, `build:core`, `validate-pack`, and
  `git diff --check` pass. Packaging contains the notification client and both
  reporters and completed with **`Package is installable. Safe to publish.`**
- A real Herdr v0.8.2 CLI smoke sent `GSD notification integration verified`
  with sound `done`; the live server returned
  `notification_show { shown: true, reason: "shown" }`. Exact next operational
  check after installing this build is one real root question and one real
  completion, confirming request/done sounds and no duplicate alert while the
  question stays blocked.

### 2026-09-02 — Verification-retry dispatch scope incident

- Investigated production wedge `W-6aa93846` for `execute-task M013/S01/T01`.
  Attempt 1 and coordination dispatch 4 had already settled
  `succeeded`/`completed`. Verification then requested a durable retry after
  derived state advanced to T02. Retry dispatches 5 and 6 retained canonical
  `unit_id=M013/S01/T01` but incorrectly copied `task_id=T02` from
  `state.activeTask`; `attempt.claim` correctly rejected both with `Task Attempt
  claim must activate exactly one matching coordination dispatch`.
- `openDispatchClaim()` now derives slice/task coordination scope from the
  canonical `unitId`, not the mutable prompt/state snapshot. This keeps a
  verification retry bound to T01 even when ordinary state derivation already
  points at T02. GSD remains the only authority for the retry and Task Attempt;
  no project DB row was edited or removed during diagnosis.
- Added a focused payload regression and an integrated UnitRun →
  `claimTaskAttempt()` regression reproducing the exact advanced-state shape.
  Focused dispatch/UnitRun/Task-cutover tests **72/72 pass**, full auto-loop and
  orchestrator regression **192/192 pass**, compiled changed-source gate
  **63/63 pass**, and `typecheck:extensions` passes.
- Built and installed the repaired `1.16.2` package globally. npm's local
  `allow-scripts` policy skipped postinstall, so managed resources were synced
  explicitly; the deployed adapter imports `parseUnitId` and no longer reads
  `state.activeTask` for dispatch scope. The root package now includes
  `native/addon/*.node`, the installed darwin-arm64 addon reports
  `nativeLoaded=true`, and the previous JS-fallback warning is no longer
  expected for new processes. Final package validation passed at 9,471 entries
  and 279.6 MB unpacked with **`Package is installable. Safe to publish.`**
- Exact next operational task: restart the root GSD process so it loads the new
  dispatch adapter, then acknowledge the preserved wedge with
  `/gsd auto --resume-wedge W-6aa93846`. The failed
  dispatch rows are immutable history and need no direct repair; the next
  canonical retry will mint a correctly scoped dispatch. Do not run broad
  `/gsd doctor fix` against the migrated project until its unrelated snapshot
  and legacy-validation diagnostics are reviewed separately.

### 2026-09-02 — Coalesced worker thinking and assistant output

- Extended the private worker pane renderer to show provider-emitted reasoning
  and assistant text as labelled `◇ thinking:` and `› assistant:` lines in
  addition to existing lifecycle/tool activity. Streaming `message_update`
  records are never printed directly: deltas are buffered until newline or
  content-block boundaries, line-wrapped, and capped at 16,000 characters per
  kind per assistant message.
- Preserved the raw-stream boundary: `stdout.jsonl` and the parent callback
  still receive exact complete JSONL records in order, while the pane receives
  only the derived human projection. Model text updates last-activity evidence
  without changing Herdr lifecycle status, GSD result parsing, usage, retry, or
  pane-release authority.
- Added cross-delta credential redaction, terminal escape/control stripping,
  duplicate end-content suppression, and explicit truncation activity. Only
  reasoning actually emitted by the provider is displayable; hidden model state
  is not inferred.
- Focused activity/runner regression **19/19 passes**; full Herdr
  worker/backend/runtime regression **109/109 passes**; changed-source gate
  **77/77 passes**; Local↔Herdr semantic parity and launch regression **26/26
  passes**. `typecheck:extensions`, `build:core`, `validate-pack`, and
  `git diff --check` pass, with packaging reporting **`Package is installable.
  Safe to publish.`**
- Repacked and installed `1.16.2` globally, explicitly synchronized the managed
  `~/.gsd/agent` resources after npm skipped postinstall under its local
  `allow-scripts` policy, and verified both installed copies contain the 16,000
  character cap and labelled projections. An installed-module smoke rendered
  exact `◇ thinking: Inspecting worker state` and `› assistant: Worker output
  ready`; the bundled darwin-arm64 addon still reports `nativeLoaded=true`.
  Exact next operational task is to restart the root GSD process and run one
  real public subagent dispatch, confirming the same output in its actual Herdr
  pane without raw JSON or token-fragment flood.

### 2026-09-02 — Selective GSD Pi upstream hardening import

- Compared the current downstream branch with the locally cached
  `upstream/main` (`2a1882e9`, last locally updated 2026-09-02) without fetching
  or contacting the original project. Imported the coordination watchdog fix
  so long-running `subagent`/`Task` calls remain bounded by the unit hard
  timeout but are not falsely aborted by the shorter stalled-tool timeout
  (`a476b32f`). Dedicated regression: **4/4 pass**.
- Imported the evidence-backed lifecycle shadow repair series (`754735d0`,
  `e21e726e`, `72ab25e0`, `516f602c`). Validation can now repair supported
  legacy Task/Slice shadows before closeout, sibling corroboration remains
  evidence-bound, legacy completed slices no longer deadlock reopen/closeout,
  and reassessment metadata correction advances descendant task lifecycles.
  Focused lifecycle/current-dispatch regression: **164/164 pass**.
- Imported DB-authoritative progress reads (`9b07dc1b`) across the CLI and MCP
  seams. Adapted the upstream newer-schema test to the downstream schema version
  and package identity instead of hard-coding v48 and `@opengsd/gsd-pi`.
  Focused DB/MCP/Assessment Gate regression: **198/198 pass** after adaptation.
- Added the self-repairing `dist/bootstrap.js` bin entry, installed-package link
  repair, directory-valued `@gsd/agent-core` jiti alias, strip-types migration
  worker propagation, native coverage parity, and packaged local native addon
  inventory (`8edaeb85`). `build:core` and focused install/alias/migration
  regression **40/40 pass**. The upstream agent-loop error terminal,
  `execCommand` SIGKILL escalation, and Anthropic stop-reason fixes were already
  patch-equivalent in this fork; their regressions passed (**14 total**).
- Imported non-persistent model switching (`a2135776`), in-session model catalog
  refresh (`86a511e7`), and generated-catalog cost normalization (`176bc3e1`).
  The refresh URL was changed from the original project to the downstream
  `penggin/gsd-pi-herdr` catalog (`77c36469`) to preserve repository isolation.
  Model routing plus Codex Remote V2 compatibility regression **157/157 pass**.
- The full generated catalog snapshot from upstream was deliberately not
  selected: its provider inventory is from a different generation and choosing
  it wholesale would remove downstream OpenCodex/Codex-compaction model
  definitions. Runtime refresh now provides a bounded downstream-owned update
  path instead. Existing extension registry/install/list/update behavior was
  already a superset of the upstream fixes; installation/discovery regression
  **52/52 pass**.
- Broad verification: `typecheck:extensions` passes; compiled changed-source
  regression **77/77 pass**; auto/orchestrator/subagent/Local↔Herdr parity
  regression **413/413 pass**; Herdr integration/automation **19/19 pass**;
  `build:core`, `validate-pack`, and `git diff --check` pass. Packaging reports
  **`Package is installable. Safe to publish.`** No upstream fetch, merge to
  `main`, push, publish, or global installation was performed.
- Exact next task: review and commit this progress-log update together with the
  pre-existing uncommitted Herdr presentation/notification work as appropriate,
  then push/install only when explicitly requested. A future full generated
  catalog re-vendor must use the downstream Pi vendoring procedure and reconcile
  provider overlays rather than accepting an upstream generated file wholesale.

### 2026-09-02 — Long-command status visibility in the Herdr-hosted TUI

- Fixed the shared ANSI-aware `alignRight()` primitive used by compact command,
  tool, and GSD status rows. It now reserves the right-hand status/meta column
  first and truncates only the variable-width command/path label with an
  ellipsis. Previously the combined row was truncated from the right, so a long
  command could hide `running`, elapsed time, failure/success state, and the
  `ctrl+o` expansion hint in a Herdr pane.
- When the status itself is wider than an extremely narrow terminal, the status
  prefix remains visible and the left command is omitted. ANSI styling and
  wide Korean/CJK text continue to use terminal-cell-aware measurement.
- Added utility-level regressions for long commands, styled status columns,
  narrow rows, and wide text, plus a transcript-level regression proving a long
  command still ends with `running · 42s · output hidden · ctrl+o expand`.
- Verification: focused transcript/tool/width suite **59/59 pass**; `pi-tui`
  and `agent-modes` package builds pass; canonical compiled workspace package
  suite **1167 pass, 1 skipped**; `typecheck:extensions` and `git diff --check`
  pass; `build:core` also passes. A direct ad-hoc source-mode run of every
  `pi-tui` test is not a supported harness (one test uses TypeScript parameter
  properties and concurrent terminal simulations interfere), so the canonical
  compiled package runner is the authoritative broad result.
- Repacked and installed the dirty development build globally. A normal
  script-enabled npm 11.17.0 replacement ran postinstall successfully but then
  hit an Arborist internal `null.package` error after the package tree had been
  linked. Reinstalling the same tarball with the distribution's supported
  `--ignore-scripts` path completed successfully, and the first `gsd` launch
  self-repaired all seven internal package links. Installed `gsd --build-info`
  reports the downstream package at commit `77c36469` with `dirty=true`, and
  the installed `pi-tui` bundle contains the right-column reservation fix.
- No architecture decision changed. Exact next operational check is to restart
  the active Herdr-hosted GSD process and issue one command longer than the pane
  width, confirming the command is ellipsized while the live status remains
  pinned to the right edge.

### 2026-09-02 — SSH-hosted Linux runtime deployment and live relay smoke

- Prepared the existing `penglab` SSH target as the execution host without
  DevSpace or Hermes. The writable runtime remains under
  `/srv/penglab/gsd-runs`; existing project checkouts and lock records were
  inspected before installation and were not replaced. Added the fixed
  toolchain path to the remote interactive shell while preserving the previous
  `.bashrc` as `.bashrc.pre-gsd-herdr-20260902`.
- Installed official Herdr **v0.8.2** for Linux x86_64 after matching release
  SHA-256 `976150a14d490c94b243ea2e1a7eb2dfb67f12e36b182db90936f6728e6aecf4`.
  Installed the current downstream `1.16.2` development tarball built from
  commit `77c36469` (`dirty=true`) into a versioned toolchain prefix; its
  SHA-256 is `76df4c182cf218b67a3cb822b68bad0e86ac4f96184a399a71ea6f56c1d9ec18`.
  The first launch repaired all seven managed internal package links.
- The macOS-built tarball did not contain a usable Linux engine addon. Installed
  Rust **1.98.0** in the server-owned toolchain, built only the current native
  engine source for Linux x86_64, and installed the resulting ELF addon
  (`72e5d00f1f15121bd8b33156a050c41588d0943d6dfe0194940e6d40a874f166`).
  Runtime inspection reports `nativeLoaded=true` and the expected identity-lock
  and directory-sync exports; the prior JS fallback warning is gone.
- Installed OpenCodex **2.28.0** and Codex CLI **0.152.1** on the server. Copied
  only the required model configuration and credential material over encrypted
  SSH, set credential/config files to `0600`, and did not copy response spills,
  conversation history, usage history, or routing databases. OpenCodex now runs
  as an enabled systemd user service; user linger was already enabled, and both
  `/readyz` and `/healthz` report success.
- Enabled global remote preferences with `herdr.enabled: true` and
  `herdr.required: true`. `gsd --list-models` loads the downstream OpenCodex
  catalog, and a real no-session JSON-mode call from the remote
  `pengbot_monorepo` checkout returned exact text `remote-gsd-ready`.
- Created and detached from persistent Herdr session `gsd-penglab`. After the
  Mac client exited, the remote server remained `running`, compatible at
  protocol 20, and retained the live GSD TUI in
  `/srv/penglab/gsd-runs/projects/pengbot_monorepo/757a5a1c2c35`. The root GSD
  process contains the Herdr session/workspace/tab/pane/socket identity markers.
- A real public `subagent` dispatch returned exact semantic output
  `remote-herdr-worker-ready`. The live UI created the `GSD Workers` surface;
  the private worker consumed and deleted `env.json`, published owner-only
  `launch.json`, `stdout.jsonl` (17 records), `stderr.log`, heartbeat/state,
  ownership, and immutable `exit.json` with `exitCode=0` and `aborted=false`.
  Final state is `completed`, the parent rendered the child result, and no
  `__herdr-worker` process remained.
- Operational risk: this is a staging installation of a dirty development
  build, not a clean release artifact. Linux single-dispatch relay is now live
  proven, but the full Linux `>4` queue, cancellation/process-group escalation,
  and deliberate pane-loss matrix has not been repeated on this host. Exact
  next task is to attach from the Mac with
  `herdr --remote penglab --session gsd-penglab`, confirm the long-command
  right-column presentation during ordinary work, then build a clean committed
  release artifact before treating this server installation as the rollback
  baseline.

### 2026-09-02 — Provider-timeout retry and late blocker projection hardening

- Reproduced the production `W-15f36d1b` sequence: a provider emitted `The
  operation timed out.` before `gsd_task_complete`; the supervisor settled the
  canonical Attempt as `failed/transient-execution` and recorded a retry, then
  a surviving `blockerDiscovered: true` submission bypassed Attempt authority
  through the legacy writer and left `S02-T04-SUMMARY.md` beside a pending DB
  Task. Reconciliation correctly refused to import the file and opened an
  `artifact-db-status-divergence` wedge.
- Removed that canonical-to-legacy downgrade. A blocker report still stages a
  failed canonical Result when a held running Attempt exists, and truly legacy
  Tasks without a lifecycle remain compatible. Once a canonical Attempt has
  settled or lost its lease, late blocker submissions fail closed with the
  Attempt/recovery identity and `/gsd auto` instruction. They cannot mark the
  Task complete, populate `full_summary_md`, register a SUMMARY artifact, or
  write a disk projection (ADR-H023).
- Classified both provider `Request timed out` and `operation timed out`
  phrasings as transient network failures. Core retry remains authoritative
  when it advertises retry intent; after an explicit exhausted
  `willRetry: false`, agent-end recovery schedules the existing bounded
  same-model policy (two retries, starting at three seconds) before configured
  fallback and bounded transient pause behavior. Timeout retries do not relax
  Task Attempt or Herdr execution authority.
- Added an executor-level regression reproducing the settled-Attempt + retry
  action + late blocker sequence and proving zero SUMMARY residue, plus
  resolver, classifier, and agent-end retry tests using the exact production
  timeout wording. Focused provider/completion suite: **169/169 pass**. Extended
  auto/Task lifecycle/reconciliation suite: **196/196 pass**.
- Verification after the fix: `typecheck:extensions` passes; the focused
  provider/completion suite passes **169/169**; the extended
  auto/Task-lifecycle/reconciliation suite passes **196/196**;
  `test:changed:src` passes **246/246**; `build:core` and `git diff --check`
  pass. `validate-pack` reached the tarball guard but did not complete because
  the pre-existing local test addon `native/addon/gsd_engine.dev.node` made the
  unpacked payload **383.9 MB**, above the **350 MB** release limit. That local
  debug binary is unrelated to this runtime change and was not deleted or
  silently excluded.
- Exact next operational task: install/restart this build only when explicitly
  requested. The already-open project wedge still requires `/gsd rebuild
  markdown` followed by `/gsd auto --resume-wedge W-15f36d1b`; running
  processes cannot acquire this code change in place. Before producing a clean
  release tarball, keep the platform release addon and remove or explicitly
  exclude the local `gsd_engine.dev.node` test artifact, then rerun
  `validate-pack`.

### 2026-09-02 — Remote-first deployment of timeout/lifecycle hardening

- Packaged the verified dirty development tree without the local macOS/test
  native binaries and transferred it to the existing `penglab` execution host.
  The deployment artifact is
  `/srv/penglab/gsd-runs/artifacts/gsd-pi-herdr-1.16.2-77c36469-2ddad4d4.tgz`
  with SHA-256
  `2ddad4d4cd5f7f25a85aca02a8a4108be487f2065ecacd550d8d4e2a2e23ef7c`.
- Installed it into the immutable prefix
  `/srv/penglab/gsd-runs/toolchains/gsd-pi-herdr-1.16.2-77c36469-2ddad4d4`,
  repaired all seven internal package links, and installed the previously
  source-built Linux x86_64 engine addon. Direct inspection confirms
  `nativeLoaded=true`, the installed timeout classifier contains the
  request/operation timeout rule, and canonical blocker completion contains
  the no-legacy-fallback guard.
- A real no-session JSON-mode call from the remote project checkout returned
  exact text `remote-timeout-fix-ready`. The shared `toolchains/bin/gsd` and
  `gsd-mcp-server` links now resolve to the new prefix; the prior immutable
  prefix remains available for rollback.
- Operator deployment policy: future development installations should target
  `penglab:/srv/penglab` only. Do not replace the Mac's global GSD installation
  unless the user explicitly asks for a local install. Local builds and tests
  remain valid preparation steps, but the runtime installation target is the
  remote versioned toolchain.
- The already-running `gsd-penglab` root pane predates the link switch and
  therefore still has the former bundle loaded. It was not killed from an
  external SSH shell. Exact next task: from the attached Herdr root pane, exit
  the current GSD process and launch `gsd` again; then run `/gsd rebuild
  markdown` and `/gsd auto --resume-wedge W-15f36d1b` to recover the existing
  project wedge under the updated runtime.

### 2026-09-02 — Read-only Pi upstream audit

- Relaxed the downstream repository policy so read-only upstream research,
  fetches, and source comparisons are permitted. Upstream mutation remains an
  explicit user-authorized action; reviewed imports and compatibility choices
  must be recorded.
- Compared the vendored Pi baseline `v0.75.5` with the current upstream release
  `v0.84.4` across the four vendored packages. The raw delta is 971 files
  (`+117,628/-39,805`), so a wholesale vendor replacement is not safe against
  the current GSD overlay.
- Prioritized focused imports that directly benefit the downstream runtime:
  `ui_prompt_start`/`ui_prompt_end` for authoritative Herdr blocked-state
  reporting, extension-message ordering, resumed-JSONL repair, compaction
  retry/failure events, pre-prompt compaction, large-session streaming reads,
  timeout/shutdown hardening, and GLM-5.3 reasoning metadata.
- Recorded the full compatibility assessment and migration ladder in
  `docs/dev/pi-upstream-audit-2026-09-02.md`. No upstream source was imported
  and `scripts/pi-upstream.json` remains pinned to `v0.75.5`.
- Verified that the pre-existing long-command status-column work survived the
  audit: the focused Pi TUI suite passes **15/15**, `@gsd/pi-tui` builds, and
  `git diff --check` passes.
- Exact next task: create a focused Pi-uplift branch and backport the `v0.84.4`
  UI prompt lifecycle events first, then replace Herdr's heuristic question
  detection only after prompt/cancel/nested-UI parity tests pass. Follow with
  extension message ordering and JSONL repair as separate changes.

### 2026-09-02 — Pi v0.84 focused compatibility backports

- Imported the audited priority-1 changes as isolated commits without moving
  the vendored baseline or replacing downstream provider/runtime seams:
  authoritative `ui_prompt_start`/`ui_prompt_end` events with nested prompt
  coalescing (`4bd93dc8`), replay-safe extension-message ordering
  (`c6810777`), and resumed JSONL record-boundary repair (`b378594f`). Herdr now
  prefers the UI prompt lifecycle while retaining the bounded tool heuristic as
  a compatibility fallback for extensions that do not use the host UI.
- Added compaction trigger/retry metadata to success hooks and a structured
  `session_compact_failed` event for manual, threshold, overflow, failure, and
  cancellation paths (`f29d8378`). Pre-prompt behavior now matches upstream:
  compact the prior context before submitting the new user prompt, without
  replaying the old turn and risking duplicate work. The audit's earlier wording
  about interrupting an in-flight tool loop was broader than upstream v0.84.4;
  this backport does not insert a new orchestration boundary inside tool batches.
- Compaction and branch summarization now share the configured bounded
  exponential-backoff policy for transient provider failures and publish retry
  lifecycle events (`f34df54b`). Abort signals stop retry waits. Deterministic
  errors and exhausted retries remain explicit failures.
- Session open and session-list discovery now stream JSONL instead of loading
  whole files, with a regression crossing both the 1 MiB buffer and a multibyte
  UTF-8 boundary (`77e2210f`). This reduces peak duplication during long-session
  resume and phase-transition listing while preserving malformed-line skipping
  and newline repair.
- Session disposal now aborts retry, compaction, branch summary, bash, and active
  agent work before invalidating extension contexts (`9d86e298`). Existing
  request-timeout classification and Herdr `session_shutdown` behavior were
  already stronger than the selected upstream deltas and were not duplicated.
- Model generation now derives Z.AI effort levels from verified models.dev
  `reasoning_options`; the shipped catalog adds `glm-5.3` and
  `glm-5.3-flash` with only `low`, `high`, and `max` enabled (`f4b5bf8e`). The
  broad live catalog regeneration was deliberately rejected after it removed
  models required by downstream regressions; only the two audited entries and
  generator rule were retained.
- Focused verification passes: extension runner **30/30**, Herdr
  prompt/state **16/16**, session file operations **19/19**, Pi AI reasoning and
  completions **27/27**, and agent-core **132/132**. Final gates also pass
  `typecheck:extensions`, `build:core`, and all ten compiled workspace package
  suites (`agent-core`, `agent-modes`, `native`, `pi-agent-core`, `pi-ai`,
  `pi-coding-agent`, `pi-tui`, `contracts`, `mcp-server`, and `rpc-client`).
  `test:changed:src` correctly reports no focused `src/` tests for this
  package-only change set, and `git diff --check` passes.
- `validate-pack` completed dependency checks and tarball creation, then failed
  only its 350 MB unpacked-size guard: the local macOS ARM release addon
  (75 MB) and development addon (112 MB) were both present, yielding 383.8 MB.
  These workstation build artifacts were preserved. A clean packaging checkout
  or the release workflow remains the authoritative publishability gate.
- Risk/limitation: the v0.80 provider-store and v0.84 session-v4/harness changes
  remain a major migration, not safe cherry-picks. `scripts/pi-upstream.json`
  intentionally remains at `v0.75.5`; the imported compatibility surfaces are
  recorded by commit rather than claiming a baseline version bump.
- Dependency review found no root manifest or lockfile change and no new
  GStack/provider-specific runtime dependency. Exact next task after pushing
  this compatibility batch: prepare the v0.79→v0.80 provider-store migration
  as a separate focused branch rather than mixing it into the validated Herdr
  runtime line.

### 2026-09-03 — Pi v0.80 provider-store migration, storage slice

- Started the priority-2 migration on dedicated branch
  `feature/pi-v080-provider-store`, based on the fully pushed and verified
  priority-1 compatibility batch. Read-only comparison of upstream v0.79.10 and
  v0.80.10 confirmed that provider/auth/runtime changes span 232 files, so a
  wholesale replacement remains unsafe for downstream OpenCodex, Assessment
  Gate, and Herdr seams.
- Added the provider-neutral `ModelsStore`/`ModelsStoreEntry` contract to
  `@gsd/pi-ai`, including cancellation and persisted catalog validator metadata.
  Added memory and owner-only locked JSON implementations to coding-agent.
  Concurrent provider writes preserve sibling entries; values are cloned at
  the boundary; already-cancelled writes do not create storage.
- Made `models-store.json` the canonical cache for runtime model discovery.
  `ModelRegistry.create()` and `inMemory()` accept an injected store, fresh
  snapshots restore discovered models without network access, and aborts remain
  cancellations rather than provider-error results. A fresh legacy
  `discovery-cache.json` entry is promoted once for backward compatibility;
  future catalog reads/writes use the new store.
- Preserved existing startup behavior: no automatic provider network access was
  added, bundled catalog/overlay/`models.json` precedence is unchanged, and the
  existing extension provider registration API remains intact. This slice does
  not claim the v0.80 credential/runtime migration.
- Verification: store-focused tests **3/3 pass**; store + registry + catalog
  overlay regression **13/13 pass**; `typecheck:extensions` pass; `build:core`
  pass; all ten compiled workspace package suites pass, including the expanded
  coding-agent suite **59/59** and MCP workflow suite **377/377**;
  `git diff --check` pass.
- Decision: ADR-H024 makes `ModelsStore` canonical for refreshed provider
  catalogs while treating the old discovery cache only as migration input.
  No dependency or lockfile change was introduced.
- Exact next task: characterize and extract one deterministic provider
  composition pipeline with explicit precedence
  `built-in < downstream catalog overlay < models.json < extension provider`,
  then move auth/header resolution behind a credential adapter without changing
  the public extension registration contract.
- Completed that composition slice in `34487301`: repeated partial extension
  registrations now merge and rebuild from stable inputs, extension model lists
  remain the final replacement layer, and unregister restores `models.json`
  values. Request auth/header resolution moved to a dedicated resolver in
  `15b8c201` without changing Kimi OAuth or command-backed configuration.
- Added conditional catalog revalidation in `671ddf6f`. Discovery adapters
  propagate cancellation, normalize an endpoint already ending in `/v1`, send
  `If-None-Match`/`If-Modified-Since`, retain the stored body on 304, and update
  only its freshness timestamp. Forced refresh ignores freshness but preserves
  validators. A 304 without a cached body is an explicit provider error.
- Retired promoted legacy entries in `a0c176aa`: the old cache is resolved next
  to its corresponding `models.json`, copied once into `ModelsStore`, then the
  provider entry is removed so two durable sources cannot diverge.
- Added the v0.80 provider-neutral `CredentialStore` contract and an
  `AuthStorageCredentialAdapter` in `9dde4f9c`. Secret-free metadata listing and
  provider read/modify/delete are available from `ModelRegistry`; modify is an
  atomic locked operation and honors cancellation. No second credential file or
  startup network path was introduced.
- Expanded focused regressions cover exact precedence, repeated registration,
  unregister restoration, local conditional HTTP requests, 304 persistence,
  legacy promotion/removal, secret-free credential listing, atomic mutation,
  cancellation, and Kimi OAuth. Final `typecheck:extensions`, `build:core`, and
  all ten workspace package suites pass; coding-agent is now **66/66** and MCP
  workflow remains **377/377**.
- ADR-H025 records the stable composition order and single-store credential
  adapter decision. Exact next task: audit v0.80 extension event/tool-registry
  changes against the downstream dynamic registry, then import only missing
  lifecycle guarantees before evaluating lazy startup loading.
- Audited the v0.80 extension lifecycle against the downstream dynamic tool
  registry. The downstream registry already supports runtime refresh and
  `adjust_tool_set`; the missing correctness boundary was `agent_settled`.
  Added that event after every automatic retry/compaction continuation has
  finished, including failed runs, and exposed it to extensions and session
  subscribers. RPC v2 now emits `execution_complete` at this final boundary
  instead of the intermediate `agent_end`; both RPC clients wait for the same
  event, preventing false-idle reports while recovery work is still running.
- Focused verification for this lifecycle slice passes: agent-session **16/16**,
  RPC protocol/client **92/92**, and `typecheck:extensions`. Exact next task:
  import the v0.80 `before_provider_headers` hook with final-header mutation and
  deletion semantics, then run the full package/build regression matrix.
- Added `before_provider_headers` as a real provider-boundary extension hook.
  It runs after attribution, configured model/provider auth headers, and
  request headers are assembled; handlers mutate one shared header map and may
  use `null` to suppress defaults. Handler failures remain isolated extension
  diagnostics. OpenAI/Codex/Anthropic paths preserve nullable SDK semantics,
  while Google string-only clients materialize the same case-insensitive
  deletion contract before dispatch.
- Focused header verification passes: Pi AI header/Codex stream **31/31**,
  extension runner **32/32**, SDK bridge **1/1**, `build:pi-ai`,
  `build:pi-coding-agent`, and `typecheck:extensions`. No dependency or lockfile
  change was introduced. Final `build:core` and all ten workspace package suites
  pass: agent-core **135/135**, agent-modes **287/287**, native **223 pass / 1
  platform skip**, pi-agent-core **3/3**, pi-ai **49/49**, coding-agent **66/66**,
  pi-tui **8/8**, contracts **9/9**, MCP **377/377**, and RPC client **30/30**.
  Exact next task: commit this header boundary, then evaluate v0.80 lazy provider
  startup against downstream opt-in discovery and extension registration
  semantics.
- Confirmed that provider SDK modules were already lazily imported, so no new
  startup discovery or credential activity was needed. The existing lazy
  forwarding wrapper did drop an inner stream's final `AssistantMessage` when
  a provider completed through `result()` without emitting a terminal event.
  It now forwards the final result and returns the forwarding promise so setup
  and iteration failures enter the existing bounded error stream instead of
  becoming unhandled work.
- Lazy module/result regressions pass **4/4** and `build:pi-ai` passes. The full
  Pi AI run completed **71 files / 403 tests passing** but its credential-enabled
  external Codex matrix had three tool-calling failures after three retries
  each (`gpt-5.4`, `gpt-5.5`, and `gpt-5.5` WebSocket); focused deterministic
  Codex/header tests remain **31/31** and the same external tests are not part of
  the workspace offline gate. This is recorded as live-provider variance, not
  treated as a passing gate or attributed to lazy result forwarding.
- Exact next task: commit the lazy result fix, then audit v0.80 cache-friendly
  dynamic tool loading (`addedToolNames` / deferred provider tools) against the
  downstream `adjust_tool_set` registry before deciding whether its performance
  benefit justifies the broader message/protocol change.
- Added the provider-neutral `addedToolNames` provenance marker to extension
  tool results and preserved it through `afterToolCall`, agent events, and the
  canonical `ToolResultMessage` transcript. The extension wrapper snapshots the
  host-owned active tool registry around execution and records only pure
  additions; mixed removal/addition transitions remain unmarked so a provider
  cannot mistake a changed tool universe for an append-only deferred boundary.
- Marker-focused verification passes **32/32** across agent-loop propagation and
  extension wrapper behavior. `pi-ai`, `pi-agent-core`, and `pi-coding-agent`
  builds pass in dependency order. Existing tools that return no marker retain
  byte-for-byte result shape, and providers without deferred-tool support safely
  ignore the optional transcript field.
- Exact next task: implement and test a pure `splitDeferredTools` planner, then
  integrate it only into provider payloads that can represent deferred tools
  natively. Preserve complete-tool fallback for contractions, old transcripts,
  and models without an explicit deferred-tool capability.
- Implemented the pure deferred-tool planner and connected it to native provider
  payloads. OpenAI Responses and Codex-compatible routes use message-anchored
  `additional_tools` or client `tool_search` only when the model explicitly
  advertises that capability. Anthropic first-party Claude 4.5+ (excluding
  Haiku) uses `defer_loading` plus `tool_reference`; compatible proxies remain
  eager unless explicitly opted in. Reference-bearing Anthropic results retain
  ordinary text/image output as sibling content instead of dropping it.
- Safe fallback remains the complete active tool prefix for old transcripts,
  unsupported models, proxy endpoints without capability metadata, mixed
  removal/addition transitions, and Anthropic requests where every current tool
  would otherwise be deferred. Models JSON validation accepts all three new
  compatibility flags. ADR-H026 records this cache-optimization boundary.
- Focused verification currently passes: planner/provider payload **11/11**,
  OpenAI/Codex/Anthropic provider regressions **96 passed / 8 environment skips**,
  the updated models.json compatibility case **1/1**, and `build:pi-ai`. A full
  source `model-registry.test.ts` invocation still exposes eleven pre-existing
  expectation mismatches around command-backed credential hardening and dynamic
  provider validation; the changed compatibility case passes independently and
  the final compiled workspace matrix remains the release gate.
- Exact next task: run `typecheck:extensions`, `build:core`, and all compiled
  package suites; repair only regressions attributable to deferred loading, then
  commit and push the priority-2 provider/runtime batch.
- Final gate passes: `typecheck:extensions`, `build:core`, `git diff --check`,
  and all ten compiled workspace package suites. Counts remain agent-core
  **135/135**, agent-modes **287/287**, native **223 pass / 1 platform skip**,
  pi-agent-core **3/3**, pi-ai **49/49**, coding-agent **66/66**, pi-tui **8/8**,
  contracts **9/9**, MCP **377/377**, and RPC client **30/30**. The focused
  deferred/provider suite remains **11/11** and the broader affected-provider
  suite remains **96 passed / 8 environment skips**.
- Exact next task: commit and push the deferred-tool slice, then begin the next
  upstream audit unit from the remaining v0.80 provider/runtime delta rather
  than expanding this cache optimization into unsupported provider protocols.
- Added context-aware output budgeting from the audited upstream v0.80
  provider/runtime delta. Simple provider entry points now estimate the active
  context from the latest applicable usage marker plus trailing messages,
  invalidate stale usage after an inserted newer prefix such as compaction,
  count dynamically added tool definitions, reserve 4096 context tokens, and
  clamp default or explicit output budgets to the remaining window.
- The clamp is shared by Anthropic, Bedrock, Google, Vertex, Mistral, OpenAI
  Responses/Codex, Azure Responses, and OpenAI-compatible completions. Legacy
  Anthropic/Bedrock thinking budgets are re-clamped after reasoning allocation
  so they retain answer room; OpenAI and Azure Responses preserve their
  16-token wire minimum even when the common remaining-context floor is one.
  Raw provider entry points remain unchanged so advanced callers retain direct
  control over already-normalized options.
- Focused budget/provider verification passes **222/222** with **22** expected
  environment skips. `typecheck:extensions`, `build:core`, and all ten compiled
  workspace package suites pass: agent-core **135/135**, agent-modes
  **287/287**, native **223 pass / 1 platform skip**, pi-agent-core **3/3**,
  pi-ai **49/49**, coding-agent **66/66**, pi-tui **8/8**, contracts **9/9**,
  MCP **377/377**, and RPC client **30/30**. No dependency or lockfile change
  was introduced.
- Exact next task: commit and push this output-budget correctness slice, then
  audit and import the bounded v0.80 `toolChoice` request surface for OpenAI
  Responses and Codex Responses without changing provider selection or GSD
  orchestration semantics.
- Added the bounded Responses `toolChoice` surface. Provider-neutral simple
  options now expose only `auto | none`; OpenAI Responses, Codex Responses, and
  Azure Responses forward those choices, while their provider-specific raw
  options can also request `required`. Codex retains `auto` as its wire default
  when no choice is supplied. Tool definitions remain present when `none` is
  selected, so this changes request selection policy without mutating the
  registered tool universe or deferred-tool bookkeeping.
- Focused OpenAI Responses/Codex/Azure/completions verification passes
  **101/101**, including raw `required`, simple `none`, default Codex `auto`,
  tool-definition preservation, and the prior completions tool-choice contract.
  `build:pi-ai` passes. No provider-selection, credential, GSD orchestration,
  dependency, or lockfile behavior changed.
- Exact next task: run the full downstream type/build/package regression matrix,
  commit and push this tool-choice slice, then audit retry classification for
  transient provider failures (Cloudflare 524, resource exhaustion, and closed
  sockets) as the next isolated correctness unit.
- Final gate passes: `typecheck:extensions`, `build:core`, `git diff --check`,
  and all ten compiled workspace package suites. Counts remain agent-core
  **135/135**, agent-modes **287/287**, native **223 pass / 1 platform skip**,
  pi-agent-core **3/3**, pi-ai **49/49**, coding-agent **66/66**, pi-tui
  **8/8**, contracts **9/9**, MCP **377/377**, and RPC client **30/30**.
- Replaced the session-local loose retry regex with a provider-neutral Pi AI
  classifier. It recognizes Cloudflare 524, gRPC `ResourceExhausted`, DNS
  resolution failures, closed sockets, premature terminal streams, and explicit
  provider retry guidance. Account/subscription/quota/billing exhaustion wins
  over embedded 429 text and fails immediately instead of consuming the retry
  budget. GSD still owns retry count, backoff, cancellation, UI events, and
  continuation; context overflow is still intercepted first for compaction.
- Focused retry verification passes: classifier **12/12** and agent-core
  **136/136**, including the context-overflow precedence guard. `build:pi-ai`
  and `build:agent-core` pass. No retry count, delay, provider SDK, dependency,
  or lockfile setting changed.
- Exact next task: run the full downstream gates, commit and push this retry
  classification slice, then audit OpenAI Responses terminal-event and
  reasoning-replay fixes as the next bounded provider correctness unit.
- Final retry-classification gate passes: `typecheck:extensions`, `build:core`,
  `git diff --check`, and all ten compiled workspace suites. Agent-core grows to
  **136/136**; the other counts remain agent-modes **287/287**, native **223 pass
  / 1 platform skip**, pi-agent-core **3/3**, pi-ai **49/49**, coding-agent
  **66/66**, pi-tui **8/8**, contracts **9/9**, MCP **377/377**, and RPC client
  **30/30**.
- Hardened OpenAI/Azure Responses terminal handling. A stream that closes
  without `response.completed`, `response.incomplete`, or `response.failed` is
  now an explicit provider error instead of a false successful turn.
  `response.incomplete` with `max_output_tokens` maps to canonical `length`;
  content-filter and unknown incomplete reasons remain explicit errors rather
  than silently completing.
- Added Azure stateless reasoning replay repair: when
  `response.output_item.done` omits `encrypted_content`, the parser backfills it
  from the matching reasoning item in the terminal response without replacing
  an already complete signature. This preserves `store:false` multi-turn
  reasoning continuity while leaving GSD orchestration and transcript ownership
  unchanged.
- Focused Responses verification passes **53/53** with **7** expected
  credential/environment skips across all OpenAI Responses and Azure test files;
  wrapper/parser terminal tests pass **38/38**, and `build:pi-ai` passes. The
  existing partial-tool JSON test now includes the protocol-required terminal
  event. No dependency or lockfile change was introduced.
- Exact next task: run full downstream gates, commit and push this terminal and
  replay slice, then audit usage reasoning-token reporting before deciding
  whether the larger concurrent output-slot parser refactor is justified.
- Final terminal/replay gate passes: `typecheck:extensions`, `build:core`,
  `git diff --check`, and all ten compiled workspace suites. Counts remain
  agent-core **136/136**, agent-modes **287/287**, native **223 pass / 1 platform
  skip**, pi-agent-core **3/3**, pi-ai **49/49**, coding-agent **66/66**, pi-tui
  **8/8**, contracts **9/9**, MCP **377/377**, and RPC client **30/30**.
- Added optional reasoning-token usage metadata without changing billing totals.
  OpenAI Responses reads `output_tokens_details.reasoning_tokens`, OpenAI
  completions reads `completion_tokens_details.reasoning_tokens`, and Anthropic
  reads its current `output_tokens_details.thinking_tokens` extension field.
  The value is explicitly documented as a subset of output tokens, so context,
  total-token, and cost calculations do not double-count it. Providers that do
  not report a breakdown leave the field absent.
- Focused reasoning usage verification passes **37/37** across Responses,
  completions, and Anthropic SSE parsing; `build:pi-ai` passes. No serialized
  transcript migration, dependency, or lockfile change is required because the
  field is optional.
- Exact next task: run full downstream gates, commit and push this observability
  slice, then evaluate the upstream concurrent Responses output-slot parser
  against real downstream interleaving risks before importing that larger
  refactor.
- Final reasoning-usage gate passes: `typecheck:extensions`, `build:core`,
  `git diff --check`, and all ten compiled workspace suites. Counts remain
  agent-core **136/136**, agent-modes **287/287**, native **223 pass / 1 platform
  skip**, pi-agent-core **3/3**, pi-ai **49/49**, coding-agent **66/66**, pi-tui
  **8/8**, contracts **9/9**, MCP **377/377**, and RPC client **30/30**.
- Hardened the shared OpenAI/Azure Responses parser against interleaved output
  events. Active reasoning, text, function-call, and web-search blocks are now
  selected by protocol `output_index` instead of one mutable global slot, while
  sequential synthetic streams without an index retain the existing fallback.
  This prevents a later `output_item.added` event from redirecting an earlier
  item's deltas or terminal bookkeeping into the wrong content block.
- Added a deterministic regression that interleaves a reasoning item and text
  item, then delivers the reasoning delta after the text slot is opened. The
  complete Responses/Azure focused matrix passes **55/55** with **7** expected
  credential/environment skips; `build:pi-ai`, `typecheck:extensions`,
  `build:core`, `git diff --check`, and all ten compiled package suites pass.
  Counts remain agent-core **136/136**, agent-modes **287/287**, native **223
  pass / 1 platform skip**, pi-agent-core **3/3**, pi-ai **49/49**,
  coding-agent **66/66**, pi-tui **8/8**, contracts **9/9**, MCP **377/377**,
  and RPC client **30/30**. No dependency or lockfile change was introduced.
- Exact next task: commit and push this concurrent output-slot fix, then audit
  the remaining v0.80 session-affinity representation as the next bounded
  compatibility unit before considering the larger sampling/API migrations.
- Imported the v0.80 structured session-affinity contract without replacing
  downstream session identity. OpenAI-compatible models can select `openai`,
  `openai-nosession`, or `openrouter`; Responses auto-detects OpenRouter's
  `x-session-id`, while other endpoints keep the aligned OpenAI headers.
  Completions only emits affinity headers when its existing opt-in flag is set.
- Preserved configuration compatibility: legacy Responses
  `sendSessionIdHeader: false` maps to `openai-nosession`, and the existing
  completions `sendSessionAffinityHeaders` boolean remains authoritative for
  whether headers are sent. The new enum is validated by both remote-catalog
  and `models.json` schemas, and explicit caller headers still override all
  generated values.
- Focused affinity/provider verification passes **81/81** plus the targeted
  `ModelRegistry` compatibility case **1/1**. `typecheck:extensions`,
  `build:core`, `git diff --check`, and all ten compiled package suites pass;
  counts remain agent-core **136/136**, agent-modes **287/287**, native **223
  pass / 1 platform skip**, pi-agent-core **3/3**, pi-ai **49/49**,
  coding-agent **66/66**, pi-tui **8/8**, contracts **9/9**, MCP **377/377**,
  and RPC client **30/30**. No dependency or lockfile change was introduced.
- Exact next task: commit and push the affinity-format slice, then audit the
  provider-scoped environment boundary from v0.80 so per-provider endpoint and
  auth configuration can be injected without mutating global `process.env`.
- Added the first bounded v0.80 provider-scoped environment slice.
  `StreamOptions` and image options now accept an `env` overlay, simple option
  mapping preserves it, and provider key discovery consults the overlay before
  ambient environment or the Bun sandbox fallback without mutating
  `process.env`. All current simple/raw OpenAI, Codex, Azure, Anthropic,
  Anthropic Vertex, Google, Mistral, and OpenRouter image entrypoints now pass
  that scoped overlay into API-key discovery.
- Scoped `PI_CACHE_RETENTION` now reaches OpenAI Responses/completions,
  Anthropic Messages, and Bedrock. Azure additionally resolves scoped API key,
  base URL, resource name, API version, and deployment-name mapping. Existing
  explicit option precedence and ambient-environment fallback remain unchanged;
  no environment values are logged or persisted.
- Focused provider-env/cache/Azure verification passes **45/45** with **4**
  expected live-credential skips. `typecheck:extensions`, `build:core`,
  `git diff --check`, and all ten compiled package suites pass; counts remain
  agent-core **136/136**, agent-modes **287/287**, native **223 pass / 1
  platform skip**, pi-agent-core **3/3**, pi-ai **49/49**, coding-agent
  **66/66**, pi-tui **8/8**, contracts **9/9**, MCP **377/377**, and RPC client
  **30/30**. No dependency or lockfile change was introduced.
- Risk/limitation: Bedrock credential/client configuration, Google Vertex
  project/location/ADC resolution, and proxy environment selection still read
  their established ambient sources internally; this slice does not claim the
  full upstream provider-env migration.
- Exact next task: commit and push this scoped-env core, then isolate the
  Bedrock and Google Vertex scoped configuration paths with dedicated tests
  before extending the overlay into proxy selection.
- Completed the remaining high-risk scoped runtime configuration paths for
  Bedrock, Google Vertex, and HTTP(S) proxy selection. Bedrock now accepts a
  request-scoped profile, region, bearer/static credentials, session token,
  transport/cache switches, and proxy environment without mutating ambient
  process state. Google Vertex resolves scoped project, location, API key, and
  ADC key-file configuration. Proxy resolution applies scoped `HTTPS_PROXY`
  and `NO_PROXY` consistently while retaining the established explicit-option
  and ambient fallback precedence.
- Added dedicated isolation regressions proving that scoped values reach the
  provider SDK/client configuration and proxy routing while the corresponding
  ambient variables remain unchanged. Focused Bedrock/Vertex/proxy/env
  verification passes **23/23**; `build:pi-ai`, `typecheck:extensions`,
  `build:core`, `git diff --check`, and all ten compiled package suites pass.
  Counts remain agent-core **136/136**, agent-modes **287/287**, native **223
  pass / 1 platform skip**, pi-agent-core **3/3**, pi-ai **49/49**,
  coding-agent **66/66**, pi-tui **8/8**, contracts **9/9**, MCP **377/377**,
  and RPC client **30/30**. No dependency or lockfile change was introduced.
- Compatibility note: Bedrock keeps upstream v0.80's endpoint-resolution
  distinction: a scoped profile is provided to the AWS SDK, but only an
  ambient profile suppresses standard endpoint pinning. This avoids inventing
  downstream endpoint semantics while still isolating credentials.
- Exact next task: commit and push this provider-runtime slice, then audit the
  remaining bounded ambient provider reads (Anthropic Vertex project/region,
  Cloudflare URL placeholders, and Codex proxy selection) and cover only the
  request-scoped paths that can honor `StreamOptions.env` without changing
  OAuth/startup-global behavior.
- Closed the request-scoped provider environment audit. Anthropic Vertex now
  constructs its SDK client from scoped project/region values; Cloudflare URL
  placeholders resolve from the same overlay in Anthropic, Responses, and
  completions clients; and the Bun Codex WebSocket proxy path uses the shared
  scoped `HTTP(S)_PROXY`/`NO_PROXY` resolver instead of reading ambient state
  through a separate library. Scoped WebSocket constructors are not placed in
  the ambient constructor cache.
- Focused Anthropic Vertex, Cloudflare, proxy, and Codex transport verification
  passes **46/46**; `build:pi-ai`, `typecheck:extensions`, `build:core`,
  `git diff --check`, and all ten compiled package suites pass. Counts remain
  agent-core **136/136**, agent-modes **287/287**, native **223 pass / 1
  platform skip**, pi-agent-core **3/3**, pi-ai **49/49**, coding-agent
  **66/66**, pi-tui **8/8**, contracts **9/9**, MCP **377/377**, and RPC client
  **30/30**. No dependency or lockfile change was introduced.
- Remaining direct environment reads are intentionally outside this request
  overlay: OAuth callback hosts and the fake transcript switch are
  process-start configuration, while raw OpenAI client fallback only runs when
  no explicit/scoped key reached the client. No provider credential or endpoint
  is logged or persisted by this change.
- Exact next task: commit and push the completed provider-env tail, then begin a
  separate v0.84 startup-performance slice by characterizing current extension
  transpilation and syntax-grammar load timing before importing any lazy-load
  behavior. Keep the provider-store branch history as the compatibility base.

### 2026-09-03 — Pi v0.84 startup-performance compatibility slice

- Started `feature/pi-v084-startup-performance` from the fully pushed v0.80
  provider-store branch and compared the downstream startup graph with upstream
  commits `cec3a91c0` (deferred uncommon grammars) and `faecac2ca` (reduced
  bundled startup work). The grammar change is not applicable here: downstream
  TUI highlighting already uses the native/lightweight implementation, and the
  legacy `highlight.js` utility is not imported by the runtime barrel.
- Removed the eager Jiti/Babel transform from the extension-loader module
  graph. The loader now imports a transpiler only on the first real extension
  load: Node uses upstream `jiti` 2.7's lazy transform, while Bun binary mode
  retains `@mariozechner/jiti` and its embedded virtual-module support. The
  upstream-normalization script now maps future `jiti/static` imports to the
  production `jiti` dependency rather than restoring the eager fork on Node.
- Added two process/behavior contracts: importing the loader must not populate
  the Jiti `babel.cjs` module, and the deferred importer must still transform a
  typed `.ts` extension and register its command. Focused startup/extension and
  lightweight-highlight verification passes **8/8**. `typecheck:extensions`,
  `build:core`, `git diff --check`, and all ten compiled package suites pass;
  counts are agent-core **136/136**, agent-modes **287/287**, native **223 pass
  / 1 platform skip**, pi-agent-core **3/3**, pi-ai **49/49**, coding-agent
  **68/68**, pi-tui **8/8**, contracts **9/9**, MCP **377/377**, and RPC client
  **30/30**.
- Dependency audit: `jiti` 2.7 was already locked as a development dependency;
  it is now a root and coding-agent production dependency so global installs can
  resolve the deferred Node import. No package version changed, and the legacy
  fork remains because current Bun binary compatibility still depends on it.
- Exact next task: commit and push this startup slice, then audit upstream
  v0.84.3 nested `.agents/skills/` discovery and health diagnostics against the
  downstream Assessment Gate metadata/parser. Add compatibility tests before
  changing discovery precedence or diagnostics.
- Audited upstream `5e11f6586` and the related startup/settings diagnostics.
  Downstream already has the stronger directory model (nearest-first ancestor
  `.agents/skills` discovery through the git root), namespaced Assessment Gate
  validation, fatal/advisory health diagnostics, and gate catalog separation.
  Those paths were retained instead of importing upstream's competing settings
  diagnostic surface.
- Added the one missing compatibility rule: root-level arbitrary Markdown in an
  `.agents/skills` directory remains ignored, but `.md` skills nested inside a
  vendor/pack subtree are now discovered at any depth. All discovered files
  still pass through the existing skill frontmatter and GSD metadata validator;
  a nested `assessment-gate` remains forced out of the ordinary model prompt.
- Targeted upstream-style discovery and GSD metadata tests pass **2/2**, and a
  new downstream compiled contract proves nested gate discovery/catalog
  isolation **1/1**. `typecheck:extensions`, `build:core`, `git diff --check`,
  and all ten compiled package suites pass; counts are agent-core **136/136**,
  agent-modes **287/287**, native **223 pass / 1 platform skip**,
  pi-agent-core **3/3**, pi-ai **49/49**, coding-agent **69/69**, pi-tui
  **8/8**, contracts **9/9**, MCP **377/377**, and RPC client **30/30**.
- Known test-harness limitation: the full inherited
  `packages/pi-coding-agent/test/package-manager.test.ts` has 12 pre-existing
  expectations tied to upstream `.pi` directories and install paths; the
  changed test and its metadata companion pass when targeted, while the
  downstream compiled suite is the authoritative full regression gate.
- Exact next task: commit and push this nested-skill compatibility slice. This
  closes the audited priority-2 set (extension/tool lifecycle, provider/model
  store and affinity, startup transpilation, and skill discovery). Before any
  priority-3 code import, write a dedicated migration plan for the v0.84
  harness/session-v4 and provider-directory reorganization, including GSD DB,
  Herdr worker, JSONL, compaction, and Assessment Gate compatibility boundaries.
- Added `docs/dev/pi-v084-major-migration-plan.md` after measuring the actual
  upstream boundary: 69 harness/test files and a distinct version-4 JSONL
  schema versus downstream's two version-3 session surfaces. The plan requires
  dual readers, one format per file, no startup rewrite, legacy-v3 rollback,
  version-neutral adapters, memory/JSONL conformance, downstream lifecycle
  parity, and real Herdr E2E before any default cutover.
- Architectural decision for the migration plan: provider directory churn is
  not itself a deliverable. Provider behavior is imported only when a tested
  semantic gap remains, and provider moves never share a commit with session
  format changes. GSD DB/AssessmentRun authority and Herdr runtime authority
  remain outside the conversation session store.
- Exact next task: commit and push the priority-3 plan, then implement P3.0
  characterization only—version detection and immutable v3/v4/corrupt/torn-tail
  fixtures—without adding or selecting a v4 writer.
- Completed priority-3 P3.0 format characterization without changing the
  active session reader or writer. `pi-agent-core` now exposes a read-only
  JSONL detector that distinguishes legacy v3, upstream harness v4,
  unsupported versions, malformed/ambiguous headers, non-files, and symlinks;
  symlink targets are rejected before any content read.
- Added immutable v3/v4/future/malformed/torn-tail fixtures. The v3 opaque
  fixture proves that Remote V2-style checkpoint data and GSD Assessment Gate
  metadata survive the legacy reader unchanged. The torn-tail contract proves
  header detection does not conceal the later parse failure or rewrite the
  source file. No v4 codec or writer was introduced or selected.
- Verification: focused JSONL compatibility suite **6/6**,
  `@gsd/pi-agent-core` build, `typecheck:extensions`, `test:packages`,
  `build:core`, and `git diff --check` pass. The compiled package counts remain
  agent-core **136/136**, agent-modes **287/287**, native **223 pass / 1
  platform skip**, pi-agent-core **3/3**, pi-ai **49/49**, coding-agent
  **69/69**, pi-tui **8/8**, contracts **9/9**, MCP **377/377**, and RPC client
  **30/30**. `test:changed:src` reported no focused root-source tests because
  this slice is confined to the workspace package.
- Exact next task: commit and push P3.0, then begin P3.1 by introducing the
  version-neutral repository contract over the existing legacy-v3 backend.
  Keep legacy-v3 as the only creatable/default format and reject v4 opens as
  recognized-but-not-yet-readable rather than creating an empty replacement.
- Began P3.1 at the coding-agent boundary. Existing session paths now pass
  through a bounded format inspection seam before `SessionManager` or
  `forkFrom` reads them. Legacy v1/v2 remain supported by the inherited
  migration path, v3 remains the only active format, and recognized v4 returns
  a typed `unsupported-session-format` error. Empty, malformed, ambiguous, and
  symlinked session files fail closed and are never replaced by a new header.
- Removed the old open-time file mutation that appended a missing newline.
  Opening a valid v3 session is now read-only; the separator is repaired only
  immediately before the next real append. Regression tests assert that
  corrupt/v4/symlink sources remain byte-for-byte unchanged and that the
  deferred separator still produces valid JSONL.
- Verification: format detector **7/7**, inherited session file operations
  **19/19**, compiled coding-agent format guards **3/3**,
  `typecheck:extensions`, `test:packages`, `build:core`, and
  `git diff --check` pass. Compiled package counts remain unchanged except
  coding-agent is now **72/72**; all other counts match the preceding P3.0
  matrix.
- Exact next task: commit and push this P3.1 safety slice, then add the
  version-neutral `SessionRepositoryAdapter` over legacy `JsonlSessionRepo`.
  Its read-only snapshot/open path must use the shared detector; create/fork
  remain v3-only, and v4/unsupported/corrupt inputs must return typed failures
  without file or GSD-state mutation.
- Added the P3.1 `SessionRepositoryAdapter` in `pi-agent-core`. It exposes
  format detection, an immutable cloned read-only snapshot, and the existing
  list/open/create/fork/delete repository contract while delegating only
  legacy-v3 operations. Harness-v4 create/fork/open attempts return the new
  typed `unsupported_version` session error; malformed inputs return
  `invalid_session`. The adapter has an explicit no-op `close()` lifecycle seam
  for future resource-owning backends.
- Adapter conformance covers default v3 creation, format detection, frozen
  read-only snapshots, v4 writer exclusion, corrupt/v4 no-fallback behavior,
  and opaque Remote V2/Assessment Gate details. Focused P3.0 + adapter tests
  pass **11/11** and `@gsd/pi-agent-core` builds successfully.
- Exact next task: route the current harness JSONL construction sites through
  `SessionRepositoryAdapter`, preserving the public `SessionRepo` API and v3
  default. Then add list diagnostics for recognized v4 files without making
  them openable, before starting the isolated P3.2 v4 codec port.
- Completed the remaining P3.1 construction and catalog boundary. Production
  code has no raw `JsonlSessionRepo` constructor outside the adapter; new
  callers now have the exported `createSessionRepository()` factory while the
  low-level class remains compatible for storage tests and existing imports.
  The default and only writable format remains legacy v3.
- Added non-mutating `listDiagnostics()` across all JSONL candidates. It
  distinguishes readable v3, recognized-but-disabled v4, future/corrupt
  formats, and symbolic links without making excluded files appear in normal
  `list()` results. Legacy listing now refuses to follow symlink candidates.
  The durable-harness author documentation records this construction and
  migration boundary.
- Verification for this P3.1 slice: focused repository/adapter tests **10/10**,
  `@gsd/pi-agent-core` build, `typecheck:extensions`, all compiled package
  suites via `test:packages`, `build:core`, and `git diff --check` pass. No
  session file, GSD database, Herdr state, or default writer format changed.
- Exact next task: commit and push the completed P3.1 catalog slice, then start
  P3.2 by porting the minimum upstream v4 header/mutation decoder and immutable
  read-only state reducer. Keep all v4 write/CLI paths disabled until the
  corruption, bounds, parent-linkage, and upstream-fixture conformance gates
  pass.
- Implemented P3.2 as an isolated read-only v4 codec and reducer adapted from
  upstream Pi v0.84.4. It validates header and mutation families, positive
  consecutive sequence numbers, unique IDs, lanes, parent chains, label
  targets, header parent exclusivity, and typed operation records before
  returning a deeply frozen snapshot. No encoder or append API was imported.
- Added bounded read enforcement: 64 MiB files, 1 MiB physical lines, and
  200,000 mutation records by default; error text is capped and never embeds
  raw JSON payloads. Reads reject direct symlink files and canonical paths
  outside the configured sessions root. A syntactically torn final append is
  ignored in memory only; complete schema errors fail and both torn and valid
  unterminated inputs remain byte-for-byte unchanged.
- `SessionRepositoryAdapter.openReadOnly()` now selects the v4 reader, and
  `listReadOnly()` returns validated v3/v4 metadata. Ordinary `open`, `create`,
  `fork`, and `list` remain v3-only, preserving rollback and preventing an
  accidental writer cutover. Immutable leaf-to-root v4 branch reads are
  exposed over already validated snapshots.
- P3.2 focused verification passes **26/26** across version detection, legacy
  repository, codec, reader/security, and adapter suites. In addition,
  `typecheck:extensions`, all compiled package suites via `test:packages`,
  `build:core`, and `git diff --check` pass. The broad source harness invocation
  still reports the pre-existing faux-provider registration failures
  documented earlier; the changed focused suites are clean and the compiled
  package gate remains the authoritative broad check.
- Exact next task: run the full compiled package/typecheck/core-build gates,
  review and push P3.2, then begin P3.3 by defining one shared read-state
  conformance surface for legacy-v3 and harness-v4. Do not add v4 mutation or
  default selection until memory/JSONL equivalence and downstream lifecycle
  parity are proven.
- Began P3.3 by extracting `V4SessionState` as the single deterministic reducer
  shared by the v4 reader and future memory/JSONL writers. It owns consecutive
  sequence, unique ID, lane, parent, label, and name invariants without doing
  any I/O; snapshots and individual reads are detached clones.
- Added a reducer parity fixture that applies the same mutation stream directly
  in memory and through the bounded JSONL reader, then compares entries,
  records, lanes, facts, and branch traversal. Focused reader/state tests pass
  **8/8**; `@gsd/pi-agent-core` build, `typecheck:extensions`, all compiled
  package suites via `test:packages`, `build:core`, and `git diff --check` also
  pass. No v4 writer, CLI selection, GSD state mutation, or Herdr behavior was
  introduced.
- Exact next task: commit and push the P3.3 reducer foundation, then implement
  an isolated v4 memory storage over the reducer and a JSONL writer that
  appends before applying state. Run one shared backend conformance suite for
  lanes, entries, records, facts, branch reads, cloning, and deterministic
  errors before exposing either backend through the version-neutral adapter.
- Added the isolated P3.3 v4 memory repository/storage reference backend. It
  provisions storage-owned sequence, parent, and timestamp fields; implements
  lanes, entries, operation records, names, labels, bounded entry/record/log
  queries, open-operation recovery reads, and branch/tree forks over the shared
  reducer. All returned metadata and payloads are detached clones.
- Programmatic payloads now pass a side-effect-free JSON durability validator
  that rejects cycles, accessors, `toJSON`/non-plain objects, symbols, sparse or
  extended arrays, non-finite numbers, and values JSON would silently discard.
  The accepted mutation is then serialized into the same flat v4 wire shape
  and decoded by the shared codec before state application, preventing the
  memory reference backend from accepting states the JSONL backend cannot
  persist. Overlapping open operations on one lane are rejected.
- Focused memory/state/reader verification passes **12/12**. The full
  `typecheck:extensions`, compiled `test:packages`, `build:core`, and
  `git diff --check` gates also pass with package counts unchanged from the
  preceding slice. The backend remains isolated: the application adapter still
  creates and mutates only legacy v3 sessions; no CLI, GSD DB, projection, or
  Herdr behavior changed.
- Exact next task: review and push the memory backend slice, then implement the v4 JSONL
  repository/storage with serialized mutation commits, atomic create/fork,
  explicit torn-tail repair on writable open, and a shared conformance suite
  against memory. Do not select harness-v4 in the application adapter yet.
- Added the isolated P3.3 v4 JSONL repository and storage. Per-storage writes
  share a promise tail, validate the exact flat wire record, make one append,
  and apply the reducer only after filesystem acceptance. Failed and
  pre-aborted writes leave sequence/facts unchanged; subsequent queued writes
  continue from the last committed sequence.
- Create and fork build complete sibling temporary files and publish with an
  atomic rename, cleaning temporary files on failure. Writable open reuses the
  bounded, containment-checking reader and atomically publishes only its
  validated prefix when repairing a syntactically torn final append or missing
  newline. Read-only open remains byte-for-byte non-mutating. Session
  directories and files are symlink/containment checked before writable use.
- Added `FileSystem.renameFile()` and abort-aware append preflight to the Node
  execution environment. A shared backend conformance suite now exercises the
  same entry/lane/record/fact sequence, deterministic errors, branch/tree fork,
  and detached payload rules against memory and JSONL. Focused v4 storage,
  reader, codec, repository-adapter, conformance, and Node filesystem tests
  pass **58/58**. The full `typecheck:extensions`, compiled `test:packages`,
  `build:core`, and `git diff --check` gates pass with the established package
  counts unchanged.
- Risk/limitation: this is still an opt-in internal backend. The version-neutral
  application adapter deliberately remains legacy-v3 for all mutable paths,
  and no CLI, GSD DB/projection, or Herdr behavior has changed. Same-process
  create/fork identity races are rejected; cross-process writer ownership and
  a public v4 selection remain later cutover gates.
- Exact next task: review and push this JSONL foundation, then finish P3.3
  semantic parity by porting
  filtered branch queries, operation-kind/open-operation bounds, usage stats,
  and the remaining upstream conformance cases before any adapter selection.
- Completed P3.3 memory/JSONL semantic parity for the isolated v4 backends.
  The shared reducer now supports bounded branch queries with stop/cursor/type
  filters, operation-kind record queries, incremental open-operation tracking,
  per-lane limits, and ledger statistics for messages, cached/uncached tokens,
  total tokens, cost, and negative provider corrections. Reads remain detached
  clones and one open operation per lane is enforced with the upstream storage
  error semantics.
- Common conformance exposed and fixed two durability gaps: clearing a session
  name or entry label now uses the v4 omitted-field convention without
  weakening general JSON payload validation, and usage records are fully
  validated before the JSONL append so a malformed usage payload cannot become
  a durable line after reducer rejection. JSONL deletion is now idempotent as
  required by the repository contract.
- Expanded the shared memory/JSONL suite to cover branch bounds and compaction
  traversal, record filters and cursors, operation overlap/recovery/lane
  isolation, immutable open-operation reads, usage aggregation, durable fact
  clearing and reopen, idempotent deletion, invalid JSON/usage preflight, and
  concurrent cross-lane write linearization. Focused P3.3 verification passes
  **72/72** across nine suites.
- Full gates pass: `typecheck:extensions`, `test:changed:src` (no root-source
  tests for this package-only slice), all compiled package tests via
  `test:packages`, `build:core`, and `git diff --check`. Package counts remain
  agent-core **136/136**, agent-modes **287/287**, native **223 pass / 1
  platform skip**, pi-agent-core **3/3**, pi-ai **49/49**, coding-agent
  **72/72**, pi-tui **8/8**, contracts **9/9**, MCP **377/377**, and RPC client
  **30/30**.
- Remaining risk: the v4 writer is still internal and unselected. Same-process
  create/fork identity collisions are guarded, but cross-process writer
  ownership remains a P3.5/cutover concern. No CLI, GSD database/projection,
  AssessmentRun, or Herdr runtime state was changed.
- Exact next task: review, commit, and push the completed P3.3 parity slice,
  then begin P3.4 by characterizing the current downstream AgentHarness prompt,
  tool loop, steer/follow-up, retry, compaction, branch summary, abort, and
  shutdown contracts against upstream v0.84.4. Import only missing behavior by
  capability; keep the v4 application adapter disabled until both memory and
  JSONL harness parity pass.
- Began P3.4 with a capability-level comparison rather than importing the
  upstream v0.84.4 `AgentHarness` package tree. The tagged v0.84.4 harness is a
  compile-complete scaffold whose public methods still reject with
  `HarnessNotImplemented`; replacing the downstream working harness with it
  would be a functional regression. The useful summary-request behavior comes
  from the earlier v0.81–v0.83 evolution and was adapted independently.
- Compaction history, split-turn prefix, and branch-summary requests now each
  receive a fresh routing session ID and force `cacheRetention: none`, so they
  cannot inherit root websocket/Remote Compaction affinity or pollute the root
  prompt cache. Transport, timeout, bounded retry, metadata, merged auth/base
  headers, and the downstream provider request/payload/response lifecycle hooks
  still apply. Hook patches may customize supported request fields but cannot
  override the isolated session identity or re-enable caching.
- Repointed the three source-level harness tests at the local `@gsd/pi-ai` faux
  provider registry. Their former `@earendil-works/pi-ai` import registered a
  separate module instance and produced false “No provider registered” failures
  even though the runtime imported the downstream registry. Added regression
  coverage for two concurrent split summaries receiving distinct identities,
  branch-summary isolation, hook header/metadata propagation, payload hooks,
  and response observability. The focused build and harness suites pass
  **37/37**. `verify:pi-patches`, `typecheck:extensions`, `build:core`, the full
  compiled package suite, and `git diff --check` also pass. Package counts are
  agent-core **136/136**, agent-modes **287/287**, native **223 pass / 1
  platform skip**, pi-agent-core **3/3**, pi-ai **49/49**, coding-agent
  **72/72**, pi-tui **8/8**, contracts **9/9**, MCP **377/377**, and RPC client
  **30/30**.
- Remaining P3.4 scope: characterize and close any semantic gaps in prompt/tool
  result reduction, steer/follow-up queues, retry classification, abort, and
  shutdown against the working downstream contracts. Then run the same harness
  parity matrix over memory and v4 JSONL before enabling an adapter.
- Imported the missing bounded assistant retry primitive on top of the existing
  downstream transient-error classifier. Summary retries are opt-in, use
  exponential backoff, honor cancellation during backoff, and emit scheduled,
  attempt-start, and finished lifecycle events. Quota, billing, disabled-policy,
  abort, and deterministic errors remain terminal. Compaction and branch-summary
  retries keep one isolated request identity across attempts and do not inherit
  root affinity.
- Focused retry verification passes **16/16** in pi-ai and the combined harness
  suites remain **37/37**, including transient recovery in both compaction and
  branch-summary paths plus retry lifecycle ordering. `verify:pi-patches`,
  `typecheck:extensions`, `build:core`, the full compiled package suite, and
  `git diff --check` pass with the established package counts unchanged.
- Exact next task: document, gate, commit, and push the bounded-summary-retry
  slice, then reconcile abort/shutdown task ownership and pending session-write
  settlement against upstream `82c485983` through `9cde1725d`. Do not replace
  the downstream harness with the v0.84.4 scaffold and do not select v4 at
  runtime yet.
- Reconciled harness operation ownership and shutdown semantics. Prompt, skill,
  prompt-template, compaction, and branch navigation now share one active
  abort-controller contract and are tracked independently from idle session
  mutations. `waitForIdle()` waits only for an operation; idempotent
  `shutdown()` rejects future work, clears queued/pending work, aborts the active
  operation, and waits for both operations and already-started mutations.
- Compaction and branch hooks/provider calls receive the active operation signal.
  A shutdown after a provider call begins cannot persist a late compaction or
  move the session leaf, while ordinary `abort()` cancels compaction without
  permanently closing the harness. Normal compaction/navigation settlement now
  flushes listener-queued session writes instead of leaving them pending until a
  later prompt.
- Focused lifecycle and harness verification passes **42/42**, covering active
  prompt shutdown, idempotent close, post-close rejection, compaction abort and
  reuse, late compaction suppression, branch-leaf preservation, and shutdown
  waiting for a blocked idle mutation.
- Full regression gates pass: `verify:pi-patches`, extension typecheck,
  `build:core`, `test:packages`, and `git diff --check`. Package counts remain
  **136/136**, **287/287**, **223/224 with one native skip**, **3/3**, **49/49**,
  **72/72**, **8/8**, **9/9**, **377/377**, and **30/30** across the ten package
  runners.
- Exact next task: commit and push the operation-lifecycle slice, then port
  usage aggregation/persistence for generated compaction, branch summaries,
  and tool results while keeping GSD workflow accounting and session-v4 usage
  ledgers separate.
- Ported upstream auxiliary-LLM usage metadata through both the standalone
  `AgentHarness` and the deployed GSD `AgentSession` path. Generated and
  extension-provided compaction/branch summaries now persist provider usage;
  LLM-backed tool results expose usage to hooks, accept a patched value, and
  retain it in transcript messages.
- Split-turn compaction sums both provider calls. GSD's defensive chunked
  summarizer additionally includes every chunk and bounded degenerate retry in
  the recorded usage, so recovered or discarded attempts are not invisible.
  The public string-returning `generateSummary()` API remains backward
  compatible.
- Session statistics now add durable compaction, branch-summary, and tool-result
  usage alongside assistant usage. This is session cost observability only: it
  does not write GSD workflow accounting and does not synthesize session-v4
  ledger records.
- Focused verification passes: pi-agent-core agent loop **29/29** and harness
  **69/69**; GSD agent-core **139/139**; pi-coding-agent session manager
  **32/32**, extension runner **32/32**, stats **4/4**, extension compaction
  **1/1**, and branch hook persistence **2/2**. The full multi-file source suite
  is intentionally not used as one process because its faux provider registry
  is process-global; independent runs avoid cross-file unregister races.
- Final gates pass: `verify:pi-patches`, `typecheck:extensions`, `build:core`,
  `test:packages`, and `git diff --check`. Compiled package totals are GSD
  agent-core **139/139**, agent-modes **287/287**, native **223 pass / 1 skip**,
  pi-agent-core **3/3**, pi-ai **49/49**, pi-coding-agent **72/72**, pi-tui
  **8/8**, contracts **9/9**, MCP server **377/377**, and RPC client **30/30**.
- Exact next task: commit and push the usage-persistence slice, then close
  memory/v4 JSONL harness parity before enabling any v4 runtime adapter.
- Completed P3.4 harness/storage parity without changing the application
  default. `V4HarnessSessionStorageAdapter` maps the working downstream
  `SessionStorage` contract onto either isolated v4 backend, uses the native
  `main` lane and global name/label facts, and preserves strict v4 JSON
  validation. Legacy optional `undefined` object properties are normalized at
  this explicit compatibility boundary rather than weakening the v4 stores.
- Compaction writes now include a real v4-native `retainedTail` rebuilt from
  the selected branch while retaining the downstream `firstKeptEntryId` seam
  needed before P3.5. Existing v3 files are never opened or rewritten by this
  adapter, and neither the CLI nor coding-agent selects it yet.
- The same AgentHarness matrix passes against memory and JSONL v4 **12/12**:
  custom-message projection plus native name/label facts, prompt/tool execution
  and hook-patched usage, steer/follow-up ordering, compaction and
  branch-summary persistence, transient summary retry, cancellation and reuse,
  idempotent shutdown, and post-close rejection.
  Existing downstream harness regression passes **18/18** and the focused v4
  state/codec/reader/storage/conformance suites pass **39/39**.
- Final P3.4 gates pass: `verify:pi-patches`, `typecheck:extensions`,
  `build:core`, `test:packages`, `test:changed:src` (no root-source tests for
  this package-only slice), and `git diff --check`. Compiled package counts are
  unchanged from the preceding usage-persistence slice.
- Exact next task: commit and push P3.4. Begin P3.5 only afterward by adding an
  explicit opt-in coding-agent construction setting; `legacy-v3` must remain
  the default and format mismatch must fail without empty-session fallback.
- Audited primary upstream through `4e69b0c28`. P3.5 cannot safely be a thin
  setting switch: the deployed coding-agent manager is synchronous, the
  validated v4 stores are asynchronous, and upstream's new harness still throws
  `HarnessNotImplemented` for production prompt/compaction/navigation. Recorded
  ADR-H028: no duplicate synchronous v4 writer and no non-functional opt-in;
  legacy v3 remains the application default until an asynchronous production
  composition seam is characterized.
- Ported three independent upstream correctness fixes without changing GSD or
  Herdr authority. A proxy response that reaches EOF without a terminal SSE
  event now becomes a canonical error instead of hanging; an unterminated final
  terminal line is flushed. Parallel tool batches no longer start prepared
  side-effecting tools after a later preflight aborts the batch. In-memory fork
  now aborts and settles the active turn before mutating the shared manager, so
  late tool results cannot enter the replacement session.
- Focused regression evidence passes: proxy and agent-loop **32/32**, including
  paired aborted-tool events/results and no side effects; active-tool in-memory
  fork **1/1**, including a clean replacement transcript and next-provider
  context containing only the new user turn.
- Final settlement-slice gates pass: `verify:pi-patches`, extension typecheck,
  `build:core`, `test:packages`, `test:changed:src` (no root-source tests for
  this package-only slice), and `git diff --check`. Compiled package totals are
  GSD agent-core **139/139**, agent-modes **287/287**, native **223 pass / 1
  skip**, pi-agent-core **3/3**, pi-ai **49/49**, pi-coding-agent **72/72**,
  pi-tui **8/8**, contracts **9/9**, MCP server **377/377**, and RPC client
  **30/30**.
- Exact next task: commit and push this settlement slice, then evaluate upstream
  `56700d42e` (compact before post-tool model requests) against downstream
  compaction semantics before importing it.
- Evaluated and ported the semantic portion of upstream `56700d42e`. The agent
  loop now invokes next-turn preparation only when another turn will actually
  start and after graceful-stop decisions. AgentSession uses that boundary to
  threshold-compact an oversized tool result, then refresh the provider context
  from the compacted transcript plus the current system prompt, tools, model,
  and thinking level before the same run's next request.
- Next-turn preparation re-polls steering only when the earlier poll was empty,
  so input queued while a long compaction runs is delivered without violating
  one-at-a-time queue semantics. A terminating/no-next-turn path does not run
  preparation. This is conversation lifecycle only and does not change GSD
  retry, Task Attempt, or Herdr pane authority.
- Focused verification passes: Agent/agent-loop **49/49**, harness plus v4
  parity matrix **78/78**, and standalone AgentSession post-tool compaction plus
  active-fork regressions **2/2**. The post-tool test proves compaction precedes
  the follow-up provider call, the compacted summary and retained large result
  are both present, and the operation remains one agent run.
- Final post-tool-compaction gates pass: `verify:pi-patches`, extension
  typecheck, `build:core`, `test:packages`, `test:changed:src` (no root-source
  tests for this package-only slice), and `git diff --check`. Compiled package
  totals remain GSD agent-core **139/139**, agent-modes **287/287**, native
  **223 pass / 1 skip**, pi-agent-core **3/3**, pi-ai **49/49**,
  pi-coding-agent **72/72**, pi-tui **8/8**, contracts **9/9**, MCP server
  **377/377**, and RPC client **30/30**.
- Exact next task: commit and push the post-tool compaction slice, then audit
  current upstream Anthropic per-turn thinking preservation (`4e69b0c28`)
  without changing session-format selection.
- Audited and ported the transport-safe subset of upstream `4e69b0c28`.
  Verified Anthropic Messages models now persist the exact native effort on
  each assistant response and reconstruct effort-only system markers before
  replaying signed thinking, so changing low/medium/high between turns no
  longer invalidates the signed prefix. The binding beta uses `drop_block` for
  a stale prefix and records only redacted transformation type/path/reason
  diagnostics; raw thinking signatures and content are not logged.
- Activation is deliberately narrow: the committed catalog enables the feature
  for direct Anthropic `claude-opus-5`; the generator also recognizes only the
  upstream-verified Opus 5 and Fable/Mythos 5.1 patterns on Anthropic Messages
  transports. Existing Fable 5, Sonnet, Vertex, Bedrock, OpenAI/OpenCodex, and
  OpenRouter completions behavior is unchanged. This adds no GSD workflow or
  Herdr authority and does not alter session-format selection.
- Focused evidence passes **24/24** across mid-conversation effort replay,
  beta headers, transformation diagnostics, legacy adaptive behavior, and the
  generated catalog. `@gsd/pi-ai` TypeScript build also passes. The unfiltered
  source `pnpm test` command was interrupted after entering credential-gated
  live-provider smoke coverage; canonical offline package gates remain the
  required final evidence for this slice.
- Final gates pass: `verify:pi-patches`, extension typecheck,
  `test:changed:src` (no root-source tests for this package-only slice),
  `build:core`, `test:packages`, and `git diff --check`. Compiled package totals
  are GSD agent-core **139/139**, agent-modes **287/287**, native **223 pass / 1
  skip**, pi-agent-core **3/3**, pi-ai **49/49**, pi-coding-agent **72/72**,
  pi-tui **8/8**, contracts **9/9**, MCP server **377/377**, and RPC client
  **30/30**.
- Exact next task: review, commit, and push this Anthropic effort slice; then
  audit upstream `b8b873b98` (`supportsMaxOutputTokens`) as the next isolated
  compatibility improvement.
- Ported upstream `b8b873b98` as a default-preserving OpenAI Responses
  compatibility switch. `max_output_tokens` remains present for every existing
  model, but a custom Responses-compatible gateway can declare
  `compat.supportsMaxOutputTokens: false` when that gateway rejects the field.
  The flag is enforced by the provider and accepted by both catalog and
  `models.json` validation; it does not affect `openai-codex-responses`, Remote
  V2 compaction, or GSD/Herdr lifecycle semantics.
- Also closed the custom-model schema half of the preceding Anthropic slice:
  explicitly configured Anthropic-compatible providers can now declare
  `supportsMidConvoEffort` instead of relying only on generated catalog data.
  Both features remain opt-in outside their verified generated defaults.
- Focused evidence passes: OpenAI Responses payload/default coverage **37/37**
  and the two new custom model-registry cases **2/2**. The unfiltered
  model-registry source test still contains 11 pre-existing expectations for
  arbitrary shell credential commands that the current security policy blocks;
  the new cases were therefore run by exact test name and pass independently.
- Final compatibility-slice gates pass: `verify:pi-patches`, extension
  typecheck, `test:changed:src` (no root-source tests for this package-only
  slice), `build:core`, `test:packages`, JSON allowlist parsing, and
  `git diff --check`. Compiled package totals remain GSD agent-core **139/139**,
  agent-modes **287/287**, native **223 pass / 1 skip**, pi-agent-core **3/3**,
  pi-ai **49/49**, pi-coding-agent **72/72**, pi-tui **8/8**, contracts
  **9/9**, MCP server **377/377**, and RPC client **30/30**.
- Exact next task: review, commit, and push this compatibility slice; then audit
  upstream `e266507b6` for duplicate automatic retry lifecycle events.
- Audited upstream `e266507b6`; no code port is required. Upstream removed a
  duplicate `auto_retry_end` union member from its monolithic AgentSession
  source, while this fork's split `gsd-agent-core` event type already contains
  exactly one such member. Retry emission and UI cleanup semantics remain
  covered by the existing downstream retry suites.
- Ported upstream `23842b1e6` to the fork's HTTP dispatcher. Proxied plain-HTTP
  model endpoints now explicitly use CONNECT tunneling instead of depending on
  Undici's changing default forwarding mode. This protects the repeated
  provider request after a tool result without changing proxy selection,
  `NO_PROXY`, provider routing, GSD lifecycle, or Herdr execution authority.
- Focused live-loopback evidence passes **1/1**: two consecutive requests to a
  local plain-HTTP provider traverse the test proxy as CONNECT traffic and both
  settle successfully. Final gates pass: `verify:pi-patches`, extension
  typecheck, `test:changed:src` (no root-source tests for this package-only
  slice), `build:core`, `test:packages`, JSON allowlist parsing, and
  `git diff --check`. Compiled package totals remain GSD agent-core **139/139**,
  agent-modes **287/287**, native **223 pass / 1 skip**, pi-agent-core **3/3**,
  pi-ai **49/49**, pi-coding-agent **72/72**, pi-tui **8/8**, contracts
  **9/9**, MCP server **377/377**, and RPC client **30/30**.
- Exact next task: review, commit, and push the proxy-transport slice; then
  refresh the upstream candidate audit from the current fetched tip.
- Refreshed `earendil-works/pi` main at `4e69b0c28` and prioritized request
  correctness over metadata-only changes. Ported upstream `1e4fbe384` and
  `69afa1050`: every Fireworks model/router ID containing `glm-` now uses
  `openai-completions` at `/inference/v1`, while GitHub Copilot Claude Fable 5
  is exposed through `anthropic-messages` with adaptive-thinking metadata.
  Other Fireworks models retain their Anthropic Messages transport.
- The normal `pnpm ... generate-models` entry currently cannot resolve an
  existing source `.js` import under raw Node. Running the same generator via
  the already-installed `tsx` loader succeeded, but the live external catalogs
  contained tens of thousands of unrelated data-line changes. Those generated
  outputs were discarded, and only the two existing Fireworks GLM records plus
  the current Copilot Fable 5 record were applied to the checked-in snapshot.
  This avoids coupling the routing fix to an unaudited catalog refresh.
- Focused catalog/provider evidence passes **28/28**, including exact JSON/TS
  mirror equality, schema validity, all checked-in Fireworks GLM routes, and
  Copilot Fable 5 Anthropic/adaptive-thinking selection. Final gates pass:
  `verify:pi-patches`, extension typecheck, `test:changed:src` (no root-source
  tests for this package-only slice), the pi-ai build, `build:core`,
  `test:packages`, and `git diff --check`. Compiled package totals remain GSD
  agent-core **139/139**, agent-modes **287/287**, native **223 pass / 1 skip**,
  pi-agent-core **3/3**, pi-ai **49/49**, pi-coding-agent **72/72**, pi-tui
  **8/8**, contracts **9/9**, MCP server **377/377**, and RPC client **30/30**.
- Exact next task: review, commit, and push this provider-routing slice; then
  evaluate optional vLLM scheduler priority (`256f63024`) independently.
- Ported upstream `256f63024` as an opt-in OpenAI Completions compatibility
  field. Custom vLLM model definitions can set numeric `compat.vllmPriority`,
  which is emitted as the top-level request `priority`; all existing generated
  and custom models omit the field unless explicitly configured. The option is
  accepted by both catalog and `models.json` validation and does not introduce
  scheduling policy into GSD orchestration or Herdr.
- Focused evidence passes: request payload/default coverage **2/2** and exact
  custom model-registry validation **1/1**. Final gates pass:
  `verify:pi-patches`, extension typecheck, `test:changed:src` (no root-source
  tests for this package-only slice), the pi-ai build, `build:core`,
  `test:packages`, and `git diff --check`. Compiled package totals remain GSD
  agent-core **139/139**, agent-modes **287/287**, native **223 pass / 1 skip**,
  pi-agent-core **3/3**, pi-ai **49/49**, pi-coding-agent **72/72**, pi-tui
  **8/8**, contracts **9/9**, MCP server **377/377**, and RPC client **30/30**.
- Exact next task: review, commit, and push this opt-in vLLM compatibility
  slice; then audit the remaining low-risk upstream corrections (`e583b290a`,
  current NO_PROXY behavior) without importing metadata-only version spoofing.
- Ported upstream `a63fb12c1` to the shared Node HTTP proxy resolver. A
  `NO_PROXY=example.com` entry now excludes both the root and true subdomains,
  but not `notexample.com`; `.domain`, `*.domain`, port-qualified IPv4, and
  bracketed or bare IPv6 entries are normalized consistently. Scoped provider
  environments and ambient proxy precedence are unchanged.
- Focused proxy-resolution evidence passes **5/5**, including root/subdomain
  boundaries, wildcard forms, IPv6, port matching, unsupported proxy protocols,
  and scoped environment isolation. Final gates pass: `verify:pi-patches`,
  extension typecheck, `test:changed:src` (no root-source tests for this
  package-only slice), the pi-ai build, `build:core`, `test:packages`, and
  `git diff --check`. Compiled package totals remain GSD agent-core **139/139**,
  agent-modes **287/287**, native **223 pass / 1 skip**, pi-agent-core **3/3**,
  pi-ai **49/49**, pi-coding-agent **72/72**, pi-tui **8/8**, contracts
  **9/9**, MCP server **377/377**, and RPC client **30/30**.
- Exact next task: review, commit, and push this proxy-resolution slice; then
  apply the isolated write-result wording correction from `e583b290a`.
- Ported the applicable coding-agent half of upstream `e583b290a`. Successful
  writes now report the destination without calling JavaScript string length a
  byte count. This fork has no pi-agent-core harness write tool, so there is no
  second runtime surface to change.
- The inherited broad `packages/pi-coding-agent/test/tools.test.ts` cannot be
  collected because it still imports the removed pre-seam `bash-executor.ts`.
  Rather than coupling this correction to that unrelated migration, a focused
  write-only regression exercises the current tool directly and passes **1/1**
  with multibyte content and exact operation arguments.
- Canonical validation is green: Pi patch inventory, extension typecheck,
  core build, and every package suite passed — agent-core **139/139**,
  agent-modes **287/287**, native **223 passed / 1 skipped**, pi-agent-core
  **3/3**, pi-ai **49/49**, pi-coding-agent **72/72**, pi-tui **8/8**,
  contracts **9/9**, MCP server **377/377**, and RPC client **30/30**.
- Exact next task: review, commit, and push the wording correction; then close
  the current upstream candidate audit with explicit defer/no-port decisions.
- Began the next isolated upstream compatibility slice from `605a1b038`.
  Terminal dimension refresh is now best-effort: a restricted Linux runtime
  that rejects the self-directed `SIGWINCH` cannot crash GSD TUI startup, while
  Windows continues to skip the signal. The focused SIGWINCH plus existing
  terminal regression passed **7/7**; Pi patch inventory, extension typecheck,
  pi-tui and core builds, and all package suites also pass — agent-core
  **139/139**, agent-modes **287/287**, native **223 passed / 1 skipped**,
  pi-agent-core **3/3**, pi-ai **49/49**, pi-coding-agent **72/72**, pi-tui
  **8/8**, contracts **9/9**, MCP server **377/377**, and RPC client **30/30**.
- Exact next task: review, commit, and push the restricted-runtime terminal
  slice, then port and validate the cwd-sensitive tool execution correction
  from `62835ea81` against the fork's extension context seam.
- Ported the runtime half of upstream `62835ea81` against the fork's current
  tool definitions. Bash, read, write, edit, find, grep, and ls now prefer the
  invocation-time `ExtensionContext.cwd`, while preserving their construction
  cwd fallback for ordinary callers. The focused seven-tool regression passes
  **7/7** (and **8/8** together with the write-result regression).
- Pi patch inventory, extension typecheck, coding-agent and core builds, and all
  package suites pass — agent-core **139/139**, agent-modes **287/287**, native
  **223 passed / 1 skipped**, pi-agent-core **3/3**, pi-ai **49/49**,
  pi-coding-agent **72/72**, pi-tui **8/8**, contracts **9/9**, MCP server
  **377/377**, and RPC client **30/30**.
- Exact next task: review, commit, and push the context-cwd slice; then record
  explicit dispositions for the remaining current upstream candidates before
  selecting any further isolated compatibility work.
- Upstream candidate audit selected `649214477` as the next small compatibility
  slice. Zed's integrated terminal is now classified as truecolor and hyperlink
  capable, and its modified-key forwarding configuration is documented.
  The focused terminal-image suite passes **58/58**; Pi patch inventory,
  extension typecheck, pi-tui and core builds, and all package suites pass —
  agent-core **139/139**, agent-modes **284/284**, native **223 passed / 1
  skipped**, pi-agent-core **3/3**, pi-ai **49/49**, pi-coding-agent **72/72**,
  pi-tui **8/8**, contracts **9/9**, MCP server **377/377**, and RPC client
  **30/30**.
- Exact next task: review, commit, and push the Zed compatibility slice; then
  adapt the selector-state corrections from `f2a622789` and `3fc3ef532` to the
  fork-owned `gsd-agent-modes` UI rather than copying obsolete upstream paths.
- Began the selector-state adaptation in the fork-owned UI. Current thinking,
  theme, model, and scoped-model values retain leading markers while browsing;
  toggling a scoped model from the all-enabled state now disables only that
  model instead of clearing the entire scope. The focused downstream marker and
  toggle regression passes **5/5**, together with the existing selector footer
  and theme regressions for **7/7**.
- Pi patch inventory, extension typecheck, agent-modes and core builds, and all
  compiled package suites pass — agent-core **139/139**, agent-modes **292/292**,
  native **223 passed / 1 skipped**, pi-agent-core **3/3**, pi-ai **49/49**,
  pi-coding-agent **72/72**, pi-tui **8/8**, contracts **9/9**, MCP server
  **377/377**, and RPC client **30/30**. The package-local agent-modes command's
  inherited shell glob only discovers nine top-level tests; the root compiled
  package suite is therefore the authoritative complete package result.
- Candidate dispositions: the applicable portions of `f2a622789` and
  `3fc3ef532` are adapted here; their upstream trust selector, unavailable-model
  rendering, and automatic dual-theme paths do not exist in this fork's UI.
  `96317e50b` is rejected because spoofing a newer Claude Code user-agent adds
  brittleness without a runtime capability. `8d1b1178c` and `853a80d26` are
  upstream-only documentation/changelog changes, and `e266507b6` removes a
  duplicate event the fork's split runtime never had. The current post-v0.84.4
  candidate audit is otherwise covered by the isolated ports above.
- Exact next task: review, commit, and push this selector adaptation, then build
  one clean remote development artifact from the committed branch and deploy it
  to a new immutable `penglab:/srv/penglab/gsd-runs/toolchains` prefix without
  changing the Mac's global installation.
- Built clean release-candidate artifact commit `68a8e280` (51 MB, SHA-256
  `c10d1dd084a68602a4e64df07907c6f71b818522763244da0746731d6dbeb3cc`),
  installed it at remote immutable prefix
  `/srv/penglab/gsd-runs/toolchains/gsd-pi-herdr-1.16.2-68a8e280-c10d1dd0`,
  copied the verified Linux x86_64 engine, repaired seven internal links, and
  switched only the shared remote `gsd`/`gsd-mcp-server` links. Build metadata
  is clean and native identity-lock/directory-sync support loads successfully;
  the prior prefix remains the rollback target.
- Remote model discovery succeeds. The live no-session JSON smoke reached the
  configured provider but the account returned `429 ... Usage limit reached for
  5 hour`; no model response can be proven until that external limit resets.
  The smoke exposed an independent classification gap: this exact terminal
  account-limit phrase was retried three times because the generic `429` rule
  won. Added it to the non-retryable limit vocabulary with both shared-provider
  and agent-session regressions. The focused suites pass **17/17** and **18/18**;
  Pi patch inventory, extension typecheck, core build, and all compiled package
  suites pass — agent-core **139/139**, agent-modes **292/292**, native **223
  passed / 1 skipped**, pi-agent-core **3/3**, pi-ai **49/49**,
  pi-coding-agent **72/72**, pi-tui **8/8**, contracts **9/9**, MCP server
  **377/377**, and RPC client **30/30**.
- Exact next task: review, commit, and push the account-limit classification,
  then repack that clean commit and switch the remote shared links to its new
  immutable prefix. A successful live model response remains externally blocked
  until the provider's displayed account-limit reset.
- Committed the classifier as `ec14fbb1`, built a clean 51 MB candidate with
  SHA-256 `754780020ce21019fb1e85d6da2633cd6585bb54c45133d58ab3109378d91062`,
  and installed it at
  `/srv/penglab/gsd-runs/toolchains/gsd-pi-herdr-1.16.2-ec14fbb1-75478002`.
  The shared remote `gsd` and `gsd-mcp-server` links now resolve to that prefix;
  the `68a8e280` and older prefixes remain intact for rollback. No Mac global
  installation was changed and no running Herdr/GSD process was killed.
- Remote post-install verification confirms clean commit metadata, seven repaired
  internal workspace links, `nativeLoaded=true`, identity-lock/directory-sync
  exports, and `accountLimitRetryable=false` for the exact production 429 text.
  Model catalog discovery is operational. Live generation remains externally
  unavailable until the account's displayed five-hour limit resets; rerun the
  no-session exact-response smoke after reset, and restart any already-running
  GSD TUI from inside its Herdr pane to load the newly linked bundle.
- Began the deferred session-v4 P3.5 cutover as a bounded P3.5a construction
  slice. A new typed, awaitable session-manager factory now owns create, open,
  continue-recent, and memory preparation. Print/JSON-worker and interactive
  startup use it, and the replacement-oriented `AgentSessionRuntime` uses the
  same injected factory for new/resume/fork/import preparation. The factory
  deliberately exposes only `legacy-v3`; recognized v4 files still fail closed
  and no non-functional v4 preference was added.
- Focused evidence passes **4/4**, including all construction targets, CLI
  startup routing, v4 fail-closed behavior, and the guarantee that replacement
  preparation fails before the active session is aborted or disposed. The
  current agent-core suite passes **142/142** and the canonical compiled package
  matrix passes:
  agent-core **142/142**, agent-modes **292/292**, native **223 passed / 1
  skipped**, pi-agent-core **3/3**, pi-ai **49/49**, pi-coding-agent **72/72**,
  pi-tui **8/8**, contracts **9/9**, MCP server **377/377**, and RPC client
  **30/30**. Three inherited source-tree Vitest files under
  `packages/pi-coding-agent/test/` still import the removed pre-split
  `src/core/agent-session-runtime.ts`; they cannot be collected and were not
  counted as evidence. The canonical compiled package suite remains green.
- Exact next task: complete P3.5b by composing interactive mode around
  `AgentSessionRuntime`, adding an explicit TUI/session rebind contract, and
  proving new/resume/fork replacement preserves extension/UI state before
  implementing a functional `harness-v4` manager adapter. Existing v3 remains
  the default and no remote deployment is warranted until that runtime path is
  complete.
- Completed P3.5b interactive runtime ownership. The root interactive CLI now
  owns an `AgentSessionRuntime`; `/new`, `/resume`, and `/fork` replacement
  requests prepare storage through the awaitable factory, detach the old agent
  and extension UI, recreate cwd-bound settings/resources, then rebind the
  footer, branch watcher, themes, autocomplete, extension runner, and agent
  subscription. The selected model, thinking level, scoped models, and active
  tools carry across. Replacement extension diagnostics and model fallback
  warnings remain visible in the rebound TUI.
- Removed the remaining process-cwd affinity from replacement-sensitive UI
  surfaces: GSD status/footer workspace labels, extension shortcut context,
  command autocomplete, user-bash events, terminal title, and JSONL export now
  use the active session cwd. The production backend remains `legacy-v3`; no v4
  setting, automatic migration, or write cutover was exposed.
- Focused session-runtime and TUI lifecycle regression passes **8/8**, including
  runtime command routing, extension/UI rebinding, diagnostics, workspace-cwd
  construction, and prepare → abort → UI invalidation → dispose → create →
  rebind ordering. Changed root-source tests pass **27/27**. The compiled package
  matrix passes: agent-core **143/143**, agent-modes **294/294**, native **223
  passed / 1 skipped**, pi-agent-core **3/3**, pi-ai **49/49**,
  pi-coding-agent **72/72**, pi-tui **8/8**, contracts **9/9**, MCP server
  **377/377**, and RPC client **30/30**.
- Packaging validation exposed two environment-dependent leaks and both now fail
  safe: local `gsd_engine.dev.node` is excluded from release tarballs, and main
  plus optional assessment-pack validation use an isolated empty npm user config
  with inherited `allow-scripts` cleared. This reduced the candidate from the
  rejected **384.4 MB** unpacked payload to **280.2 MB** and prevents a user's
  npm policy from making the isolated install check nondeterministic.
- Exact next task: finish all final gates, commit and push P3.5b plus packaging
  hardening, deploy one clean immutable candidate to `penglab:/srv/penglab`, and
  then begin P3.5c by implementing a functional version-neutral manager adapter
  over the validated async v4 stores. Do not expose `harness-v4` until the full
  legacy manager capability contract passes.
- P3.5b and packaging hardening were committed as `93afa4b0e` and `494e6ae20`
  and pushed to `origin/feature/pi-v084-startup-performance`. Final focused
  **8/8**, packaging-contract **10/10**, changed-source **27/27**, extension
  typecheck, agent-core/agent-modes builds, complete package matrix,
  `build:core`, `validate-pack`, assessment-pack validation, and
  `git diff --check` all pass. `validate-pack` ends with **Package is
  installable. Safe to publish.**
- Built a clean release-candidate tarball from `494e6ae20`: SHA-256
  `b95c84cb301c3aab07b95220d635da395cd92528ad6cc04f969a60db3c8b21ca`,
  about **60 MiB** compressed, with clean commit/ref metadata. Remote deployment
  could not start because three bounded SSH attempts to the configured
  `penglab` endpoint (`192.168.0.6:22`) timed out; the current Mac route is via
  `172.25.80.1` and the private host does not answer ICMP. No shared remote link,
  existing prefix, running process, or Mac installation was changed.
- Exact next operational task: restore LAN/VPN reachability to `penglab`, upload
  the verified `494e6ae20-b95c84cb` candidate, install it under a new immutable
  `/srv/penglab/gsd-runs/toolchains` prefix, verify the Linux native addon and
  build identity, then atomically switch only the shared remote links. In
  parallel, P3.5c begins with the explicit async mutation/read capability
  contract needed to adapt the validated v4 repository without a duplicate
  synchronous writer.
- Completed P3.5c1's version-neutral session capability contract. The adapter
  delegates every read and mutation to either the existing legacy-v3 manager or
  a validated harness-v4 session and never owns a second log or fire-and-forget
  write path. Metadata distinguishes legacy parent file paths from v4 parent
  session IDs; a harness-v4 factory rejects mismatched metadata before use.
- The shared parity scenario covers branch navigation with summary, rebuilt
  context, model/thinking changes, custom messages, labels, and names across
  both formats. It exposed and fixed a v4 compatibility difference where label
  text was trimmed even though legacy-v3 preserves every non-empty label
  verbatim. Focused adapter tests pass **3/3**, harness-v4 parity passes
  **12/12**, the full harness configuration passes **197/197**, the agent-core
  suite passes **146/146**, extension typecheck passes, and pi-agent-core plus
  the complete core build pass. No production backend selection, existing
  session file, GSD state, remote installation, or Mac global installation
  changed.
- Known test-runner limitation: the pi-agent-core package's unscoped
  `vitest --run` command still collects one Node `node:test` source as an empty
  Vitest suite and its external faux-provider E2E returns empty responses in
  this environment (**8 failures**). The dedicated harness configuration is
  the repository's valid session-v4 evidence and is green; no failing default
  test was hidden or changed as part of this slice.
- Exact next task: complete P3.5c2 by moving asynchronous AgentSession
  persistence/query paths onto the capability boundary and explicitly adapting
  the synchronous extension-context compatibility surface. Keep legacy-v3 as
  the only selectable production backend until CLI/headless parity is complete.
  Independently, retry the immutable `penglab` deployment only after the
  configured private endpoint becomes reachable.
- Completed P3.5c2a adoption for the already-asynchronous production paths.
  Awaited Agent listeners now persist ordinary/custom message-end events before
  settlement; deferred custom messages, model changes, and manual/automatic
  compaction also await the shared capability adapter. Compaction reads its
  saved entries and rebuilt context only after the durable append completes.
  Harness lane-movement records are filtered from the legacy-compatible facade.
- Runtime selection remains deliberately fail-closed: constructing an
  AgentSession with a harness-v4 adapter throws until synchronous bash,
  thinking, navigation, and extension-context persistence have a truthful
  compatibility contract. The focused combined suite passes **24/24**, the
  then-current agent-core suite passed **149/149**, agent-core build and extension typecheck
  pass, and `git diff --check` passes.
- Exact next task: implement P3.5c2b for the remaining synchronous surfaces,
  beginning with bash flush and thinking-level mutation boundaries, then
  navigation and extension callbacks. Do not remove the harness-v4 fail-closed
  guard until all mutation paths and CLI/headless characterization pass.
- P3.5c2b now routes idle and deferred bash-result persistence through the same
  awaited capability adapter. `executeBash`, the interactive handled-command
  path, and prompt preflight/settlement await the write or flush; a focused test
  proves `recordBashResult` cannot settle while its durable append is blocked.
  The expanded focused suite passes **25/25**, the agent-core suite passes
  **150/150**, extension typecheck passes, and the complete core build passes
  after the public Promise contract change.
- The inherited pi-coding-agent source harness remains non-authoritative for
  this fork because it mixes `@earendil-works/pi-agent-core`'s old Agent with
  the split `@gsd/agent-core` session; its focused bash file reproduced two
  30-second event-settlement timeouts and one incomplete transcript assertion.
  This is consistent with the previously recorded source-harness limitation;
  production builds and the downstream agent-core tests use the awaited GSD
  Agent implementation.
- Exact next task: design the synchronous extension mutation bridge for
  thinking, label/name, and custom-entry calls. It must expose immediate
  in-memory semantics while registering durable Promises that the enclosing
  command/run boundary drains and surfaces; do not silently ignore rejections
  or introduce a second session writer.
- Implemented the synchronous extension mutation bridge and recorded it as
  ADR-H029. Legacy-v3 callbacks start their selected-backend operation
  immediately; harness-v4 operations serialize. The bridge captures the first
  failure and rethrows it exactly once at an awaited command, input, Agent-event,
  prompt-settlement, or explicit drain boundary instead of emitting an
  unhandled Promise rejection. It stores no session data itself.
- Extension `appendEntry`, session-name, label, and thinking mutations now use
  that bridge. Model switches drain the associated thinking write before their
  selection event settles. Focused tests prove immediate legacy visibility,
  one-time failure propagation, ordered v4 mutations, and the existing session
  parity contract. The combined focused suite passes **27/27**, the agent-core
  suite passes **152/152**, extension typecheck passes, and the complete core
  build passes.
- Exact next task: convert the remaining navigation read/write surfaces to the
  capability contract, add a coherent snapshot for synchronous UI/extension
  reads, and add an awaited disposal/replacement drain. Only after those paths
  and CLI/headless parity pass may the AgentSession harness-v4 guard be removed.
- Converted tree navigation to the capability contract. Both legacy-v3 and
  harness-v4 now traverse old/target branches, publish optional summaries and
  labels, move the leaf, and rebuild context through one selected adapter; a
  focused cross-format navigation test passes. Harness-only lane records remain
  hidden from the public entry view.
- Session transitions and `AgentSessionRuntime` teardown now drain mutations
  emitted by shutdown or other synchronous extension callbacks before the old
  runtime is invalidated. The replacement-order regression explicitly proves
  abort → drain → invalidate → dispose → create → rebind. Focused navigation,
  capability, and runtime tests pass **11/11**, and agent-core build passes.
- Exact next task: introduce the coherent read snapshot needed by synchronous
  footer, selector, stats, export, and extension getter APIs; then migrate
  new/open/fork construction to return a capability-backed runtime object. Keep
  harness-v4 fail-closed until those reads and CLI/headless parity are proven.
- Added the ADR-H030 read-only compatibility snapshot. It atomically projects
  metadata, entries, leaf, labels, tree, context, and usage from either
  legacy-v3 or harness-v4 without owning a write path. Normal persisted appends
  update it from the returned entry instead of rescanning the full transcript;
  movement/name/label changes perform a complete backend refresh. Failed
  refreshes leave the previous coherent snapshot intact, and all public entry
  and tree reads are defensive copies.
- Footer, tree/session selectors, stats, JSONL/HTML export, print-mode headers,
  slash commands, and extension contexts now consume the snapshot. `/name` and
  interactive label edits route back through the AgentSession mutation drain
  instead of mutating `SessionManager` directly. Legacy callback read-after-
  write remains immediate; harness-v4 production selection remains blocked.
- Verification for this slice: capability snapshot tests pass across both
  formats, including refresh-after-mutation and atomic failure behavior;
  agent-core passes **155/155**, agent-modes passes **9/9**, focused inherited
  session-name coverage passes **2/2** with the other selected split-harness
  files skipped, and pi-coding-agent/agent-core/agent-modes builds plus extension
  typecheck pass.
- Exact next task: replace legacy-only new/open/continue/fork factory returns
  with a capability-backed runtime object that carries metadata, read snapshot,
  and the selected adapter together. Then migrate `AgentSessionRuntime` session
  replacement paths and run CLI/print/JSON/headless parity before considering
  removal of the harness-v4 fail-closed guard.
- Completed P3.5c3's prepared-runtime boundary. `SessionManagerRuntimeFactory`
  now returns a single backend-owned bundle containing the selected capability
  adapter, its coherent synchronous read snapshot, backend identity, and a
  transitional legacy manager only where current construction semantics still
  require it. Root print/JSON-worker and interactive startup, plus `/new`,
  `/resume`, `/fork`, and import replacement, preserve the same bundle through
  SDK construction rather than reconstructing adapters independently.
- SDK restore queries and initial model/thinking records now use the selected
  capability adapter and refresh the supplied snapshot before exposing the
  session. A regression proves that the prepared snapshot contains SDK-created
  initialization records. Focused capability/runtime tests pass **14/14**,
  CLI/print/headless boundary tests pass **40/40**, agent-modes passes **9/9**,
  agent-core passes **156/156**, and ordered package builds plus extension
  typecheck pass. The unrelated DB schema fixture tests retain their existing
  package-name/global-adapter isolation failures when co-scheduled and were not
  changed in this slice.
- Exact next task: add version-neutral create/new/fork semantics to the runtime
  factory or capability contract, then remove `requireLegacySessionManager()`
  from replacement paths. Run the full CLI/print/JSON/headless parity matrix
  before changing the harness-v4 fail-closed guard. No global macOS install is
  needed; deploy a verified package only to `penglab:/srv/penglab` when SSH is
  reachable.
- Completed P3.5c4's backend-owned construction semantics. The runtime factory
  now owns typed parent references and source-to-leaf forks; replacement code no
  longer calls legacy `newSession()` or `createBranchedSession()` directly.
  Legacy-v3 rejects a harness-v4 session-ID parent, persisted forks are prepared
  without mutating the active source, and in-memory forks retain the prior
  shutdown-before-mutation behavior. Focused cross-format capability/runtime
  tests pass **16/16**, agent-core passes **158/158**, agent-modes passes **9/9**,
  CLI/print/headless boundary tests pass **40/40**, extension typecheck passes,
  and the complete core build passes.
- Remaining risk: `AgentSession` construction and the backward-compatible
  extension `newSession({ setup(sessionManager) })` callback still expose a
  legacy manager. These are explicit blockers to selecting harness-v4, not
  prompt-only or silent fallback behavior.
- Exact next task: add a harness-v4 prepared-runtime factory over the validated
  v4 memory/JSONL repositories, then design the backend-aware replacement for
  the centralized legacy construction bridge and extension setup callback.
  Keep the harness-v4 runtime selection guard intact until CLI/headless parity.
- Added the P3.5c5 harness-v4 prepared-runtime factory over the already validated
  v4 JSONL and memory repositories. It performs create/open/continue/fork with
  session-ID parent binding, returns the same capability/snapshot bundle as the
  legacy factory, and never creates or exposes a legacy manager. Cross-format
  parent mismatches fail before construction. Memory and cwd-override sessions
  receive an adapter-level cwd view without rewriting durable metadata.
- Added ADR-H031 to keep parent/fork authority in the selected factory. Focused
  runtime/capability tests pass **18/18**, including real v4 JSONL open,
  continue-recent, persisted fork, and memory fork evidence. Production remains
  legacy-v3 because the AgentSession construction bridge and extension setup
  callback are not yet backend-neutral.
- Exact next task: remove `AgentSession`'s mandatory legacy-manager construction
  dependency and specify a fail-closed, backward-compatible policy for
  `newSession({ setup(sessionManager) })` on harness-v4. Prove the common
  lifecycle suite on prepared legacy and v4 memory sessions before adding any
  runtime preference or CLI selector.
- Completed P3.5c6 AgentSession composition. A capability adapter plus coherent
  snapshot can now construct AgentSession without any legacy manager. Real v4
  JSONL runtime replacement covers fork, switch, and new-session operations;
  session-ID parentage survives replacement. The legacy manager getter remains
  source-compatible for legacy embeddings and fails explicitly on v4.
- Added ADR-H032 for the remaining legacy extension callback:
  `newSession({ setup(sessionManager) })` is rejected on v4 before teardown,
  while `withSession` is the backend-neutral post-replacement mechanism. This
  avoids a fake manager and second writer. Focused AgentSession/runtime tests
  pass **32/32**.
- Exact next task: add a test-only/internal composition selector for CLI print,
  JSON/headless, and interactive startup parity on harness-v4. Keep the public
  preference surface and deployed default on legacy-v3 until that matrix and
  GSD/Herdr integration gates pass.
- Completed P3.5c7's internal composition selector. Root print/JSON and
  interactive startup now choose one prepared runtime factory from
  `GSD_INTERNAL_SESSION_BACKEND`; only `legacy-v3` and `harness-v4` are accepted,
  unknown values fail explicitly, and the unset/deployed default remains
  legacy-v3. No public preference or automatic migration was added.
- Harness-v4 startup no longer runs the legacy flat-session migration. A built
  CLI, network-free `--mode json --no-session` smoke emitted the canonical v4
  session header and exited zero. A separate real OpenAI Codex JSON turn also
  completed through the v4 AgentSession path with the normal agent event and
  usage stream. The v4 header is the intentional print-mode protocol header,
  not persistence output leakage.
- Verification for this slice: focused CLI source contract passes **1/1**,
  built-CLI v4 composition smoke passes **1/1**, root TypeScript check passes,
  and `build:core` passes. Legacy remains the production default.
- Remaining risk: interactive resume/catalog and headless/web session queries
  still contain legacy `SessionManager.list()` or path assumptions. The
  internal selector must not be promoted while those reads are backend-specific.
- Exact next task: introduce a version-neutral session catalog/list-open
  boundary for resume selection and headless/web queries, then run the complete
  legacy-v3 versus harness-v4 print/JSON/RPC/headless matrix. After that, run
  GSD command regressions and real Herdr worker E2E before considering opt-in.
- Completed P3.5c8's version-neutral session catalog boundary. The selected
  runtime factory now owns list and rename operations. Legacy-v3 preserves the
  established manager behavior; harness-v4 validates and opens its authoritative
  JSONL records, then projects the existing `SessionInfo` shape without a second
  index or writer. Root `gsd sessions`, interactive `/resume` and rename,
  headless `--resume`, and web list/rename subprocesses use this boundary.
- Added ADR-H034. The unset/deployed default remains legacy-v3, and the fast
  legacy web boot reader remains unchanged. An explicit harness-v4 web boot
  traverses the selected runtime instead of parsing v4 with legacy assumptions.
- Verification evidence: agent-core passes **162/162**, agent-modes passes
  **9/9**, the built harness-v4 create/open/continue plus headless-resume E2E
  set passes **3/3**, the web bridge/session/command contract set passes, and
  `build:core` passes. A manual built `gsd sessions` run listed and selected a
  real version-4 catalog entry without a model request.
- Remaining risks: standalone `@gsd/agent-modes` entry code still contains its
  legacy construction adapter; custom legacy `sessionDir` semantics are not yet
  represented in the v4 repository; and the complete print/JSON/RPC/headless,
  GSD lifecycle, and real Herdr matrices have not yet passed. No public v4
  preference or cutover is authorized.
- Exact next task: execute and fill the complete two-backend command matrix,
  remove or explicitly isolate remaining standalone direct-manager ownership,
  then run GSD/web/Assessment Gate regressions followed by real Herdr E2E. Deploy
  the verified package only to `penglab:/srv/penglab` when SSH is reachable.
- Completed P3.5c9's built command matrix. Legacy-v3 and harness-v4 each pass
  text print, JSON header, RPC v2 init/shutdown, and headless resume-catalog
  startup. The matrix is network-free and passes **10/10** across both backends.
- The standalone `@gsd/agent-modes` entry is explicitly isolated as legacy-v3:
  setting the root-only harness-v4 selector there now fails with a diagnostic
  instead of silently using `SessionManager`. The package test script now runs
  root-level contracts as well as nested tests; agent-modes passes **11/11**.
- Exact next task: begin P3.6 by running and filling two-backend GSD lifecycle,
  Assessment Gate, and browser session command regressions. Custom legacy
  `sessionDir` parity remains a known adapter limitation. Keep v4 internal-only,
  then proceed to P3.7's real Herdr worker E2E before any cutover decision.
- Completed P3.6a's common command/bootstrap coverage. Both internal backends
  run `/gsd status`, `/gsd gate list`, and `/gsd gate status` through the built
  JSON CLI without provider access; the expanded two-backend matrix passes
  **12/12**. Assessment Gate and lifecycle authority remain in GSD's canonical
  stores rather than the selected transcript backend.
- Added real harness-v4 web inactive-rename coverage. Browser lookup finds the
  v4 record through the selected catalog, the inactive mutation uses the v4
  repository, and reopening the session observes the new name. The combined web
  bridge/session/command contract set passes.
- Focused Assessment Gate, auto-recovery, quick, validation, verdict, ship, and
  read-only forensics regressions pass **145/145**. No GSD lifecycle authority
  moved into the session runtime.
- Exact next task: prove custom entries and compaction survive persisted v4
  reload, cover the remaining debug/recovery/browser command surfaces, then run
  P3.7's real Herdr root/worker matrix. Keep the selector internal and legacy-v3
  as the deployed default.
- Completed P3.6b and the P3.6 integration gate. Persisted harness-v4 reopen now
  proves ordinary custom entries, displayed custom messages, and compaction
  records survive with their GSD-owned data intact; agent-core remains
  **162/162**.
- The built matrix now exercises nine GSD command variants per backend:
  status, Assessment Gate list/status, debug list, noninteractive forensics,
  quick usage, validation, verdict, and recovery. Both backend groups pass, and
  none requires a provider request. The combined browser contract set also
  passes with v4 list and inactive rename coverage.
- P3.7 is ready for live validation, not cutover. Remaining risk: an extension-
  selected custom legacy `sessionDir` does not yet have a defined v4 repository
  mapping. Until that is resolved or explicitly rejected at selection time,
  harness-v4 stays internal and the deployed default stays legacy-v3.
- On 2026-09-03, packaged the clean P3.6 commit `703d07f5a674ee82cb7b372d5ddbfd30e991747a`
  as release-candidate artifact
  `/srv/penglab/gsd-runs/artifacts/gsd-pi-herdr-1.16.2-703d07f5-15a59dab.tgz`
  (`sha256:15a59dab11fe178e303a2bf22a5b7959f795f0481daf31273ca6f4ad3a5214e7`)
  and installed it at the immutable remote prefix
  `/srv/penglab/gsd-runs/toolchains/gsd-pi-herdr-1.16.2-703d07f5-15a59dab`.
  The first launch repaired all seven internal package links. The separately
  verified Linux x64 addon was installed with matching source/artifact hash
  `72e5d00f1f15121bd8b33156a050c41588d0943d6dfe0194940e6d40a874f166`,
  and runtime inspection reported `nativeLoaded: true` with 98 exports.
- Direct-prefix and shared-path smoke tests both emitted a canonical version-4
  session header and exited zero under
  `GSD_INTERNAL_SESSION_BACKEND=harness-v4`; `gsd --build-info` reports the
  exact clean P3.6 commit. Only the shared remote `gsd` and `gsd-mcp-server`
  symlinks were atomically switched. The previous known installation
  `/srv/penglab/gsd-runs/toolchains/gsd-pi-herdr-1.16.2-ec14fbb1-75478002`
  remains intact for rollback. Existing GSD/Herdr processes were not restarted
  and will acquire the candidate only after their normal pane/process restart.
- This deployment is installation evidence, not P3.7 completion and not a v4
  cutover: the deployed default remains `legacy-v3`, the selector remains
  internal-only, and Herdr capability metadata remains unverified until the
  live pane matrix passes.
- Completed P3.5c10 after the P3.6 audit identified that harness-v4 accepted but
  ignored explicit `sessionDir` inputs. The v4 JSONL repository now supports a
  flat explicit-root layout while preserving its existing cwd-partitioned
  default. The selected factory applies the scoped repository consistently to
  create, open, continue, list, fork, and rename; files remain contained,
  atomically published, format-validated, and owned by one v4 writer.
- Root session-directory selection now follows one tested precedence:
  `--session-dir`, `GSD_CODING_AGENT_SESSION_DIR`, legacy
  `PI_CODING_AGENT_SESSION_DIR`, then settings. The `gsd sessions` picker,
  print/JSON, and interactive startup consume that result. This work also fixed
  print/JSON `--continue`, which was parsed but previously created a new session
  instead of calling the selected runtime's continue operation.
- Verification evidence: v4 storage **5/5**, session resolver **2/2**,
  agent-core **163/163**, focused built CLI **3/3**, full built CLI smoke
  **28 passed / 1 provider-dependent skip**, two-backend command/GSD matrix
  **12/12**, all ten package suites, extension typecheck, `build:core`, package
  installation validation, Assessment pack validation, and `git diff --check`
  pass. ADR-H035 records the mapping. The custom-directory cutover blocker is
  closed without changing the deployed default.
- Packaged clean commit `60845072b5ad368e97b59f8d31aa4b921f399d5d` as
  `/srv/penglab/gsd-runs/artifacts/gsd-pi-herdr-1.16.2-60845072-932258da.tgz`
  (`sha256:932258daf6c51d639123158e4e2f3e92c4c51e1eb33b08d1401912341532f084`)
  and installed it at immutable prefix
  `/srv/penglab/gsd-runs/toolchains/gsd-pi-herdr-1.16.2-60845072-932258da`.
  Seven internal links repaired on first launch; the verified Linux x64 addon
  still reports `nativeLoaded: true` with 98 exports. Direct-prefix and shared
  remote smoke both created one flat custom-directory v4 file and proved that
  `--continue` returned the same session ID. The shared `gsd` and
  `gsd-mcp-server` links now target this prefix; `703d07f5`, `ec14fbb1`, and
  older immutable prefixes remain available for rollback. Running processes
  were not killed and require their normal pane/process restart to acquire it.
- Added a fail-closed P3.7 session-v4 live preflight. It requires a real root
  pane with the complete Herdr identity, rejects `GSD_SUBAGENT_CHILD=1`,
  requires the internal `harness-v4` selector, compares inherited identity to
  `pane current --current`, runs the pinned v0.8.2/protocol-20 capability
  contract, and verifies downstream build identity. It can atomically retain a
  bounded JSON report without logging the socket path or credentials. Offline
  evaluation and refusal coverage passes **6/6**; the combined Herdr integration
  suite passes **25/25**, extension typecheck and `build:core` pass, and package
  validation confirms the new script plus its shared capability helpers are in
  the installable tarball (`Package is installable. Safe to publish.`). The
  current non-Herdr shell correctly exits 2 before issuing any pane command.
  This removes setup ambiguity but does not count as live P3.7 evidence.
- Packaged clean preflight commit
  `8f8b2bd58a328425cc91fa1763849d47fc4d9110` as
  `/srv/penglab/gsd-runs/artifacts/gsd-pi-herdr-1.16.2-8f8b2bd5-e9d66dfa.tgz`
  (`sha256:e9d66dfab02fb99382e6b92f677912e88a182f01977c36faf54609420303dcec`)
  and installed it at immutable prefix
  `/srv/penglab/gsd-runs/toolchains/gsd-pi-herdr-1.16.2-8f8b2bd5-e9d66dfa`.
  The installed package contains the preflight and shared capability helpers;
  first launch repaired seven internal links, the verified Linux x64 addon
  reports `nativeLoaded: true` with 98 exports, and an outside-Herdr installed
  smoke exits 2 with `phase=environment` before pane control. Shared remote
  `gsd` and `gsd-mcp-server` links now target this clean candidate. Prior
  immutable prefixes remain rollback targets and running processes were not
  killed; they acquire the candidate after their normal restart.
- Added the P3.7 live runbook with an isolated remote path layout, exact result
  markers, public-subagent-only single/chain/parallel/cancellation/pane-loss
  sequence, detach/reattach and root-restart captures, artifact/mode/raw-output
  checks, and final promotion gates. Partial or manually asserted results are
  explicitly non-promotable. This standardizes the still-unrun live evidence;
  it does not mark P3.7 complete or change the legacy-v3 default.
- Added a bounded P3.7 postflight auditor. It derives the exact root runtime ID
  from the v4 header, validates owner-only artifact identity and `env.json`
  consumption, requires each exact success marker plus positive usage, proves
  chain affinity/pane reuse and five-task/four-pane queue timing, correlates a
  canonical abort and missing pane, and rejects raw JSON in captured pane text.
  Reports omit transcript text and hash affinity keys. Focused audit coverage
  passes **5/5** and the full Herdr integration suite passes **30/30**;
  extension typecheck, `build:core`, installable package validation, packaged
  script inventory, and `git diff --check` pass. Worker/directory/pane capture
  counts and all reads are explicitly bounded. The manifest now also requires
  and validates stable detach/reattach topology, root lease replacement, and a
  strict append-only v4 session across restart; original captures remain
  mandatory review evidence.
- Packaged clean auditor commit
  `dcd926a715f9a78f1b0cf6cce7ed3867e3e4a220` as
  `/srv/penglab/gsd-runs/artifacts/gsd-pi-herdr-1.16.2-dcd926a7-93cdd2ca.tgz`
  (`sha256:93cdd2cacc850794e60891400e2c61829d660f0f4df18b675d4589370d316504`)
  and installed it at immutable prefix
  `/srv/penglab/gsd-runs/toolchains/gsd-pi-herdr-1.16.2-dcd926a7-93cdd2ca`.
  The installed auditor and preflight are present, first launch repaired seven
  internal links, the verified Linux x64 addon reports `nativeLoaded: true`
  with 98 exports, and the auditor fails closed without its explicit manifest.
  Shared remote `gsd` and `gsd-mcp-server` links now target this clean
  candidate. Previous prefixes remain intact for rollback; running processes
  were not killed and acquire it on their normal restart.
- Extended the auditor so supplied detach snapshots must retain identical
  workspace/tab/pane identities and the root pane, while restart records must
  retain the derived root/session/pane identity, replace the lease instance,
  advance its start time, and prove the resumed v4 file is a strict append-only
  extension equal to the audited live file. Continuity plus artifact coverage
  passes **5/5** and the complete Herdr integration suite remains **30/30**;
  typecheck, package validation, and `git diff --check` pass.
- Packaged clean continuity commit
  `a0f8e6b5f8b47ea573ff798044b895722c0ccf50` as
  `/srv/penglab/gsd-runs/artifacts/gsd-pi-herdr-1.16.2-a0f8e6b5-476f0297.tgz`
  (`sha256:476f0297f8c9e7faf22de3ba9c583e0017a58943d5e73b488890e2ae9c65cece`)
  and installed it at immutable prefix
  `/srv/penglab/gsd-runs/toolchains/gsd-pi-herdr-1.16.2-a0f8e6b5-476f0297`.
  First launch repaired seven internal links, the verified Linux x64 addon
  reports `nativeLoaded: true` with 98 exports, and shared remote `gsd` and
  `gsd-mcp-server` links now target this clean candidate. Previous prefixes
  remain rollback targets and running processes were not killed.
- Exact next task: from an actual Herdr-managed root pane (`HERDR_ENV=1`), run
  the pinned-Herdr P3.7 root/worker matrix with an internal harness-v4 root
  session: single dispatch, affinity reuse, parallel >4, cancellation, pane
  loss, detach/reattach, and restart. Record the worker artifacts and semantic
  parent results before any opt-in or cutover decision.

### 2026-09-03 — P3.7 real Herdr session-v4 live gate

- Ran the clean `a0f8e6b5f8b47ea573ff798044b895722c0ccf50` candidate from an
  actual Herdr-managed root on macOS arm64. Both pane-local preflight and the
  packaged capability check passed Herdr **0.8.2**, protocol **20**, and the
  internal `harness-v4` selector. Evidence is owner-only under
  `/private/tmp/gsd-session-v4-p37-20260903T042518Z/evidence`; it contains no
  copied provider credentials.
- The public subagent path passed all required success markers. Root session
  `01a06584-3a36-7260-a546-9cabe21f8c64` maps to runtime
  `root-0d6966f203f5df44c7fe`. Single dispatch
  `dispatch-17d5b6de80bb1ed62e26` relayed `P3V4_SINGLE_OK` with positive common
  usage. Chain dispatch `dispatch-667cc68c766d74d5577e` reused pane `w9:p3`
  and one affinity key for both steps, with step two launching only after step
  one's exit evidence.
- Five-way parallel dispatch `dispatch-58951fbbb97eed5a433b` completed 5/5
  across exactly four panes. The active snapshot at
  `snapshots/05-parallel-active.json` shows the four-pane cap; the fifth launch
  reused `w9:p5` only after an earlier child settled. No duplicate artifact or
  marker exists.
- Cancellation with the configured root `app.interrupt` action (Escape)
  targeted worker `w9:p4` for dispatch `dispatch-7998257fe3d345686672`.
  Bounded process-group escalation completed in about 10 seconds with
  `aborted=true`, `signal=SIGKILL`, settled ownership, and no surviving worker
  or descendant. An initial operator attempt used root Ctrl-C and correctly did
  not create an AbortSignal because Ctrl-C is the editor-clear binding; that
  worker was then safely interrupted directly and its evidence was retained.
  ADR-H036 and the runbook now distinguish outer TUI `Operation aborted` from
  the common runner's direct `Subagent was aborted` mapping.
- Pane-loss dispatch `dispatch-acd1981428b0f599fe47` was closed only after its
  `state.json` reported the `sleep 300 & wait` tool in pane `w9:p3`. The parent
  failed explicitly within the bounded probe window, the process tree vanished,
  no `exit.json` was fabricated, and ownership is retained as orphaned. Recovery
  dispatch `dispatch-02f6e6439e7c31af9131` then returned
  `P3V4_AFTER_PANE_LOSS_OK` without Local fallback.
- A separate test client detached and reattached to named session `default`
  while a 45-second worker remained active. Snapshots
  `10-before-detach.json` and `11-after-reattach.json` have identical workspace,
  tab, and pane ID sets. Root restart changed the lease from instance
  `d1fbba85-6b7b-4762-a1f9-f186b6831ab2`/pane `w9:p2` to
  `c0a88124-9535-47c1-b8fe-36c8c2690d23`/pane `w9:p7` while preserving the
  session/runtime IDs. The resumed JSONL is a strict append-only extension
  (**104,511 → 113,246 bytes**) and `dispatch-cabcb71db957108264ae` returned
  `P3V4_AFTER_RESTART_OK` through the same worker tab.
- The corrected bounded postflight audit is green: `ready=true`, required
  markers **10/10**, workers **14**, canonical aborted artifacts **2**,
  pane-loss artifacts **1**, parallel panes **4**, pane captures **3**, and
  detach/restart continuity both true. Every consumed `env.json` is absent,
  directories/files are `0700`/`0600`, positive usage exists for every success,
  and captured worker panes contain no raw JSON events or token deltas.
- The live environment exposed two validation-harness/runtime edge cases and
  both are fixed with regression coverage. Herdr identity inherited by the
  test runner could accidentally scope a fixture-only operations test, so that
  test now supplies an explicit empty environment. Separately, inline-image
  capability probing could throw `EIO` from `queryCellSize()` before the TUI
  render loop installed its normal dead-output handling; `TUI.start()` now
  treats that startup write failure as an output-closed event while preserving
  all other errors.
- Final verification for this closeout: the focused v4 auditor suite passed
  **5/5**, `pnpm run typecheck:extensions` passed,
  `pnpm run test:herdr-integration` passed **30/30**,
  `pnpm run test:changed:src` reported no focused source tests,
  `pnpm run test:packages` passed across all workspace packages,
  `pnpm run build:core` passed, and
  `NPM_CONFIG_USERCONFIG=/dev/null pnpm run validate-pack` completed with
  `Package is installable. Safe to publish.`
- P3.7's live gate is complete. The deployed/default backend remains
  `legacy-v3`; no automatic migration or default cutover is authorized yet.
  Exact next task: add a documented public **new-session opt-in** for
  `harness-v4` with strict enum validation and explicit legacy rollback, while
  keeping existing sessions format-bound and `legacy-v3` as the default. Run
  the complete two-backend CLI/GSD/web/Herdr regression matrix before deploying
  that opt-in to `penglab:/srv/penglab`.

### 2026-09-03 — P3.7 controlled public session-v4 opt-in

- Added the public root-session selector
  `--session-backend legacy-v3|harness-v4` and the automation equivalent
  `GSD_SESSION_BACKEND`. CLI selection wins over the public environment, which
  wins over the retained internal validation seam. Unknown values fail
  explicitly; an unset selection remains `legacy-v3`.
- Propagated the selected backend through direct interactive/print/JSON/RPC
  startup, `auto` and `quick` headless routing, headless RPC children and resume
  catalog lookup, and web host/bridge children. The standalone
  `@gsd/agent-modes` entry remains legacy-only.
- Existing files remain format-bound. A v4 file opened under the v3 default
  fails without rewrite or replacement; v4 resume requires the same explicit
  selection. `--session-backend legacy-v3` or removing the public environment
  variable is the conversion-free rollback. No default cutover or automatic
  migration was added.
- The web launch audit found one legacy side effect at the new boundary:
  `runWebCliBranch` previously migrated flat v3 files before backend selection.
  Selection is now resolved first and that migration runs only for
  `legacy-v3`; a focused test proves v4 web startup leaves the legacy file and
  destination directory untouched.
- Verification is green: parser/precedence/forwarding tests **52/52**; the
  complete legacy-v3 versus harness-v4 print/JSON/RPC/headless/GSD lifecycle/
  Assessment Gate matrix **12/12**; public create, environment, mismatch and
  rollback E2E **2/2**; headless public propagation **1/1**; web selection and
  v3 non-migration **19/19**; Herdr integration **30/30**; all workspace package
  suites passed; `typecheck:extensions`, `build:core`, and `validate-pack`
  passed, with the package reported installable and safe to publish.
- Exact next task: commit and push this opt-in, build an immutable clean tarball,
  deploy it only to `penglab:/srv/penglab`, verify the Linux native addon plus
  public v4 create/reopen and legacy rollback from the installed binary, and
  retain the previous remote prefix as rollback. After deployment, decide
  whether optional P3.8 copy-only migration tooling is worth implementing;
  do not change the default as part of that decision.
- Committed and pushed the controlled opt-in as
  `53dc2f2abd9ec5a413a365a47b2a175ec7606771`. The clean release-candidate
  tarball is
  `/srv/penglab/gsd-runs/artifacts/gsd-pi-herdr-1.16.2-53dc2f2a-d75b4f67.tgz`
  with SHA-256
  `d75b4f67beb5ffd647ed016f012bd9cd573b13f12398894dae8e750e676ceaf3`.
- Installed the tarball at immutable prefix
  `/srv/penglab/gsd-runs/toolchains/gsd-pi-herdr-1.16.2-53dc2f2a-d75b4f67`.
  First launch repaired all seven internal workspace links. The verified Linux
  x64 addon reports `nativeLoaded: true` with 98 exports, and build info reports
  the exact clean commit with `dirty: false`.
- Direct-prefix installed-binary smoke under owner-only directory
  `/srv/penglab/gsd-runs/public-v4-smoke.z9w4jk` created and reopened one
  public-selected v4 session (headers 4/4), rejected opening that file under
  the default v3 backend without replacement, and returned header 3 under the
  explicit legacy rollback. The installed help also exposes the public option.
- Atomically switched only the shared remote `gsd` and `gsd-mcp-server` links
  to the new prefix. The previous
  `/srv/penglab/gsd-runs/toolchains/gsd-pi-herdr-1.16.2-a0f8e6b5-476f0297`
  installation remains intact for rollback; no running process was killed or
  restarted. No local global installation was changed.
- Exact next task: evaluate optional P3.8 as a copy-only, preview-first
  migration command. It must retain the v3 source, publish only after v4 reopen
  and semantic comparison, and remain independent from the default backend.
  If that user value does not justify the added mutation surface, record the
  decision to defer it and move to the next upstream adoption slice instead.
- P3.8 evaluation: deferred by ADR-H038. With v3 still supported/default and v4
  explicitly selectable, format-bound reopen provides availability and
  rollback without conversion. A converter would introduce a second writer
  that must preserve branch, compaction, usage, metadata, and opaque downstream
  semantics; no current workflow requires that risk. The next task is a fresh
  read-only upstream impact audit that ranks missing behavior against the now
  completed P3 session boundary. Do not combine a provider/compaction import
  with a session-format default change.

### 2026-09-03 — Pi upstream freshness gate

- Rechecked the official `earendil-works/pi` refs read-only. Latest stable is
  still `v0.84.4` at `b79e4cc834970cca69daebffab7df1da7d1e52c4`; main is still
  `4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057`. There is no new stable or main
  delta beyond the already completed selective compatibility ports.
- Verified current downstream source and focused tests already contain the
  three correctness changes whose upstream hashes were not called out in the
  earlier audit: terminal proxy EOF settlement (`ebc374490`), stop-all behavior
  after a parallel tool preflight abort (`afda4d620`), and active-turn
  settlement before in-memory fork mutation (`56c6fb33`). Re-importing them
  would create duplicate ownership rather than new behavior.
- Added `upstreamAudit` metadata beside, but explicitly separate from, the
  `v0.75.5` vendor pin. `pnpm run audit:pi-upstream` uses only
  `git ls-remote`, reports the observed stable/main objects, and exits 2 if
  either moves. It never fetches, checks out, vendors, or edits upstream code.
  Five deterministic tests cover semantic tag ordering, annotated tags,
  current state, both drift types, and malformed baselines.
- Validation evidence: audit tests **5/5**, live remote audit `current`, Pi
  patch inventory clean, and `git diff --check` clean. No runtime dependency,
  provider behavior, compaction path, session format, or Herdr authority
  changed, so no remote runtime deployment is required for this operator-only
  repository audit command.
- Exact next task: keep `legacy-v3` as the default until explicit harness-v4
  usage supplies a burn-in record. The next runtime change should be selected
  only from a newly detected upstream ref or a concrete production failure;
  do not invent a speculative provider/session migration while this audit is
  current. When either upstream ref moves, run the fail-closed audit, classify
  the new commits, and import only behavior missing from current downstream
  code with focused parity tests.

### 2026-09-03 — External-engine hard safety preflight

- Audited ADR-041's recorded external-engine gap against current source. Phase
  tool presentation already narrows Claude Code's native and MCP surface for
  `run-uat`, `complete-slice`, and strict GSD units, but the native Pi
  `tool_call` guards still cannot block a Claude SDK tool that has already run.
- Added a real Claude SDK `PreToolUse` policy hook to every query, including
  `bypassPermissions`. It denies direct Write/Edit/NotebookEdit and Bash
  mutation of the authoritative `.gsd/STATE.md`/`gsd.db` family before the SDK
  executes it. This preserves the DB/projection single-writer invariant under
  both interactive and headless external execution.
- Destructive Bash now requests explicit one-time permission before execution.
  The interactive UI exposes only `Allow once` and `Deny`, so SDK suggestions
  and saved `Always Allow` rules cannot authorize future destructive calls.
  Headless/auto-mode has no approving human and therefore denies fail-closed;
  ordinary source edits and verification commands remain autonomous.
- The same pure policy decision is applied by both PreToolUse and canUseTool.
  Native-engine guards remain unchanged, and no lifecycle, session, provider,
  compaction, or Herdr authority moved into the Claude adapter. ADR-H039 records
  the boundary; ADR-041 now distinguishes the closed hard-safety subset from
  the remaining shared-policy extraction.
- Focused Claude adapter coverage is **218/218** and the combined adapter plus
  destructive-classifier suite is **222/222**, including state-write,
  shell-wrapper destructive commands, headless behavior, one-time approval,
  and real query-option hook wiring. Extension typecheck and changed-source
  verification pass.
- Exact next task: extract the remaining loop, pending/deferred gate, queue,
  planning, worktree, and context-depth decisions into one shared
  pre-execution evaluator, then consume it from native `tool_call` and external
  SDK hooks without duplicating lifecycle side effects. Add parity tests before
  enabling the shared evaluator for a second external engine.
- Committed and pushed the hard-safety slice as
  `d720ea884e0670062d75438345fd06f78ea3e2ae`. Its clean release-candidate
  tarball is
  `/srv/penglab/gsd-runs/artifacts/gsd-pi-herdr-1.16.2-d720ea88-043e9bd6.tgz`
  with SHA-256
  `043e9bd66ff2b6db24273f764c8448cdc7c4630b8b3ccb2b1bfaf4cc1c1cccb6`.
- Installed the artifact at immutable remote prefix
  `/srv/penglab/gsd-runs/toolchains/gsd-pi-herdr-1.16.2-d720ea88-043e9bd6`.
  The installed build reports the exact commit, `dirty=false`, and
  `buildKind=release-candidate`. The verified Linux x64 addon reports
  `nativeLoaded=true` with 98 exports.
- Installed-runtime policy smoke proves authoritative state writes return
  `deny`, direct and `bash -c` wrapped destructive commands return `ask`, safe
  verification returns `continue`, the actual SDK PreToolUse output is `ask`,
  and the headless permission callback returns `deny`. Only after those checks
  passed were the shared remote `gsd` and `gsd-mcp-server` links atomically
  switched. The prior `53dc2f2a-d75b4f67` prefix remains intact for rollback;
  no running GSD or Herdr process was killed or restarted, and no local global
  installation changed.
- Deployment exposed an existing installer limitation: bootstrap recovery after
  `--ignore-scripts` restores the seven `@gsd/*` links but not the three shipped
  `@opengsd/*` packages. This candidate was repaired with the packaged
  `scripts/link-workspace-packages.cjs` before promotion and all ten links are
  present. A future packaging slice should make first-launch repair use the
  canonical ten-package manifest so operators cannot miss this manual step.
- Exact next task: first close the newly evidenced bootstrap link-repair gap
  with an installed-tarball regression. Then extract the remaining loop,
  pending/deferred gate, queue, planning, worktree, and context-depth decisions
  into one shared pre-execution evaluator and consume it from native
  `tool_call` plus external SDK hooks without duplicating lifecycle side effects.
  Add parity tests before enabling it for a second external engine.

### 2026-09-03 — First-launch canonical workspace-link repair

- Reproduced the remote deployment failure as a focused red test: the
  `--ignore-scripts` bootstrap restored `@gsd/pi-coding-agent` and
  `@gsd/pi-tui` but omitted a shipped `@opengsd/contracts` fixture. This
  matched the installed candidate, where first launch reported seven repairs
  and importing the Claude adapter failed until the private link script was
  run manually.
- Extended the canonical `scripts/lib/workspace-manifest.cjs` query with an
  explicit root parameter and made `src/bootstrap.ts` consume that same
  manifest. First launch now discovers every package carrying validated
  `gsd.linkable` metadata and creates its declared `@gsd` or `@opengsd` scope;
  it no longer maintains a second scope-specific package scanner.
- Replaced the masking global-install check in `validate-pack`: after
  `npm install --global --ignore-scripts`, the test now invokes the public
  bootstrap as the first process and then requires all ten canonical links.
  The packaged private link script is no longer called by the test before this
  assertion.
- Verification is green: bootstrap and manifest focused tests **11/11**,
  changed-source tests **3/3**, validate-pack script tests **2/2**, extension
  and root TypeScript checks, `build:core`, Herdr integration **30/30**,
  `git diff --check`, and full package installation validation. The decisive
  tarball evidence is `First-launch bootstrap repaired all 10 linkable
  packages` followed by `Package is installable. Safe to publish.`
- No architecture decision changed: this closes the documented deployment gap
  by making bootstrap obey the already-canonical package manifest. Remaining
  risk is limited to platforms where both junction creation and recursive copy
  are unavailable; the existing fail-closed startup diagnostic remains in
  force for that case.
- Committed and pushed the repair as
  `d3a4868c1f4660630d08c624e98289a5c26be144`. The clean remote artifact is
  `/srv/penglab/gsd-runs/artifacts/gsd-pi-herdr-1.16.2-d3a4868c-79eeb73d.tgz`
  (`sha256:79eeb73da179eceef0b74375bcc6ac0e92e32b13aaae3ed6908d27e0783bf497`),
  installed at immutable prefix
  `/srv/penglab/gsd-runs/toolchains/gsd-pi-herdr-1.16.2-d3a4868c-79eeb73d`.
- Remote validation began from a global `--ignore-scripts` install with both
  `@gsd/native` and `@opengsd/contracts` absent. Without invoking
  `link-workspace-packages.cjs`, the first public `gsd --build-info` reported
  `GSD repaired 10 internal package link(s) on first run`; all ten symlinks and
  all three `@opengsd/*` entries were then present. Build identity is the exact
  clean commit, the Linux x64 addon reports 98 exports, and the installed
  external-engine policy smoke remains green.
- Shared remote `gsd` and `gsd-mcp-server` links now target this prefix. The
  preceding `d720ea88-043e9bd6` and `53dc2f2a-d75b4f67` installations remain
  intact for rollback. No running process was killed or restarted and no local
  global installation changed.
- Exact next task: extract the remaining loop, pending/deferred gate, queue,
  planning, worktree, and context-depth decisions into one shared
  pre-execution evaluator. Consume it from native `tool_call` and external SDK
  pre-execution hooks without duplicating lifecycle side effects, then add
  parity coverage before enabling it for a second external engine.

### 2026-09-03 — Shared native/Claude pre-execution policy

- Extracted the native hook's ordered loop, deferred/pending approval, queue,
  planning-unit, worktree, authoritative-state, and context-depth decisions into
  `gsd/pre-execution-policy.ts`. Claude native names are normalized at this
  boundary, so native `write`/`bash` and SDK `Write`/`Bash` receive the same
  decision without copying workflow policy into the provider adapter.
- Moved same-turn deferred approval state into a shared host module and split
  policy decisions from effects. Gate deferral and loop-guard harness evidence
  are applied exactly once; native auto-mode pausing remains in the native hook
  because it owns the Pi UI context. Claude's SDK `PreToolUse` denies shared
  policy blocks before execution, then applies its existing one-time
  destructive-command permission layer.
- Preserved the two-process write-gate contract by resolving one
  disk-reconciled host snapshot per decision. A focused regression caught an
  initially stale in-memory snapshot for a lower-case depth gate; the final
  implementation retains verified-on-disk-wins behavior and canonical M-ID
  normalization.
- Verification is green: shared policy plus native/Claude focused regression
  **350/350**, changed-source **262/262**, all workspace package tests,
  extension and root TypeScript checks, Herdr integration **30/30**,
  `build:core`, `validate-pack`, and `git diff --check`. Installed-package
  validation still proves first-launch repair of all ten linkable packages.
- ADR-H040 records the boundary. No Herdr pane/runtime authority, GSD lifecycle
  authority, provider routing, compaction behavior, or session format changed.
  Cursor and Google CLI are not yet declared safe: post-hoc external results do
  not constitute a pre-execution deny contract.
- Exact next task: audit Cursor Agent and Google CLI for a real pre-execution
  interception capability. Wire the shared evaluator only where denial happens
  before the external tool side effect; otherwise add an explicit fail-closed or
  capability-restricted guarded-workflow path and tests. Do not treat
  `tool_execution_start` as enforcement and do not broaden external CLI access
  speculatively.
- Committed and pushed the shared policy slice as
  `b520707a8f188ec8718588c921f34e09bd1b0e88`. The clean remote artifact is
  `/srv/penglab/gsd-runs/artifacts/gsd-pi-herdr-1.16.2-b520707a-59073642.tgz`
  (`sha256:59073642cf8d5f14ad8dbc111ab4ea2cb0d99d5ae242eefcbfbb7e55c88877d3`),
  installed at immutable prefix
  `/srv/penglab/gsd-runs/toolchains/gsd-pi-herdr-1.16.2-b520707a-59073642`.
- Remote validation started from `--ignore-scripts` with both the native and
  `@opengsd/contracts` links absent. The first public launch repaired all ten
  canonical workspace links; the verified Linux x64 addon loads natively, and
  the installed Claude SDK hook denied a `Write` during queue mode before tool
  execution with the canonical queue-policy reason. The shared `gsd` and
  `gsd-mcp-server` links were switched only after those checks. The prior
  `d3a4868c-79eeb73d` prefix remains intact for rollback; no running process was
  killed or restarted and no local global installation changed.

### 2026-09-03 — Supported-model scope and verified OpenCodex hosted search

- Narrowed current downstream provider work to Codex authentication,
  Codex-based models, and GLM Coding Plan models. Cursor Agent, Gemini CLI, and
  Antigravity adapter work is deferred; inherited support remains intact and no
  provider was removed. ADR-H041 records the implementation boundary.
- Revalidated the installed remote runtime from the writable canonical project
  root `/srv/penglab/gsd-runs/projects/pengbot_monorepo/757a5a1c2c35`.
  `opencodex/gpt-5.6-luna` returned `CODEX_ROUTE_OK`, and
  `gsd-haiku/zai/glm-5.3-flash` returned `GLM_ROUTE_OK`. The earlier
  `/srv/penglab/.gsd/runtime` EACCES was an invalid smoke cwd under the
  root-owned workspace container, not a provider or runtime-path defect.
- Sent a bounded, credential-redacted Responses request directly through the
  installed OpenCodex endpoint. It accepted `tools: [{ type: "web_search" }]`
  and streamed the complete `response.web_search_call.in_progress` →
  `searching` → `completed` lifecycle with HTTP 200.
- Added `OpenAICodexResponsesCompat.nativeWebSearch`. Direct OpenAI Codex keeps
  its existing default; compatible proxies remain disabled unless explicitly
  enabled after verification, and an explicit `false` disables the direct
  default. Search injection, external-tool suppression, config schema, types,
  and author documentation share that capability.
- Verification is green for the changed contract: native-search **52/52**,
  Codex proxy model registry **1/1**, generated-model validation **16/16**,
  Codex Responses transport **31/31**, changed-source **52/52**, Herdr
  integration **30/30**, `typecheck:extensions`, `build:core`, `validate-pack`,
  and `git diff --check`. Package validation again reported
  `Package is installable. Safe to publish.` and repaired all ten linkable
  workspaces on first launch.
- The broader network-bearing `@gsd/pi-ai` suite passed 78 files/475 tests but
  retained four unrelated failures: one pre-existing generated Anthropic
  adaptive-model fixture drift and three live Codex tool-call expectations.
  The deterministic Codex transport suite and every changed test are green;
  none of those four failures exercises `nativeWebSearch`.
- Exact next task: commit and push, build a clean immutable tarball, install
  only on `penglab:/srv/penglab`, add `compat.nativeWebSearch: true` to the
  verified OpenCodex provider, and prove an installed GSD search turn plus
  unchanged GLM behavior before switching the shared remote link. Do not
  install locally.
- Committed and pushed the capability slice as
  `9e09e779f155a9531979e823188304ab70f35f20`. The clean release-candidate
  artifact is
  `/srv/penglab/gsd-runs/artifacts/gsd-pi-herdr-1.16.2-9e09e779-426cc709.tgz`
  (`sha256:426cc7091d5eb6e3028830630c30d63e6837e7f27f0139d828bf85c6cd9f0915`),
  installed at immutable prefix
  `/srv/penglab/gsd-runs/toolchains/gsd-pi-herdr-1.16.2-9e09e779-426cc709`.
- The local-platform tarball carried only the Darwin release addon. Native
  source did not change from the prior deployed commit, so the candidate was
  supplemented with the prior verified Linux x64 addon at SHA-256
  `72e5d00f1f15121bd8b33156a050c41588d0943d6dfe0194940e6d40a874f166`.
  The candidate then reported `nativeLoaded=true`; no native fallback warning
  appeared in either installed model smoke. This is an operator deployment
  detail, not a source or package claim.
- Candidate first launch repaired all ten internal workspace links. An
  isolated copied model catalog with the new flag produced one
  `serverToolUse`, one `webSearchResult`, and exact final
  `SEARCH_ROUTE_OK 2026-09-03`; GLM independently returned `GLM_ROUTE_OK`.
- After those gates passed, atomically switched the shared remote `gsd` and
  `gsd-mcp-server` links, backed up the mode-600 model catalog as
  `models.json.pre-9e09e779`, and set the verified OpenCodex provider's
  `compat.nativeWebSearch` to `true`. The global installed-runtime repeat
  produced the same search evidence and exact final response, retained GLM
  behavior, reported the clean commit/build identity, and emitted no native
  fallback warning. Sanitized evidence is under
  `/srv/penglab/gsd-runs/private/native-search-global-9e09e779`.
- The preceding `b520707a-59073642` prefix and model-catalog backup remain
  intact for rollback. No running GSD or Herdr process was killed or restarted,
  and no local global installation changed.
- Exact next task: treat hosted-search support as proven only for this exact
  OpenCodex route and keep all other compatible proxies fail-closed. Re-run the
  live protocol probe after an OpenCodex upgrade. The next code change should
  respond to a concrete Codex/GLM production failure or a moved upstream audit
  ref; Cursor, Gemini, and Antigravity remain out of scope.

### 2026-09-03 — Targeted native deployment artifact workflow

- Closed the remaining remote deployment rough edge exposed by the hosted
  search release: a tarball packed on macOS contains only the local release
  addon, while the Linux server needs a current Linux x64 artifact. The existing
  manual `build-native.yml` did build Linux x64, but only as part of an
  unconditional five-platform matrix.
- Dispatched run `33726574975` with publishing disabled. Its Linux x64 job
  completed against branch commit `5261f3629` and produced an ELF x86-64 addon
  with SHA-256
  `b1d5b33b59cc1578eed207544a4020699f0c9d123c0247481df1914002b51da7`.
  Atomically replaced the temporary prior-build addon in the active immutable
  prefix with this exact CI artifact. It loads with `nativeLoaded=true`; fresh
  installed Codex and GLM turns returned `CODEX_CI_NATIVE_OK` and
  `GLM_CI_NATIVE_OK` without fallback warnings. Evidence is under
  `/srv/penglab/gsd-runs/private/native-ci-smoke.O1413W`.
- Cancelled only the still-waiting Linux ARM job after all four other build jobs,
  including the required Linux x64 upload, had completed. No package was
  published and the deployed runtime remained available throughout.
- Added a validated `platform` choice to the manual native workflow. A small
  deterministic matrix planner emits either all five entries or exactly one
  selected platform; publishing with a partial matrix fails closed. This lets a
  Linux server deployment request only `linux-x64-gnu` without allocating
  unrelated macOS, Windows, or ARM jobs.
- Focused workflow and runner-contract tests pass **15/15**, including exact
  single-platform output, publish/all-platform enforcement, approved runner
  selection, and the Linux ARM Rust target mapping.
- Exact next task: commit and push the targeted matrix change, dispatch
  `build-native.yml` with `platform=linux-x64-gnu` and `publish=false`, and
  require a one-job successful run plus matching downloaded artifact before
  treating the deployment path as closed.
- Committed and pushed the targeted workflow as
  `927c798a9615d236dbdaa012a0b53ce8e7a2bbad`. Live run `33727412908`
  succeeded with exactly the planner and one `Build linux-x64-gnu` job; no
  macOS, Windows, or ARM build job was created, and publishing was skipped.
  The native job completed in 51 seconds.
- Downloaded `native-linux-x64-gnu` from that run and verified it is an ELF
  x86-64 shared object with the same SHA-256
  `b1d5b33b59cc1578eed207544a4020699f0c9d123c0247481df1914002b51da7`
  already installed from the first CI run. The remote runtime therefore uses
  the reproducible artifact built from the current branch, not the earlier
  temporary binary.
- The targeted Linux deployment path is closed. Exact next task: keep the
  upstream freshness gate and concrete Codex/GLM production evidence as the
  triggers for further runtime changes. Re-run the single-platform native job
  whenever native source changes before remote promotion; do not reintroduce
  Cursor, Gemini, or Antigravity work under the current provider scope.

### 2026-09-03 — Automated Pi upstream freshness gate

- Re-ran the read-only upstream audit before selecting more work. Stable remains
  `v0.84.4` at `b79e4cc834970cca69daebffab7df1da7d1e52c4` and main remains
  `4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057`; no unreviewed Codex, GLM,
  session, or common runtime change exists at this checkpoint.
- Closed an operational gap in the freshness policy: the fail-closed audit was
  only a documented local command. Added a read-only GitHub workflow that runs
  weekly, by manual dispatch, and when the audit contract changes in a pull
  request. It has only `contents: read`, uses the existing bounded
  `git ls-remote` implementation, and cannot fetch, vendor, update the baseline,
  open an issue, or mutate upstream.
- A moved stable/main ref still exits nonzero. Success, drift, and network-error
  runs all retain the Markdown report and stderr diagnostic for 30 days and add
  the evidence to the Actions job summary.
- Focused audit/workflow/runner-contract tests pass **15/15**, the live audit is
  current, and `git diff --check` passes. The dedicated
  `test:pi-upstream-audit` command now covers both parser and workflow policy.
- Exact next task: commit and push this workflow, dispatch it once from the
  feature branch, and require a successful live Actions run with retained audit
  evidence. After that, implement no speculative provider work: only verified
  Codex/GLM failures or a freshness alert should trigger the next runtime slice.
- Committed and pushed the automation as `06b73d40e`. GitHub rejected a manual
  dispatch from the feature ref with HTTP 404 because a newly introduced
  `workflow_dispatch` workflow is not registered until its file exists on the
  default branch. The branch was not merged or copied to `main` to bypass that
  repository boundary.
- As the strongest pre-merge substitute, loaded the committed YAML and executed
  its exact audit and summary shell bodies locally. The live upstream query
  exited 0, wrote `exit-code=0`, and produced a job summary containing the
  current stable/main identities and `Status: current`. YAML policy tests also
  prove the always-run summary/artifact steps and read-only permissions.
- Exact next task after normal review/merge: manually dispatch
  `pi-upstream-audit.yml` once from the default branch and confirm the 30-day
  `pi-upstream-audit-<run-id>` artifact. Until then the code and command are
  complete but the GitHub-hosted execution gate remains explicitly pending;
  no `main` merge or upstream mutation is authorized by this session.

### 2026-09-03 — Remote runtime health and stale probe cleanup

- Audited the active `penglab:/srv/penglab` runtime without changing user
  configuration or restarting GSD/Herdr. The shared launcher resolves to the
  immutable `9e09e779-426cc709` package, reports `1.16.2`, and loads the Linux
  x64 native addon at SHA-256
  `b1d5b33b59cc1578eed207544a4020699f0c9d123c0247481df1914002b51da7`.
- The host had roughly 48.8 GiB available memory with effectively unused swap
  and 578 GiB free disk space (33% used). Current evidence therefore does not
  support memory or disk pressure as the phase-transition latency cause.
- Found one unrelated ad-hoc upload probe from 2026-08-28 still listening on
  localhost: a two-process `bash`/Bun group running `/tmp/probe2-remote.mjs`.
  Its source proved it was the prior test listener, not a GSD worker or user
  service. Terminated only process group `1697457`, removed only its two exact
  temporary files, and verified both PIDs and port `34739` disappeared.
- Other long-running processes whose cwd is the real `pengbot_monorepo`
  `search-worker` service were deliberately left untouched. No product-code
  change is justified by an uncommitted one-off probe; future live probes must
  remain bounded and explicitly close listeners before their shell exits.
- Exact next task remains the default-branch Actions validation after normal
  merge or a concrete Codex/GLM/Herdr production failure. The current remote
  runtime is healthy and requires no reinstall for the documentation/CI-only
  freshness changes.

### 2026-09-03 — Noninteractive SSH runtime repair

- Reproduced an installation usability failure on `penglab`: interactive shell
  setup made `gsd` visible, but both a direct SSH command and `bash -lc` lacked
  Node, so the installed `#!/usr/bin/env node` launcher exited 127. The stable
  toolchain PATH existed only after `.bashrc`'s noninteractive early return.
- Preserved `/home/penglab/.bashrc.pre-gsd-remote-path-20260903`, then added one
  idempotently marked PATH export before the early return. It exposes only the
  stable `/srv/penglab/gsd-runs/toolchains/bin` and existing user-local bin;
  no credential, command output, or service startup was added to shell init.
- Direct `ssh penglab 'node --version; gsd --version'` and `bash -lc` now both
  resolve the managed Node v22.19.0 and GSD v1.16.2 and exit 0. Existing Herdr,
  GSD, OpenCodex, and project service processes were not restarted.
- Updated the operations runbook with this noninteractive shebang/PATH contract,
  atomic-link rule, and bounded probe cleanup requirement. Also removed its
  obsolete prohibition on read-only upstream fetches so it matches the current
  repository policy; upstream mutation remains prohibited without explicit
  user authority.
- Exact next task: no runtime reinstall is needed. Preserve this PATH invariant
  on future toolchain rotations and continue to gate new product work on a
  concrete Codex/GLM/Herdr failure or the automated upstream freshness signal.

### 2026-09-03 — Compaction seam regression ownership repair

- A completion audit found that the canonical compiled package matrix was green
  while the explicitly maintained
  `packages/pi-coding-agent/test/suite/agent-session-compaction.test.ts`
  characterization still called the removed pre-split `_checkCompaction` and
  `_runAutoCompaction` methods. This was test ownership drift, not a production
  compaction failure: runtime authority has lived in
  `AgentSessionCompactionModule` since the ADR-010 split.
- Rebound the 13-test characterization to an owned
  `AgentSessionCompactionModule` instance and
  repaired its compactable fixture to contain discarded and retained turns.
  Custom-stream summaries now satisfy the production non-degenerate-summary
  contract, and the test distinguishes successful compaction from whether a
  queued continuation is requested.
- Added six canonical Node tests beside the owning module for one-shot overflow
  recovery, stale pre-compaction response rejection, threshold recovery from
  the last successful usage, no-usage rejection, pre-compaction usage
  invalidation, disabled mode, and below-threshold behavior. These tests are
  now included automatically in `@gsd/agent-core` and the compiled workspace
  matrix instead of relying only on an ad-hoc Vitest selection.
- Verification is green: focused characterization **13/13**, Codex OAuth /
  transport / Remote V2 / hosted-search plus GLM catalog and compaction matrix
  **151/151** (89 Vitest + 62 Node), `@gsd/agent-core` **169/169**, and the full
  compiled workspace matrix (agent-core **169/169**, agent-modes **294/294**,
  native **223 passed / 1 skipped**, pi-agent-core **3/3**, pi-ai **49/49**,
  pi-coding-agent **72/72**, pi-tui **8/8**, contracts **9/9**, MCP server
  **377/377**, RPC client **30/30**).
- No runtime behavior, provider routing, model catalog, Herdr pane authority, or
  installation artifact changed, so the remote `/srv/penglab` runtime does not
  need replacement for this test-only slice. Cursor, Gemini, and Antigravity
  remain outside the supported implementation scope.
- Final Pi boundary/patch inventory, extension typecheck, `build:core`,
  `validate-pack`, `test:changed:src`, and `git diff --check` all pass. Package
  validation again reports `Package is installable. Safe to publish.`
- Exact next task: commit and push this test-ownership repair. Afterward, make
  no speculative provider change unless the read-only upstream audit moves or
  a concrete Codex/GLM/Herdr production failure is reproduced.

### 2026-09-03 — Retry-closeout verification prose hardening

- Investigated the live local `M013/S03/T08` liveness stop against canonical
  DB, Attempt, Result, verification, and executor evidence. The executor and
  its final browser/focused checks had succeeded; host verification alone
  failed because the Task Verify field combined a real `rtk` prefix with
  acceptance prose (`twice on a quiet machine ... plus rtk ... green`). The
  command heuristic treated its flags as executable and Bash rejected the
  unquoted parenthesis in 25 ms. Provider timeout and the implementation test
  matrix were eliminated as causes.
- Added quote-aware recognition for repeated-run/result prose and a bare
  English `plus <command>` join. Existing stored contracts now route to
  `task-plan-prose`, so qualifying structured Task evidence remains the host
  authority and no prose is spawned in a shell. The shared plan/replan guard
  rejects new mixed contracts with instructions to use `&&` between runnable
  commands or keep the acceptance criterion as prose. Quoted examples such as
  `node -e '... plus rtk ...'` remain accepted.
- The exact production input first failed both new regressions, then passed.
  Focused verification-gate tests pass **138/138**; the combined verification,
  verdict, plan, and replan regression passes **194/194**; changed-source tests
  pass **138/138**. `typecheck:extensions`, `build:core`, `validate-pack`, and
  `git diff --check` pass, with package validation ending in **Package is
  installable. Safe to publish.** The fix is committed as `1c9568347`.
- Installed the clean release candidate locally because the reported incident
  was in the Mac runtime. Build info reports commit `1c9568347`, `dirty=false`;
  the installed compiled classifier returns exactly
  `{commands: [], source: "task-plan-prose"}` for the T08 input. The already
  running root was not terminated: `/reload` completed in pane `w5:p1`, then
  canonical `/gsd auto` created retry Attempt 2 and resumed T08.
- Also deployed the same clean tarball to the standing remote runtime policy:
  artifact
  `/srv/penglab/gsd-runs/artifacts/gsd-pi-herdr-1.16.2-1c956834-ea63decb.tgz`
  (`sha256:ea63decb2c4f8a43016121a37841c39dfac115473f1a4f66fddd33e4068e9a25`)
  and immutable prefix
  `/srv/penglab/gsd-runs/toolchains/gsd-pi-herdr-1.16.2-1c956834-ea63decb`.
  The unchanged CI-built Linux x64 addon retains SHA-256
  `b1d5b33b59cc1578eed207544a4020699f0c9d123c0247481df1914002b51da7`
  and reports `nativeLoaded=true` with 98 exports. Direct-prefix and shared-link
  classifier smokes pass. Shared `gsd` and `gsd-mcp-server` links were switched
  atomically; the prior `9e09e779-426cc709` prefix remains for rollback and the
  running remote GSD process was not restarted.
- Remaining live evidence: local retry Attempt 2 is currently running. Exact
  next task is to observe its closeout and require T08 to become complete
  without a new shell-parse verdict or liveness stop. Do not edit the DB or
  projections directly; if a distinct failure appears, preserve its new
  evidence and diagnose that failure independently.

### 2026-09-03 — Retry-closeout session replacement completion

- Followed the live `M013/S03/T08` retry through five distinct host-side
  failures instead of treating the first verification classifier repair as the
  whole incident. The executor, two 48-pass/4-skip browser matrices, and the
  final 46-pass focused pin run were already sound. Subsequent evidence showed
  that Pi correctly invalidated the initiating extension context after each
  `newSession`, while GSD still retained parts of that old session boundary.
- Commit `6556b7419` made fresh replacement contexts flow through the long-lived
  auto iteration. Commit `7a5d462df` restored a unit's workflow tool surface
  from the replacement registry and fails closed before model dispatch when a
  required operation is absent. Commit `612020ff8` fixed the Pi CLI replacement
  factory: `createAgentSession({tools})` is a permanent registry allowlist, so
  the outgoing active tool names are now reapplied only after the full new
  registry is created. Commit `ab230d2cf` centralized the native equivalents
  for canonical workflow operations (`capture_thought`, `memory_query`, and
  `gsd_graph`). The replacement executor then invoked both `CAPTURE THOUGHT`
  and `COMPLETE TASK`, staged T08, and passed the 4 ms post-execution gate.
- The remaining live failure occurred after that successful closeout:
  `AutoOrchestrator` still held its constructor-time `ctx/pi`, and the detached
  rejection handler also notified through the initial command context. The
  20:05 crash log points to the latter at installed `auto.js:359`; the persisted
  wedge recorded the same stale-context failure during orchestration. Commit
  `7dc143e14` adds an explicit orchestrator host-handle rebind without resetting
  its transition/liveness state and makes detached reporting/cleanup use the
  latest `s.cmdCtx`. A dedicated replacement-session regression protects the
  handoff.
- Focused replacement/detached/orchestrator tests pass **72/72**. The combined
  auto-loop, post-unit retry bridge, replacement, and detached suite passes
  **164/164**. The prior focused gates remain green: auto-loop **138/138**,
  task-recovery/doctor **39/39**, agent-core **170/170**, CLI **1/1**, workflow
  phase matrix **139/139**, token/tool gating **30/30**, and changed-source
  **277/277** for the preceding registry/equivalence slice.
  `typecheck:extensions`, `build:core`, `validate-pack`, and `git diff --check`
  pass; package validation ends with **Package is installable. Safe to
  publish.**
- Installed clean local release candidate `7dc143e14` (`dirty=false`) and
  resumed persisted wedge `W-2a506e46` only after `/gsd doctor` reported 0
  issues. Canonical state had already advanced T08, so resume did not rerun it:
  the root immediately entered `M013/S03/T09` and remained healthy in
  auto-mode with three running workers. No crash log newer than the original
  20:05 `pid-31622.log` appeared during the observation window.
- Deployed the same tarball to the remote standing runtime as
  `/srv/penglab/gsd-runs/artifacts/gsd-pi-herdr-1.16.2-7dc143e1-92607ffc.tgz`
  (`sha256:92607ffcd55d624df42d68653d4a1ba1fb8f333f896b356ed7128a4f05de0571`)
  and immutable prefix
  `/srv/penglab/gsd-runs/toolchains/gsd-pi-herdr-1.16.2-7dc143e1-92607ffc`.
  Its Linux x64 addon retains SHA-256
  `b1d5b33b59cc1578eed207544a4020699f0c9d123c0247481df1914002b51da7`,
  loads natively, and exposes 98 addon exports. Shared `gsd` and
  `gsd-mcp-server` links were switched atomically; remote PID 948361 was not
  restarted and the prior `6556b741-f18a869e` prefix remains rollback-ready.
- Residual risk: T09 was still executing when this repair was closed, so this
  evidence proves recovery, non-replay of T08, and next-unit dispatch—not T09's
  eventual product result. Exact next task is to observe T09's ordinary
  completion and treat any new provider, verification, or application failure
  as a separate incident. A new stale-context crash after `7dc143e14` is the
  only signal that should reopen this session-replacement diagnosis.

### 2026-09-04 — Remaining replacement-session owners diagnosed and repaired

- The post-`7dc143e14` recurrence was not an old installed artifact. Two clean
  post-install processes crashed exactly at the 20-minute soft timeout through
  `auto-timers.js`, and the final run completed T09 iteration 1 before failing
  iteration 2 prior to its `iteration-start` event. Pi's guarded getters and
  the compiled crash lines localized the remaining stale owners to supervision
  timer closures and `buildLoopDeps.loadEffectiveGSDPreferences`; detached UI
  reporting could then mask either originating rejection.
- Supervision callbacks now resolve the current context/API from `s.cmdCtx`
  when they fire, loop preferences resolve that same live owner when invoked,
  and detached failure reporting logs durably before attempting a best-effort
  UI notification. Behavior-level regressions make the original context throw
  after a replacement and cover all three boundaries.
- Focused replacement/timer/detached tests pass **20/20** and
  `typecheck:extensions` passes. Three isolated manual mutants were killed:
  restoring the captured timer API, restoring the captured loop context, or
  rethrowing a stale notification each makes its corresponding regression fail.
- Exact next task: run the broader changed-source/build/package gates, install
  a clean immutable local candidate, reload the existing target root, and
  resume wedge `W-2a506e46`. Require T09 to pass both the 20-minute supervision
  boundary and its next-iteration prologue without another stale-context crash
  before archiving the debug session.

## 11. Working-session protocol

For every Herdr session:

1. read this file;
2. identify exact current task IDs;
3. inspect relevant current downstream code;
4. make the smallest coherent change;
5. run required focused/contract/parity/security tests;
6. update this plan before stopping;
7. record the exact next task and any changed decisions/risks.
