# Deferred upstream implementation — verification record

**Status:** R1–R6 implemented and verified; final combined gates passed.

Operator goal (2026-09-07): implement all six recommended bundles in order,
primarily using GPT-6 Astra/xhigh subagents for this development goal. This
does not change the installed GSD role policy, revive App Server delegation,
or authorize unrelated provider/platform features.

## Baseline and source

- Worktree: `feature/gsd-upstream-backports-20260907`, HEAD `0417606d3` plus
  the existing verified, uncommitted eight-patch selective backport batch.
- Immutable reviewed upstream main: `68acbe7863f79fb4256574c7a3aa65b2e8bec9ac`.
- Published tag: v1.18.0 `0a735e2293c53366d50e2937d560a84a8be9de57`.
- Keep prior fixes and unrelated work intact. Use patch adaptation, not a whole
  vendor replacement. Scope/refs remain in `gsd-upstream.md` and the JSON ledger.
- Native collaboration workers were explicitly launched with model
  `gpt-6-astra`, reasoning effort `xhigh`; no machine-wide settings were edited.

## Required sequence and completion evidence

| Bundle | Required delivered behavior | Sources | Status |
| --- | --- | --- | --- |
| R1 | Cause-aware pause on schema-rejected completion; execute-task commit retry uses verification-retry; rejected claims have stable liveness identities/actionable recovery | `e2448afef`, `0e165af3f`, `f8ac95307` | VERIFIED |
| R2 | DB snapshots are not mistaken for browser evidence; PLAN empty lines contain no indentation-only whitespace | `277bb6b38`, `dad224c8a` | VERIFIED |
| R3 | Approved remediation resume and finalize race recovery; legacy parser handles modern/legacy names, missing parents and contradictory identifiers without misattribution | `5cb9410a9`; `13cd6a00d`, `e34e7d7d0`, `87c424246` | VERIFIED |
| R4 | Complete DB-authoritative project snapshot through native GSD, MCP and CLI, including correctness follow-ups for queue side effects, wrong-project handles and concurrent state | `1af48f0d1`, `f0c4ac525`, `59d5a3588` and required dependent read-path changes | VERIFIED |
| R5 | Bounded output-limit continuation plus explicit terminal failure; preserve tool pairing, abort/stop hooks, context overflow recovery and downstream next-turn preparation | `5fbf5dca9` | VERIFIED |
| R6 | Detect same-version drift in mutable development resources without mandatory live hashing of immutable release bundles; make Ctrl-O repaint/shrink behavior correct at actual render time | `a05a682f5`, remaining `2330218f3` behavior | VERIFIED |

R3 must first verify already-equivalent lifecycle adoption behavior and retain it,
not reimport it blindly. R4 does not require the separately optional VS Code UI;
its native/MCP/CLI paths and correctness follow-ups are mandatory. R6 must solve
actual paint timing rather than merely toggling a flag before a deferred render.

## Verification contract

- Reproduce missing behavior with meaningful characterization tests, then apply
  the scoped fix and run the adjacent regression matrix after each bundle.
- Track exact source hashes, adaptations and test evidence for each bundle.
- R1/R3: compare exact task/Attempt/run/lease identity, one-time resume grants,
  repeated failure bounds, other-role retry behavior, no unauthorized lifecycle
  transitions, and no duplicate publication.
- R2: keep genuine browser requirements intact across English/line wrapping and
  preserve description text/CRLF semantics apart from empty-line whitespace.
- R4: run actual native/MCP/CLI reads against disposable real databases; check
  absent/deleted/replaced DB paths, wrong-root isolation, closed handles, queue
  files, revision consistency, error envelopes and output limits. No fake runner
  or empty placeholder counts as the feature.
- R5: simulate provider length termination and normal responses, output/overflow
  distinction, max-three extra calls, explicit termination, cancellation, tool
  errors and compaction boundaries. No repeated writes after termination.
- R6: test changed contents with unchanged version/hash-file, convergence and
  mid-copy mutation; exercise a real TUI renderer with recorded terminal writes,
  scrolling/streaming and exceptions. Benchmark the intended dev/release split.
