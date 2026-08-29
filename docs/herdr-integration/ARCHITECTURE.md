# Herdr Integration Architecture

## 1. Ownership model

The integration is intentionally split by responsibility:

### GSD owns

- deciding when and why a subagent is dispatched;
- model/thinking/tool selection;
- fresh/fork session semantics;
- parallel/chain/background scheduling;
- retries and retry budgets;
- worktree isolation and merge behavior;
- structured JSON event parsing;
- usage accounting;
- final success/failure classification;
- persisted GSD run state.

### Herdr owns

- durable terminal panes and tabs;
- pane layout and focus;
- terminal process lifetime across detach/reattach;
- terminal input delivery;
- pane output/scrollback;
- semantic agent display state;
- pane/session snapshot and event surfaces.

### The Herdr integration layer owns

- mapping GSD root/worker identity to Herdr panes;
- selecting/reserving worker panes;
- launching the internal worker runner;
- translating JSON-mode child activity into readable terminal output;
- durable bridge artifacts and heartbeats;
- cancellation delivery from GSD to the correct Herdr worker;
- reconciling GSD runtime records with Herdr pane state.

## 2. Runtime topology

```text
Herdr server/session
└── workspace: project
    ├── tab: GSD
    │   └── root pane
    │       └── gsd TUI
    │           ├── root Herdr state reporter
    │           └── subagent orchestrator
    │
    └── tab: GSD Workers
        ├── worker pane 1
        │   └── gsd __herdr-worker spec.json
        │       └── gsd --mode json ...
        ├── worker pane 2
        ├── worker pane 3
        └── worker pane 4
```

The worker tab is bounded rather than creating unbounded new panes for every dispatch.

## 3. Subagent backend abstraction

The desired internal shape is:

```ts
interface SubagentExecutionBackend {
  readonly id: "local" | "cmux" | "herdr" | string;

  isAvailable(context: BackendContext): Promise<boolean>;

  execute(
    request: BackendExecutionRequest,
    callbacks: BackendCallbacks,
  ): Promise<BackendExecutionResult>;

  interrupt?(execution: BackendExecutionHandle): Promise<void>;
}
```

The exact TypeScript contract must be derived from the current subagent implementation during M0.9/M2. The important architecture rule is that runtime backends do not own GSD orchestration semantics.

### Shared semantic layer

The following should be centralized above runtime implementations wherever possible:

- building `SubagentLaunchPlan`;
- parsing `message_end`/tool result events;
- updating `SingleResult`;
- usage aggregation;
- final-output extraction;
- missing-final-response handling;
- abort classification;
- retry/chain/parallel orchestration;
- run-store updates;
- merge/isolation results.

### Runtime-specific layer

Local:

- `spawn()` child directly;
- pipe stdout/stderr callbacks;
- signal child/process group.

Cmux:

- create/select cmux surface;
- start the same launch plan externally;
- capture/tail structured output;
- forward interrupt to the surface.

Herdr:

- reserve/select worker pane;
- generate secure worker spec/artifact directory;
- atomically submit the internal worker command with `herdr pane run`;
- tail JSONL/exit artifacts;
- send `ctrl+c` or equivalent interrupt to the exact worker pane;
- report backend metadata to the result/run store.

## 4. Root session reporting

The root GSD process runs inside a Herdr pane and reports semantic lifecycle state.

Authority guards:

```text
HERDR_ENV == 1
AND HERDR_PANE_ID exists
AND current GSD session is TUI
AND GSD_SUBAGENT_CHILD != 1
```

Root state mapping:

```text
session start / settled        -> idle
agent start                    -> working
user/input approval required   -> blocked
GSD auto milestone/slice/task  -> working + bounded context label
session shutdown               -> release lifecycle authority
```

Native session identity, when available, should use `pane.report_agent_session` or the equivalent fields supported by Herdr.

## 5. Worker lifecycle

### Reserve

1. Resolve the root Herdr workspace/tab/pane from environment or current-pane API.
2. Find/create the worker tab for the root session.
3. Reserve an available slot atomically in GSD-owned state.
4. Clear prior worker metadata/authority from that slot if it is safe to reuse.

### Launch

