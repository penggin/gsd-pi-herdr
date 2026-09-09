# Scout evidence sufficiency and offline evaluation

This is a prompt-only scout change plus an opt-in developer script, not a GSD
runtime gate. No model routing, effort, context, fallback, state, Herdr, queue or
retry policy changes are required. No ECC code, package or service is included.

The baseline is the exact `src/resources/agents/scout.md` from
`0417606d37d69ee31cf0bda496f9617a2afbe7b0`, copied into
`tests/scout-eval/baseline-scout.md`. Implementation was on
`feature/gsd-upstream-backports-20260907` at that same HEAD, preserving the existing
dirty worktree. The candidate adds evidence discipline and one short handoff
section; the original identity, tools, depth and four sections remain unchanged.
`sufficient_for_requested_scope` describes reconnaissance, not correct code or
completed implementation. GSD still decides what to do next.

## What the pilot measures

All three fixtures are **synthetic reconnaissance/handoff tasks**, not end-to-end
implementation benchmarks. They ask where and how a change should be made; the
scout must not implement it. An operator saves its unmodified final response as
`handoff.md`. That is the only allowed source-tree difference.

| Fixture | Purpose | Fixed acceptance |
| --- | --- | --- |
| `A-small` | Clear, small label-normalization change | Locate implementation and test; preserve case; hand off without forced extra exploration |
| `B-cross-contract` | Event type, retry producer, consumer, test | Trace identity across modules; distinguish retry coverage from missing duplicate-render protection |
| `C-missing-contract` | Remote charging contract unavailable | Confirm only local forwarding; identify the missing idempotency contract and its effect on retry safety |

`fixtures.json` contains reproducible source files, requests, scope and environment.
`criteria.json` contains the evaluator's fixed rubric and evidence paths.
`lock.json` binds their versions/hashes and the verification/aggregation code.
The request does not contain the rubric or an expected answer. Evaluation copies
remain outside the candidate workspace. File separation and hashes detect drift;
they are **not** a security sandbox or proof of who authored a review.

Acceptance combines mechanical source/scope/citation checks with an independent
operator's fixed semantic rubric. The evaluator must inspect the entire handoff
for unsupported claims and contradictions. Do not let the candidate write its
own review. Baseline answers need not use the new headings or literal status
words: the reviewer maps their meaning to the same rubric. Passing prompt-string
or loader tests does not demonstrate model behavior.

## Offline entrypoints

These are **new repository scripts**, not `/gsd` commands. Run from the repository
with its existing dependencies and Node >=22.18. They never launch GSD, contact a
model/network service, control Herdr, or execute commands supplied in records.
Only `probe` and `verify` spawn a fixed, bounded Node helper for actual agent
discovery; `validate`, `report` and `--dry-run` only read local artifacts.

```sh
node scripts/scout-evaluation.mjs fixtures
node --test scripts/__tests__/scout-evaluation-records.test.mjs scripts/__tests__/scout-evaluation-workspace.test.mjs
```

Create a public `settings.json` outside the candidate tree. Supply actual,
non-sensitive effective settings when planning an observed experiment; do not
copy credentials, full environments, prompts, or raw logs. For example:

```json
{
  "evaluationId": "scout-comparison-1",
  "modelPolicy": {"effectiveRolePolicy": "operator-reviewed-settings-fingerprint"},
  "tools": ["read", "grep", "find", "ls", "bash"],
  "instructions": {"projectInstructionSha256": "reviewed-instruction-fingerprint"},
  "environment": {"gsdBuild": "reviewed-build-fingerprint", "node": "record-version", "os": "record-platform"},
  "retryPolicy": {"existingPolicy": "record-current-policy"},
  "parallelism": 1,
  "cachePolicy": "fresh-controlled",
  "sessionPolicy": "fresh-isolated",
  "repetitions": 1
}
```

The strings above are placeholders, not current model defaults. Preserve the
current provider/model/effort/context/tools/fallback/override policy in both arms.
Use a new experiment directory; initialization refuses to overwrite one.

```sh
node scripts/scout-evaluation.mjs init /tmp/scout-eval-1 /tmp/scout-settings.json --synthetic
node scripts/scout-evaluation.mjs prepare /tmp/scout-eval-1/plan.json A-small baseline work/A-baseline
node scripts/scout-evaluation.mjs prepare /tmp/scout-eval-1/plan.json A-small candidate work/A-candidate
node scripts/scout-evaluation.mjs probe /tmp/scout-eval-1/work/A-candidate
node scripts/scout-evaluation.mjs validate /tmp/scout-eval-1/plan.json
```