- Final: focused tests plus model/effort, GSD workflow, recovery, subagent
  Local/Cmux/Herdr parity/security, cache/compaction, native/MCP/CLI snapshot and
  TUI regression; extension typecheck; core build; Pi boundaries/allowlist; diff
  review. Additional packaging/installation is a separate operator action.

## Progress log

- Goal turn 1: current worktree and active goal inspected. R1 split across three
  disjoint Astra/xhigh workers; parent maintains scope/provenance and integration.
  No earlier goal turn exists to classify. This turn has concrete progress, not
  an unchanged-state wait. R2–R6 remain required and are not narrowed away.
- R1 verified: combined source suite 244/244 and extension typecheck pass.
  Individual red/green evidence: schema cause 7/8 red then 60/60 adjacent green;
  commit retry 15/16 red then 80/80 plus 4/4 real Git closeout cases; claim
  liveness missing-worker/held-lease red then 129/129 authority/replay/checkpoint
  tests. Counts overlap. Model/lease/Attempt authority and downstream session
  rebinding remain intact. R2 assigned to two Astra/xhigh workers.
- R4 read-only design completed early, with no R4 implementation yet: reuse the
  existing isolated read-only adapter and independent read transaction, extracting
  shared adapter-bound state projection instead of closing/restoring global DB
  handles. The snapshot must not run migrations or accept a torn final result.
  Native/MCP/CLI and bounded result metadata remain mandatory. Auxiliary legacy
  escalation files are not versioned by the DB revision and need explicit limits.
- R2 verified: 107 passing / 10 existing skipped combined browser/renderer/UAT
  tests plus extension typecheck; dedicated browser family 91/91 and renderer
  family 32 passing / 11 existing skipped (overlap). Red failures reproduced DB
  snapshot false positives and whitespace-only PLAN bytes. Adapted explicit
  DOM/UI/page snapshots beside database wording and soft-wrapped disclaimers,
  keeping paragraph/list/table/heading boundaries. 10,000-operation stress passes.
  Inherited bare `file:///path` vocabulary behavior is unchanged; no live browser
  was started and no actual project projection regenerated.
- R3 started with Astra/xhigh runtime and parser owners plus independent review.
  Existing recovery/compatibility/cutover baseline passes 131/131. Remediation
  authorization and legacy parsing are separate changes, both required before R4.
- R3 runtime implementation is green at 264/264 including native/MCP/CLI replay
  and identity coverage; three-refresh bound uses the captured successor and
  refuses missing/same latest attempts without advertising a dead resume lever.
  Independent runtime/transport checks pass 12/12 + 4/4. A true two-process
  resume contention test is still being added; Promise microtasks over a sync API
  are not claimed to prove simultaneous process contention.
- R3 existing adoption behaviors (`4881746ef`, `d4de2bb68`, `b8621206c`) were
  independently verified by 98/98 existing tests and are not reimported.
- R3 parser red/green proves the three requested source changes. Cross-review
  additionally found SUMMARY H1 task identity could contradict its scoped name;
  explicit mismatches are now rejected, with matching/no-ID controls retained.
  Broader parser fixtures exposed six pre-existing v48/v49 assumptions, reproduced
  with the unchanged HEAD parser. Maintenance keeps sealed corpus/schema/DB bytes
  and digests intact; it separately asserts known schema-epoch classification
  changes and retains historical semantic comparisons. Final broad run is pending.
- R3 final: runtime/native/MCP/CLI 264/264, parser/preview/recover family 272/272,
  preserved-adoption 98/98, and true process-contention 4/4 pass. Typecheck and
  diff check pass. Contention uses two independent Node processes blocked at actual
  SQLite BEGIN IMMEDIATE, with one grant/checkpoint/event, identical replay or
  explicit loser, unchanged budgets and one successor. This replaces the earlier
  evidence limitation; Promise-only competition is not the final contention proof.
  SUMMARY mismatch controls independently pass 4/4. Sealed corpus tree is clean.
  The public corpus's 26 cases validate current version policy separately from
  historical digests; no historical dependency support was invented.
