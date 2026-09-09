# Output-limit continuation

The provider-neutral agent loop treats a `length` stop as incomplete output,
not a successful final answer. This adapts GSD upstream
`5fbf5dca90642249b4b409b101b3f152798f2958` to the downstream session lifecycle.

## Behavior

An assistant response with `stopReason: "length"`, positive output usage and no
provider error can trigger at most three continuation injections within one
low-level loop invocation. Four consecutive length responses therefore stop after
the initial request plus three continuations. Ordinary tool turns, summary-model
calls and a separately authorized GSD workflow retry are not part of that count.
This is not a project-wide token or cost budget.

Complete tool calls receive paired results before continuation. The existing stop
hook runs first. Only if another request will run does `prepareNextTurn` execute;
the continuation user message is appended and persisted once afterward. Replacing
or compacting the next-turn context cannot discard that pending request. Stopping
does not run preparation or leave an unanswered continuation prompt.

Cap exhaustion, a provider error, non-overflow zero output, a terminating tool
batch, or the stop hook produces an explicit assistant error prefixed
`[length-halt]`. The diagnostic carries the original response's provider/model
identity and zero added usage. The original response remains in session history;
its usage is counted once and its last-provider cost is preserved. Cancellation
remains an aborted result and prevents another provider request, including when
it arrives during asynchronous next-turn preparation.

## Compaction and retry

Ordinary provider retry does not retry `[length-halt]`. A terminal non-overflow
halt also cannot bypass that rule through threshold compaction and queued input.
Explicitly classified context overflow remains eligible for the existing single
compact-and-retry recovery. Repeated zero-output responses and internal synthetic
or queued messages do not replenish that allowance. A new explicit request can
start with a new allowance; a genuinely successful response retains established
recovery-reset behavior.

Overflow recovery trims only its failed response/diagnostic tail from the
transient request context, never from canonical session history. Historical
assistant answers and paired tool results are retained. If successful compaction
leaves a legitimate assistant-only tail with no queued input, the existing
`followUp` queue supplies one explicit recovery message so `Agent.continue()` has
valid input. It is persisted through normal events, does not rerun completed
tools, and is not enqueued after failed, cancelled or exhausted recovery.

GSD still owns Task Attempts, workflow retry and final completion decisions. These
changes do not switch planner/executor roles, install a model, alter effort
preferences, select an App Server executor, or transfer orchestration to Herdr.

## Verification and limitations

The loop/Agent/schema matrix passes 75 tests. Source-backed session/module tests
pass, including six independent actual Agent + AgentSession + disk SessionManager
tests with an in-memory provider. They exercise call caps, once-only persistence,
tool pairing, changed-model attribution, real overflow recovery, retained-history
bridging, later explicit prompts and cancellation during preparation. No paid
provider or installed user session is used by these fixtures.

The existing schema-convergence parser recognizes JSON-pointer fields, while
some validator diagnostics use dotted paths. This unrelated limitation is not
repaired here. Cap precedence is tested using the existing preflight-error path
with recognized field notation; narrowed retry is not claimed to work for every
validator message format.

Exact combined gates and current implementation status are recorded in
[the implementation ledger](gsd-upstream-deferred-implementation.md).
