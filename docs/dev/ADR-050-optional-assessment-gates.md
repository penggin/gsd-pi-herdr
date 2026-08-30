# ADR-050: Optional, report-only Assessment Gates

**Status:** Accepted
**Date:** 2026-08-30

## Context

Ordinary Agent Skills are useful for work methods such as debugging, TDD, and completion discipline. Product, design, security, staging, and performance reviews have a different trust profile: they may be expensive, lifecycle-sensitive, and influenced by external tools. Treating them as ordinary prompt text would permit accidental activation and would not enforce read-only behavior.

GSD is already the authority for project, milestone, slice, task, Task Attempt, validation, remediation, worktree, Git closeout, and release state. An optional reviewer must not become a second workflow engine.

## Decision

GSD adds a vendor-neutral Assessment Gate contract while preserving existing Agent Skill behavior. A skill without `gsd` metadata remains an ordinary skill with unchanged discovery and invocation semantics.

An Assessment Gate:

- is discovered through the existing skill/package loader;
- is never injected into the ordinary model skill catalog;
- is `suggest` or `manual`, never `auto`;
- requires explicit interactive approval before execution;
- runs in a fresh JSON-mode child with only host-selected `assessment_*` tools;
- supports only `report-only` effect in v1;
- writes no GSD state directly and returns only `gsd.findings/v1`;
- is persisted as a separate canonical `AssessmentRun`, not a Task Attempt;
- binds post-validation results to the existing validation source revision;
- does not change milestone, validation, remediation, ship, or release state.

The host creates a minimal runtime context, starts the child in bare mode, disables extension/skill/template/theme auto-discovery, suppresses normal bundled extensions, passes only approved repository roots/artifacts/verifier IDs, and reuses the common subagent JSON parser. The one explicit GSD extension detects the assessment context and registers only the bounded assessment tool profile. Before accepting output, the host verifies source integrity and validates the structured result. A source change produces `policy-violation` and is reported without reverting user work.

Assessment records are canonical in SQLite. Markdown under `.gsd/assessments/` or `.gsd/milestones/<MID>/assessments/` is a generated projection only.

## Lifecycle placement

- `pre-milestone`: binds the supplied brief/scope digest and current repository snapshot. It can return findings or a brief, but cannot create a milestone.
- `post-validation`: requires a current GSD milestone validation whose `testedSourceRevision` exactly matches the current source snapshot.

## Consequences

- Existing skills need no migration.
- Suggestions expose compact metadata only and are nonblocking.
- Declined or suppressed recommendations are stored per gate and scope by GSD.
- Findings require explicit GSD-owned remediation action.
- `browser.inspect` is recognized in metadata but refused at runtime until an origin-restricted browser sandbox exists.
- `process.verification` exposes only host-approved command/argv entries; generic shell is never exposed.
- Optional methodology packs can be installed or removed independently. GSD core has no GStack or provider-specific dependency.

## Rejected alternatives

- Prompt-only “do not modify” instructions: not enforceable.
- Reusing Task Attempts or internal quality `gate_runs`: conflates assessment with authoritative execution/lifecycle evidence.
- Allowing arbitrary shell with a warning: cannot provide a credible report-only guarantee.
- Letting findings automatically reopen validation: transfers GSD authority to an external reviewer.
- Embedding a complete vendor workflow in core: creates provider and methodology lock-in.
