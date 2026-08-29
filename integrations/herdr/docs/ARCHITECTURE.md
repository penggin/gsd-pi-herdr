# Herdr Runtime Architecture

## 1. Objective

Run GSD-Pi subagents in persistent Herdr-managed panes while preserving all existing GSD orchestration and result semantics.

The runtime must support local, cmux, and Herdr execution through one internal contract. Backend choice may change transport, observability, pane identity, and lifecycle metadata; it must not change the meaning of the GSD result.

## 2. System topology

```text
Herdr workspace
├── main pane
│   └── GSD TUI
│       ├── bundled Herdr root-session extension
│       └── bundled subagent orchestration
│           └── executePreparedSubagent()
│               ├── result collector/finalizer
│               ├── backend selector
│               └── SubagentExecutionBackend
│                   ├── LocalBackend
│                   ├── CmuxBackend
│                   └── HerdrBackend
│
└── GSD Workers tab
    ├── pane A ── gsd-herdr-worker ── GSD child --mode json
    ├── pane B ── gsd-herdr-worker ── GSD child --mode json
    ├── pane C ── gsd-herdr-worker ── GSD child --mode json
    └── pane D ── gsd-herdr-worker ── GSD child --mode json

Herdr operations plugin
├── worker dashboard
├── focus actions
├── cleanup
└── startup reconciliation
```

Herdr remains an external runtime. `penggin/gsd-pi-herdr` owns the GSD-side integration and downstream distribution.

## 3. Ownership boundaries

### 3.1 GSD orchestration layer

GSD owns:

- agent discovery and trust confirmation;
- task content and dispatch identifiers;
- single, parallel, chain, background, status, and resume behavior;
- concurrency limits and retry policy;
- model and thinking overrides;
- context fresh/fork behavior and child sessions;
- project/worktree cwd resolution;
- isolation creation, delta capture, merge, and cleanup;
- JSON event interpretation;
- current result, final output, usage, model, stop reason, and error classification;
- run-store and journal updates;
- cancellation intent and workflow state.

A transport backend does not take ownership of any of those decisions.

### 3.2 Shared execution layer

The shared execution layer owns one attempt of one prepared child:

- backend-neutral request and lifecycle types;
- launch-state classification;
- backend selection and fallback policy;
- complete JSONL record framing;
- stderr accumulation;
- parent update emission;
- common result initialization and finalization;
- missing-final-response detection;
- external execution handles and targeted shutdown registration;
- runtime-specific metadata attachment without changing result meaning.

### 3.3 Execution backends

A backend owns only:

- probing whether its runtime is usable;
- placing and starting the prepared child or worker;
- forwarding complete stdout records and stderr chunks;
- reporting known pre-launch failure, known launch, ambiguous launch, completion, and abort;
- targeted interrupt and force-termination operations;
- returning external workspace/tab/pane/process metadata.

Backends must not independently parse a task as successful or decide to retry it.

### 3.4 Herdr integration layer

Herdr-specific GSD code owns:

- Herdr capability discovery and typed requests;
- root GSD pane session/state/metadata authority;
- worker tab and pane-pool creation;
- pane labels, focus, layout, and retention;
- launching the fixed worker runner in the correct pane context;
- detecting pane/process loss;
- Herdr-specific diagnostics and reconciliation;
- Herdr plugin assets and actions.

### 3.5 Worker runner

The worker runner owns:

- validating a protected, versioned launch artifact;
- replacing inherited main-pane Herdr identity with its actual worker-pane identity;
- spawning the existing GSD JSON child through argv arrays and `shell: false`;
- capturing complete stdout JSONL and stderr;
- converting arbitrary stream chunks into complete JSONL records;
- relaying records to the parent-side collector path;
- rendering bounded lifecycle, tool, retry, blocked, and final activity;
- worker heartbeat, state, and atomic exit evidence;
- signal escalation to the child process group;
- output redaction and artifact path containment.

It does not reconstruct the GSD prompt or determine the semantic result.

## 4. Source and package layout

```text
src/resources/extensions/subagent/
├── index.ts
├── launch.ts
├── isolation.ts
├── run-store.ts
├── execution/
│   ├── types.ts
│   ├── collector.ts
│   ├── selector.ts
│   ├── execute.ts
│   └── backends/
│       ├── local.ts
│       ├── cmux.ts
│       └── herdr.ts
└── tests/

src/resources/extensions/herdr/
├── extension-manifest.json
├── index.ts
├── preferences.ts
├── main-session-state.ts
├── diagnostics.ts
└── tests/

packages/herdr-runtime/
├── package.json
├── tsconfig.json
├── bin/gsd-herdr-worker.js
└── src/
    ├── client/
    ├── protocol/
    └── worker/

integrations/herdr/
├── README.md
├── PLANNING.md
├── AGENTS.md
├── docs/
├── plugin/
└── tests/
    ├── fixtures/
    ├── contract/
    └── e2e/
```

