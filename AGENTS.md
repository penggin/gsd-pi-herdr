# Downstream Fork Instructions

This repository is a managed downstream distribution of `open-gsd/gsd-pi` with a first-class Herdr runtime integration.

## Source-of-truth rules

- Upstream GSD-Pi remains `open-gsd/gsd-pi`.
- The exact upstream mirror is maintained on `upstream-main`.
- Downstream product work lands on `main` through focused feature branches.
- Herdr integration planning is canonical in `integrations/herdr/PLANNING.md`.
- Herdr-specific architecture decisions are recorded in `integrations/herdr/docs/DECISIONS.md`.

## Mandatory protocol for Herdr work

Before changing any of the following areas, read `integrations/herdr/PLANNING.md` completely:

- `integrations/herdr/**`
- `src/resources/extensions/subagent/**`
- `src/resources/extensions/cmux/**`
- any new Herdr extension, provider, runtime, worker, pane, or process code
- package/build/release files changed to ship the Herdr integration

Then read the linked architecture, contract, security, and testing documents for the active task.

At the end of every Herdr development session, update `integrations/herdr/PLANNING.md` with:

- completed and incomplete task IDs;
- decisions or newly discovered constraints;
- tests and evidence;
- upstream sync state;
- exact next action.

Do not claim a milestone is complete without evidence for each exit criterion.

## Downstream change discipline

- Keep upstream merge commits distinguishable from downstream feature commits.
- Prefer a coherent in-tree abstraction over a fragile patch-size optimization.
- Preserve GSD-Pi's orchestration semantics unless the plan explicitly approves a behavior change.
- Do not duplicate the bundled `subagent` implementation.
- Keep local, cmux, and Herdr execution paths behind one tested backend contract.
- Do not silently fall back to an unmonitored local worker when monitored execution is required.
- Do not print raw JSONL or token deltas in worker panes.
- Treat spawning, signals, environment transfer, artifacts, cleanup, and pane authority as security-sensitive.
- Keep Herdr core external and unmodified until a documented public-API limitation is reproduced.

## Upstream sync protocol

1. Move `upstream-main` only to a verified `open-gsd/gsd-pi` commit.
2. Review upstream changes affecting subagents, extensions, packaging, process control, sessions, isolation, or cmux.
3. Merge the mirror into a downstream integration branch before `main`.
4. Resolve semantic conflicts, not just textual conflicts.
5. Run the affected upstream tests and the Herdr result-parity/E2E suite.
6. Record the sync in `integrations/herdr/PLANNING.md`.

The existing `fix/cmux-split-cli` branch is preserved as historical downstream work and must be rebased or reimplemented against the current backend abstraction rather than merged blindly.