`init` freezes both scout definitions and the plan. Omit `--synthetic` for an
explicitly approved observed experiment; this still does not start any model.
`prepare` prints the exact task request, start fingerprint and environment, and
creates fixture files plus the project-local `.gsd/agents/scout.md`. Repeated
trials/attempts need distinct workspace names. Keep failure snapshots before any
retry; never reset or repurpose a user's existing project.

## Verifying and recording a submission

The evaluation plan holds the fixture/criteria hashes and planned start
fingerprints. To inspect only candidate and handoff fingerprints without dumping
their contents, use the existing script exports:

```sh
node --input-type=module -e 'import {snapshotWorkspace,sha256} from "./scripts/lib/scout-evaluation-workspace.mjs"; const s=snapshotWorkspace(process.argv[1]); console.log(JSON.stringify({candidateFingerprint:s.fingerprint,handoffSha256:sha256(s.files["handoff.md"]??"")}))' /tmp/scout-eval-1/work/A-candidate
```

An independent evaluator writes `reviews/A-candidate-1.json`, outside `work/`.
Its schema is `gsd.scout-review/v1`:

- `author: "evaluator"`, a non-sensitive `reviewerId`, `evaluationId`, `taskId`,
  `trialId` (e.g. `repeat-1`), `variant`, and 1-based `attemptIndex`.
- `fixtureHash`, `criteriaHash`, `candidateFingerprint`, `handoffSha256`.
- `condition: "submission"`; alternatively `environment_error`, `timeout` or
  `incomplete` with `conditionReason`. These alternatives are operator-attested
  observed conditions, not inferred from prose or manufactured by the verifier.
- `citations`: `{path,startLine,endLine,sourceQuote,handoffQuote}` entries. Quote
  the exact fixture lines (1-based, inclusive) and the exact handoff fragment that
  cites that path/range. Required evidence paths are in `criteria.json`.
- `checks`: one entry for every fixed check ID, each
  `{ "pass": true_or_false, "evidence": "exact handoff quote" }`.
- `sufficiency: {value,evidence}` with one of the three scout states, and
  `stopReason: {value,evidence}` using `enough-evidence`, `no-new-evidence`,
  `budget`, or `unavailable`. Evidence is an exact handoff quote, not an invented
  claim. Missing evidence/invalid review is a verification error, not acceptance.

Use `scripts/__tests__/scout-evaluation-workspace.test.mjs` for a complete
**synthetic** schema example. Its canned quotes are arithmetic/validation test
data, not a semantic grading example or real answer quality evidence.

```sh
node scripts/scout-evaluation.mjs verify /tmp/scout-eval-1/plan.json A-small repeat-1 candidate 1 work/A-candidate reviews/A-candidate-1.json
```

This fixed verifier checks scope and source/citation integrity, checks the
external rubric, probes the actual resource loader, and freezes source, handoff,
review and load evidence at `verification/A-small/repeat-1/candidate/1.json` and
adjacent artifacts. The receipt binds the exact evaluation/task/trial/variant/
attempt. It cannot be overwritten or relabeled. Source snapshots exclude
GSD-owned `.git`/`.gsd`; the selected scout is separately checked. This is not a
full audit of GSD state or a permission boundary against a hostile same-user
process. Small text fixtures have bounded reads (200 entries, 1 MiB total,
256 KiB/file, depth 16); symlink traversal is rejected.

Write a `records.json` array with one immutable entry per submission. Copy, do
not guess, these fields from the plan and verifier output:

```text
evaluationId, taskId, trialId, variant, attemptIndex
fixtureVersion, criteriaVersion, fixtureHash, criteriaHash
startFingerprint, candidateFingerprint, settingsFingerprint
verificationRef, verificationHash, scout
final, durationMs, additionalSearches, usageCompleteness, usage
```

`settingsFingerprint` is `fingerprint(plan.settings)` from
`scripts/lib/scout-evaluation-records.mjs`. `scout` is the verifier's returned
object (definition/loaded-definition/loaded-prompt hashes and evidence reference).
`final` means the planned trial stops at this submission, **not** that it passed.
Decide retries under the predeclared existing policy. The first receipt always
remains attempt 1; a failed first submission followed by success is still a first
submission failure. `verify` requires the previous receipt before attempt 2+.
Missing already-verified attempts, duplicates and attempts after `final` invalidate
the report rather than silently dropping their failures.

