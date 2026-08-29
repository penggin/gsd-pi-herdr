# Upstream Maintenance for the Managed GSD Fork

## Objective

Keep `penggin/gsd-pi-herdr` close enough to `open-gsd/gsd-pi` that upstream improvements are adopted routinely, while preserving deliberate downstream Herdr behavior and other fork-specific fixes.

AI-assisted maintenance lowers mechanical conflict cost, but tests and semantic review remain mandatory.

## Branch model

```text
open-gsd/gsd-pi:main
        │
        ▼
upstream-main     # pristine mirror target; no downstream commits
        │
        ▼
main              # downstream stable/integration line
        │
        ├── feature/*
        └── compat/*
```

Never commit downstream implementation directly to `upstream-main`.

## Initial state

Before Herdr document migration:

- fork `main`: `c2e61def5d6d3d8c516d115a53654b229f658915`;
- current upstream at inspection: `4b26a642c0121ae6161abbb6f2dc6937c78874dd`;
- upstream delta: 29 commits;
- downstream `main` had no unique commits;
- custom historical branch: `fix/cmux-split-cli` at `5b74d301b6d1599df5fe0a385b90a28b48492b9a`.

`main` and `upstream-main` were advanced to the current upstream base before integrated Herdr work began.

## Regular synchronization procedure

1. Identify current `open-gsd/gsd-pi:main` SHA.
2. Compare it with `upstream-main` and review upstream release/commit scope.
3. Advance `upstream-main` only to an actual upstream commit.
4. Integrate into a temporary sync branch or `main` with a normal reviewed history operation.
5. For each conflict, identify the upstream semantic change and the downstream intent before choosing a resolution.
6. Run upstream tests for the changed area.
7. Run downstream tests determined by the impact matrix below.
8. Update the Herdr living plan if the synchronization changes architecture, compatibility, or next work.

## Impact matrix

### Upstream subagent changes

Re-run:

- backend abstraction tests;
- local parity;
- cmux regression;
- Herdr worker parity;
- parallel/chain/background/retry/fork/isolation tests;
- cancellation/missing-final-response behavior.

### Upstream extension/event changes

Re-run:

- root Herdr reporter tests;
- state authority tests;
- configuration migration/validation;
- Herdr integration load/reload tests.

### Upstream CLI/resource packaging changes

Re-run:

- internal worker entrypoint packaging/smoke test;
- packaged resource discovery;
- downstream install/build validation.

### Upstream process/signal changes

Re-run worker cancellation and orphan cleanup tests.

## Custom commit discipline

Downstream commits should be easy to explain independently:

```text
refactor(subagent): extract execution backend contract
fix(cmux): use current split and surface CLI commands
feat(herdr): report root GSD state
feat(herdr): add persistent worker backend
fix(herdr): reconcile pane loss during cancellation
```

Do not mix unrelated cleanup into compatibility ports unless required to make the implementation correct.

## Upstreamable vs downstream-only work

It is acceptable for the fork to contain downstream-only behavior. Still classify changes:

- generally useful GSD bug fix: candidate for upstream PR;
- neutral architectural cleanup: candidate for upstream if low-risk;
- generic runtime abstraction: potentially upstreamable;
- Herdr-specific product behavior: may remain downstream;
- experimental workflow/policy: downstream until proven broadly useful.

This classification helps reduce future divergence without forcing every useful local improvement through upstream review first.

## Herdr compatibility tracking

Herdr remains an external dependency. Track it by capability rather than mirroring its source.

For a new Herdr release:

1. obtain the exact binary/release identity;
2. record `herdr --version`;
3. export `herdr api schema --json`;
4. verify required methods and CLI behavior;
5. run real Herdr contract/E2E tests;
6. canary representative GSD workflows;
7. add/update the compatibility table only after evidence.

## Herdr fork threshold

Do not fork Herdr merely for convenience.

A Herdr core fork becomes justified only if:

- a concrete GSD requirement cannot be implemented through documented CLI/socket/plugin APIs;
- the limitation is reproduced on the supported Herdr release;
- the missing capability materially blocks correctness or required UX;
- a minimal core change is understood and tested;
- the living plan/decision record is updated first.

## Automated upstream watch

Future CI should regularly report:

```text
current upstream-main SHA
latest open-gsd/main SHA
commits/files changed
whether affected Herdr integration paths changed
focused downstream test recommendations
Herdr latest stable/version/schema capability result
```

Do not auto-merge upstream solely because text conflicts are absent.

## Release metadata

Every downstream release should record the exact upstream base, for example:

```json
{
  "downstream": "<fork-version>",
  "upstream": {
    "repository": "open-gsd/gsd-pi",
    "commit": "4b26a642c0121ae6161abbb6f2dc6937c78874dd"
  },
  "herdr": {
    "tested": ["0.8.2"],
    "protocols": [20]
  }
}
```

The exact packaging/version syntax will be decided before public downstream releases.

## The old patch-queue strategy

The original `penggin/gsd-herdr` plan proposed maintaining one GSD-Pi patch per upstream version. That is superseded for production because this repository is now the full downstream source tree.

The useful principles remain:

- know the exact upstream base;
- keep custom changes focused;
- test every supported execution mode;
- never treat a clean textual application/merge as proof of semantic correctness.

## Anti-patterns

Do not:

- use `main` as an opaque pile of upstream and downstream edits without recording the upstream base;
- modify `upstream-main` with fork-only code;
- let AI resolve conflicts without tests;
- preserve obsolete downstream code just because it still compiles;
- silently skip an upstream security/correctness fix because it conflicts with Herdr code;
- force a Herdr fork when existing public APIs suffice;
- delete historical known-good releases before a replacement passes canary.
