# GSD–Herdr Living Plan

> **Status:** M0–M7 and final downstream-isolation revalidation complete
> **Last updated:** 2026-08-31
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

The recorded source-base SHA is historical provenance. Normal development,
canary, package, and release workflows compare only refs already present in this
repository and must not fetch or mutate the original project.

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

## 11. Working-session protocol

For every Herdr session:

1. read this file;
2. identify exact current task IDs;
3. inspect relevant current downstream code;
4. make the smallest coherent change;
5. run required focused/contract/parity/security tests;
6. update this plan before stopping;
7. record the exact next task and any changed decisions/risks.