Use measured attempt wall time in `durationMs`, excluding evaluator idle time;
trial time sums all its recorded attempts. Use `null` if unavailable. Likewise,
`additionalSearches` is an observed count under a predeclared definition or null,
not an estimate from answer length. These fields are operator-provided metrics,
not new automatic telemetry.

`usageCompleteness` is `complete`, `partial` or `unavailable`; unavailable usage
is null. Measured rows use the existing **normalized Pi Usage contract**:

```json
{
  "provider": "non-sensitive-provider-id",
  "model": "non-sensitive-model-id",
  "normalization": "pi-ai/usage-v1",
  "input": null,
  "output": null,
  "cacheRead": null,
  "cacheWrite": null,
  "totalTokens": null,
  "evidenceRef": "evidence/A-candidate-1.usage.json"
}
```

The evidence file has `kind: "normalized-pi-usage"`, the same five attempt
identity fields, and `rows` with provider/model and those five counters. Preserve
all models and failed calls measured within the attempt. Complete coverage must
match the full artifact; partial rows must not duplicate the same evidence.
Normalize through existing Pi provider/session data before recording: raw provider
input may already include caches. Do not add caches to an already-inclusive
total, add reasoning twice (it is in output), or substitute last-message
`contextTokens` for cumulative usage. Unknown counters stay null; do not derive
them. Complete known counters must agree with the supplied total.

```sh
node scripts/scout-evaluation.mjs validate /tmp/scout-eval-1/plan.json /tmp/scout-eval-1/records.json --dry-run
node scripts/scout-evaluation.mjs report /tmp/scout-eval-1/plan.json /tmp/scout-eval-1/records.json
```

Exit 0 means valid artifacts/records, not successful tasks. Invalid input/evidence
exits 2. Reports recheck frozen artifacts, do not trust `reportedOutcome`, and do
not rerun candidate code. They contain hashes/IDs/metrics/diagnostics, not copied
prompt or log bodies. Existing secret redaction is applied to CLI output; this is
not a guarantee of detecting arbitrary secrets in operator-created artifacts.

## Future real-model comparison — separate approval required

**Real GSD runs consume model/API/subscription usage. None are started by these
scripts or by this implementation's tests.** After explicit approval:

1. Use the same reviewed GSD build in two disposable OS accounts/containers or
   equivalent isolated homes. Do not change global resources. `GSD_HOME` alone is
   insufficient: normal resource initialization also manages bundled skills under
   `os.homedir()/.agents/skills`. The offline probe avoids initialization and gives
   its loader a temporary HOME/GSD_HOME; tests pass a private skills directory.
2. Initialize one observed plan with identical effective settings, fixture,
   request, environment, tools/instructions, concurrency and retry/stop rules.
   Freeze the exact build including dirty-source fingerprint if applicable. Only
   the scout definition differs. Do not activate any unused model router.
3. Prepare independent baseline/candidate workspaces for each task/repetition.
   Start fresh sessions and record cache/session policies; alternate or
   counterbalance variant order. Do not silently let one arm inherit warm memory
   or caches. Record any unavoidable provider cache uncertainty as a limitation.
4. Start each authorized GSD session **in its fixture workspace**: discovery uses
   the session's `ctx.cwd`, so a tool-level `cwd` override alone is insufficient.
   Use the existing public `subagent`
   tool with `agent: "scout"`, `agentScope: "project"`, `context: "fresh"`,
   fixture workspace `cwd`, and the exact `prepare` request as `task`. Preserve
   existing role/provider/effort/fallback policy; do not set new model overrides.
   Save the final text unchanged as `handoff.md` **as operator**, without granting
   scout source-write permission. This is an ordinary GSD dispatch, not a new
   benchmark execution loop. Do not use `/gsd auto` to invent a milestone for it.
5. Confirm actual load provenance. The real path is bundled resource sync →
   user/project `discoverAgents` → temporary `--append-system-prompt` file →
   common backend runner. Project definitions override user definitions in
   `both`; `project` is explicit. `probe` proves discovery, not that a live process
   used it. The operator must verify the existing run's selected project resource
   and loaded prompt (the runner removes its temporary prompt file at closeout).
   Add `scout.runEvidenceRef` pointing to an operator-attested artifact:
   `{kind:"operator-observed-gsd-launch",evaluationId,taskId,trialId,variant,
   attemptIndex,gsdRunId,loadedPromptSha256,settingsFingerprint}`. Bind it to real
   observed GSD launch evidence; if unavailable, report missing evidence rather
   than substituting the probe or inventing a run ID.