Detailed placement rationale is recorded in [`spikes/M0.8-CODE-PLACEMENT.md`](spikes/M0.8-CODE-PLACEMENT.md).

## 5. Dependency direction

```text
subagent orchestration
  → execution contract / collector / selector
    → local backend
    → cmux backend → low-level cmux client
    → Herdr backend → @gsd/herdr-runtime

bundled Herdr root extension
  → @gsd/herdr-runtime

@gsd/herdr-runtime
  → Node standard library and Herdr public protocol
  ↛ bundled subagent extension

Herdr plugin / E2E
  → public Herdr APIs
  → installed downstream GSD build
```

Important constraints:

- `@gsd/herdr-runtime` never imports the bundled subagent extension.
- Backend-neutral `launch.ts` never imports cmux or Herdr shell helpers.
- The cmux low-level client never parses GSD JSON events or decides fallback.
- The root Herdr extension and subagent backend share infrastructure through the workspace package, not through extension-loader singleton assumptions.

## 6. Unified execution flow

### 6.1 Preparation

1. GSD validates the requested mode and agents.
2. GSD resolves context mode, model, thinking, tools, system prompt, and cwd.
3. GSD creates any isolation environment at the orchestration layer.
4. `createSubagentLaunchPlan()` produces executable arguments, environment, cwd, and session metadata.
5. GSD creates a backend-neutral result collector.

### 6.2 Selection and launch

6. The selector resolves the requested backend and probes availability.
7. The selected backend receives the immutable prepared launch request and collector callbacks.
8. The backend returns an execution handle and a known launch classification.
9. Complete stdout records flow to the same `processSubagentEventLine()`-based collector regardless of backend.
10. Stderr and lifecycle changes update the common result state.

### 6.3 Finalization

11. The backend returns exit and abort evidence.
12. The common finalizer validates final response, normalizes errors, and closes the handle.
13. GSD applies retry policy outside the backend.
14. GSD captures and merges isolation deltas outside the backend.
15. GSD updates run store, journal, worker projections, and final tool output.

The central invariant is:

```text
same launch plan + equivalent child stream/exit
→ equivalent GSD semantic result across local, cmux, and Herdr
```

## 7. Dispatch-mode integration

Every one-attempt child execution must pass through the shared executor.

| Operation | Orchestration responsibility | Backend responsibility |
|---|---|---|
| single | optional isolation and final merge | run one prepared child |
| parallel | queue, concurrency 4, retry once, per-task isolation | run each attempt and return a handle |
| chain | `{previous}` substitution and stop-on-failure | run each ordered step |
| background | durable run state and immediate run-ID response | continue one child after caller returns |
| resume | choose stored fork session and task | run the prepared resumed child |
| fork context | create branched child session | execute provided session args |
| isolation | create/capture/merge/cleanup | use provided cwd/env only |

The initial refactor does not change current product rules such as background being single-only or chain not creating isolation.

## 8. Launch-state and fallback model

External launch behavior is explicitly classified:

```text
not-attempted
known-pre-launch-failure
known-launched
ambiguous-launch
completed
aborted
lost/orphaned
```

Fallback rules:

- explicit optional fallback may occur only after a known pre-launch failure;
- a known launch never falls back to a duplicate local child;
- an ambiguous launch triggers reconciliation and visible failure, not duplicate execution;
- required monitored execution fails before starting an unmonitored worker;
- terminal command acceptance is not proof that the child exited or succeeded.

## 9. Result collector

The collector is backend-neutral and owns:

```text
current SingleResult
partial stdout buffer
complete JSONL ordering
processSubagentEventLine calls
stderr accumulation
onUpdate emission
usage/model/stop/error fields
missing-final-response detection
finish and abort normalization
```

Local, cmux, and Herdr backends do not implement their own result state machines.

## 10. Main and worker authority

### Root GSD pane

The root reporter activates only when:

```text
HERDR_ENV == 1
ctx.mode == tui
GSD_SUBAGENT_CHILD != 1
```

It reports the visible main session, milestone/slice/task context, and root agent state.

### Worker pane

The worker runner reports against the pane into which Herdr launched it. Before spawning the child, it strips inherited main-pane values and reapplies its own:

```text
HERDR_ENV
HERDR_SOCKET_PATH
HERDR_WORKSPACE_ID
HERDR_TAB_ID
HERDR_PANE_ID
```

The JSON child cannot mark the main pane idle, replace the root session identity, or release root authority.

Every authority domain uses monotonic sequence numbers and explicit release.

## 11. Worker output model

