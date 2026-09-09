# GSD Pi upstream review ledger

This is the canonical human-readable record for reviewing **GSD Pi itself**:
[`open-gsd/gsd-pi`](https://github.com/open-gsd/gsd-pi).
Machine-readable refs are in [`scripts/gsd-upstream.json`](../../scripts/gsd-upstream.json).
The separately vendored Pi engine (`earendil-works/pi`) remains tracked in
[`pi-upstream.md`](pi-upstream.md) and `scripts/pi-upstream.json`. Do not confuse
its `v0.x` vendor pin with GSD Pi's `v1.x` release line.

## Last checked snapshot

| Field | Value |
| --- | --- |
| Checked on | **2026-09-07** |
| Latest published stable tag observed | **v1.18.0** |
| Stable tag commit | `0a735e2293c53366d50e2937d560a84a8be9de57` |
| Reviewed main commit | `68acbe7863f79fb4256574c7a3aa65b2e8bec9ac` |
| Version declared on reviewed main | `1.18.0` |
| Downstream before this review | `0417606d37d69ee31cf0bda496f9617a2afbe7b0` |
| Full-sync fork base (unchanged) | `4b26a642c0121ae6161abbb6f2dc6937c78874dd` — version `1.16.2` |
| Review branch | `feature/gsd-upstream-backports-20260907` |
| Review depth | Inventory of 69 commits since the full-sync base; targeted behavioral review and selective backports |

The published [v1.18.0 release](https://github.com/open-gsd/gsd-pi/releases/tag/v1.18.0)
and the fetched main snapshot are distinct Git objects despite declaring the same
version. The exact refs above, not a cached release-page commit count, define this
review. Some selected main fixes postdate the published release. **Reviewed is not
fully merged, installed, or a vendor-version bump.** The downstream distribution
remains `@penggin/gsd-pi-herdr`; its package version is not changed by this review.

## Selected backports — 2026-09-07

| Source | Value | Downstream adaptation |
| --- | --- | --- |
| [`fc0ce0661`](https://github.com/open-gsd/gsd-pi/commit/fc0ce0661fb906ade43842473326ed74bfd5b021) | Refuse a missing DB path before constructing a no-create handle, instead of recreating an empty database. | Source guard and test retained. This is an entry-time check, not an atomic filesystem race guarantee. |
| [`60826e393`](https://github.com/open-gsd/gsd-pi/commit/60826e39356e2087802fa7d03ce041b68a403b69) | An explicit blocker-discovered attempt pauses with its reason instead of wedging the verification gate. | Keep ordinary failed attempts as failures; do not create success verdicts or remediation automatically. Display escalation only when its milestone/slice/task IDs match. Only relevant documentation added. |
| [`09f133390`](https://github.com/open-gsd/gsd-pi/commit/09f1333909aacccef0c5400804da186bc076feeb) | A failed retry-bound dispatch clears that pending retry and pauses, preventing repeated dispatch selection. | Preserve downstream replacement-session ctx/pi rebinding and execution-owner cleanup; add unmatched-retry coverage. |
| [`9212937f3`](https://github.com/open-gsd/gsd-pi/commit/9212937f34abde2bf74554b11a449ca8fecd1c43) | Preserve a resolved tool result's `isError` in terminal events and transcript results. | Preserve usage/provenance and after-tool hook overrides, including explicit false; retain abort handling. |
| [`dcdf4fc91`](https://github.com/open-gsd/gsd-pi/commit/dcdf4fc9170305023e890df4c4c380feddbf8c33) | Recoverable UAT/exec input-schema rejection no longer poisons later valid execution with a durable harness abort. | Clear only an explicitly successful matching tool in the same unit type/raw ID/start time. Never erase turn cancellation. Missing records are a no-op; avoid nested record locks and normalized-filename collisions. |
| [`2330218f3`](https://github.com/open-gsd/gsd-pi/commit/2330218f321657e55986beafdc367b27c71211de) | Continuous model output now requests rendering instead of repeatedly resetting a trailing debounce. | TUI coalescing remains authoritative. The follow-on R6 UI adaptation is now verified below; the large downstream controller tests are preserved. |
| [`00c730727`](https://github.com/open-gsd/gsd-pi/commit/00c730727d67b786ca6281f0c441a451269b90b6) | Browser daemon launcher exit no longer waits for stdout/stderr inherited by its surviving descendants. | Ignore stdout; private file-backed stderr with diagnostic reads capped to 4KiB, using the same descriptor and honoring short reads/cleanup. The capture file itself is not size-capped. |
| [`acc9f9ecb`](https://github.com/open-gsd/gsd-pi/commit/acc9f9ecb78eea0e281900a898da9e05ced87733) | Doctor stops incorrectly reporting healthy remotes unreachable. | Probe `HEAD` without `ls-remote -h`, which excludes symbolic HEAD. Regression uses a local bare remote. |

Reproductions before changes included resolved errors reported as success, missing
DB recreation, retry/blocker wedges, and zero render requests during one second
of continuous 10ms deltas. A daemon fixture with inherited output handles consumed
its 250ms timeout; ignored stdio completed in about 38ms. These are isolated
correctness/performance probes, not production latency claims.

## Follow-on full implementation goal

The operator subsequently approved all six recommended bundles. Track their
ordered implementation and requirement-level evidence in
[the active goal record](gsd-upstream-deferred-implementation.md). The original
deferral table below is historical review rationale, not permission to omit an
approved goal item.

R1 is now verified (244 combined tests and extension typecheck):

- [`e2448afef`](https://github.com/open-gsd/gsd-pi/commit/e2448afef1ec7a185639326b004379f6f34e9e46): preserve deterministic completion invocation failure and pause without creating completion artifacts or changing durable Attempt authority.
- [`0e165af3f`](https://github.com/open-gsd/gsd-pi/commit/0e165af3fe4b074350567a290e9fc7b2503fddb7): execute-task commit retries and telemetry use verification-retry, while plan/refine retain their policy.
- [`f8ac95307`](https://github.com/open-gsd/gsd-pi/commit/f8ac9530755d8d6fd5b2b8772c36fe76eaa71364): rejected claims register stable conflict identities and actionable recovery without relaxing leases or wedge acknowledgment.

R2 is verified (107 passing / 10 existing skipped combined tests and typecheck):

- [`277bb6b38`](https://github.com/open-gsd/gsd-pi/commit/277bb6b38de14de1574604160006663a62432529): DB snapshots no longer imply browser requirements; adapted explicit browser subjects, Markdown/soft-wrap and negation boundaries.
- [`dad224c8a`](https://github.com/open-gsd/gsd-pi/commit/dad224c8a84a48c18de9d27582d0b67411604180): PLAN blank separators remain byte-empty without changing nonempty content.

R3 is verified (runtime/transport 264/264, parser/recover 272/272, preserved
adoption 98/98, real process contention 4/4, plus typecheck):

- [`5cb9410a9`](https://github.com/open-gsd/gsd-pi/commit/5cb9410a9cff5141ed82e42034e5025e741da341): approved remediation resumes one successor; bounded captured-successor refresh retains abort/blocker/replay authority and stops unstable or missing successors.
- [`13cd6a00d`](https://github.com/open-gsd/gsd-pi/commit/13cd6a00d044d705baa87b7921f12078e075292e): parser-only current names and evidence-derived parents; unrelated Copilot and ignore-list hunks excluded.
- [`e34e7d7d0`](https://github.com/open-gsd/gsd-pi/commit/e34e7d7d0ef27a0381d7f16619fee5a4e4a78171) and [`87c424246`](https://github.com/open-gsd/gsd-pi/commit/87c424246c8b3c8a7f4037569cb82d8ae0f9f46a): non-task summaries remain preserved, contradictory identities remain unresolved. Downstream adds SUMMARY task-heading conflict checks. Sealed historical corpus bytes/digests remain unchanged while current-schema expectations are tested separately.

R4 is verified (core/runtime 98/98, independent isolation 9/9, interface/CLI
43/43 and MCP workflow/parity 84/84, plus typecheck; counters overlap):

- [`1af48f0d1`](https://github.com/open-gsd/gsd-pi/commit/1af48f0d15a89155f343ab0679fe41b4e4e58ddf): canonical snapshot available through native/MCP and a real CLI entry point, with complete counts, bounded collections/text and explicit truncation.
- [`f0c4ac525`](https://github.com/open-gsd/gsd-pi/commit/f0c4ac52535b8ae9ea9855a2772ef43838d68bac): no read-side migrations, queue or notification writes; one isolated read transaction replaces the upstream final mixed-retry fallback.
- [`59d5a3588`](https://github.com/open-gsd/gsd-pi/commit/59d5a3588127fb9c7c8c6b2384de7975ecfe1111): canonical project/handle/scope isolation preserves caller statements and same-project aliases without replacing global adapters. Different projects do not inherit session execution locks.

The [public snapshot contract](project-snapshot.md) records limits, error envelopes
and the auxiliary-file consistency boundary.

R5 is verified (loop/Agent/schema 75/75, parent source session/module/integration
52/52 and final independent persistent integration 6/6, plus package typechecks):

- [`5fbf5dca9`](https://github.com/open-gsd/gsd-pi/commit/5fbf5dca90642249b4b409b101b3f152798f2958): three output-limit continuations per loop, explicit zero-usage/source-attributed halts and one-overflow recovery. The downstream stop-before-prepare boundary, canonical history and provider cost survive; actual retained-assistant-tail recovery uses the existing follow-up queue. Existing schema-field notation limitations are not changed.

The [output-limit contract](output-limit-continuation.md) describes retry/cost
boundaries and the actual persistent-session tests.

R6 resource half is verified (60/60 adjacent and 7/7 independent tests):

- [`a05a682f5`](https://github.com/open-gsd/gsd-pi/commit/a05a682f585fdd3de7d44097ca27032afa2c5a5e): same-version mutable-bundle drift detection and pre-copy hash stamping, adapted with auto/live/bundled selection so immutable release packages retain the shipped-hash fast path. Actual between-copy and pre-stamp mutations converge; accepted ABA limitations and measured costs are in [managed-resource-sync.md](managed-resource-sync.md).

R6 UI is verified: 750/750 TUI/controller and 66/66 component tests pass. Default
Ctrl-O tool collapse was already correct; actual Ctrl-T exposed live-tool and
failed-rebuild view loss. Staged replay fixes those, including orphan thinking,
getter-only host properties, repeated IDs and rollback. Tall expanded tool status
moves to a footer to avoid offscreen elapsed metadata replaying the transcript.
The app WRITE-append fixture emits 924 bytes/no full repaint instead of 288,541
bytes/full repaint. No pi-tui runtime/history policy changed; 13 old test oracles
were aligned to its already-existing layout. See
[interactive-render-backports.md](interactive-render-backports.md).

## Initial review: already present, deferred, and out of scope

| Source/category | Disposition and reason |
| --- | --- |
| `9637bef85` / #2079 (`persist:false`) | Already imported through `a21357762283f5f535a8c48ac5ed5d9ce9f31a5f`; existing model-setting persistence regressions remain. Do not duplicate it or overwrite the current role policy. |
| `0f93a35cc` self-repairing bootstrap; catalog cost rounding | Downstream equivalents already exist, including verified lifecycle-script-free installation and more recent GPT cache-write pricing. |
| `5fbf5dca9` output-limit continuation | Missing, deferred: adds up to three extra model calls plus session/compaction event behavior. Requires a dedicated budget, abort and turn-boundary review. Do not import only half the continuation contract. |
| `5cb9410a9` finalize/recovery/remediation authorization | Missing, deferred: 18-file authority-sensitive change. Needs a dedicated Task Attempt/remediation test matrix. |
| `a05a682f5` live resource hashing on startup | Missing, deferred for immutable release packages. Here it adds 1,509 file reads / 13.7MB (about 49ms warm, 213ms first pass). Rebuilt release tarballs already update their shipped content hash; mutable development-bundle drift still needs explicit treatment. |
| Ctrl-O half of `2330218f3` | Deferred: the temporary `clearOnShrink` flag may be restored before deferred painting. Requires a real paint/shrink regression; avoid replacing the large existing controller tests. |
| `e2448afef`, `0e165af3f`, `f8ac95307` | Missing, next workflow candidates: schema-rejected completion pause, commit retry routing, rejected-claim liveness identity. Keep separate from the selected retry catch to review each authority boundary. |
| `277bb6b38` | Missing, next small candidate: distinguish database snapshots from browser evidence requirements. |
| `dad224c8a` | Missing, lower priority: whitespace-only PLAN projection lines. |
| Canonical project snapshot tool and follow-up DB-handle fixes (`1af48f0d1`, `f0c4ac525`, `59d5a3588`, related RPC/CLI) | Deferred as a complete feature; do not bring only the UI or query without its canonical read contract. |
| Legacy lifecycle adoption/recovery groups | Inventory reviewed, not merged wholesale. Downstream lineage and state-reconciliation fixes require semantic comparison before adoption. |
| Copilot/vendor catalog/provider expansion, Gemini/Cursor/Hermes/VS Code features | Outside the current Astra/Codex/GLM workflow, or already represented selectively. No broad catalog regeneration or optional runtime activation. |
| Windows native-lock change, release/CI metadata and dependency churn | Not selected for this macOS-arm64/Linux-x64 patch batch; no native rebuild or version bump implied. |

The remaining inventory is classified by scope, not claimed to have a full
line-by-line behavioral audit. Follow-up work must inspect actual downstream code
before labeling a patch missing; commit ancestry alone is insufficient for
selectively ported fixes.

## Repeatable maintenance

```sh
pnpm run audit:gsd-upstream
# Optional machine-readable report:
node scripts/audit-gsd-upstream.mjs
```

This manual tool uses bounded `git ls-remote` only. It does not fetch, switch
branches, edit metadata, install, create issues/PRs, or mutate upstream. Exit 0
means the observed tag/main match the record; 2 means review is required; 1 means
the query or metadata is invalid. `--no-fail` keeps the report but returns 0 for
changed refs. A moved tag with the same version is also detected. No automatic
runtime, installer or CI invocation is added.

When refs change:

1. Start from a clean focused downstream branch and retain the previous record.
2. Fetch main read-only and resolve the published tag to a full immutable commit.
   Do not replace an existing downstream tag with an upstream tag of the same name.
3. Compare from the recorded `reviewedMainCommit`; if ancestry changed, inspect the
   rewritten range explicitly rather than silently advancing the baseline.
4. Classify code as already equivalent, selected/adapted, deferred, or out of scope.
   Record source SHA, prerequisites, adaptations and tests for every selected fix.
5. Preserve GSD/Herdr authority, source revision binding, Astra/medium and GLM/Luna
   role settings, provider hooks, cache behavior and downstream distribution paths.
6. Run focused red/green tests and the affected regression/build gates. Record
   actual test counts and existing limitations; never infer a production win.
7. Update both this document and `scripts/gsd-upstream.json` after review. Do not
   change `forkBase` unless an actual reviewed full synchronization occurs. Do not
   change `scripts/pi-upstream.json` to pretend the Pi engine was vendored.
8. Keep commit/push, package/install and live-session restart as explicit handoffs.

## Verification log

Targeted source suites passed before integration: 221 workflow/DB/verification
tests, 100 tool/UAT/runtime tests, and 80 rendering/browser/doctor tests. Final
combined gates and any limitations are recorded in the current progress entry in
`docs/herdr-integration/PLANNING.md`. Counters can overlap between suites.

Initial eight-backport batch integrated checks: changed-source 214/214; model/phase/abort/TaskAttempt/
compaction/subagent/Herdr regression 189/189; UI/browser/doctor 80/80; agent-core
55/55; Herdr integration/boundary 31/31; audit parsers 12/12. Core build, extension
typecheck, Pi package boundary, patch allowlist and diff checks pass. Independent
review verified the exact refs, source SHAs, adaptations and deferred sections.
No package validation, installation, commit or push is claimed for that batch.

Completed R1–R6 follow-on gates: changed-source 875 passing / 10 existing skips /
zero failures (885 tests); full TUI/controller 750/750; full subagent/Local/Cmux/
Herdr/worker 170/170; loop/Agent/schema 75/75; role/effort/backend 118/118;
Herdr boundary/plugin 31/31. Core build, final extension typecheck, Pi boundary,
patch allowlist, audit metadata and diff checks pass. Independent SQLite,
process-contention, real CLI and persistent-session tests are detailed in
[the completed implementation record](gsd-upstream-deferred-implementation.md).
Counts overlap and are not one unique test total. New tests were also run
explicitly; changed-source selection alone does not discover untracked files.
The reviewed upstream refs and full-sync/vendor baselines remain unchanged.
No installation, commit or push was performed for the follow-on goal either.

This review does not modify user model preferences, running sessions, the project
database, remote installations, the abandoned App Server integration, or native
Codex experimental context management.
