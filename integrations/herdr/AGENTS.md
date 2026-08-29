# Herdr Integration Agent Instructions

These instructions apply to every task under `integrations/herdr/` and to core GSD-Pi changes made for the Herdr runtime.

## Start of session

1. Read `integrations/herdr/PLANNING.md` completely.
2. Identify the current milestone, exact task IDs, dependencies, and exit criteria.
3. Read the linked documents under `integrations/herdr/docs/`.
4. Inspect the current GSD-Pi and Herdr sources instead of relying on a prior summary.
5. Confirm whether `upstream-main` has advanced and whether the active feature branch is based on the intended commit.

## Source-of-truth order

1. `integrations/herdr/PLANNING.md`
2. `integrations/herdr/docs/DECISIONS.md`
3. `integrations/herdr/docs/INTEGRATION_CONTRACT.md`
4. `integrations/herdr/docs/ARCHITECTURE.md`
5. other Herdr integration documents
6. code and tests

When documents conflict, stop and update the plan or ADR before continuing.

## Engineering constraints

- GSD remains authoritative for orchestration, retry, result parsing, usage, sessions, isolation, and merge decisions.
- Herdr owns panes, terminal persistence, focus, and visible runtime state.
- One backend contract must cover local, cmux, and Herdr execution.
- Do not copy the entire subagent tool into the Herdr integration.
- Keep JSON mode for child agents unless a separately approved protocol replaces it.
- Preserve raw JSONL as evidence, but never mirror token deltas directly into panes.
- Main-pane authority and worker-pane authority must be separate.
- A child must not inherit and reuse the main pane's Herdr identity.
- When monitoring is required, backend failure must be explicit and fatal before any ambiguous duplicate launch.
- All mutable state and final evidence must use versioned schemas.

## Testing requirements

Before marking a task complete, run the narrowest relevant upstream tests plus the integration tests required by `docs/TESTING.md`.

Changes to execution backends require, at minimum:

- local behavior regression coverage;
- cmux behavior regression coverage when affected;
- Herdr fake-client contract tests;
- local-vs-external result parity;
- cancellation/process-group tests;
- raw-JSON suppression checks;
- error/fallback tests.

## End of session

Update `integrations/herdr/PLANNING.md` with completed tasks, evidence, risks, decisions, upstream state, and the exact next action. Leave incomplete work unchecked and do not hide uncertainty.
