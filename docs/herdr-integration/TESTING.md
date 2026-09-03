# Herdr Integration Testing Strategy

## Principle

A managed downstream fork reduces merge mechanics but does not eliminate semantic drift. Tests are therefore the primary guard against an upstream refactor that compiles cleanly while changing subagent behavior.

## 1. Existing upstream tests

Preserve and run upstream tests for every touched subsystem. Herdr work must not weaken unrelated GSD behavior.

At minimum during active development:

```bash
pnpm run typecheck:extensions
```

and the focused compiled/source tests for modified files. Before major integration, use the repository's normal `verify:pr` / `verify:merge` gates as appropriate.

## 2. Backend abstraction unit tests

Test backend selection and ownership independently from Herdr:

- local backend selected by default;
- cmux selection preserves existing preference behavior;
- Herdr selected only when configured/available;
- required Herdr failure does not fall through invisibly;
- no backend receives retry/orchestration responsibility it should not own;
- every backend receives the same resolved launch plan inputs.

## 3. Local refactor parity

The first M2 milestone must prove that extracting LocalBackend is behavior-preserving before Herdr execution is introduced.

Compare before/after outputs for fake deterministic children:

- message accumulation;
- final output;
- usage counters;
- model/thinking;
- stopReason/errorMessage;
- exit code;
- abort classification;
- session file;
- isolation/merge metadata.

## 4. Cmux regression tests

The current historical cmux fix changed stale CLI usage to the current cmux command surface. When folded into M2, tests must cover:

- split creation returns/uses the created surface;
- command submission targets the intended surface;
- `ctrl+c` interrupt reaches that surface;
- failure does not leave an invisible duplicate worker;
- output capture does not dump raw JSON into the pane after the backend refactor.

## 5. Worker runner unit tests

Use a fake child executable that emits deterministic JSONL in deliberately awkward chunk sizes.

Cases:

- one event split across multiple stdout chunks;
- several events in one chunk;
- final line without newline;
- malformed/unknown JSON record;
- large token-delta stream suppressed from terminal output;
- tool start/completion formatting;
- retry formatting;
- secret redaction;
- stderr capture;
- exit artifact atomic publication;
- heartbeat updates;
- SIGINT/SIGTERM/SIGKILL escalation.

## 6. Artifact/security tests

- `0600`/`0700` best-effort permissions on supported platform;
- generated paths remain inside runtime root;
- symlink/path traversal cleanup is rejected;
- one-time environment artifact is removed after read;
- user-controlled task/agent/model strings do not become command/path injection;
- raw JSON remains in artifact while filtered pane output excludes it.

## 7. Herdr client contract tests

Against a fake protocol server where possible:

- request/response ID correlation;
- bounded timeout and reconnect failure;
- state/metadata sequence handling;
- schema/capability detection;
- graceful unknown fields;
- explicit missing-capability diagnostic.

Against real Herdr v0.8.2:

- `tab create` returns tab/root pane IDs;
- `pane split` returns the new pane;
- `pane run` atomically submits a test command;
- `pane process-info` observes the foreground test process;
- `pane send-keys ... ctrl+c` interrupts it;
- report-agent/session/metadata are visible in pane/agent queries;
- release-agent removes lifecycle authority;
- `session.snapshot` contains expected resources;
- pane closure emits/detects the expected state.

## 8. End-to-end worker scenarios

| Scenario | Expected evidence |
|---|---|
| single success | one worker pane, complete JSONL, same parent result as local |
| parallel 4 | four distinct worker slots, no identity collision |
| parallel > pool | bounded concurrent panes + queued work |
| chain | stable/reused pane where policy allows; previous result semantics unchanged |
| retry | retry remains visible and does not publish false root/worker idle |
| provider failure | failed/blocked worker retained with bounded error summary |
| Ctrl-C | intended process group stops; final abort artifact exists |
| manual pane close | parent stops waiting and reports runtime failure |
| detach/reattach | workers continue; UI/state recover on attach |
| root GSD crash | workers become orphaned, not successful |
| Herdr restart | reconciliation avoids duplicate launch |
| raw JSON guard | raw JSONL in artifact, zero raw event lines intentionally written to pane |
| fork context | child session reference remains correct |
| isolation | worktree cwd/merge behavior matches local backend |

## 9. Result parity suite

The key invariant for external runtime integration:

```text
same launch plan + same child event stream + same child exit
=> same GSD semantic result
```

Run this across LocalBackend and HerdrBackend for deterministic fixtures. Backend-specific pane/artifact metadata is excluded from semantic equality.

## 10. Upstream synchronization tests

If an upstream sync touches any of these areas:

```text
src/resources/extensions/subagent/**
src/resources/extensions/cmux/**
launch/session/fork helpers
run-store / retry / isolation / merge
extension loader or shared event/state code
CLI/resource packaging relevant to internal worker entrypoint
```

then downstream CI must re-run the full subagent backend/parity matrix, not only conflict-adjacent unit tests.

## 11. Herdr compatibility matrix

Before first stable release:

- supported stable: Herdr v0.8.2;
- current/latest Herdr stable: canary when newer;
- current Herdr master: best-effort compatibility signal, not production promise.

For each tested Herdr version, record:

- version and commit if known;
- socket protocol/schema version;
- required method/CLI capability result;
- plugin manifest compatibility;
- E2E result.

## 12. Failure-injection requirements

Inject at least:

- socket unavailable;
- tab creation failure;
- pane command submission timeout/ambiguous response;
- worker crash before exit artifact;
- worker crash after JSONL but before exit publication;
- root crash;
- pane close;
- stale/out-of-order state update;
- malformed worker artifact;
- missing required Herdr capability.

## 13. Promotion gate

A Herdr integration release is not production-ready because it visually works once. Promotion requires:

1. upstream relevant tests pass;
2. local semantic parity passes;
3. Herdr worker E2E passes;
4. cancellation/process cleanup passes;
5. raw JSON suppression passes;
6. security/path/env tests pass;
7. detach/reconnect/pane-loss scenarios pass for the supported stability tier;
8. `PLANNING.md` records the exact evidence.

For the session-v4 P3.7 gate, start in the candidate root pane with
`GSD_INTERNAL_SESSION_BACKEND=harness-v4` and run:

```bash
pnpm run herdr:session-v4-live-preflight -- --output /absolute/evidence/preflight.json
```

The preflight is evidence preparation, not E2E completion. It refuses to run
outside a Herdr-managed pane, from a subagent child, against a non-v4 root, with
mismatched inherited/current pane identity, or without the pinned Herdr
v0.8.2/protocol-20 capability contract. A passing report still requires every
worker scenario in section 8 before cutover.

The complete isolated-path setup, exact marker protocol, public-subagent
scenario order, topology capture, restart evidence, and closeout gates are in
[`spikes/P3.7-SESSION-V4-LIVE-RUNBOOK.md`](spikes/P3.7-SESSION-V4-LIVE-RUNBOOK.md).
