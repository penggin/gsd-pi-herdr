# Agent Instructions for the GSD Pi Herdr Fork

This repository is a managed downstream fork of `open-gsd/gsd-pi` with first-class Herdr integration work.

## Source-of-truth order

1. Upstream GSD-Pi behavior and tests remain the baseline unless this fork intentionally overrides them.
2. `docs/herdr-integration/PLANNING.md` is the canonical plan for Herdr-specific work.
3. `docs/herdr-integration/DECISIONS.md` records accepted downstream architecture decisions.
4. `docs/herdr-integration/INTEGRATION_CONTRACT.md` defines cross-component behavior and serialized boundaries.
5. Code and tests become authoritative for implemented behavior.

## Start of every Herdr-integration session

Before editing Herdr-related code or documentation:

1. Read `docs/herdr-integration/PLANNING.md`.
2. Identify the active milestone, exact task IDs, prerequisites, and exit criteria.
3. Read the relevant design documents in `docs/herdr-integration/`.
4. Inspect the current upstream and downstream code paths rather than relying on an old summary.
5. When Herdr behavior is involved, validate against the actual supported Herdr schema/docs for the pinned version.

## End of every Herdr-integration session

Before ending the session:

1. Run focused tests for the modified surface.
2. Run parity/regression tests when touching subagent execution.
3. Update `docs/herdr-integration/PLANNING.md` with completed tasks, new risks, decisions, test evidence, and the exact next task.
4. Update `DECISIONS.md` when an architectural constraint changes.
5. Review the final diff for accidental upstream changes.

## Downstream fork policy

- `upstream-main` is the pristine mirror target for `open-gsd/gsd-pi:main`.
- `main` is the downstream integration branch and may contain deliberate Herdr features, fixes, and other fork-specific improvements.
- Keep custom commits focused and clearly labeled so upstream synchronization remains understandable.
- Prefer normal abstractions over tiny patch seams when the downstream architecture benefits from a proper refactor.
- Do not mechanically resolve semantic conflicts. Re-evaluate affected behavior and run the relevant test matrix.
- Preserve upstream-compatible behavior unless a downstream decision explicitly changes it.

## Herdr integration invariants

- GSD remains authoritative for subagent orchestration, retries, context/fork semantics, isolation, result parsing, usage accounting, and final success/failure decisions.
- Herdr owns pane/session persistence, terminal layout, visible worker state, input forwarding, and detach/reattach behavior.
- Raw JSONL and token deltas must not be dumped directly into worker panes.
- Main-pane authority and worker-pane authority must never overwrite one another.
- When monitored execution is required, a failed Herdr launch must fail visibly rather than silently spawning an unmonitored local worker.
- The first stable target is macOS arm64; avoid unnecessary platform coupling where practical.