- R4 now starts. It must use one isolated read transaction with shared
  adapter-bound projection; native/MCP/CLI must call the same complete reader.
  Wrong-project global adapter closure, migration on reads and torn success at
  retry exhaustion are not acceptable shortcuts. Collection/text/byte limits must
  be explicit without changing project-wide counts.
- R4 final: core/runtime 98/98, interface/CLI 43/43, native relative-path/scope
  2/2, independent isolation 9/9, and MCP workflow/parity 84/84 pass (overlap).
  Parent final snapshot/progress/isolation run passes 27/27; parent broader
  derive/state run passed 83/83 before final boundary refinements. Typecheck,
  core no-emit typecheck, Pi boundary/patch inventory and diff checks pass.
  A real top-level CLI child uses disposable GSD_HOME/agent paths. Native/MCP
  return one snapshot plus compact metadata; actual escaped transport bounds
  are tested at 540 KiB (tools) and 270 KiB (CLI), with core data capped at
  256 KiB. Foreign-project scope, aliases, unavailable existing DBs, raw identity
  overflow and Unicode truncation are covered. The observer's notification/log
  side effect was reproduced and removed without silencing normal runtime
  warnings. Runtime queue repair remains intact; reads never perform it.
  See [the public read contract](project-snapshot.md). No installed copy changed.
- R5 starts after R4 verification. Read-only characterization reproduced a
  positive-output length response ending silently after one provider call.
  Implementation is divided between the low-level loop, session retry/compaction,
  and independent source-backed integration tests. Preserve downstream
  prepareNextTurn scheduling after the stop hook at the next request boundary;
  do not transplant the upstream ordering. Continuations must survive context
  replacement, and repeated zero-output overflow must remain bounded.
- R5 final: parent loop/Agent/schema 75/75 and source session/module/integration
  52/52 pass; the final additional real retained-assistant-tail bridge test brings
  independent persistent integration to 6/6. Package no-emit typechecks and diff
  checks pass. Reds reproduced silent length completion, retryable-text marker
  retry, repeated zero-output guard reset, dropped history and synthetic last-cost
  overwrite. Positive-output continuation has a three-injection cap; stop happens
  before preparation and pending intent is persisted only after replacement.
  Overflow has one compact/retry allowance; canonical history remains intact and
  a successful compaction with assistant-only retained tail uses one normal
  persisted follow-up bridge. Actual Agent.continue(), later explicit prompt,
  zero completed-tool reruns and aborted prepare return/throw are exercised.
  Model/effort/backend regression 118/118 and Herdr boundary/plugin 31/31 pass.
  Existing dotted-field/JSON-pointer schema-convergence mismatch is unchanged and
  documented, not claimed fixed. See [the contract](output-limit-continuation.md).
- R6 starts with separate resource-sync and real-paint owners plus independent
  review. Immutable release startup must retain the precomputed fast path; live
  developer bundles need same-version drift detection and pre-copy hash stamping.
  Parent read-only baseline: 1,510 files / 13,721,320 bytes, fingerprint calls
  195.66ms first / 48.87ms / 42.12ms thereafter (not a cold-disk benchmark).
  Current TUI already has tall-shrink viewport realignment; remaining behavior
  must be reproduced with actual key handlers/rendered terminal writes before
  modifying its policy. Final combined regression/build gates remain required.
- R6 resource half verified: 60/60 adjacent tests, independent policy 7/7 and
  parent drift/policy combination 13/13 pass; root no-emit/typecheck and diff
  checks pass. Auto/live/bundled mode uses this package's identity, not ancestor
  Git metadata. Both a real between-directory copy mutation and post-copy/pre-stamp
  mutation converge next launch; the sealed pre-copy hash is used once. Immutable
  release hash reads avoid reading every file's content, not all startup filesystem
  work. Timing and accepted ABA residual are recorded in
  [managed-resource-sync.md](managed-resource-sync.md).
