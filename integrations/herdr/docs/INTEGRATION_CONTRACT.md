# Herdr Integration Contract

## 1. Purpose

Define the versioned boundaries between GSD orchestration, execution backends, the Herdr worker runner, pane state, and durable artifacts.

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

## 7. Capability contract

Initial Herdr capabilities to verify in M0.6:

```text
session.snapshot
tab.create / tab.list / tab.get
pane.split or layout.apply
pane.run
pane.read
pane.send_keys or pane.send_input
pane.process_info
pane.report_agent
pane.report_agent_session
pane.report_metadata
pane.release_agent
pane.close
```

Compatibility is based on actual schema and behavior, not version alone.

## 8. Versioning

Breaking changes increment the relevant boundary independently:

```text
backend contract version
launch artifact schema
worker state schema
configuration schema
Herdr capability-set version
```

Unknown major versions fail closed with a clear diagnostic.
