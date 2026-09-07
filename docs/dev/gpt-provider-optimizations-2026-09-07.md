# GPT provider optimization and Astra readiness

Date: 2026-09-07. Baseline: `8bbe2f3ba`.

This note records the initial readiness-only audit. The later operator-approved
[Astra/medium migration](astra-medium-migration-2026-09-07.md) supersedes the
deferred role-assignment decision, but not the deferred native-Codex experiment.

## Scope and decision

Keep existing role assignments, provider selection, effective effort, context,
tools, fallback and override precedence. Do not enable dynamic difficulty routing,
add Astra as an automatic fallback, change the executor to Astra, or restore the
archived Codex App Server delegation implementation. This change improves the
existing direct Pi Responses transports; it does not introduce a new executor.

Astra remains a candidate for a separately approved planner/reviewer experiment.
Neither global Codex configuration nor GSD user/project preferences are rewritten.
No paid model comparison, proxy canary, push or installation is part of this audit.

## Astra: where a trial could pay off

The official model ID is `gpt-6-astra`. It supports reasoning from `low` through
`max`, but not `none`/`minimal`. Tool use requires Responses, and sampling controls
such as `temperature` are unsupported. Existing effective effort should be retained
when supported, not automatically raised to `max`.
[Model](https://developers.openai.com/api/docs/models/gpt-6-astra),
[migration guidance](https://developers.openai.com/api/docs/guides/latest-model).

The proposed pilot is an inference about this workflow, not a measured quality win:

| Role/task | Pilot recommendation | Evaluation target |
| --- | --- | --- |
| Cross-service planning or a plan with uncertain dependencies | Compare Astra against the current Sol planner | Missing constraints, dependency mistakes, rework after execution |
| Independent review of a difficult plan | Separate report-only second opinion | Actionable new findings supported by evidence |
| Routine task execution, small documentation changes | Keep the current role model | Avoid a larger-model cost increase without a demonstrated benefit |

At the reviewed Standard API prices, Astra input/output are $10/$50 per million
tokens and Sol input/output are $4/$20. Equal token counts therefore cost 2.5x
as much on Astra. Sol's current price is promotional; recheck before a pilot.
These are API estimates, not the user's ChatGPT/OpenCodex subscription bill.
[Astra pricing](https://developers.openai.com/api/docs/models/gpt-6-astra),
[Sol pricing](https://developers.openai.com/api/docs/models/gpt-5.6-sol).

Use the same frozen source/artifacts, task, role instructions, tool permissions,
effort and output contract in the two arms. Start with a small approved sample of
representative planning tasks, not a production milestone. Compare median/p95
latency, retries, tokens by input/read/write/output, estimated cost, accepted plans
and downstream rework. Judge cost per accepted result, not token count alone.
Account separately for long-context and cache effects. Preserve failures in the
comparison; do not silently substitute another model and score it as Astra.

Keep stable authority/role/tool instructions before variable task evidence. Supply
only relevant artifacts; request the plan, assumptions, acceptance criteria and
unresolved risks once. Avoid stacking duplicate methodology bodies or asking for
the same full explanation at several layers. Tests should match the task's risk.
These are pilot instructions, not automatic edits to every installed skill or
permission to bypass GSD verification.

## Existing provider-path repairs

1. **Effort constraints:** explicit `null` mappings must not be converted back into
   the unsupported effort they disable. Valid model mappings and high/max values
   remain intact; requests must not mutate model objects or future role settings.
2. **Reasoning replay:** stateless Responses reasoning requests ask for encrypted
   reasoning even when the caller does not explicitly set effort/summary. Existing
   transcript replay remains responsible for reusing returned content. This is not
   permission to expose reasoning signatures or raw JSON in Herdr panes.
3. **Temperature capability:** `compat.supportsTemperature` can disable forwarding
   for a model/endpoint. Known direct Astra requests suppress it by default. Unknown
   proxy aliases and other model families retain their existing behavior unless
   explicitly configured; do not infer every GPT model has Astra's restrictions.
4. **Cache wire format:** `compat.promptCacheRetentionFormat` selects `legacy` or
   `options` for `openai-responses`. Known direct OpenAI GPT-5.6 Sol/Terra/Luna and
   Astra requests use the modern format. Proxies stay legacy unless opted in.
5. **Usage and cost:** Responses cache writes are a distinct bucket. Ordinary input
   excludes cache reads and writes; long-context tier selection uses their sum.
   Custom prices remain authoritative, including deliberate zero rates.

The modern format uses `prompt_cache_options.ttl: "30m"`; both short and long
preferences map to that supported TTL rather than claiming a 24-hour cache. The
legacy path retains its existing long-retention opt-out. `cacheRetention: "none"`
omits client cache options/key; it is not a claim that the service disables all
automatic caching. Codex transport/session affinity is unchanged. Cache writes
must be included when comparing costs, not counted again as ordinary input.
[OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).

Bundled native GPT-5.6 prices are dated API-equivalent estimates with cache-write
rates. They do not overwrite proxy, Copilot, user or live catalog prices. The
separate GSD static fallback table is not a billing source and is not refreshed
by this change. A custom catalog with zero cache-write price still estimates zero
for writes; configure that catalog's real rates before using its cost display to
compare models. No invoice reconciliation or measured savings are claimed.
[Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol),
[Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra),
[Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna).

## Proxy opt-in contract

Add only the relevant fields to an existing model's `compat` object after checking
the endpoint. Do not replace its authentication, API, tools or role configuration.

```json
{
  "supportsTemperature": false,
  "promptCacheRetentionFormat": "options"
}
```

The cache field applies to `openai-responses`, not `openai-codex-responses`.
Codex-compatible models may use `supportsTemperature` while retaining their
existing bearer/OAuth and endpoint settings. Provider-level fields can be
overridden per model. Invalid recognized values are diagnosed by model loading.

Verify a disposable request, one tool-result round trip, usage and error handling
before deploying an opt-in through a proxy. Do not assume support merely because
the provider accepts `/v1/responses`. Model aliases need explicit metadata when
their upstream contract cannot be established from the advertised ID/endpoint.

If Astra is later approved and a custom catalog does not supply its reasoning
metadata, its model definition must describe disabled levels rather than copying
Sol's `off: "none"` mapping. For example, merge the following model-level fields
only after verifying the route. This fragment does not assign a role or establish
authentication, context limits, prices or model availability:

```json
{
  "reasoning": true,
  "thinkingLevelMap": {
    "off": null,
    "minimal": "low",
    "xhigh": "xhigh",
    "max": "max"
  },
  "compat": { "supportsTemperature": false }
}
```

Do not infer supported effort levels for unknown aliases. Normal caller-side
clamping uses this metadata; the low-level provider repair preserves explicit
disabled mappings, not an invented replacement role policy.

## Codex experimental context management: not enabled here

The documented setting is **`features.context_management.experimental_mode`**,
not top-level `context_management.experimental_mode`. It uses notes and searchable
history and is experimental/off by default. The documentation requires eligible
ChatGPT sign-in (Plus, Pro or Pro Lite); sign-in alone does not establish eligibility.
[Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).

Read-only local inspection found Codex `0.153.4`, OpenCodex `2.42.0`, and the
feature disabled. An invocation-only override makes `codex features list` report
it enabled; the version without `features.` leaves it disabled. This proves flag
recognition, not successful notes/history execution through OpenCodex.

GSD Pi calls its provider directly and does not read Codex CLI feature settings.
Its `context_management.codex_remote_compaction` path is the separate Remote V2
extension with provider/model-bound checkpoints. It remains unchanged. A misplaced
`context_management.experimental_mode` in GSD preferences now produces a warning
and is ignored, instead of silently suggesting the feature has been enabled.

Do not globally enable the native experiment on the strength of this audit. A
later, separately approved native-Codex canary can use an invocation-only override:

```sh
codex -c features.context_management.experimental_mode=true
```

Use a disposable directory/session and the existing model/routing. Establish
account eligibility and actual tool activation, then test recall across a context
boundary and session resume against a flag-off control. Record protocol failures,
latency and tokens without auth headers, credentials or full private transcripts.
Persistent enablement requires that evidence; it still would not enable the
feature in GSD Pi.

## Verification and release boundary

Offline provider tests cover request shapes, usage accounting, cost thresholds,
compatibility loading and override precedence. GSD regression covers preferences,
role/effort selection, compaction and subagent execution. Final commands and actual
counters are recorded in `docs/herdr-integration/PLANNING.md`.

Final results: 202 Pi AI tests passed (4 skipped), 308 compiled GSD regression
tests passed, 137 changed-source tests passed, and 72 focused registry cases passed
(33 excluded). Counts overlap. Core build, extension/Pi AI typechecks and diff
whitespace checks pass. The package-local full registry suite still has 11 failures
reproduced with unchanged baseline code. Standalone coding-agent typechecking has
three source/dist private-class conflicts in unchanged package commands; use the
supported clean/bootstrap build for the integrated build gate. These are recorded
limitations, not claims that every repository test is green. No install or package
publication validation was performed.

Mocked transport tests establish serialization and parser behavior, not a proxy's
new capability or a model quality/latency improvement. Native hosted compaction,
dynamic `configuration_update`, cache breakpoint policy, automatic Fast mode and
automatic Astra routing remain outside this change. Adopt them only through a
separate capability/evaluation decision.
