# Herdr Integration Architecture Decisions

Statuses are `Proposed`, `Accepted`, `Superseded`, or `Rejected`. Preserve superseded entries so future maintainers understand why the design changed.

## ADR-H001 — Manage GSD-Pi as a downstream distribution

**Status:** Accepted  
**Date:** 2026-08-29

### Decision

Use `penggin/gsd-pi-herdr` as the owned runtime distribution and synchronize it regularly with `open-gsd/gsd-pi`.

Do not constrain necessary GSD changes to a tiny external patch solely to avoid fork maintenance. Prefer a coherent in-tree design with strong tests.

### Consequences

- first-class refactors and custom fixes are allowed;
- upstream merge discipline and semantic regression tests become permanent responsibilities;
- distribution naming, release, and rollback must be defined;
- integration code can use normal GSD package boundaries instead of a fragile overlay.

### Supersedes

The original standalone decision to keep GSD-Pi unchanged except for a minimal patch seam.

## ADR-H002 — Keep Herdr external initially

**Status:** Accepted

Herdr already exposes pane, agent-state, metadata, session-snapshot, input, output, and plugin surfaces. Use those public APIs. Fork Herdr only after a required behavior is reproduced as impossible or unsafe through public interfaces.

## ADR-H003 — Unify subagent execution backends

**Status:** Accepted

Refactor GSD's child execution behind one internal `SubagentExecutionBackend` contract. Local, cmux, and Herdr implementations receive the same prepared launch plan and feed the same parser/finalizer.

Rejected alternatives:

- copying the bundled subagent tool into a Herdr extension;
- maintaining a Herdr-only parallel executor;
- continuing separate local/cmux code paths with duplicated finalization.

## ADR-H004 — GSD remains authoritative

**Status:** Accepted

Backends cannot decide task success, retry policy, usage, context, worktree merge, or final response meaning. They execute and transport; GSD interprets.

## ADR-H005 — Preserve JSON-mode children

**Status:** Accepted

Continue to run the child with the existing JSON mode so GSD receives structured messages, tool events, usage, errors, and model metadata.

## ADR-H006 — Filter terminal output

**Status:** Accepted

Preserve complete raw JSONL as protected evidence but render only bounded lifecycle, tool, retry, blocked, and final-status activity. Never stream token-delta JSON into a pane.

## ADR-H007 — Use a dedicated worker runner

**Status:** Accepted

Launch a fixed Node-based worker process in Herdr panes. It validates a versioned launch artifact and spawns the GSD child with argv arrays and `shell: false`.

## ADR-H008 — Separate authority domains

**Status:** Accepted

The root TUI extension reports the main pane. The worker runner reports its own pane. `ctx.mode === "tui"` and `GSD_SUBAGENT_CHILD !== "1"` protect root authority; inherited Herdr variables are replaced for workers.

## ADR-H009 — Monitoring failure is fatal by default

**Status:** Accepted

When Herdr monitoring is configured as required, inability to establish a known worker execution fails the dispatch. Local fallback is opt-in and allowed only before any external launch could have occurred.

## ADR-H010 — Maintain an exact upstream mirror branch

**Status:** Accepted

`upstream-main` points to a reviewed upstream commit without downstream changes. `main` is the downstream release line. Upstream merges are staged and tested before reaching `main`.

## ADR-H011 — Preserve and normalize cmux

**Status:** Accepted

Cmux remains supported as another execution backend. The existing stale-CLI fix is reviewed and reimplemented under the shared backend contract rather than treated as unrelated disposable work.

## ADR-H012 — Use durable, versioned evidence

**Status:** Accepted

Launch, state, heartbeat, stdout, stderr, and exit artifacts use explicit schemas and protected paths. Final evidence is written atomically and is not inferred from terminal output.

## ADR-H013 — Use a bounded worker pool

**Status:** Proposed

Associate one four-pane worker pool with each root GSD session. Validate layout, queueing, retention, and multi-session behavior before acceptance in M4.

## ADR-H014 — Target macOS arm64 first

**Status:** Accepted

The first stable downstream release targets macOS arm64. Keep platform-specific signal and path behavior isolated for future Linux/Windows support.

## ADR-H015 — Migrate planning into `integrations/herdr/`

**Status:** Accepted

Keep all Herdr planning, plugin assets, runner assets, and cross-runtime documentation in one integration directory. Core runtime changes remain in their natural GSD source locations and are linked from the plan.

## Historical decisions retained from `penggin/gsd-herdr`

The following findings remain active even though the repository topology changed:

- Herdr should be validated by actual capabilities, not a version string alone.
- child JSON mode is required for result parity;
- raw JSON terminal mirroring is a defect;
- silent unmonitored fallback is unsafe;
- main and child Herdr state must not share authority;
- process, artifact, environment, and cleanup behavior require security tests.

The previous package-overlay decision is now historical. Because this repository owns the full GSD source and build, production resource overlaying is unnecessary for the primary distribution path.
