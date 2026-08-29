# Source Lineage and Repository Maintenance

## Current policy

`penggin/gsd-pi-herdr` is operated as a self-contained downstream distribution.
The source-base commit recorded in release metadata is historical provenance,
not an instruction for automation to contact another repository.

Without a new explicit user authorization, runtime code, CI, release scripts,
and maintenance commands must not:

- add or fetch an original-project remote;
- query its issues, releases, raw files, or package identity;
- open issues, pull requests, tags, or releases there;
- publish or modify packages/images owned by it.

## Branch model

```text
main                 # downstream integration/release line
  ├── feature/*      # focused implementation
  └── compat/herdr-* # temporary Herdr compatibility work
```

## Repository impact analysis

Compare refs already available in this repository:

```bash
pnpm run herdr:repository-impact -- \
  --base origin/main \
  --head HEAD \
  --output build/herdr-repository-impact.json \
  --markdown
```

The command verifies ancestry, lists exact commits/files, classifies semantic
risk, and selects downstream gates. It performs no fetch, merge, rebase, push,
publish, or remote mutation.

## Impact matrix

### Subagent changes

Run backend abstraction, Local/Cmux/Herdr parity, parallel/chain/background/
retry/fork/isolation, cancellation, and missing-final-response regressions.

### Extension/event changes

Run root Herdr reporter, state authority, preference validation, and extension
load/reload tests.

### CLI/resource/package changes

Run private worker packaging, bundled resource discovery, `gsd --build-info`,
isolated tarball installation, and `validate-pack`.

### Process/signal changes

Run worker cancellation, descendant cleanup, pane-loss, and orphan recovery tests.

## Herdr compatibility

Herdr remains an external runtime and is checked by capability rather than by
version alone. For a candidate Herdr release:

1. record the exact binary identity;
2. run `herdr --version` and `herdr api schema --json`;
3. verify all required socket methods, CLI helpers, and plugin contracts;
4. run real Herdr contract/E2E tests in isolated XDG/config/state/socket roots;
5. update compatibility metadata only after evidence passes.

## Release metadata

Every tarball contains `dist/herdr-release.json` with:

- package name and downstream version/commit;
- downstream source-base commit;
- historical source-lineage commit;
- supported Herdr version/protocol/schema evidence;
- required verification gates;
- the prior known-good rollback tuple;
- clean/dirty build state.

Inspect an installed artifact with:

```bash
gsd --build-info
```

## Future source imports

If a future user explicitly authorizes importing source changes, first create a
new decision record defining the exact source, allowed network operations,
review branch, conflict policy, and required gates. Do not silently reactivate
the historical remote-tracking workflow.

## Anti-patterns

Do not:

- use a clean textual merge as semantic proof;
- move orchestration policy into Herdr runtime code;
- preserve obsolete downstream code merely because it compiles;
- fork Herdr when its public APIs already satisfy the requirement;
- delete known-good artifacts or durable worker evidence before replacement
  evidence passes all gates.
