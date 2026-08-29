# Herdr Integration Testing Strategy

## 1. Central invariant

For equivalent launch inputs, backend choice must not change GSD's semantic result.

Compare:

```text
final assistant output
message/tool-event interpretation
usage and context accounting
model/thinking metadata
stop reason and error classification
exit and abort behavior
session/fork metadata
worktree isolation and merge result
retry decisions and run-store state
```

## 2. Test layers

### Unit tests

- backend selection and fallback policy;
- JSONL chunk framing and malformed-line handling;
- activity formatting, deduplication, throttling, and redaction;
- state transitions and sequence ordering;
- artifact validation and atomic writes;
- pane-pool reservation, queueing, retention, and reuse;
- environment stripping/rebinding;
- signal escalation.

### Contract tests

- backend request/outcome schema;
- launch/state/heartbeat/exit schemas;
- Herdr request/response fixtures;
- unknown protocol-version rejection;
- required capability-set detection.

### GSD regression tests

- no Herdr configuration preserves existing local behavior;
- existing cmux behavior remains supported;
- single, parallel, chain, background, retry, fork, and isolation paths share the intended executor;
- backend errors do not become false successes;
- required monitoring prevents local fallback.

### Result parity

Run the same deterministic fake child through local, cmux fake, and Herdr fake backends. Normalize runtime-specific IDs and compare the complete GSD result shape.

### Herdr integration tests

With a fake or isolated Herdr server:

```text
create worker tab/pane
launch worker runner
report working/tool/retry/done state
read recent pane output
verify raw JSON is absent from pane output
verify raw JSONL artifact is complete
send targeted interrupt
release authority and close/reuse pane
```

### End-to-end tests

On macOS arm64 with a real Herdr binary:

| Scenario | Expected evidence |
|---|---|
| single success | one pane, exit 0, parsed result |
| parallel four | four distinct panes and results |
| parallel over capacity | bounded workers plus queue |
| chain | stable pane reuse and ordered output |
| provider retry | no false idle between attempts |
| failure | retained pane and stderr evidence |
| cancellation | correct process group terminated |
| pane manually closed | parent detects loss |
| detach/reattach | processes and readable state persist |
| parent crash | worker becomes explicit orphan |
| Herdr restart | reconciliation avoids duplicates |
| raw JSON check | artifact yes, terminal no |

## 3. Upstream sync gates

Every upstream merge that touches relevant paths runs:

1. upstream affected tests unchanged where possible;
2. backend contract tests;
3. local/cmux regression tests;
4. Herdr result parity;
5. process/security tests;
6. a representative real-Herdr smoke test before promotion.

## 4. Test fixtures

Use deterministic fake children that can:

```text
emit valid JSONL in arbitrary chunk boundaries
emit malformed records
write stderr
sleep and receive signals
exit with configured codes
simulate retryable provider errors
omit final response
hold after pane launch for ambiguity tests
```

Do not require live model providers for core CI.

## 5. Evidence requirements

Each completed planning task records exact test commands, outcomes, and known omissions. A clean compile or textual merge is not sufficient evidence for execution-path changes.
