# Herdr Integration Contract

This document defines the behavioral contracts that must remain stable across the GSD subagent layer, Herdr backend, internal worker runner, and Herdr runtime.

Names are provisional until implementation begins; semantics are the important part.

## 1. Subagent backend contract

A runtime backend receives an already-resolved GSD launch plan and returns process/runtime execution evidence without taking over GSD's higher-level orchestration.

Conceptual shape:

```ts
interface SubagentExecutionBackend {
  id: string;
  isAvailable(ctx: BackendContext): Promise<boolean>;
  execute(
    request: BackendExecutionRequest,
    callbacks: BackendCallbacks,
  ): Promise<BackendExecutionResult>;
  interrupt?(handle: BackendExecutionHandle): Promise<void>;
}
```

### Backend input must include

- resolved executable/argv or equivalent launch plan;
- cwd;
- child environment;
- dispatch/child identity;
- agent/tracking name;
- mode and step/index metadata where relevant;
- abort signal;
- callbacks/sink for complete stdout JSONL records;
- stderr sink;
- enough metadata to preserve fork/session/isolation semantics without re-deriving them in the backend.

### Backend must not own

- retry policy;
- chain dependency logic;
- model selection;
- usage aggregation rules;
- GSD run-store truth;
- final-response validity checks;
- worktree merge decisions.

## 2. Result parity contract

For a deterministic fake child emitting the same JSONL and exit behavior, Local and Herdr execution must produce the same GSD-visible fields:

```text
final assistant output
messages/tool results consumed by GSD
usage.input/output/cacheRead/cacheWrite/cost/contextTokens/turns
model
thinking
stopReason
errorMessage
exitCode
aborted/interrupted classification
session file/reference
merge/isolation result
```

Backend-specific metadata may be additive but cannot replace semantic fields.

## 3. Worker launch spec v1

Proposed artifact:

```json
{
  "schemaVersion": 1,
  "rootSessionId": "...",
  "dispatchId": "...",
  "childId": "...",
  "agent": "scout",
  "trackingName": "falcon",
  "taskPreview": "Inspect auth state",
  "model": "...",
  "thinking": "high",
  "cwd": "/absolute/project/path",
  "executable": "/absolute/path/to/node-or-gsd",
  "args": ["..."],
  "stdoutPath": "/.../stdout.jsonl",
  "stderrPath": "/.../stderr.log",
  "statePath": "/.../state.json",
  "heartbeatPath": "/.../heartbeat",
  "exitPath": "/.../exit.json",
  "envPath": "/.../env.json"
}
```

Requirements:

- paths must resolve inside the integration-owned runtime root;
- IDs become generated safe path segments, not user text;
- task text is not used as a filename;
- command execution uses argv arrays, never shell interpolation of this document;
- the worker rejects unknown future incompatible schema versions;
- `env.json` is one-time input and is removed immediately after successful read.

## 4. Worker state v1

Proposed semantic state:

```text
queued
starting
working
retrying
blocked
completed
failed
aborted
orphaned
```

`state.json` is diagnostic/operational state, not GSD's canonical orchestration state.

Example:

```json
{
  "schemaVersion": 1,
  "status": "working",
  "updatedAt": "2026-08-29T12:34:56.000Z",
  "pid": 12345,
  "paneId": "w1:p5",
  "lastActivity": {
    "kind": "tool",
    "label": "read .gsd/STATE.md"
  }
}
```

## 5. Final exit artifact v1

`exit.json` is immutable final process evidence after atomic publication.

```json
{
  "schemaVersion": 1,
  "exitCode": 0,
  "signal": null,
  "aborted": false,
  "completedAt": "2026-08-29T12:35:01.000Z"
}
```

An exit artifact does not by itself mean GSD success; the parent must still parse/validate the structured result.

## 6. JSONL relay contract

The worker captures child stdout exactly enough for the parent parser to consume it.

Rules:

- raw bytes are persisted to `stdout.jsonl`;
- chunk boundaries are not assumed to equal line boundaries;
- the parent-facing relay emits each complete non-empty line at most once and in order;
- a final unterminated buffered line is processed on child close;
- malformed JSON may be retained as evidence but must not crash the worker renderer;
- presentation filtering must never mutate the raw parent stream.

