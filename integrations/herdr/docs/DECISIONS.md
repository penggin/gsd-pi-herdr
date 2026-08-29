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

Herdr exposes the pane, layout, state, metadata, session snapshot, input, output, process, event, and plugin operations required by the initial runtime. Use those public APIs. Fork Herdr only after a required behavior is reproduced as impossible or unsafe through public interfaces.

## ADR-H003 — Unify subagent execution backends

**Status:** Accepted  
**Date:** 2026-08-29

Refactor GSD child execution behind one internal `SubagentExecutionBackend` contract. Local, cmux, and Herdr implementations receive the same prepared launch plan and feed the same collector and finalizer.

Rejected alternatives:

- copying the bundled subagent tool into a Herdr extension;
- maintaining a Herdr-only parallel executor;
- continuing separate local/cmux result state machines;
- relying on extension load order to replace the `subagent` tool.

## ADR-H004 — GSD remains authoritative

**Status:** Accepted  
**Date:** 2026-08-29

Backends cannot decide task success, retry policy, usage, context, worktree merge, session behavior, or final response meaning. They execute and transport; GSD interprets.

## ADR-H005 — Preserve JSON-mode children

**Status:** Accepted  
**Date:** 2026-08-29

Continue to run child agents through the existing JSON mode so GSD receives structured messages, tool events, usage, errors, model metadata, and stop reasons.

## ADR-H006 — Filter terminal output

**Status:** Accepted  
**Date:** 2026-08-29

Preserve complete raw JSONL as protected evidence but render only bounded lifecycle, tool, retry, blocked, elapsed-time, and final-status activity. Never stream token-delta JSON into a pane.

## ADR-H007 — Use a dedicated worker runner

**Status:** Accepted  
**Date:** 2026-08-29

Launch a fixed Node-based worker process in external panes. It validates a versioned launch artifact and spawns the GSD child with argv arrays and `shell: false`.

The runner owns stream framing/capture, filtered rendering, worker state, heartbeat, signal escalation, and final process evidence.

## ADR-H008 — Separate authority domains

**Status:** Accepted  
**Date:** 2026-08-29

The root TUI extension reports the main pane. The worker runner reports its own pane. `ctx.mode === "tui"` and `GSD_SUBAGENT_CHILD !== "1"` protect root authority; inherited Herdr variables are replaced with worker-pane values before child spawn.

## ADR-H009 — Monitoring failure is fatal by default

**Status:** Accepted  
**Date:** 2026-08-29

When monitored execution is configured as required, inability to establish a known worker execution fails the dispatch. Local fallback is opt-in and allowed only after a known pre-launch failure, before any external process could have started.

An ambiguous external launch never triggers a duplicate local child.

## ADR-H010 — Maintain an exact upstream mirror branch

**Status:** Accepted  
**Date:** 2026-08-29

`upstream-main` points to a reviewed upstream commit without downstream changes. `main` is the downstream release line. Upstream merges are staged and semantically tested before reaching `main`.

## ADR-H011 — Preserve and normalize cmux

**Status:** Accepted  
**Date:** 2026-08-29

Cmux remains supported as another external-pane backend. Its transport is brought under the same execution contract as local and Herdr rather than maintained as an independent result path.

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

The first stable downstream release targets macOS arm64. Keep platform-specific signal and path behavior isolated for future Linux and Windows support.

## ADR-H015 — Migrate planning into `integrations/herdr/`

**Status:** Accepted  
**Date:** 2026-08-29

Keep Herdr planning, plugin assets, cross-runtime documentation, and E2E fixtures under one integration directory. Core runtime changes remain in their natural GSD source/package locations and are linked from the plan.

## ADR-H016 — Support Herdr by capability set, with protocol 20 as the stable baseline

**Status:** Accepted  
**Date:** 2026-08-29

### Context

Herdr `v0.8.2` uses API protocol `20`; current `master` uses protocol `21`. Protocol 20 already includes the pane, layout, snapshot, event, process, state-authority, and plugin operations required for the initial runtime.

### Decision

- The first stable baseline is Herdr `v0.8.2`, protocol `20`.
- Compatibility is expressed through named method/shape capability sets.
- Startup records version and protocol for diagnostics but gates on actual required operations.
- Additive unknown fields are tolerated.
- Missing methods or incompatible shapes fail closed.
- Protocol 21 is canary coverage, not a first-release requirement.

### Consequences

- official `v0.8.2` remains a valid target;
- compatibility tooling must parse schemas or run equivalent probes;
- stable and canary contract fixtures are maintained;
- version strings alone never prove compatibility.

## ADR-H017 — Prefer `layout.apply` for deterministic worker creation

**Status:** Accepted  
**Date:** 2026-08-29

### Context

The validated API supports `layout.apply` with pane nodes containing argv command arrays, cwd, environment, label, and IDs. It also supports `pane.split`, but split requests do not include a command array.

Herdr's documented `herdr pane run` is a CLI convenience and is not a raw socket method in protocol 20 or 21.

### Decision

