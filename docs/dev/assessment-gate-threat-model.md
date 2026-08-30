# Assessment Gate threat model

## Protected assets

- repository source and Git history;
- GSD SQLite state and generated projections;
- provider, GitHub, deployment, and browser credentials;
- validated source-revision integrity;
- user accounts, staging data, deployment, and release state.

## Trust boundaries

The gate skill body and model output are untrusted. GSD host metadata, user approval, source bindings, capability grants, schema validation, and DB writes are trusted host operations. AssessmentRun SQLite rows are canonical; projections and gate prose are not authority.

## Threats and controls

| Threat | Runtime control |
|---|---|
| Gate is activated as an ordinary skill | Loader forces every `assessment-gate` out of the normal model catalog, even if frontmatter omits `disable-model-invocation` |
| Suggestion silently executes | Suggestion block contains compact metadata only; `/gsd gate run` requires interactive approval |
| Gate loads unrelated instructions/extensions or mutation tools | Restricted subagent uses bare mode, disables extension/skill/template/theme auto-discovery, loads one explicit GSD restricted extension, and selects only named `assessment_*` tools |
| Path traversal or symlink escape | Repository paths must be relative, canonicalized, contained in an approved root, and cannot resolve through an escaping symlink |
| Arbitrary command execution | No shell tool; verifiers are opaque host-approved IDs mapped to fixed command and argv arrays, bounded timeout/output, `shell:false` |
| Source/Git/GSD mutation | No edit/write/GSD/package/deploy tools; Git tool supports fixed read-only status/diff/log actions; before/after source snapshot comparison |
| Source changes despite controls | Run ends `policy-violation` or `stale`, changed paths are reported, user changes are not reverted |
| Validation replay against different source | Post-validation start requires equality with the canonical validation `testedSourceRevision`; host-owned identity fields are revalidated in output |
| Model forges run/scope/result | `runId`, gate, lifecycle, revision/digest, enums, evidence, and schema are validated by host; malformed output gets one retry only |
| Secret exfiltration through findings/logs | Child has no environment/shell inspection tool; verifier environment is stripped; result and bounded diagnostic text are redacted |
| Browser causes external mutation | `browser.inspect` is refused in v1; no prompt-only substitute is provided |
| Findings mutate lifecycle | Gate has no DB handle or GSD writer tools; only host persistence writes AssessmentRun rows; remediation remains explicit |
| Denial through large output/process | read/search/result sizes, file counts, verifier timeout, and process output are bounded |

## Residual risks and limitations

- The model provider necessarily receives the assessment prompt and approved evidence it reads. Operators must choose appropriate providers and scope.
- Static redaction cannot recognize every secret format. The primary defense is non-disclosure through the restricted tool surface and minimal context.
- The v1 process verifier assumes the operator who approves the verifier definition trusts that executable and argv. Gates cannot supply or alter them.
- Browser and benchmark packs are not shipped until their dedicated sandboxes exist.
