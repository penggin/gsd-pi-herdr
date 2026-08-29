# GSD-Pi Herdr integration

Persistent, observable GSD-Pi subagents running in Herdr-managed panes.

> **Status:** M0 architecture and feasibility planning is complete. M1 implementation is ready to begin; no production Herdr-enabled build is available yet.

This directory is the canonical home of Herdr-specific planning, architecture, plugin assets, compatibility evidence, operations guidance, and cross-runtime tests for `penggin/gsd-pi-herdr`.

## Why this downstream fork exists

GSD-Pi already owns rich subagent semantics:

- single, parallel, and chained dispatch;
- background work, status, and resume;
- retries and concurrency limits;
- model and thinking overrides;
- fresh and forked context;
- isolated worktrees and merge handling;
- JSON event parsing, usage accounting, and error classification;
- cancellation and durable run status.

Herdr provides persistent terminal workspaces, panes, agent-aware state, detach/reattach, process inspection, layouts, input/output control, and a public CLI/socket/plugin surface.

This fork combines them as a first-class runtime. It does not copy the bundled `subagent` tool and does not currently fork Herdr.

## Target experience

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

Raw Pi JSONL remains available to the GSD parent for structured result processing. Worker panes show bounded, human-readable lifecycle and tool activity rather than token-level JSON events.

## Repository strategy

```text
open-gsd/gsd-pi
        │
        │ reviewed upstream synchronization
        ▼
penggin/gsd-pi-herdr
        ├─ unified subagent execution contract
        ├─ local backend
        ├─ normalized cmux backend
        ├─ Herdr backend
        ├─ root Herdr session integration
        ├─ @gsd/herdr-runtime worker package
        └─ downstream fixes and experiments

herdrdev/herdr
        └─ consumed through public plugin, CLI, and socket APIs
```

The exact upstream mirror is maintained on `upstream-main`. Downstream changes are staged on focused feature/sync branches before reaching `main`.

## Final component placement

```text
src/resources/extensions/subagent/execution/
  backend contract, collector, selector, local/cmux/Herdr adapters

src/resources/extensions/herdr/
  root-session state, preferences, diagnostics

packages/herdr-runtime/
  typed Herdr client, capability checks, schemas, worker executable

integrations/herdr/
  plan, ADRs, plugin assets, compatibility fixtures, real-Herdr E2E
```

The existing GSD run store remains semantic authority. The Herdr runtime store contains protected process evidence such as JSONL, stderr, heartbeats, and exit artifacts.

## M0 conclusions

- `penggin/gsd-pi-herdr` is the managed downstream distribution.
- The fork was synchronized to upstream commit `4b26a642c0121ae6161abbb6f2dc6937c78874dd` before migration.
- Herdr `v0.8.2` protocol 20 already exposes the public capabilities needed for the initial runtime.
- Herdr compatibility is capability-based; current protocol 21 is canary coverage.
- Fresh worker layouts should prefer schema-backed `layout.apply` command arrays.
- Local and cmux execution currently duplicate result semantics and must be unified before Herdr execution is added.
- Current cmux still uses obsolete commands and raw JSON `tee` output.
- Historical cmux commit `5b74d301...` is not merged directly; its valid command changes will be reimplemented under the shared backend.
- Shared Herdr infrastructure and the worker binary belong in private workspace package `@gsd/herdr-runtime`.
- Deterministic local old-vs-new result parity is the gate before any external backend port.

## Documentation

### Canonical plan and architecture

- [`PLANNING.md`](PLANNING.md) — milestone status, execution queue, risks, decisions, and progress log.
- [`AGENTS.md`](AGENTS.md) — mandatory workflow for agents working on the integration.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — final runtime ownership, flow, persistence, and recovery architecture.
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — accepted, proposed, and superseded ADRs.
- [`docs/INTEGRATION_CONTRACT.md`](docs/INTEGRATION_CONTRACT.md) — backend, Herdr capability, worker, state, and artifact contracts.

### Operations and quality

- [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md) — proposed GSD preference model and fallback rules.
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — branch, build, canary, rollback, and runtime operations.
- [`docs/SECURITY.md`](docs/SECURITY.md) — environment, process, socket, path, redaction, and cleanup requirements.
- [`docs/TESTING.md`](docs/TESTING.md) — result parity, contract, failure injection, and E2E strategy.
- [`docs/UPSTREAM_MAINTENANCE.md`](docs/UPSTREAM_MAINTENANCE.md) — semantic upstream-sync and downstream-release policy.
- [`docs/MIGRATION.md`](docs/MIGRATION.md) — planning migration and initial fork baseline.

### M0 technical evidence

- [`docs/spikes/M0.6-GSD-PACKAGE-LOADING.md`](docs/spikes/M0.6-GSD-PACKAGE-LOADING.md) — historical released-package loading analysis.
- [`docs/spikes/M0.6-HERDR-API-CAPABILITIES.md`](docs/spikes/M0.6-HERDR-API-CAPABILITIES.md) — Herdr protocol 20/21 capability validation.
- [`docs/spikes/M0.7-GSD-EXECUTION-AUDIT.md`](docs/spikes/M0.7-GSD-EXECUTION-AUDIT.md) — current subagent, cmux, persistence, packaging, and test audit.
- [`docs/spikes/M0.8-CODE-PLACEMENT.md`](docs/spikes/M0.8-CODE-PLACEMENT.md) — final module/package ownership.
- [`docs/spikes/M0.9-CMUX-MIGRATION.md`](docs/spikes/M0.9-CMUX-MIGRATION.md) — historical cmux branch migration decision.
- [`docs/spikes/M0.10-CONSOLIDATED-TECHNICAL-PLAN.md`](docs/spikes/M0.10-CONSOLIDATED-TECHNICAL-PLAN.md) — implementation slices, gates, risks, and estimates.

## Next implementation checkpoint

M1 begins with a new focused branch, `feature/herdr-runtime-foundation`.

Initial work order:

1. scaffold private, linkable `packages/herdr-runtime`;
2. add protocol 20 and 21 capability fixtures;
3. add a minimal typed Herdr request client and worker executable stub;
4. add root build/test/package inclusion;
5. define the backend-neutral execution contract and result collector;
6. port local execution and prove deterministic result parity before cmux or Herdr external execution.

## Current limitations

M0 was a repository, schema, source, release, packaging, and test-structure investigation. It did not execute:

```text
GSD dependency installation or build
existing GSD test suites
Herdr v0.8.2 binary/socket operations
real cmux operations
pane launch, signal delivery, or detach/reattach
```

Those are explicit implementation and promotion gates.

## Historical source

The initial planning corpus was developed in `penggin/gsd-herdr` and migrated from commit `d13fbe85ad584dd7505a5420d668c780ac137726`. That repository should remain available as a read-only historical reference until this integration reaches a stable checkpoint.
