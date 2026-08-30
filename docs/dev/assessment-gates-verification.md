# Assessment Gates Verification

This document records the implementation verification for ADR-050. The GSD database remains the canonical state owner; assessment skills and the optional pack cannot mutate GSD lifecycle state.

## Verified behavior

- Existing skills without `gsd` metadata retain their prior discovery and invocation behavior.
- Assessment gate bodies are excluded from normal model skill catalogs and direct `/skill:` expansion.
- `suggest` gates require explicit approval; `manual` gates are neither activated nor suggested.
- Gate lifecycle placement and post-validation source revision binding are enforced by the host.
- The isolated gate child receives only capability-filtered read and verifier tools. It receives no source-writing, Git mutation, GSD mutation, deployment, arbitrary MCP, or generic shell tools.
- Gate output must validate as `gsd.findings/v1`; malformed output gets one structured retry and then becomes inconclusive.
- Source drift during a run becomes a policy violation. Later source drift makes persisted results stale without reverting user changes.
- Assessment runs and recommendation dispositions are stored separately from Task Attempts.
- Findings never change validation, milestone, task, remediation, ship, or release state automatically.
- Structured skill matching uses exact tokens and normalized phrases while preserving legacy `when` rules.
- The optional GStack-derived pilot pack is independently discoverable and is not a core dependency.

## Verification commands

The final staged change set was checked on 2026-08-30 (macOS arm64) with:

```sh
pnpm --filter @gsd/pi-coding-agent exec vitest run test/skills.test.ts
pnpm --filter @gsd/agent-core test
pnpm run test:changed:src
pnpm run test:herdr-integration
pnpm run typecheck:extensions
pnpm run build:core
pnpm run validate-pack
git diff --cached --check
```

Focused suites cover loader compatibility, invocation policy, lifecycle placement, revision binding, report-only capabilities, source integrity, findings validation, persistence/projection behavior, recommendation disposition, structured matcher regressions, restricted subagent isolation, and the optional pack dependency boundary.

Results:

- changed-source suite: 201 passed
- Pi skill loader suite: 34 passed
- agent-core suite: 125 passed
- explicit auto/quick/debug/forensics/validation/ship/recovery/worktree/Task Attempt suite: 263 passed
- Herdr integration suite: 19 passed
- extension typecheck: passed
- core build: passed
- package validation: isolated and global installation passed; package reported safe to publish
- schema JSON and staged diff checks: passed

## Dependency audit

`packages/gsd-assessment-pack-gstack` is a standalone workspace package with no runtime dependencies. Neither the root package nor GSD core packages depend on it. Core code contains only provider-neutral assessment contracts and does not require GStack, Codex, or another provider-specific CLI.

## Known v1 limitations

- `browser.inspect` is recognized metadata but rejected by the v1 runner until an origin-restricted browser sandbox is available. Browser QA is not simulated with prompt-only enforcement.
- `process.verification` can run only host-approved verifier IDs mapped to fixed argv arrays. Gate authors cannot submit shell strings or install packages.
- The pilot pack includes only design review and second-opinion review. Security, browser QA, and benchmark adapters remain intentionally unshipped until their required controlled tools exist.
- Assessment findings are advisory records. Applying remediation remains an explicit GSD-owned action.
