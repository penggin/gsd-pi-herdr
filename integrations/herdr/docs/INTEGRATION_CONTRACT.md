# Herdr Integration Contract

## 1. Purpose

Define the versioned boundaries between GSD orchestration, execution backends, the Herdr worker runner, pane state, durable artifacts, and the external Herdr control surface.

## 2. Internal backend contract

The exact TypeScript types will be finalized in M1. The semantic contract is:

```ts
interface SubagentExecutionBackend {
  readonly id: "local" | "cmux" | "herdr" | string;

  probe(context: BackendProbeContext): Promise<BackendProbeResult>;

  execute(
    request: SubagentExecutionRequest,
    callbacks: SubagentExecutionCallbacks,
  ): Promise<SubagentExecutionOutcome>;

  interrupt(handle: ExternalExecutionHandle): Promise<void>;
}
```

### Request

A request contains a prepared GSD launch plan and immutable dispatch metadata:

```text
dispatch ID and child ID
single/parallel/chain/background mode
index, total, attempt, and optional step
agent and tracking name
model and thinking level
executable, argv, cwd, and child environment
abort signal
```

A backend does not reconstruct prompts, choose models, fork sessions, allocate worktrees, or determine retry policy.

### Callbacks

```text
onStdoutRecord(line)
onStderrChunk(chunk)
onLifecycle(event)
onExternalMetadata(metadata)
```

`onStdoutRecord` receives complete JSONL records in original order. Partial chunks are framed before delivery.

### Outcome

```text
known launch state
exit code and signal
aborted flag
backend failure classification
workspace/tab/pane IDs when applicable
artifact directory when applicable
```

The outcome is transport evidence. GSD remains responsible for parsing and final result classification.

## 3. Worker launch artifact

Schema version 1 contains:

```json
{
  "schemaVersion": 1,
  "dispatchId": "uuid",
  "childId": "uuid",
  "attempt": 1,
  "mode": "parallel",
  "display": {
    "agent": "scout",
    "trackingName": "falcon",
    "taskPreview": "Inspect planning state",
    "model": "provider/model"
  },
  "process": {
    "executable": "/absolute/node",
    "args": ["/absolute/gsd", "--mode", "json"],
    "cwd": "/absolute/project"
  },
  "artifacts": {
    "stdout": "stdout.jsonl",
    "stderr": "stderr.log",
    "state": "state.json",
    "heartbeat": "heartbeat",
    "exit": "exit.json"
  }
}
```

Environment values are transferred through a protected mechanism and are not included in terminal output or support metadata.

## 4. Worker state

Worker states:

```text
queued
reserved
starting
working
retrying
blocked
done
failed
aborted
orphaned
```

Herdr-facing mapping:

| Worker state | Herdr state | Message example |
|---|---|---|
| queued | idle/metadata | `queued` |
| starting | working | `starting scout` |
| working | working | `read STATE.md` |
| retrying | working | `retry 2/3 · provider 503` |
| blocked | blocked | bounded blocker |
| done | idle/done | `completed · exit 0` |
| failed | blocked/metadata | bounded error |
| aborted | idle | `aborted` |
| orphaned | unknown/metadata | `parent disconnected` |

State updates use monotonically increasing sequence numbers per authority domain so late messages cannot overwrite newer state.

## 5. Output contract

Always preserved:

```text
complete stdout JSONL
complete stderr subject to bounded storage policy
exit evidence
```

Allowed terminal rendering:

```text
worker identity
lifecycle state
concise tool starts/completions
retry and blocked notices
elapsed time
bounded final summary
```

Forbidden terminal rendering by default:

```text
raw JSON records
token/text delta events
full prompts
full tool result payloads
credentials or complete environment
```

## 6. Cancellation contract

Cancellation is targeted to one external execution handle.

Recommended Unix escalation:

```text
SIGINT
wait configured grace
SIGTERM
wait configured grace
SIGKILL
```

The runner writes final evidence even when aborted. A backend must not report success only because the pane accepted `ctrl+c`.

## 7. Herdr capability contract

### 7.1 Baseline

The first stable compatibility baseline is Herdr `v0.8.2`, protocol `20`. Current Herdr `master` uses protocol `21`. Protocol 20 already exposes the public methods required for the initial GSD worker runtime.

Compatibility is represented by named capability sets and validated against the installed schema or equivalent probes. It is not represented by one exact protocol-number comparison.

Detailed evidence is recorded in [`spikes/M0.6-HERDR-API-CAPABILITIES.md`](spikes/M0.6-HERDR-API-CAPABILITIES.md).

### 7.2 Runtime capability set

`gsd-herdr-runtime-v1` requires:

```text
ping
session.snapshot

tab.create
tab.list
tab.get

layout.apply
  OR
pane.split + validated command delivery

pane.list
pane.current
pane.get
pane.process_info
pane.read
pane.send_keys
pane.report_agent
pane.report_agent_session
pane.report_metadata
pane.release_agent
pane.close

events.subscribe
  OR
events.wait
```

