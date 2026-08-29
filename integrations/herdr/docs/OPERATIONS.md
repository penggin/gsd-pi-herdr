# Downstream and Herdr Operations

## Current phase

No production install is available. This document defines the intended workflow for the managed fork.

## Branches

```text
upstream-main                  reviewed mirror of open-gsd/gsd-pi
main                           downstream releasable line
integration/herdr-*            active feature work
sync/upstream-<date-or-ref>    staged upstream merge
release/*                      release preparation
```

Never add downstream commits to `upstream-main`.

## Development build

The fork uses GSD-Pi's normal source build:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run build:core
pnpm run typecheck:extensions
```

Focused tests should run before the full merge gate. Exact commands are selected after M0.7 audits current test coverage.

## Herdr development setup

The first implementation should support a development mode that:

1. verifies a compatible Herdr binary;
2. links or installs the Herdr plugin assets from `integrations/herdr/`;
3. launches the locally built GSD binary in a Herdr pane;
4. uses an isolated integration state root;
5. runs a fake-model/fake-child smoke test before live provider testing.

## Upstream synchronization

1. fetch the new upstream commit;
2. move `upstream-main` only after verifying source identity;
3. create `sync/upstream-<ref>` from downstream `main`;
4. merge `upstream-main` into the sync branch;
5. review changes affecting subagents, cmux, extension loading, process control, sessions, isolation, packaging, and tests;
6. resolve semantic conflicts;
7. run upstream affected tests plus Herdr parity/E2E tests;
8. update `integrations/herdr/PLANNING.md`;
9. merge to downstream `main` only when green.

## Canary

A canary build tracks a newer upstream or experimental Herdr integration without replacing the stable installation.

```text
stable binary/config/state pointers remain intact
canary binary has a distinct command or install root
state schemas remain backward-readable where feasible
promotion requires automated and manual representative workflows
```

## Rollback

Downstream releases are installed side by side. Rollback switches the active version pointer and corresponding plugin assets. It does not mutate an old release in place.

A rollback must preserve:

```text
previous binary
previous extension/plugin assets
previous config schema reader
runtime evidence needed to diagnose interrupted workers
```

## Runtime inspection

Planned commands:

```text
/gsd herdr status
/gsd herdr doctor
/gsd herdr workers
/gsd herdr cleanup
```

Planned Herdr actions:

```text
focus worker tab
focus failed worker
show worker dashboard
clean expired successful workers
reconcile stale authority
```

## Failure handling

- A missing required capability blocks Herdr backend selection.
- Ambiguous launch blocks duplicate fallback.
- A manually closed worker pane becomes a visible failure/orphan state.
- Failed and blocked panes are retained by default.
- Support bundles redact secrets and include only bounded metadata plus requested logs.

## Retiring the old planning repository

`penggin/gsd-herdr` remains available as a historical reference during consolidation. After the downstream plan and first implementation checkpoint are verified, mark it archived/read-only rather than deleting evidence.
