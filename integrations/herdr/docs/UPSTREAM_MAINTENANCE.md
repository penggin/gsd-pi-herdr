# Managed Downstream Maintenance

## 1. Objective

Track `open-gsd/gsd-pi` closely while preserving deliberate downstream Herdr features and selected fixes.

## 2. Branch authority

```text
upstream-main  = exact reviewed upstream commit; no downstream changes
main           = releasable downstream distribution
integration/*  = feature development
sync/*         = upstream merge and semantic validation
release/*      = release preparation
```

At migration, both `upstream-main` and `main` were synchronized to upstream commit `4b26a642c0121ae6161abbb6f2dc6937c78874dd` before downstream documentation commits.

## 3. Upstream adoption workflow

1. identify the target upstream commit/release;
2. review release notes and changed paths;
3. move `upstream-main` to that exact commit;
4. branch `sync/upstream-<ref>` from downstream `main`;
5. merge `upstream-main` into the sync branch;
6. classify conflicts as textual, structural, or semantic;
7. inspect subagent, cmux, extension, session, isolation, packaging, and process changes even when conflict-free;
8. port or remove downstream changes deliberately;
9. run affected upstream tests and Herdr parity/E2E gates;
10. update the living plan and downstream change ledger;
11. merge to `main` only after review.

## 4. Downstream change organization

Custom changes should be grouped into coherent components and commits:

```text
refactor(subagent): introduce execution backend contract
fix(cmux): use supported surface commands
feat(herdr): add runtime client and backend
feat(herdr-worker): add filtered JSON-mode runner
feat(herdr): add persistent pane pool
fix(...): downstream-only defect correction
```

Avoid mixed commits containing an upstream merge, architecture refactor, unrelated cleanup, and feature behavior.

## 5. Semantic drift review

High-risk upstream changes include:

```text
subagent launch args or environment
JSON event formats and parser behavior
parallel/chain/retry/background scheduling
session fork creation
worktree isolation or merge
run-store/result schemas
extension discovery and bundling
signal/abort behavior
cmux integration
CLI packaging and installed resource paths
```

For these, an agent must explain the upstream intent and how the downstream design adapts. Conflict-free merging is not enough.

## 6. Existing cmux branch

`fix/cmux-split-cli` is based on the pre-sync commit and contains one custom commit. Do not merge it blindly. During M0.9:

- compare it with current upstream cmux code;
- verify whether upstream has independently fixed any part;
- retain valid CLI compatibility behavior;
- fold the behavior into the unified backend contract;
- add regression tests for empty shells, command delivery, interrupt, and raw JSON suppression.

## 7. Herdr updates

Herdr remains external. Validate new versions using:

```text
installed API schema
required request/response shapes
plugin manifest compatibility
pane identity/environment behavior
real smoke tests
```

A Herdr version number alone is insufficient.

## 8. Downstream releases

Each release records:

```text
downstream version and commit
upstream GSD base commit
supported Herdr versions/capability set
integration protocol and artifact versions
known downstream changes
exact test evidence
rollback target
```

Keep at least one previous known-good release available.

## 9. Automation

Planned scheduled checks:

- detect new GSD upstream commits/releases;
- generate a path/risk summary;
- test mergeability in an isolated branch/worktree;
- run selected compatibility tests;
- detect new Herdr releases and schema changes;
- maintain one tracking issue rather than duplicate alerts.

Automation may prepare changes but does not auto-promote an unreviewed upstream merge.

## 10. Upstreaming

When a downstream abstraction or fix is broadly useful and focused, it may be proposed upstream. Downstream operation must not depend on acceptance. If upstream lands equivalent behavior, remove or adapt the duplicate after parity tests pass.
