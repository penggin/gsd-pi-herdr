# Herdr Runtime Architecture

## 1. Objective

Run GSD-Pi subagents in persistent Herdr panes while preserving all existing GSD orchestration and result semantics.

## 2. Ownership boundaries

### GSD orchestration layer

GSD owns:

- agent selection and task content;
- single, parallel, chain, background, and retry scheduling;
- model and thinking overrides;
- context fresh/fork behavior;
- worktree isolation and merge decisions;
- JSON event parsing;
- final output, usage, stop reason, and error classification;
- cancellation intent and workflow state.

### Execution backend layer

A backend owns only:

- where and how the prepared child process runs;
- delivery of stdout records and stderr chunks;
- lifecycle and external runtime metadata;
- signal delivery and process termination;
- explicit failure before or after launch.

Backends must not independently decide whether a GSD task succeeded.

### Herdr integration layer

Herdr-specific code owns:

- Herdr capability discovery and requests;
- worker tab/pane creation and reuse;
- pane labels, focus, state, and metadata;
- launching the worker runner in the correct pane context;
- detecting pane loss and reconciling Herdr state;
- Herdr plugin actions and dashboards.

### Worker runner

The worker runner owns:

- secure launch-artifact validation;
- `spawn(..., { shell: false })` of the existing GSD JSON-mode child;
- raw stdout/stderr capture;
- JSONL chunk framing;
- bounded human-readable terminal rendering;
- worker heartbeat, state, and final evidence;
- signal escalation to the child process group.

## 3. Runtime topology

```text
Herdr workspace
├── main pane
│   └── GSD TUI
│       └── subagent orchestration
│           └── SubagentExecutionBackendRegistry
│               ├── LocalBackend
│               ├── CmuxBackend
│               └── HerdrBackend
│
└── worker tab
    ├── pane A ── gsd-herdr-worker ── GSD child --mode json
    ├── pane B ── gsd-herdr-worker ── GSD child --mode json
    ├── pane C ── gsd-herdr-worker ── GSD child --mode json
    └── pane D ── gsd-herdr-worker ── GSD child --mode json
```

## 4. Unified execution flow

1. GSD resolves an agent and creates the existing launch plan.
2. GSD selects a backend from explicit preference and runtime availability.
3. The backend receives immutable launch metadata and callbacks.
4. Local runs the child directly; cmux/Herdr launch an external worker context.
5. Complete JSONL records return to the same GSD parser.
6. GSD performs the same finalization, retry, usage, isolation, and merge logic regardless of backend.
7. The backend returns external metadata such as pane ID without changing the result meaning.

The desired invariant is:

```text
same task + same model + same context
→ equivalent GSD result semantics across local, cmux, and Herdr
```

## 5. Main and worker authority

The main GSD pane reports the root session only when:

```text
ctx.mode == tui
GSD_SUBAGENT_CHILD != 1
HERDR_ENV == 1
```

Each worker runner reports against the worker pane into which Herdr launched it. A child launch must remove inherited main-pane Herdr variables and apply the runner's actual pane context.

A worker child must never set the main pane idle, replace the main session identity, or release the main authority.

## 6. Worker output model

```text
child stdout JSONL
├── raw append-only stdout.jsonl
├── complete records delivered to GSD parser
└── filtered activity renderer
    ├── lifecycle
    ├── tool start/completion
    ├── retry and blocked state
    └── bounded final summary
```

`message_update` and token deltas are not rendered. Tool result payloads are not dumped. Full evidence remains protected on disk.

## 7. Pane pool

One root GSD session owns one Herdr worker tab with a bounded pool, initially four panes.

Slot states:

```text
available → reserved → starting → running
running → retained-success | retained-failure | blocked | aborted | orphaned
retained-success → available after retention/reset
retained-failure/blocked/orphaned → manual or policy cleanup
```

Parallel dispatch queues tasks beyond capacity. Chain steps and retries reuse a stable pane where practical.

## 8. Failure model

### Pre-launch failure

If monitored execution is required and no compatible Herdr backend is available, dispatch fails before starting a child.

### Ambiguous launch

If it is unclear whether Herdr started a worker, do not launch a local duplicate. Reconcile pane/process state and fail explicitly if certainty cannot be established.

### Pane loss

A missing pane without final evidence is a failed or orphaned worker, never an implicit success.

### Parent loss

A living worker with a stale parent heartbeat becomes `orphaned`. Initial releases preserve the pane and evidence rather than automatically adopting the result.

### Herdr restart

Reconciliation compares durable records with `session.snapshot`, pane/process information, and heartbeat/final artifacts.

## 9. Source layout decision pending M0

The architecture permits two implementation layouts:

1. backend interfaces and implementations colocated under `src/resources/extensions/subagent/`;
2. a generic subagent registry in the subagent extension with Herdr implementation under `src/resources/extensions/herdr/`.

M0.7–M0.8 will choose after auditing current imports, bundle boundaries, tests, and package validation. The worker runner and Herdr plugin assets remain under `integrations/herdr/` or a dedicated workspace package referenced from that directory.
