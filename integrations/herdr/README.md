# GSD-Pi Herdr integration

Persistent, observable GSD-Pi subagents running in Herdr-managed panes.

> **Status:** planning corpus migrated into the managed downstream fork; architecture rebaseline is in progress. No production build is available yet.

This directory is the home of all Herdr-specific planning, documentation, plugin assets, worker-runtime code, and cross-runtime tests for `penggin/gsd-pi-herdr`.

## Why this fork exists

GSD-Pi already owns rich subagent semantics: single, parallel, and chained dispatch; retries; model and thinking overrides; context forking; isolated worktrees; result parsing; usage accounting; cancellation; and durable workflow state.

Herdr provides persistent terminal workspaces, panes, agent-aware state, detach/reattach, programmable pane control, and a public CLI/socket API.

The downstream fork combines them as a first-class runtime instead of constraining the implementation to a tiny out-of-tree patch.

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
        │ regular upstream synchronization
        ▼
penggin/gsd-pi-herdr
        ├─ unified subagent execution backend contract
        ├─ local backend
        ├─ cmux backend
        ├─ Herdr backend
        ├─ Herdr worker runner
        ├─ Herdr main-session state integration
        └─ downstream fixes and experiments

herdrdev/herdr
        └─ consumed through public plugin, CLI, and socket APIs
```

The fork may make broad but deliberate GSD-Pi improvements when they are useful to the downstream distribution. Herdr itself remains an external upstream unless a public API gap is proven.

## Directory plan

```text
integrations/herdr/
├── README.md
├── PLANNING.md
├── AGENTS.md
├── docs/
│   ├── ARCHITECTURE.md
│   ├── CONFIGURATION.md
│   ├── DECISIONS.md
│   ├── INTEGRATION_CONTRACT.md
│   ├── MIGRATION.md
│   ├── OPERATIONS.md
│   ├── SECURITY.md
│   ├── TESTING.md
│   ├── UPSTREAM_MAINTENANCE.md
│   └── spikes/
├── plugin/                 # Herdr plugin assets, added during implementation
├── worker/                 # worker-runner source, added during implementation
└── tests/                  # Herdr-specific integration and E2E fixtures
```

Core GSD runtime changes remain near the code they affect, principally under `src/resources/extensions/subagent/` and a future bundled Herdr extension. This directory owns the integration-facing assets and plan; it does not hide a second copy of GSD's subagent implementation.

## Planning and documentation

- [`PLANNING.md`](PLANNING.md) — canonical living plan and execution queue.
- [`AGENTS.md`](AGENTS.md) — scoped rules for agents working in this integration.
- [`docs/MIGRATION.md`](docs/MIGRATION.md) — source-repository migration and fork inspection record.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — ownership boundaries and runtime flow.
- [`docs/INTEGRATION_CONTRACT.md`](docs/INTEGRATION_CONTRACT.md) — backend, worker, state, and artifact contracts.
- [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md) — proposed GSD preferences and runtime defaults.
- [`docs/SECURITY.md`](docs/SECURITY.md) — trust boundaries and process/artifact requirements.
- [`docs/TESTING.md`](docs/TESTING.md) — parity, contract, failure-injection, and E2E strategy.
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — build, install, update, and recovery workflow.
- [`docs/UPSTREAM_MAINTENANCE.md`](docs/UPSTREAM_MAINTENANCE.md) — downstream synchronization policy.
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — accepted and superseded architectural decisions.

## Migration source

The initial planning corpus was developed in `penggin/gsd-herdr` and migrated from commit `d13fbe85ad584dd7505a5420d668c780ac137726`. That repository remains a read-only historical reference until this integration reaches a stable checkpoint.

## Non-goals for the first stable release

- Replacing GSD-Pi's workflow engine or duplicating its bundled subagent tool.
- Rendering a complete independent GSD TUI in every worker pane.
- Token-by-token worker output.
- Cross-host distributed execution.
- Windows support.
- Forking Herdr before a public API limitation is demonstrated.
