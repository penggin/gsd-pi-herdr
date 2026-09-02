# Pi upstream audit — 2026-09-02

## Baseline

- Downstream vendored baseline: `earendil-works/pi` `v0.75.5`
- Latest reviewed upstream release: `v0.84.4` (`b79e4cc`)
- Compared packages: `agent`, `ai`, `tui`, and `coding-agent`
- Raw delta: 971 files, 117,628 insertions, and 39,805 deletions

The gap is too large for an unreviewed vendor replacement. The downstream
overlay includes GSD-owned provider, model, extension, TUI, and runtime seams,
and upstream introduced breaking extension, provider/model, schema, and session
APIs during this interval. Imports must therefore be staged and verified rather
than applied as a single version bump.

## Recommended imports

### Priority 1 — focused compatibility backports

1. **UI prompt lifecycle events (`v0.84.4`)**
   - Import `ui_prompt_start` and `ui_prompt_end` so Herdr can distinguish agent
     work from time waiting for user input without inferring that state from
     rendered text.
   - Replace the custom question-detection seam only after event parity tests
     cover prompts, cancellation, and nested UI calls.
2. **Extension message ordering repair (`v0.84.4`)**
   - Defer `triggerTurn: false` extension messages until tool results have been
     appended. This prevents strict providers from rejecting replay histories
     containing an extension message between a tool call and its result.
3. **Resumed JSONL trailing-newline repair (`v0.84.4`)**
   - Prevent the next session entry from corrupting a resumed JSONL file that
     does not end in a newline.
4. **Compaction observability and retry (`v0.81.1`, `v0.84.3`)**
   - Reuse the configured transient retry policy for compaction and branch
     summaries.
   - Surface `session_compact_failed` with reason, retry state, source, and
     error details for GSD/Herdr status reporting.
5. **Pre-prompt auto-compaction (`v0.84.4`)**
   - Compact after a large tool result crosses the threshold and before the
     next assistant request. This directly reduces peak context and avoids
     paying for a doomed oversized request.
   - Treat this as a medium-risk backport because GSD also owns compaction and
     provider routing extensions.
6. **Large-session streaming reads (`v0.78.1`)**
   - Read large JSONL sessions line-by-line instead of materializing the entire
     file. This is a likely improvement for long-run memory pressure and
     phase-transition latency.
7. **Timeout and shutdown hardening (`v0.77.0` onward)**
   - Carry over missing early-stream/socket timeout classifications and ensure
     retry waits honor abort signals.
   - Reconcile upstream signal disposal and `session_shutdown` behavior with
     the existing Herdr shutdown path instead of duplicating it.
8. **Z.AI GLM-5.3 reasoning metadata (`v0.84.3`)**
   - Import the missing low/high/max reasoning-effort metadata after comparing
     it with downstream OpenCodex model discovery and overrides.

### Priority 2 — staged infrastructure migration

- Extension event/tool-registry changes introduced around `v0.77`, including
  event renames and dynamic tool updates.
- Provider/model-store and routing-affinity changes introduced around `v0.80`.
- Startup improvements from lazy extension transpilation, lazy syntax grammar
  loading, and bundled entrypoints in `v0.84.3`.
- Nested `.agents/skills/` discovery and skill-health diagnostic fixes from
  `v0.84.3`, reconciled with GSD's Assessment Gate metadata rules.

These should land as compatibility slices with downstream adapters and focused
tests, not as isolated cherry-picks that leave two competing APIs.

### Priority 3 — separate major migration

- The `v0.84` agent harness/session-v4 architecture.
- The TypeBox upgrade and removed schema APIs.
- Broad AI provider directory and abort-contract reorganization.

This work needs an explicit migration plan and a clean integration branch. It
should not be mixed with Herdr live-E2E fixes or Assessment Gate delivery.

## Suggested sequence

1. Backport UI prompt lifecycle events and switch Herdr blocked-state reporting
   to those events behind parity tests.
2. Backport extension message ordering and JSONL newline repair.
3. Add compaction retry/failure events, then pre-prompt compaction with OpenAI
   Codex/OpenCodex/plain-provider regression coverage.
4. Import large-session streaming reads and benchmark startup/resume memory.
5. Evaluate a baseline uplift to `v0.79.x`, then cross the `v0.80` provider and
   model-store boundary as a dedicated migration.
6. Reassess the full `v0.84.4` harness/session migration only after the above
   seams converge.

## Verification and limitations

- The official repository and release tags were accessed read-only.
- No upstream code was imported and `scripts/pi-upstream.json` remains pinned
  to `v0.75.5`.
- The current tree contains no `ui_prompt_start`, `ui_prompt_end`, or
  `session_compact_failed` symbol, so those candidates are not already present
  under their upstream API names.
- Existing downstream implementations may already cover portions of shutdown,
  timeout, and compaction behavior. Each import must begin with a semantic
  comparison and characterization test to avoid regressing GSD authority.