- R6 UI actual terminal baseline: Ctrl-O collapse already passes against the
  downstream viewport renderer; no temporary clearOnShrink flag is needed.
  Ctrl-T loses active tool identity or leaves an empty transcript on rebuild
  failure (two red cases). Expanded WRITE updates also cause a 288,541-byte full
  replay when elapsed metadata changes above the viewport. Approved correction:
  transactional thinking/replay with live-tool reuse, and dynamic status at the
  footer of tall expanded cards. Semantic content/history repaint policy remains
  unchanged; actual key handlers/xterm writes and exception cases must pass before
  R6 is complete.
- R6 final UI: 750/750 TUI/controller tests (130 suites, no skips) and 66/66
  component tests pass. Independent actual key-handler/footer 15/15 and view
  rollback/repeated-ID 3/3 overlap these gates. Final app key-handler suite has
  10 cases. Getter-only host shape, orphan thinking clones, exact live-tool
  reuse, repeated historical IDs, created-tool disposal and settings rejection
  are covered. Actual app WRITE append is 924 bytes/no full repaint; isolated
  timer/append are 141/296 bytes. Semantic offscreen changes still use the normal
  repaint path. See [the UI contract](interactive-render-backports.md).
- Final audit found four additional pre-existing schema-epoch assertions in
  `legacy-import-corpus.test.ts`. HEAD already had schema/contract v49; sealed
  source databases are v48. Test-only maintenance preserves every aggregate,
  oracle and corpus byte. The 182-test corpus/parser/recovery family passes after
  correction. Sealed inventory remains 210 entries / 3 symlinks / 1,897,803 bytes,
  digest `10d53b542fc0a532d8b625400e16b74cadf9faddac61073da7e7d3183092b71f`.
  Earlier broad source run was 827 passing / 4 old expectation failures; it is
  not misreported as a fully rerun 831-test gate.
- Final combined gates: `pnpm run test:changed:src` — 875 passing, 10 existing
  skips, zero failures (885 tests); full subagent/Local/Cmux/Herdr/worker source
  regression — 170/170; full TUI/controller — 750/750; loop/Agent/schema — 75/75;
  source session/module/integration — 52/52 plus final persistent integration
  6/6; role/effort/backend — 118/118; Herdr plugin/downstream boundary — 31/31.
  Counts overlap. Core build, final extension typecheck, Pi boundary, documented
  patch allowlist, upstream metadata tests and final diff checks pass. New
  untracked tests are explicitly exercised separately from changed-source
  selection, which uses tracked Git diffs. No install/commit/push is claimed.

## Repeating the broader UI and backend gates

```sh
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-transform-types --test --test-concurrency=3 packages/pi-tui/test/*.test.ts packages/gsd-agent-modes/src/modes/interactive/controllers/*.test.ts packages/gsd-agent-modes/src/modes/interactive/interactive-chat-render.test.ts packages/gsd-agent-modes/src/modes/interactive/streaming-render-state.test.ts packages/gsd-agent-modes/src/modes/interactive/interactive-key-handlers-paint.test.ts packages/gsd-agent-modes/src/modes/interactive/components/interactive-key-handling.test.ts packages/gsd-agent-modes/src/modes/interactive/interactive-thinking-rebuild-contract.test.ts packages/gsd-agent-modes/src/modes/interactive/components/tool-execution-live-footer.test.ts
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test --test-concurrency=2 src/resources/extensions/subagent/tests/*.test.ts src/resources/extensions/subagent/execution/tests/*.test.ts src/resources/extensions/subagent/execution/herdr-worker/tests/*.test.ts src/resources/extensions/herdr/tests/*.test.ts
```

## Completion audit and next action

All six required bundles have code, characterization/behavior tests, provenance
and documented downstream adaptations. Real SQLite transactions/process
contention, real CLI execution, persisted agent-session recovery and actual
keyboard/terminal paint cover their respective runtime boundaries. Independent
review found no missing implementation requirement. Accepted limitations remain:
auxiliary-file snapshot consistency, resource-sync ABA, existing schema-field
notation mismatch and unrelated previously documented full-suite limitations.
These are not TODO implementations or fake runners.

Next action is maintainer review of the working-tree changes. Commit/push,
packaging, local/remote installation and live-session restart remain separate
explicit operator actions. Installed role/provider/effort policy and current
Mac/penglab installations were not modified by this goal.
