# Agent Instructions for the GSD Pi Herdr Fork

This repository is the self-contained `penggin/gsd-pi-herdr` distribution with first-class Herdr integration.

## Source-of-truth order

1. Current downstream code and tests are the implementation baseline.
2. `docs/herdr-integration/PLANNING.md` is the canonical plan for Herdr-specific work.
3. `docs/herdr-integration/DECISIONS.md` records accepted downstream architecture decisions.
4. `docs/herdr-integration/INTEGRATION_CONTRACT.md` defines cross-component behavior and serialized boundaries.
5. Code and tests become authoritative for implemented behavior.

## Start of every Herdr-integration session

Before editing Herdr-related code or documentation:

1. Read `docs/herdr-integration/PLANNING.md`.
2. Identify the active milestone, exact task IDs, prerequisites, and exit criteria.
3. Read the relevant design documents in `docs/herdr-integration/`.
4. Inspect the current downstream code paths rather than relying on an old summary.
5. When Herdr behavior is involved, validate against the actual supported Herdr schema/docs for the pinned version.

## End of every Herdr-integration session

Before ending the session:

1. Run focused tests for the modified surface.
2. Run parity/regression tests when touching subagent execution.
3. Update `docs/herdr-integration/PLANNING.md` with completed tasks, new risks, decisions, test evidence, and the exact next task.
4. Update `DECISIONS.md` when an architectural constraint changes.
5. Review the final diff for accidental upstream changes.

## Downstream repository policy

- `main` is the downstream integration/release line; feature work stays on focused branches until reviewed.
- Do not fetch, pull, push, open issues, create PRs, publish, or otherwise make network requests against the original source project.
- Source lineage is historical metadata only. Any future source import requires explicit user authorization and a new decision record.
- Runtime, CI, release, installer, documentation, and support links must target `penggin/gsd-pi-herdr` or remain local.
- Prefer normal abstractions over tiny patch seams when the downstream architecture benefits from a proper refactor.
- Preserve inherited behavior unless a downstream decision explicitly changes it, and run the relevant regression matrix for every intentional change.

## Herdr integration invariants

- GSD remains authoritative for subagent orchestration, retries, context/fork semantics, isolation, result parsing, usage accounting, and final success/failure decisions.
- Herdr owns pane/session persistence, terminal layout, visible worker state, input forwarding, and detach/reattach behavior.
- Raw JSONL and token deltas must not be dumped directly into worker panes.
- Main-pane authority and worker-pane authority must never overwrite one another.
- When monitored execution is required, a failed Herdr launch must fail visibly rather than silently spawning an unmonitored local worker.
- The first stable target is macOS arm64; avoid unnecessary platform coupling where practical.
