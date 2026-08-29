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
**Date:** 2026-08-29

Herdr already exposes pane, agent-state, metadata, session-snapshot, input, output, process-inspection, event, and plugin surfaces. Use those public APIs. Fork Herdr only after a required behavior is reproduced as impossible or unsafe through public interfaces.

## ADR-H003 — Unify subagent execution backends

**Status:** Accepted  
**Date:** 2026-08-29

Refactor GSD's child execution behind one internal `SubagentExecutionBackend` contract. Local, cmux, and Herdr implementations receive the same prepared launch plan and feed the same parser/finalizer.

Rejected alternatives:

- copying the bundled subagent tool into a Herdr extension;
- maintaining a Herdr-only parallel executor;
- continuing separate local/cmux code paths with duplicated finalization.

## ADR-H004 — GSD remains authoritative

**Status:** Accepted  
**Date:** 2026-08-29

Backends cannot decide task success, retry policy, usage, context, worktree merge, or final response meaning. They execute and transport; GSD interprets.

## ADR-H005 — Preserve JSON-mode children

**Status:** Accepted  
**Date:** 2026-08-29

Continue to run the child with the existing JSON mode so GSD receives structured messages, tool events, usage, errors, and model metadata.

## ADR-H006 — Filter terminal output

**Status:** Accepted  
**Date:** 2026-08-29

Preserve complete raw JSONL as protected evidence but render only bounded lifecycle, tool, retry, blocked, and final-status activity. Never stream token-delta JSON into a pane.

## ADR-H007 — Use a dedicated worker runner

**Status:** Accepted  
**Date:** 2026-08-29

Launch a fixed Node-based worker process in Herdr panes. It validates a versioned launch artifact and spawns the GSD child with argv arrays and `shell: false`.

## ADR-H008 — Separate authority domains

**Status:** Accepted  
**Date:** 2026-08-29

The root TUI extension reports the main pane. The worker runner reports its own pane. `ctx.mode === "tui"` and `GSD_SUBAGENT_CHILD !== "1"` protect root authority; inherited Herdr variables are replaced for workers.

## ADR-H009 — Monitoring failure is fatal by default

**Status:** Accepted  
**Date:** 2026-08-29

When Herdr monitoring is configured as required, inability to establish a known worker execution fails the dispatch. Local fallback is opt-in and allowed only before any external launch could have occurred.

## ADR-H010 — Maintain an exact upstream mirror branch

**Status:** Accepted  
**Date:** 2026-08-29

`upstream-main` points to a reviewed upstream commit without downstream changes. `main` is the downstream release line. Upstream merges are staged and tested before reaching `main`.

## ADR-H011 — Preserve and normalize cmux

**Status:** Accepted  
**Date:** 2026-08-29

Cmux remains supported as another execution backend. The existing stale-CLI fix is reviewed and reimplemented under the shared backend contract rather than treated as unrelated disposable work.

## ADR-H012 — Use durable, versioned evidence

**Status:** Accepted  
**Date:** 2026-08-29

Launch, state, heartbeat, stdout, stderr, and exit artifacts use explicit schemas and protected paths. Final evidence is written atomically and is not inferred from terminal output.

## ADR-H013 — Use a bounded worker pool

**Status:** Proposed  
**Date:** 2026-08-29

Associate one four-pane worker pool with each root GSD session. Validate layout, queueing, retention, and multi-session behavior before acceptance in M4.

## ADR-H014 — Target macOS arm64 first

**Status:** Accepted  
**Date:** 2026-08-29

The first stable downstream release targets macOS arm64. Keep platform-specific signal and path behavior isolated for future Linux/Windows support.

## ADR-H015 — Migrate planning into `integrations/herdr/`

**Status:** Accepted  
**Date:** 2026-08-29

Keep all Herdr planning, plugin assets, runner assets, and cross-runtime documentation in one integration directory. Core runtime changes remain in their natural GSD source locations and are linked from the plan.

## ADR-H016 — Support Herdr by capability set, with protocol 20 as the stable baseline

**Status:** Accepted  
**Date:** 2026-08-29

### Context

The validated Herdr `v0.8.2` schema uses protocol `20`; current `master` uses protocol `21`. Protocol 20 already includes the pane, layout, snapshot, event, process, state-reporting, and plugin operations required for the initial runtime.

Requiring one exact protocol number would incorrectly reject compatible installations and bind the integration to unrelated additive API evolution.

### Decision

- The first stable baseline is Herdr `v0.8.2`, protocol `20`.
- Compatibility is expressed as named method/shape capability sets.
- Startup records version and protocol for diagnostics but gates on actual required operations.
- Additive unknown fields are tolerated.
- Missing required methods or incompatible request/response shapes fail closed.
- Current protocol 21 is tested as a canary, not required by the first stable release.

### Consequences

- official `v0.8.2` remains a valid target;
- compatibility tooling must parse schemas or execute equivalent probes;
- contract fixtures are maintained for stable and current upstream schemas;
- version numbers alone never constitute runtime support evidence.

## ADR-H017 — Prefer `layout.apply` for deterministic worker creation

**Status:** Accepted  
**Date:** 2026-08-29

### Context

The validated schema supports `layout.apply` with pane nodes containing argv command arrays, cwd, environment, label, and IDs. It also supports `pane.split`, but split requests do not contain a command array.

Herdr's documented `herdr pane run` command is a CLI convenience and is not a raw socket method in protocol 20 or 21.

### Decision

- Use `layout.apply` as the preferred strategy for initial one-, two-, and four-pane worker-tab creation.
- Use `pane.split` for incremental growth, repair, or compatibility.
- When split-created panes require command delivery, invoke only a fixed worker runner with a protected artifact path through a validated input path.
- Do not declare or send a raw `pane.run` socket request.
- A separate CLI adapter may use `herdr pane run` only with dedicated compatibility and output-parsing tests.
- Do not use `agent.start` as the correctness path for the headless GSD worker runner.

### Consequences

- fresh worker layouts can be created with argv-based commands and authoritative returned IDs;
- live worker tabs must never be replaced by `layout.apply` without explicit safety checks;
- both declarative layout creation and incremental repair paths require tests;
- documentation and code must distinguish raw methods from CLI wrappers.

## ADR-H018 — Schema validation does not replace real Herdr runtime tests

**Status:** Accepted  
**Date:** 2026-08-29

The checked-in schema proves that the public contract exists. Promotion of a Herdr version additionally requires real-binary tests for layout creation, environment injection, returned identities, state reporting/release, output reads, process inspection, targeted interruption, detach/reattach, snapshot reconciliation, and plugin operations.

## Historical decisions retained from `penggin/gsd-herdr`

The following findings remain active even though the repository topology changed:

- Herdr should be validated by actual capabilities, not a version string alone.
- child JSON mode is required for result parity;
- raw JSON terminal mirroring is a defect;
- silent unmonitored fallback is unsafe;
- main and child Herdr state must not share authority;
- process, artifact, environment, and cleanup behavior require security tests.

The previous package-overlay decision is now historical. Because this repository owns the full GSD source and build, production resource overlaying is unnecessary for the primary distribution path.
