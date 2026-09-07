# Cache and workflow efficiency audit — 2026-09-07

## Scope and baseline

Continue `feature/gpt-provider-optimizations` from its current working tree,
including the prior GPT transport/accounting improvements and approved
Astra/medium migration. Preserve Astra/medium planning, GLM/max execution,
Luna/max fallbacks, verification gates, DB authority, session replacement,
secure artifacts and Herdr's four-pane limit.

The installed `gsd-audit-fix` source requires phase/UAT files which this fork does
not have (`query audit-uat` reports no phases directory). No artificial UAT or
parallel planning state was created. This audit uses current-code reproductions
and targeted red/green tests instead. No model/config change or paid benchmark is
needed to establish the reproduced issues.

## Findings

| ID | Finding and measured baseline | Classification |
| --- | --- | --- |
| CE-01 | Cache hit denominators omit writes: read 12K + write 3K displays 100%, not 80%. Silent/length-stop context-overflow detection also omits writes. | Clear accounting fix |
| CE-02 | Identical hidden context is removed at its old position and re-added later. A 2,643-byte fixture leaves only 1/4 prior items in the stable prefix without reducing request size. | Exact-equality deduplication fix |
| CE-03 | Unchanged protected source context moves behind new tool iterations. A 25,025-byte fixture is outside the reusable input prefix again. | Stateless user-turn anchoring, guarded by format tests |
| CE-04 | Safety and immediate execute-task checks repeat worktree classification. In 20 isolated iterations over 1,401 files/40 apps: 3,360 readdir + 80 Git calls; one classification requires 1,680 + 40. | Unit-local reuse, no cross-unit cache |
| CE-05 | Four busy panes plus 100 simultaneous queued reservations trigger 100 tab lists, pane lists, recovery scans and cleanup scans without allocating a slot. | Coalesce redundant drain scheduling |
| CE-06 | Real worker with a local fixture child: 200 rendered text lines cause 411 fsyncs, about 1,808ms in fsync and 2,303ms elapsed; empty fixture uses 11 fsyncs and about 72ms elapsed. | Batch activity-only durable updates, preserve lifecycle immediacy |

Times are local isolated observations, not production latency percentiles. Byte
prefix equality is a prerequisite for cache reuse, not proof of a provider cache
hit. OpenAI caches matching prefixes; tool ordering, instructions and relevant
settings can invalidate matching. Actual hit rates and cost depend on the provider
and request mix. [Official caching contract](https://developers.openai.com/api/docs/guides/prompt-caching).

## Correctness boundaries

- **Accounting:** reads are hits; writes and ordinary input are misses. Keep all
  three disjoint counters, totals, zero-input behavior and old records without a
  cache-write field. Pricing estimates are not subscription invoices.
- **Context deduplication:** compare complete outgoing items, not only the first
  text block. Keep the earlier copy only within the last uninterrupted run of
  equal context injections. A changed context, including A→B→A, remains latest-wins.
  Never mutate persisted transcript objects or drop different metadata/images.
- **Source block:** anchor only where a genuine user turn is recognized. Do not
  split assistant tool-call/output sequences. Unknown shapes fall back to the
  previous tail insertion. No process-global or cross-session cache is introduced;
  source changes are reflected immediately and still bypass display truncation.
- **Worktree:** reuse only inside one dispatch with the same root/identity.
  Missing paths, recovery and explicit refresh must not reuse stale classification.
  Keep both safety checks and discard the memo at unit completion.
- **Pane pool:** preserve FIFO/affinity, aborts, release wakeups during awaited
  reconciliation, pane loss and retained failures. Never allocate beyond four or
  retry ambiguously launched work locally.
- **Worker durability:** visible activity and raw artifact relay are not throttled.
  Coalesce only intermediate presentation evidence. Starting, blocked, resumed,
  cancellation and terminal transitions remain immediate, with final flush before
  immutable exit publication and pane reuse. Secure writers/fsync, containment,
  symlink rejection and final semantic authority remain unchanged.

## Deferred rather than inferred

- No cross-session shared prompt cache, blanket tool pruning, lower verification
  coverage, larger context window, dynamic model routing or forced Fast mode.
- No proxy-specific explicit cache breakpoints or native Codex experimental
  context-management enablement without a separate compatibility canary.
- Duplicate queue setup in DB state derivation measured only small absolute cost;
  it is not changed in this pass to avoid unnecessary state-path refactoring.
- Existing independent package registry test failures remain separate; do not
  weaken credential command restrictions to make those fixtures pass.

Final counters, regression gates, durability bound and operational handoff are
recorded in `docs/herdr-integration/PLANNING.md` after implementation and review.

Test hygiene follow-up: several legacy auto-model-selection cases created a
temporary project but inherited the operator's global GSD preferences. The
Astra/medium migration exposed high-effort expectations that had previously passed
accidentally. Isolate test homes rather than modifying production precedence or
the operator's model settings.

## After implementation: same-fixture evidence

| Surface | Before | After |
| --- | --- | --- |
| Mixed cache read/write hit rate | 100% for 12K reads + 3K writes | 80% |
| Identical hidden context: matching prior input prefix | 86 / 2,965 bytes | 2,965 / 2,965 bytes |
| Unchanged source: matching prior input prefix | 160 / 26,455 bytes | 26,455 / 26,455 bytes |
| Worktree classification, 30 alternating fixture samples | 5,040 directory reads / 120 Git calls; median 88.34ms, p95 109.46ms | 2,520 reads / 60 Git calls; median 43.27ms, p95 54.28ms |
| 100 queued reservations behind four leased panes | 100 tab/pane/recovery/cleanup passes each | 1 pass each |
| Worker 200 complete text lines | 411 fsyncs; 1,807.8ms in fsync; 2,302.8ms total | 11 fsyncs; 40.0ms in fsync; 76.2ms total |

The source-prefix comparison uses the same updated snapshot wording in both
arms. It preserves request sizes and excludes any alleged token savings from
changed wording. The worker samples preserve all raw lines and projected activity;
its intermediate durable snapshot can lag nominally 250ms (or a shorter configured
heartbeat), assuming the event loop and filesystem can run. Lifecycle/final writes
are immediate and a failed final durable write is not reported as success.

Cross-review caught an ambiguous real user message beginning `Ran \`...\``;
source anchoring now requires a complete sole-text shell-result wrapper before
skipping it, otherwise retaining conservative tail placement. The source block
explicitly describes latest available recorded observations, including mutations,
not a newly read filesystem snapshot. Later historical results may be older.
No new global context memo or source-observation authority was introduced.

## Final verification

- Changed-source compiled tests: 387 passed.
- Combined role/effort, safety, metrics, compaction and complete backend/worker
  regression: 244 passed.
- Pi AI provider/cache/accounting tests: 228 passed, 4 skipped.
- Herdr integration/plugin/capability checks: 30 passed.
- Focused model registry: 72 passed, 33 excluded; previous unrelated full-suite
  failures remain documented in the living plan.
- Core build, extension typecheck, migration utility 16 tests, and diff check pass.

Totals overlap. This is a verified source/build change, not an installed-runtime
or production-billing result. No global/remote installation, live pane restart,
paid model benchmark, commit or push was performed in this optimization turn.
