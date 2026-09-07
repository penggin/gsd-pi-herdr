# Sol/high to Astra/medium: explicit role-policy migration

The operator approved this migration on 2026-09-07, superseding the prior
readiness-only decision. `astra-midium` means `gpt-6-astra` with `medium` reasoning.
This is an ordinary Pi model migration, not the archived App Server delegation.

## Effective policy

| Existing workload | New route | Effort | Context ceiling |
| --- | --- | --- | --- |
| Fable planning/discussion and named planner | `gsd-fable/gpt-6-astra` | medium | 872,000 |
| Opus named UI roles/default Heavy mapping | `gsd-opus/gpt-6-astra` | medium | 272,000 |
| General OpenCodex Sol policy entry | `opencodex/gpt-6-astra` | medium | 872,000 |
| Sonnet research/execution/verification/subagent | Existing GLM route | max | unchanged |
| Haiku simple execution | Existing GLM route | max | unchanged |
| Sonnet/Haiku fallbacks | Existing Luna routes | max | unchanged |

Provider/authentication, fallback order, tools and lifecycle authority are not
changed. Dynamic difficulty routing stays disabled in the Pi preferences.
Named-role configuration retains its existing profile mechanism. Native bundled
Sol entries remain available for other explicit uses. Historical transcripts,
Attempts, summaries and previous verification evidence are not rewritten.

Native OpenAI supports Astra medium and a 1.05M context window. The installed
Codex 0.153.4/OpenCodex catalog reports 872K on its Codex route; that smaller
operational ceiling controls Fable. Opus keeps its narrower 272K budget.
[Official Astra model](https://developers.openai.com/api/docs/models/gpt-6-astra).

## Changes and protections

- Native OpenAI/Codex Astra entries have reasoning metadata, prices and long-input
  tiers. Native entries retain the supported effort range, not a global medium cap.
- Migrated machine-local policy entries allow only medium. Pi's normal thinking
  clamping converts inherited high/max to medium, without a blanket GPT override.
- Phase/named-role settings explicitly carry medium, overriding ambient session
  settings. Subsequent GLM/Luna roles retain max.
- Interactive subagent instructions now include configured thinking and model.
  Regression covers omitted/off settings and role selection after repeat/resume.
- Astra suppresses unsupported temperature on native API and canonical Codex
  endpoints. Proxy entries explicitly opt out; unknown proxies are not guessed.
  Tools, phase replay, encrypted reasoning and cache-key behavior remain intact.
  [Migration constraints](https://developers.openai.com/api/docs/guides/latest-model).

## Operator helper

`scripts/migrate-sol-high-to-astra-medium.mjs` is explicit and on-demand, never a
startup migration. Supply an absolute `--file` and `--kind` (`models`, `preferences`,
`settings`, or `roles`). Preview is default. `--apply` creates a private backup
before atomic replacement and checks for intervening source changes. This is not
a kernel-level compare-and-swap against an uncooperative writer; apply at a
configuration-editing boundary.

The helper changes known model/effort fields, not arbitrary prose, credentials,
providers or sessions. Unexpected effort, target-model collisions, unsupported
YAML shapes and symlinks fail visibly. Review the preview; never recursively
replace model names across a home directory or `.gsd/` history.

## Verification and rollout limits

Before routing changes, real Mac and `penglab` proxy requests sent Astra/medium
and returned exact `hi`, terminal stop, 21 input / 5 output tokens each. These are
compatibility checks, not quality, latency or cost benchmarks. The temporary
canary model inherited zero price metadata; its cost display is not an invoice.

Final targets, backups and regression/build evidence are recorded in
`docs/herdr-integration/PLANNING.md`. Running root/workers are not interrupted.
Saved manual sessions may retain their historical model: explicitly select
Astra/medium or begin a new session. Strict GSD phase dispatch uses current phase
settings on the next dispatch. Config reload, source build, install and process
restart are distinct; do not claim a running process has loaded new code.

Native Codex experimental context management remains off and unverified through
the proxy. No App Server, new authority or orchestration state is introduced.