1. Build the normal GSD subagent launch plan.
2. Create a restricted artifact directory.
3. Write a validated launch spec and any one-time secret environment handoff.
4. Run only the internal runner command in the worker pane.
5. The worker process reuses the pane's Herdr-managed identity, not the root pane's inherited identity.

### Execute

The internal runner:

- loads the spec;
- spawns the real child using argv arrays and `shell: false`;
- writes raw stdout to `stdout.jsonl`;
- writes stderr to `stderr.log`;
- parses complete JSON records from chunked stdout;
- renders only selected activity to the terminal;
- reports working/retrying/blocked/idle semantic state and bounded metadata;
- updates a heartbeat/state artifact;
- atomically writes immutable final exit evidence.

### Complete

The parent backend consumes final JSONL records through the existing GSD parser and returns the same semantic result the local backend would have produced.

Success does not become authoritative merely because the worker process exited zero; GSD's existing result validation still applies.

## 6. Display model

Worker panes should be useful at a glance:

```text
falcon / scout
model: gpt-5.6-sol
working · 01:42

[00:04] read  .gsd/STATE.md
[00:12] bash  git diff -- src/auth
[00:31] edit  src/auth/session.ts
[00:54] retry 2/3 · provider 503
[01:42] completed · exit 0
```

Never display by default:

- raw `message_update` JSON;
- token deltas;
- complete tool result payloads;
- complete prompts/system prompts;
- full environment maps;
- secrets or auth headers.

## 7. Herdr API split

Herdr v0.8.2 exposes both raw socket APIs and CLI wrappers.

Use raw socket/API-oriented calls for:

- `session.snapshot`;
- pane/tab discovery;
- semantic state reporting;
- session identity reporting;
- metadata/tokens;
- event subscriptions when needed.

Use `herdr pane run` for submitting a command to an existing shell pane because v0.8.2 documents this wrapper as atomic and bracketed-paste-aware. The raw method list exposes send-text/send-keys but not a raw `pane.run` method.

Layout creation can use `tab.create`, `pane.split`, or `layout.apply` depending on whether the pool is being created incrementally or restored declaratively.

## 8. Pane pool state machine

Proposed slot states:

```text
available
reserved
starting
running
retained_success
retained_failure
closing
orphaned
```

Rules:

- a slot has one owner `(rootSessionId, dispatchId, childId)` at a time;
- parallel dispatches reserve distinct slots;
- chain steps may reuse the same slot;
- retries should reuse the same slot when the prior worker fully exited;
- successful panes may be retained briefly then reused;
- failed/blocked panes are retained by default until reviewed/cleaned;
- a slot is not reusable while execution outcome is ambiguous.

## 9. Durable artifact layout

Proposed root:

```text
~/.gsd/runtime/herdr/v1/
└── <root-session-id>/
    └── <dispatch-id>/
        └── <child-id>/
            ├── launch.json
            ├── env.json        # one-time; delete after worker reads it
            ├── stdout.jsonl
            ├── stderr.log
            ├── state.json
            ├── heartbeat
            └── exit.json
```

Security requirements are defined in `SECURITY.md`.

## 10. Failure and recovery model

### Herdr unavailable before launch

- required mode: fail dispatch visibly;
- optional mode: local fallback may be allowed if no Herdr worker could possibly have started.

### Worker pane closed

- detect pane loss / missing heartbeat / missing final artifact;
- interrupt remaining process if possible;
- classify as explicit runtime failure.

### Root GSD crashes

Workers may remain alive because Herdr owns their PTYs. Mark them orphaned when root heartbeat/ownership disappears; retain pane and artifacts rather than assuming success.

### Herdr client detaches

No failure: the server and pane processes continue.

### Herdr server restarts

Reconcile durable GSD records against `session.snapshot` and available panes. Do not launch duplicates merely because the client was reattached.

## 11. Upstream synchronization boundary

The integration should modify focused areas and keep runtime-specific code modular so normal GSD upstream changes merge with minimal conflict. However, architectural quality takes precedence over artificially limiting diff size.

Every upstream synchronization that touches subagent execution must re-run:

- local backend parity;
- cmux backend tests;
- Herdr backend contract tests;
- parallel/chain/retry/fork/isolation coverage;
- cancellation and missing-final-response regressions.
