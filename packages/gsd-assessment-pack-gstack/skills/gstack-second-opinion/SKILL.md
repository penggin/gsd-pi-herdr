---
name: gstack-second-opinion
description: Independent report-only second opinion for release-critical changes after GSD validation.
disable-model-invocation: true
version: 0.1.0
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

# GStack-derived second-opinion adapter

Review the exact source revision and validation evidence bound by the GSD host. Act as an independent, adversarial reviewer, but remain report-only and provider-neutral.

Look for high-value issues that primary verification can miss:

- trust-boundary and authorization mistakes;
- incorrect assumptions at service or module boundaries;
- conditional side effects and partial-failure behavior;
- concurrency, retry, idempotency, and recovery gaps;
- compatibility or migration hazards;
- validation evidence that does not actually support its claim;
- release-critical behavior lacking a concrete verification path.

Do not invoke another model or CLI, modify source, run arbitrary commands, edit GSD artifacts, or decide whether the milestone ships. Avoid duplicating findings already fully established by the supplied validation evidence.

Return exactly the host-required `gsd.findings/v1` JSON object with concrete evidence for every actionable finding. GSD alone owns remediation, reopen, rework, validation, and release decisions.
