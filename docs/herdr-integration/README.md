# Herdr Integration in the GSD Pi Downstream Fork

This directory is the canonical home for the Herdr integration plan, architecture, compatibility evidence, and operational documentation for `penggin/gsd-pi-herdr`.

The original planning work was started in `penggin/gsd-herdr`. On 2026-08-29 the project strategy changed: instead of treating GSD-Pi as an external package plus a minimal patch, this repository became the managed downstream GSD-Pi distribution. The useful planning history was migrated here and adapted to that model.

## Goal

Run GSD-Pi subagents in persistent Herdr-managed panes while preserving GSD's existing orchestration semantics.

The intended experience is:

```text
Workspace: project

Tab: GSD
┌────────────────────────────────────────────┐
│ Main GSD TUI                               │
│ M04 / S02 / T03 · executing               │
│ Workers: 3 running, 1 queued               │
└────────────────────────────────────────────┘

Tab: GSD Workers
┌──────────────────────┬──────────────────────┐
│ falcon / scout       │ cedar / researcher   │
│ WORKING              │ WORKING              │
│ → bash git diff      │ → read STATE.md      │
├──────────────────────┼──────────────────────┤
│ harbor / reviewer    │ spruce / security    │
│ RETRYING 2/3         │ QUEUED               │
└──────────────────────┴──────────────────────┘
```

Raw Pi/GSD JSONL remains available to the parent for result processing, but worker panes display only concise lifecycle and tool activity.

## Downstream architecture

```text
open-gsd/gsd-pi:main
        │
        │ regular upstream synchronization
        ▼
penggin/gsd-pi-herdr
        │
        ├── first-class Herdr integration extension/client
        ├── subagent execution backend abstraction
        │     ├── local
        │     ├── cmux
        │     └── herdr
        ├── internal Herdr worker runner
        └── fork-specific fixes and experiments
                 │
                 ▼
          official Herdr runtime
                 +
          optional Herdr plugin
```

Herdr itself remains unmodified unless a proven public API limitation requires a fork.

## Documentation

- [`PLANNING.md`](PLANNING.md) — canonical living plan and progress log.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — ownership boundaries and runtime flow.
- [`INTEGRATION_CONTRACT.md`](INTEGRATION_CONTRACT.md) — execution, state, artifact, and Herdr contracts.
- [`CONFIGURATION.md`](CONFIGURATION.md) — proposed user-facing settings.
- [`OPERATIONS.md`](OPERATIONS.md) — upstream sync, development, release, recovery, and runtime operations.
- [`SECURITY.md`](SECURITY.md) — secrets, environment, filesystem, process, and pane-authority safety.
- [`TESTING.md`](TESTING.md) — regression, parity, integration, failure-injection, and E2E strategy.
- [`UPSTREAM_MAINTENANCE.md`](UPSTREAM_MAINTENANCE.md) — managed-fork synchronization policy.
- [`DECISIONS.md`](DECISIONS.md) — architecture decision records.
- [`spikes/M0.6-GSD-PACKAGE-LOADING.md`](spikes/M0.6-GSD-PACKAGE-LOADING.md) — historical package-loading investigation from the pre-fork plan.
- [`spikes/M0.7-HERDR-API.md`](spikes/M0.7-HERDR-API.md) — exact Herdr v0.8.2 capability validation.

## Current state

The repository has been synchronized to upstream commit `4b26a642c0121ae6161abbb6f2dc6937c78874dd` before beginning the integrated Herdr work. The fork keeps `upstream-main` as a pristine synchronization target and `main` as the downstream integration line.

The separate `fix/cmux-split-cli` branch from the earlier investigation is retained independently and can be replayed or incorporated when the subagent backend refactor reaches cmux.

No Herdr production implementation is claimed complete yet. See `PLANNING.md` for the exact milestone state.
