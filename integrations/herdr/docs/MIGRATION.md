# Planning Migration and Fork Baseline

## Purpose

This document records the move from the standalone planning repository `penggin/gsd-herdr` into the managed downstream fork `penggin/gsd-pi-herdr`.

## Source material

The migrated planning corpus was taken from:

```text
repository: penggin/gsd-herdr
commit:     d13fbe85ad584dd7505a5420d668c780ac137726
```

The source repository contained:

- `AGENTS.md`
- `PLANNING.md`
- `README.md`
- architecture, configuration, contract, operations, security, testing, decisions, and upstream-maintenance documents
- the M0.6 GSD-Pi package-loading investigation

The concepts and evidence were migrated and normalized into `integrations/herdr/`. The source repository remains a historical reference until the downstream integration reaches a stable checkpoint.

## Target fork inspection

At inspection time:

```text
penggin/gsd-pi-herdr main: c2e61def5d6d3d8c516d115a53654b229f658915
open-gsd/gsd-pi main:      4b26a642c0121ae6161abbb6f2dc6937c78874dd
upstream difference:       29 commits
```

The downstream `main` had no custom commits. One custom branch existed:

```text
branch: fix/cmux-split-cli
commit: 5b74d301b6d1599df5fe0a385b90a28b48492b9a
message: fix(cmux): use current split and surface CLI commands
```

## Baseline actions

Before adding migrated documentation:

1. created `upstream-main` at upstream commit `4b26a642c0121ae6161abbb6f2dc6937c78874dd`;
2. fast-forwarded downstream `main` to the same commit;
3. created `integration/herdr-foundation` from the synchronized baseline;
4. preserved `fix/cmux-split-cli` unchanged for a later semantic audit.

## Architecture change

The original standalone plan optimized for:

```text
official GSD-Pi + minimal generic patch + external integration repository
```

The current plan uses:

```text
managed downstream GSD-Pi fork
  + first-class execution backend abstraction
  + local/cmux/Herdr implementations
  + in-tree Herdr integration assets

official Herdr
  + public plugin/CLI/socket APIs
```

This change was made because the fork will already be synchronized and tested as a downstream distribution. Artificially minimizing the GSD patch would constrain architecture without eliminating maintenance work.

## Preserved findings

The following conclusions remain valid after consolidation:

- GSD must remain authoritative for orchestration and result semantics.
- JSON-mode subagent output must remain complete for parent-side parsing.
- Raw token-delta JSON must not be mirrored into worker terminals.
- Main-pane and worker-pane authority must remain separate.
- Monitored execution must not silently fall back to an invisible process.
- Process, environment, signal, artifact, and cleanup paths require security-focused tests.
- Herdr should be capability-checked against its actual schema.

The M0.6 package-loading investigation is retained as historical build evidence, although a managed source build removes the need for a production resource-overlay strategy.

## Follow-up

The next work is not implementation. M0 first verifies Herdr's exact API contract, audits the current subagent/cالمux code after the upstream synchronization, and finalizes code/package placement.
