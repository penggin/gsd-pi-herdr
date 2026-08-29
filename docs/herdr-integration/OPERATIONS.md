# Herdr Integration Operations

## Development branches

- `main`: downstream integration/release line.
- `feature/*`: focused work.
- `compat/herdr-*`: temporary Herdr compatibility adaptation.

## Repository impact workflow

Normal work uses this repository only. Do not add or fetch an original-project
remote. Compare the downstream integration base to the candidate checkout:

```bash
pnpm run herdr:repository-impact -- \
  --base origin/main \
  --head HEAD \
  --output build/herdr-repository-impact.json \
  --markdown
```

The report selects focused semantic gates. It never fetches, advances branches,
merges, rebases, pushes, publishes, or opens issues.

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

The automated preflight validates:

```text
herdr --version
herdr api schema --json
```

and confirm the initial capability set documented in `INTEGRATION_CONTRACT.md`.

Do not treat a compatible version string alone as sufficient proof.

```bash
pnpm run herdr:capability-check -- --mode supported --output build/herdr-capability.json
```

`supported` requires the exact production version/protocol. `canary` permits a
newer version/protocol only when every required API method and CLI helper remains
present.

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

The runtime exposes GSD-native diagnostics:

```text
/herdr-status
/herdr-doctor
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
downstream package/version/tag
downstream source-base commit and historical lineage commit
Herdr versions/capability sets tested
Herdr integration schema version
known downstream-only features/fixes
verification commands/results
```

The package identity is `@penggin/gsd-pi-herdr`. Every packed artifact includes
`dist/herdr-release.json` and exposes it through `gsd --build-info`.

Generate the machine-readable identity with:

```bash
pnpm run herdr:release-stamp -- \
  --base-ref origin/main \
  --capability build/herdr-capability.json \
  --output dist/herdr-release.json
```

The command is read-only except for its explicit output file. It never advances
branches, fetches, merges, publishes, or promotes the known-good rollback file.

## Canary policy

Before adopting substantial downstream changes or a new Herdr stable release:

1. build a canary downstream binary;
2. run automated unit/parity/E2E tests;
3. exercise representative real GSD auto/subagent workflows;
4. verify no raw JSON rendering regression;
5. verify cancellation and pane-loss behavior;
6. promote only after evidence is recorded.

## Rollback

Keep at least one prior known-good downstream build/tag. Rollback should restore the prior GSD binary/version without deleting durable Herdr worker evidence until the operator explicitly cleans it.

The exact retained tuple lives in
`integrations/herdr/release/known-good.json`. Replace it only after a candidate
passes the complete promotion gate; release stamping embeds but does not mutate
that prior target.

## Separate Herdr plugin

An optional operations plugin may live under `integrations/herdr/plugin/`. It should provide dashboard/focus/cleanup/reconciliation UX but should not become required for the core GSD Herdr backend unless a later design decision explicitly chooses that dependency.
