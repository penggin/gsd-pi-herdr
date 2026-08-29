# Herdr Integration Operations

## Development branches

- `upstream-main`: pristine mirror target for `open-gsd/gsd-pi:main`.
- `main`: downstream integration/release line.
- `feature/*`: focused work.
- `compat/herdr-*`: temporary Herdr compatibility adaptation.

The existing `fix/cmux-split-cli` branch is preserved until M2 revalidates and incorporates it through the backend abstraction.

## Upstream sync workflow

1. Fetch/identify the latest `open-gsd/gsd-pi:main` commit.
2. Move `upstream-main` to that exact upstream commit only after verifying lineage.
3. Integrate `upstream-main` into a temporary downstream sync branch or `main` through a normal reviewed merge/rebase workflow.
4. Resolve conflicts semantically, not mechanically.
5. Run upstream-focused tests for touched code.
6. Run downstream Herdr parity/E2E tests when subagent, extension loading, CLI, resources, packaging, or preferences changed.
7. Record the new upstream base in downstream release metadata and the living plan.

## Development environment

Use the normal GSD-Pi workspace toolchain:

```bash
pnpm install --frozen-lockfile
pnpm run typecheck:extensions
pnpm run test:unit
```

Run narrower tests during active development, then the appropriate upstream verification commands before integration.

Herdr integration E2E needs a supported Herdr binary and should use isolated named sessions/workspaces so tests do not mutate a developer's normal Herdr state.

## Herdr capability preflight

A diagnostic helper should validate:

```text
herdr --version
herdr api schema --json
```

and confirm the initial capability set documented in `INTEGRATION_CONTRACT.md`.

Do not treat a compatible version string alone as sufficient proof.

## Runtime operator workflow

Expected normal usage after implementation:

```text
1. Start/attach Herdr.
2. Open the project workspace/pane.
3. Run the downstream `gsd` binary.
4. GSD detects configured Herdr runtime and root pane identity.
5. Subagents appear in a dedicated worker tab.
6. Failed/blocked workers remain visible until reviewed or cleaned.
```

## Diagnostics

The fork should eventually expose a GSD-native status command, for example:

```text
/gsd herdr status
```

or equivalent CLI/slash syntax consistent with existing GSD command architecture.

Diagnostics should include:

- detected Herdr version/protocol;
- root workspace/tab/pane;
- required API/CLI capabilities;
- worker tab/pool state;
- active/retained workers;
- runtime artifact root;
- last reconciliation result;
- configuration source/effective values.

Never print full environment values or secrets.

## Worker cleanup

Cleanup categories:

- expired successful worker panes;
- explicitly acknowledged failed panes;
- stale metadata/agent authority;
- abandoned artifact directories past retention;
- orphan records with no live pane/process after explicit reconciliation.

Cleanup must not remove an execution whose outcome is still ambiguous.

## Detach/reattach

Detaching the Herdr client is normal. The server and PTYs continue running. No GSD worker should treat client detachment as cancellation.

On reattach, UI state should be derived from Herdr's current panes plus GSD durable state rather than assuming the client observed every transition.

## Root GSD crash

If the root GSD process dies while worker panes remain alive:

- worker pane processes may continue;
- their state becomes orphaned when root ownership/heartbeat is absent;
- retain pane/output/artifacts;
- do not automatically claim completion in a newly started root session in the first stable release;
- provide explicit cleanup/inspection actions.

## Pane closed manually

If a user closes a worker pane before final exit evidence:

- detect the pane disappearance and/or worker heartbeat loss;
- stop waiting indefinitely;
- mark the backend execution failed/aborted as appropriate;
- preserve logs and diagnostic context;
- do not start a replacement worker automatically unless retry policy in GSD explicitly requests a new attempt.

## Downstream releases

Each downstream release should record:

```text
downstream version/tag
upstream base commit
Herdr versions/capability sets tested
Herdr integration schema version
known downstream-only features/fixes
verification commands/results
```

A later release process may use a downstream-specific version suffix or separate package identity. That packaging decision is independent from the integration architecture and should be made before public distribution.

## Canary policy

Before adopting substantial upstream changes or a new Herdr stable release:

1. build a canary downstream binary;
2. run automated unit/parity/E2E tests;
3. exercise representative real GSD auto/subagent workflows;
4. verify no raw JSON rendering regression;
5. verify cancellation and pane-loss behavior;
6. promote only after evidence is recorded.

## Rollback

Keep at least one prior known-good downstream build/tag. Rollback should restore the prior GSD binary/version without deleting durable Herdr worker evidence until the operator explicitly cleans it.

## Separate Herdr plugin

An optional operations plugin may live under `integrations/herdr/plugin/`. It should provide dashboard/focus/cleanup/reconciliation UX but should not become required for the core GSD Herdr backend unless a later design decision explicitly chooses that dependency.