6. Independently review and verify **each first submission before retry**, then
   every retry, including timeouts/environment problems and eventual failures.
   Preserve all receipts and normalized usage; append attempt records without
   replacing earlier outcomes. Run `validate` and `report` above.

The local loader/runner regression checks the real prompt launch artifact using
an injected synthetic backend. It proves wiring without consuming a model, not
live provider behavior. Scout output remains unparsed handoff text; its new state
does not authorize completion, trigger retries, or alter GSD lifecycle status.

## Reading results and rollback

Reports separate planned tasks/trials, recorded tasks/trials, accepted/rejected,
not-run, incomplete, environment errors and timeouts. First-submission acceptance
shows both the recorded and planned denominator. Retries and failed attempts stay
in usage totals; usage per accepted trial divides **all** recorded usage by final
accepted trials (null when zero or measurement is incomplete). Missing usage is
not zero: measured subtotals/coverage remain visible separately. No-record trials
are unobserved, not proof of zero consumption. `actualSubscriptionDebit` is always
null; API counters/cost estimates are not actual subscription debits.

Baseline/candidate timing comparisons require matching conditions and measured
accepted pairs; failed and non-comparable trials remain visible elsewhere. A
timing subset is not an overall efficiency conclusion. No statistical
significance or general improvement is claimed by the tool. Check correctness and
scope first, then rework caused by gaps, exploration overhead, and slowdown on
clear small tasks. No preselected percentage improvement is required. Keeping the
old scout is a valid conclusion if evidence is weak or effects are unfavorable.

To roll back only the prompt after review, restore
`src/resources/agents/scout.md` from the frozen `tests/scout-eval/baseline-scout.md`
(or a recorded experiment's baseline), leaving evaluator scripts/fixtures intact.
Rebuild resources for any later authorized installation; do not edit a live
session or global resource. New candidate-specific prompt assertions must be
updated/retired deliberately on rollback; loader/parity tests still apply. No DB
migration or runtime undo is needed. Never use a broad reset of the dirty tree.

Changing fixture/criteria/verifier code requires a new evaluation version and
lock, then a new experiment; do not reseal old observations after seeing outcomes.
`loadSuite({allowUnsealed:true}).identity` is a developer inspection helper, not
an automatic upgrade command. Keep old code/locks with old evaluations.

Local tests cover structure, actual discovery/launch wiring, fixed evidence,
condition mismatches, unsafe paths, failed retries, unknown usage and no-command
aggregation. The required synthetic arithmetic is tasks **3**, accepted **2**,
attempts **4**, retries **1**, first accepted **1/3**, usage **67**, usage per
accepted trial **33.5**. These numbers are not measured model usage or quality.

## Local verification record (2026-09-09)

The pre-change discovery/resource-loader baseline passed 16/16. Final targeted
commands below cover the new evaluator (26 tests) and scout/loader/common-runner
regressions (72 tests), including Local/Herdr semantic parity and model overrides:

```sh
node --test scripts/__tests__/scout-evaluation-records.test.mjs scripts/__tests__/scout-evaluation-workspace.test.mjs
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/subagent/tests/scout-sufficiency.test.ts src/resources/extensions/subagent/tests/agents-conflicts.test.ts src/resources/extensions/subagent/tests/launch.test.ts src/resources/extensions/subagent/tests/index.test.ts src/resources/extensions/subagent/tests/model-override.test.ts src/resources/extensions/gsd/tests/subagent-agent-discovery.test.ts src/tests/resource-loader-content-hash.test.ts src/resources/extensions/subagent/execution/tests/local-backend.test.ts src/resources/extensions/subagent/execution/tests/resolver.test.ts src/resources/extensions/subagent/execution/tests/herdr-backend.test.ts
node scripts/scout-evaluation.mjs fixtures
pnpm run typecheck:extensions
pnpm run build:core
git diff --check
```

Typecheck/build passed; the build emitted platform-selection warnings for the
other-platform native workspace packages, not a build failure. Source and
`dist/resources/agents/scout.md` hashes matched after the build. No pre-existing
failure was found in the selected baseline. A temporary test-helper directory
setup failure during implementation was fixed; it was not a runtime defect or an
ignored failing test. The whole repository suite, live provider behavior, remote
environments and real A/B trials were not run. No installation, global setting,
user session, remote server, dependency, commit or push was changed by this task.
