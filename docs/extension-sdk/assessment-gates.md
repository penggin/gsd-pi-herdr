# Authoring optional Assessment Gates

Assessment Gates are Agent Skills with a GSD policy namespace. They are installed through the existing Pi skill/package mechanisms; there is no separate gate package manager.

## Minimal gate

```yaml
---
name: example-security-review
description: Report-only security assessment for validated changes.
disable-model-invocation: true
version: 1.0.0
gsd:
  kind: assessment-gate
  invocation: manual
  lifecycle:
    - post-validation
  effect: report-only
  revisionBinding: required
  resultSchema: gsd.findings/v1
  capabilities:
    - repository.read
    - artifacts.read
---
```

The body should explain what to assess and how to prioritize findings. It must not instruct the agent to edit files, create plans, operate Git/GSD state, install packages, deploy, or maintain separate memory. The host always blocks automatic body injection.

## Metadata

| Field | Values and rules |
|---|---|
| `kind` | `ordinary-skill` or `assessment-gate`; missing `gsd` means legacy ordinary skill |
| `invocation` | gates use `suggest` or `manual`; ordinary skills omit it or use `auto` |
| `lifecycle` | v1: `pre-milestone`, `post-validation` |
| `effect` | v1: `report-only` only |
| `revisionBinding` | `required` or `optional`; post-validation must be `required` |
| `resultSchema` | `gsd.findings/v1` |
| `capabilities` | `repository.read`, `artifacts.read`, `browser.inspect`, `process.verification` |

Unknown or contradictory metadata makes the gate unhealthy and prevents execution. `disable-model-invocation: true` plus `gsd.invocation: auto` is a diagnostic conflict and is never guessed. Gates are always hidden from the ordinary model body catalog regardless of that legacy flag.

`browser.inspect` is reserved but refused by the v1 runner. `process.verification` requires a verifier definition approved by the host/operator. Do not ship a browser or benchmark gate as prompt-only emulation.

## Output

Return one JSON object and no prose or Markdown fence. Use the host-provided run identity and binding values exactly. Each `critical`, `high`, `medium`, or `low` finding needs at least one evidence reference. Findings are recommendations; severity is not a GSD lifecycle blocker.

See [`gsd-findings-v1.schema.json`](../schemas/gsd-findings-v1.schema.json) and [`agent-skill-gsd-v1.schema.json`](../schemas/agent-skill-gsd-v1.schema.json).

## Invocation and approval

- `suggest`: compact name/description/lifecycle metadata may be shown once when relevant. It does not run. A decline or suppression is remembered for the scope.
- `manual`: appears in `/gsd gate list` and runs only after `/gsd gate run <name>` plus interactive approval.

The approval preview shows lifecycle, scope/milestone, capabilities, external target, report-only effect, and estimated model/retry cost.

## Package provenance

An adapter pack should include upstream repository, audited immutable revision, source skill, license, changed/removed behavior, and the GSD authority boundary. Preserve upstream notices when copying a substantial portion. Keep provider binaries, source-changing tools, installers, telemetry, planning state, and deployment workflows out of the core contract.

## Testing checklist

- ordinary skills remain unchanged and the gate body is absent from normal prompts;
- suggest/manual routing and decline suppression;
- lifecycle rejection and exact revision matching;
- read success plus path/symlink escape rejection;
- absence of edit/write/Git mutation/GSD mutation/generic shell tools;
- source snapshot unchanged or `policy-violation`;
- valid findings, missing evidence, invalid enum, one retry, inconclusive fallback, and redaction;
- no milestone or validation status mutation;
- package installs through existing Pi skill discovery and core runs without it.