- Use `layout.apply` for fresh one-, two-, and four-pane worker layouts.
- Use `pane.split` for incremental growth, repair, or compatibility.
- Split-created panes receive only a fixed worker-runner command and protected artifact path through a validated input operation.
- Do not send a fictitious raw `pane.run` request.
- A separate CLI adapter may use `herdr pane run` only with dedicated compatibility/output tests.
- Do not depend on `agent.start` for the headless worker runner.

### Consequences

- fresh layouts can launch argv-based workers and return authoritative IDs;
- live worker tabs must never be replaced through `layout.apply` without safety checks;
- declarative and incremental paths require separate tests.

## ADR-H018 — Schema validation does not replace real Herdr runtime tests

**Status:** Accepted  
**Date:** 2026-08-29

The checked-in API schema proves that the public contract exists. Promotion additionally requires real-binary tests for layout creation, environment injection, identities, state report/release, output read, process inspection, targeted interruption, detach/reattach, snapshot reconciliation, and plugin operations.

## ADR-H019 — Place shared Herdr infrastructure in one internal workspace package

**Status:** Accepted  
**Date:** 2026-08-29

### Context

The typed Herdr client, capability parser, protocol/artifact schemas, and worker executable are needed by the subagent backend, root extension, worker process, plugin tooling, and tests.

Keeping these in a bundled extension would make executable packaging and reuse awkward. Splitting them into multiple packages would add premature build/release complexity.

### Decision

Create one private, linkable workspace package:

```text
packages/herdr-runtime
package name: @gsd/herdr-runtime
binary: gsd-herdr-worker
```

It owns:

- the typed Herdr client and capability checks;
- shared Herdr/runtime protocol types;
- versioned launch, state, heartbeat, and exit artifact helpers;
- the standalone worker runner and process/output/security utilities.

It must not import the bundled subagent extension.

### Consequences

- one reusable infrastructure boundary serves all Herdr-facing GSD code;
- root build and package validation must explicitly include the package;
- installed-tarball tests must resolve and execute the worker binary;
- the package can be extracted later if independent distribution becomes useful.

## ADR-H020 — Keep orchestration integration near the code it affects

**Status:** Accepted  
**Date:** 2026-08-29

### Decision

Place backend-neutral execution types, collector, selector, executor, and backend implementations under:

```text
src/resources/extensions/subagent/execution/
```

Place root GSD lifecycle/state integration under:

```text
src/resources/extensions/herdr/
```

Keep Herdr plugin assets, long-form integration documentation, and real-Herdr E2E under:

```text
integrations/herdr/
```

Keep user settings in the existing GSD preference system. Keep semantic run status in the current subagent run store, extended additively; keep raw process evidence in the Herdr runtime store.

### Consequences

- upstream merge review follows natural GSD ownership boundaries;
- the subagent tool is not copied or hidden under integration assets;
- extension and worker infrastructure share only `@gsd/herdr-runtime`;
- root package files/build/test validation must include the new locations.

## ADR-H021 — Reimplement the historical cmux fix instead of merging it

**Status:** Accepted  
**Date:** 2026-08-29

### Context

Historical commit `5b74d301b6d1599df5fe0a385b90a28b48492b9a` correctly changes stale cmux command usage, but it is based on the pre-sync code and leaves the raw JSON `tee`, duplicated result path, temporary polling, and ambiguous local fallback intact.

### Decision

Do not merge or cherry-pick the historical branch into the downstream release line.

Reimplement these valid behaviors during the unified cmux backend port:

```text
parse the surface returned by new-split
send text with send
send ctrl+c with send-key
```

Do not retain in the execution-critical path:

```text
list-surfaces
send-surface
before/after global discovery
raw JSON tee
completion-only parent parsing
post-attempt silent local fallback
```

Retain the old branch as evidence until replacement tests pass.

### Consequences

- no immediately obsolete cherry-pick is introduced;
- cmux compatibility and observability are solved together;
- new tests must invoke production cmux methods and cover launch ambiguity, interruption, shutdown, and raw-output suppression.

## ADR-H022 — Require local result parity before external backend ports

**Status:** Accepted  
**Date:** 2026-08-29

### Context

The largest risk is semantic drift while extracting duplicated local/cmux execution. Adding Herdr at the same time would make regressions difficult to isolate.

### Decision

Implementation order is gated:

1. define the shared backend contract and collector;
2. port the current local executor;
3. prove deterministic old-vs-new local result parity;
4. route all dispatch call sites through the shared executor;
5. only then port cmux and implement Herdr external execution.

### Consequences

- external transports are built on a verified semantic baseline;
- temporary refactor work may exist before new user-facing functionality appears;
- parity fixtures and a complete dispatch-mode matrix are mandatory M1 deliverables.

## Historical decisions retained from `penggin/gsd-herdr`

The following findings remain active after repository consolidation:

- validate Herdr through actual capabilities rather than version strings alone;
- preserve child JSON mode for structured result parity;
- treat raw JSON terminal mirroring as a defect;
- forbid silent unmonitored fallback by default;
- keep main and worker Herdr authorities separate;
- test process, signal, environment, artifact, path, and cleanup behavior as security-sensitive code.

The previous package-overlay strategy is historical. Because this repository owns the full GSD source and build, production resource overlaying is unnecessary for the primary distribution path.