## 7. Human activity projection

Displayable events are a lossy projection and may include:

- start/finish;
- tool execution start and bounded completion status;
- retry notices;
- blocked/failure summaries;
- bounded assistant/final summary if explicitly enabled.

Do not render raw token deltas or unbounded tool payloads.

Activity formatting must redact known secret patterns and cap line lengths.

## 8. Root Herdr authority contract

Root reporting is allowed only when:

```text
HERDR_ENV == "1"
HERDR_PANE_ID is present
session mode is visible TUI
GSD_SUBAGENT_CHILD != "1"
```

Root state uses one stable `source` identifier and monotonically increasing `seq` values where ordering matters.

Root shutdown/reload must release or safely replace lifecycle authority.

## 9. Worker Herdr authority contract

A worker reports only against the pane that actually hosts its internal runner.

The worker uses Herdr-injected values from its own pane environment. Parent pane values copied into the GSD launch plan must be removed before the child environment is constructed.

Herdr semantic mapping for v0.8.2:

| Worker state | Herdr semantic state | Notes |
|---|---|---|
| starting/working | `working` | normal active work |
| retrying | `working` | metadata/message indicates retry |
| blocked | `blocked` | user/action required or durable failure awaiting review |
| completed | `idle` | Herdr derives `done` presentation for unseen idle agents; metadata can say completed |
| failed | `blocked` or released + failure metadata | final UX to validate |
| aborted | `idle` then release/retention metadata | policy to validate |
| orphaned | `unknown` or `blocked` with explicit metadata | must never look successful |

Herdr v0.8.2's `pane report-agent` CLI accepts semantic states `idle`, `working`, `blocked`, and `unknown`; `done` is an effective UI state rather than a lifecycle report value.

## 10. Herdr v0.8.2 capability contract

Initial required capabilities:

### Required for core worker execution

- `tab.create` / CLI `herdr tab create`;
- `pane.split` / CLI `herdr pane split`;
- CLI `herdr pane run` for atomic command submission;
- `pane.get`/`pane.list`;
- `pane.process_info`;
- `pane.read` for diagnostics;
- `pane.send_keys` for cancellation/input;
- `pane.report_agent`;
- `pane.report_agent_session` when native session identity is available;
- `pane.report_metadata`;
- `pane.release_agent`;
- `pane.close`;
- `session.snapshot` for reconciliation.

### Preferred/optional

- `layout.apply` for declarative pool creation/restoration;
- `pane.layout`;
- `events.subscribe` for event-driven pane loss/state updates;
- Herdr plugin APIs for operations/dashboard features.

### Important v0.8.2 detail

The raw socket method list does **not** include `pane.run`. `pane run` is a documented CLI helper that atomically submits a command and Enter while honoring bracketed-paste mode. The first implementation should therefore either invoke the Herdr CLI for worker command submission or use another explicit process-launching API; it must not model `pane.run` as a raw JSON socket method.

## 11. Herdr-managed environment contract

Processes created in Herdr panes receive authoritative values including:

```text
HERDR_SOCKET_PATH
HERDR_ENV=1
HERDR_WORKSPACE_ID
HERDR_TAB_ID
HERDR_PANE_ID
```

Plugin commands additionally receive plugin-specific variables such as `HERDR_BIN_PATH`, plugin ID/root/config/state, and context JSON.

Worker child environment construction must strip parent copies of Herdr-managed identity values and reapply the values belonging to the actual worker pane/runner process.

## 12. Cancellation contract

Parent cancellation targets one specific backend execution.

Herdr initial strategy:

1. send `ctrl+c` to the worker pane;
2. internal runner forwards SIGINT to the spawned child process group;
3. after grace period escalate to SIGTERM;
4. after another grace period escalate to SIGKILL;
5. publish `exit.json` with aborted/signal evidence;
6. parent classifies the result using existing GSD abort semantics.

A timeout or ambiguous launch must not silently start a second local worker.

## 13. Compatibility/versioning

- Artifact schemas are explicitly versioned.
- Herdr compatibility is capability-based and tied to tested releases/protocols.
- GSD downstream compatibility is tied to the recorded upstream base commit plus downstream test evidence.
- Unknown fields should be tolerated where additive evolution is intended; unknown incompatible schema versions must fail clearly.
