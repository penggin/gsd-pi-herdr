---
name: gstack-design-review
description: Report-only pre-milestone product and interaction design critique for substantial user-facing work.
disable-model-invocation: true
version: 0.1.0
gsd:
  kind: assessment-gate
  invocation: suggest
  lifecycle:
    - pre-milestone
  effect: report-only
  revisionBinding: optional
  resultSchema: gsd.findings/v1
  capabilities:
    - repository.read
    - artifacts.read
---

# GStack-derived design review adapter

Assess only the scope and host-approved artifacts supplied by GSD. Do not create or edit a milestone, roadmap, plan, source file, decision, branch, or worktree.

Evaluate whether the proposed experience is sufficiently intentional before milestone creation:

- user goal, target persona, and primary journey;
- information hierarchy and interaction states;
- empty, loading, error, permission, and recovery states;
- accessibility and responsive behavior;
- consistency with existing product patterns found in the repository;
- unresolved choices that would cause implementation churn.

Report concrete gaps, not aesthetic preferences without evidence. Cite an approved artifact or repository path for every actionable finding. If no actionable gaps are supported by evidence, return a pass verdict with an empty findings array.

Return exactly the host-required `gsd.findings/v1` JSON object. A recommendation is not an implementation plan and has no GSD lifecycle authority.