```text
child stdout JSONL
├── protected append-only stdout.jsonl
├── complete records delivered to GSD collector
└── filtered activity renderer
    ├── lifecycle state
    ├── concise tool start/completion
    ├── retry and blocked information
    ├── elapsed time
    └── bounded final status/summary
```

Not rendered:

```text
raw JSON records
message_update/text_delta events
full prompts
full tool results
credentials or complete environment
```

Raw evidence remains protected on disk for GSD parsing and bounded diagnostics.

## 12. Herdr layout and pane pool

One root GSD session owns one worker tab and a bounded pool, initially four panes.

Preferred initial creation:

```text
layout.apply
  with declarative one/two/four-pane tree
  pane cwd/env/label
  worker command argv
```

Incremental growth or repair may use `pane.split` plus validated delivery of a fixed worker-runner command. CLI `herdr pane run` is not treated as a raw socket method.

Slot states:

```text
available → reserved → starting → running
running → retained-success | retained-failure | blocked | aborted | orphaned
retained-success → available after retention and reset
retained-failure/blocked/orphaned → manual or policy cleanup
```

Parallel work queues beyond capacity. Chain steps and retries reuse stable panes when safe. Main-pane focus is preserved by default.

## 13. Persistence model

### GSD semantic run store

The existing subagent run store remains the user-facing semantic projection. It is extended additively with references such as:

```text
backend ID
external execution/attempt ID
workspace/tab/pane ID
artifact directory
last known external state
```

### Herdr runtime evidence

`@gsd/herdr-runtime` owns protected evidence:

```text
launch artifact
worker state
heartbeat
stdout.jsonl
stderr.log
exit artifact
```

The distinction is:

```text
GSD run store = what the task means and how it ended
runtime evidence = what process/pane was launched and what it emitted
```

Final artifacts are written atomically. Absence of a pane or heartbeat is not interpreted as success.

## 14. Failure and recovery model

### Pre-launch failure

If a required capability is missing or a pane cannot be created before launch, dispatch fails visibly. Optional fallback is allowed only when no external process could have started.

### Ambiguous launch

Reconcile pane/process state. Do not start a duplicate local child.

### Pane loss

A missing pane without final evidence is failed or orphaned, never successful.

### Parent loss

A live worker with a stale parent heartbeat becomes `orphaned`. Initial releases retain the pane and evidence instead of automatically adopting success.

### Herdr restart/reconnect

Reconciliation combines:

```text
session.snapshot
event stream/wait
pane.process_info
parent/worker heartbeat
state and exit artifacts
GSD run-store references
```

No single data source proves child completion by itself.

## 15. Cmux migration

Cmux remains supported as another external-pane backend.

Valid behavior from historical downstream commit `5b74d301...` is reimplemented:

```text
parse the surface returned by new-split
send text with send
interrupt with send-key ctrl+c
```

Not retained:

```text
list-surfaces
send-surface
before/after global discovery
raw JSON tee
completion-only parent parsing
silent post-split local fallback
```

Generic cmux environment, sidebar, notification, and low-level current CLI behavior remain in `src/resources/extensions/cmux/`; subagent transport belongs in the shared execution layer.

## 16. Packaging architecture

`@gsd/herdr-runtime` is a private, linkable workspace package shipped inside the root downstream package. The root build must compile it before resources/package validation.

The root tarball must include and validate:

```text
packages/herdr-runtime/dist
packages/herdr-runtime/bin
packages/herdr-runtime/package.json
required integrations/herdr/plugin assets
bundled Herdr extension in built resources
```

Real installed-package smoke tests must resolve and execute `gsd-herdr-worker`.

## 17. Test architecture

- subagent backend contract, selection, local/cmux parity: `src/resources/extensions/subagent/tests/`;
- root reporter and preferences: `src/resources/extensions/herdr/tests/`;
- client, protocol, worker, process, and security tests: `packages/herdr-runtime/src/**/*.test.ts`;
- plugin/API contract fixtures: `integrations/herdr/tests/contract/`;
- real Herdr detach/recovery E2E: `integrations/herdr/tests/e2e/`.

External-backend implementation cannot begin before deterministic local old-vs-new result parity is green.

## 18. Implementation order

```text
1. @gsd/herdr-runtime protocol/client/bin foundation
2. backend contract and common collector
3. local backend parity
4. all dispatch call-site migration
5. cmux normalization and filtered transport
6. root Herdr extension
7. secure worker runner
8. single-worker Herdr backend
9. persistent pane pool and all modes
10. durability, operations plugin, and crash recovery
11. downstream packaging and release automation
```

See [`spikes/M0.10-CONSOLIDATED-TECHNICAL-PLAN.md`](spikes/M0.10-CONSOLIDATED-TECHNICAL-PLAN.md) for implementation slices and gates.