An implementation may use additional public methods when present, but optional features must not cause a compatible stable Herdr installation to be rejected.

### 7.3 Operations-plugin capability set

`gsd-herdr-plugin-v1` requires:

```text
plugin.link
plugin.list
plugin.unlink
plugin.action.list
plugin.action.invoke
plugin.pane.open
plugin.pane.focus
plugin.pane.close
```

Plugin features are operational conveniences. Failure to install the operations plugin must be distinguishable from failure of the worker runtime itself.

### 7.4 Capability probe result

```ts
interface HerdrCapabilityProbeResult {
  available: boolean;
  version?: string;
  protocol?: number;
  schemaVersion?: number;
  capabilitySet: "gsd-herdr-runtime-v1";
  methods: Record<string, "present" | "missing" | "incompatible">;
  launchStrategy?: "layout-apply" | "split-and-input";
  diagnostics: string[];
}
```

Backend selection must fail before child launch when a mandatory capability is missing and monitoring is required.

## 8. Herdr layout and launch contract

### 8.1 Preferred strategy: `layout.apply`

The preferred initial worker-tab strategy uses `layout.apply` with a declarative split tree. Pane nodes can carry:

```text
label
cwd
env
command: string[]
```

This gives the integration an argv-based command-at-creation path and an authoritative returned layout. It is used for fresh deterministic one-, two-, and four-pane worker layouts.

A backend must not apply a replacement layout over a live worker tab without first proving that existing PTYs will not be discarded. Initial creation and explicit reconstruction are distinct operations.

### 8.2 Incremental strategy: `pane.split`

`pane.split` is used for incremental growth, repair, or compatibility. It creates a pane with optional target pane, workspace, cwd, environment, ratio, and focus properties.

Because `pane.split` does not include a command array in the validated schema, command delivery must use a separately validated public path. The delivered command must invoke a fixed worker-runner executable with a protected launch-artifact path; arbitrary task text is never interpolated into terminal input.

### 8.3 `pane.run` distinction

`herdr pane run` is a CLI convenience, not a raw socket method in the validated protocol 20 or protocol 21 schemas.

Therefore:

- `pane.run` is not part of `gsd-herdr-runtime-v1`;
- the socket client does not send a fictitious `pane.run` request;
- a CLI adapter may use the command only behind dedicated parsing and compatibility tests;
- the core Herdr backend prefers schema-backed `layout.apply` or split-and-input operations.

### 8.4 `agent.start` distinction

`agent.start` is intended for recognized interactive coding-agent manifests. The GSD worker is a dedicated runner wrapping a headless JSON-mode child. The Herdr backend must not depend on native interactive-agent startup detection for correctness.

## 9. Snapshot and event contract

`session.snapshot` provides an authoritative Herdr bootstrap view containing version/protocol metadata, workspaces, tabs, panes, layouts, agents, and focused IDs.

The integration combines:

```text
session.snapshot
+ event subscription/wait
+ pane.process_info
+ integration-owned durable artifacts
```

No single source proves child success by itself.

Expected event categories include:

```text
pane created/closed/updated/focused/moved
pane output changed
pane exited
pane agent detected/status changed
layout updated
```

On reconnect, the client first obtains a safe snapshot/event ordering strategy and then reconciles durable worker records. Exact subscription sequencing is finalized during implementation and tested against a real Herdr server.

## 10. State-authority contract

### Main pane

The root reporter owns one source/agent authority tuple for the visible TUI session. It activates only when:

```text
HERDR_ENV == 1
ctx.mode == tui
GSD_SUBAGENT_CHILD != 1
```

### Worker pane

The worker runner owns a separate authority tuple for the pane into which Herdr launched it.

A child launch strips inherited main-pane Herdr identity and reapplies the actual worker-pane values before spawning the GSD JSON child.

### Reporting operations

```text
pane.report_agent_session
pane.report_agent
pane.report_metadata
pane.release_agent
```

Every authority domain uses monotonic sequence numbers. Release is explicit; process exit alone is not assumed to clear integration-owned state.

## 11. Versioning

Breaking changes increment the relevant boundary independently:

```text
backend contract version
launch artifact schema
worker state schema
configuration schema
Herdr capability-set version
```

The client must tolerate additive unknown response fields. Unknown major integration schemas, missing required fields, or incompatible method shapes fail closed with a clear diagnostic.

## 12. Runtime-verification requirement

Schema presence is necessary but not sufficient. Before a Herdr version is promoted, real-binary tests must verify:

```text
schema export and capability parsing
layout/tab/pane creation and returned IDs
pane-specific environment injection
worker command launch
state/session/metadata report and release
pane output read
process information
ctrl+c delivery and foreground-process termination
detach/reattach behavior
snapshot-based reconciliation
plugin link/action/pane operations
```
