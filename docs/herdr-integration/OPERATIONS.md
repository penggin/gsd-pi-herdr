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

## Human-input attention

When the visible root GSD calls `ask_user_questions`, its Herdr agent state is
`blocked` with a bounded `awaiting user input` message until that exact tool call
settles. Answer, cancellation, interruption, agent end, reload, and shutdown all
clear the attention state and restore the surrounding working/idle lifecycle.
Multiple concurrent input calls remain blocked until all matching call IDs have
settled.

Headless workers use the same projection for remote-question waits. Their stdin
is intentionally unavailable, so the worker pane itself is not an answer
surface. Without a configured remote-question transport, the normal headless
tool error settles immediately instead of leaving a false persistent wait.

Herdr presentation never includes question text, choices, answers, secure field
names, or collected secret values. It receives only the input category and a
bounded question count.

## Completion and attention notifications

The root reporter and each visible worker use Herdr's native
`notification.show` API:

```text
normal root turn / worker completion  -> sound: done
first transition into blocked         -> sound: request
```

Only the first update in one blocked interval notifies. Resuming work resets
that interval, so a later independent block can notify again. Notification
titles are fixed and bodies are single-line, length-bounded, and secret-redacted.
Question text, choices, answers, and secure-input details are excluded.

GSD does not override Herdr notification preferences. Herdr may return
`disabled`, `rate_limited`, `no_foreground_client`, or `busy`; these are expected
best-effort presentation outcomes and never change task status or exit evidence.

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

If a user closes an idle or terminal worker pane after final exit evidence, the
next distinct dispatch reconciles the live topology, removes the stale cached
slot, and creates or reuses healthy capacity. A pre-submission `pane.get` check
may safely re-reserve once because no worker command has been submitted yet.
After `pane run` has been attempted, ambiguous outcomes remain fail-closed and
are never automatically replaced.

An accepted `pane run` is not worker-start evidence. The private worker must
publish its owner-bound `state.json`/`heartbeat.json` within the bounded startup
window. If the pane remains alive and idle without those artifacts, the backend
interrupts that exact pane, marks its ownership orphaned, retains the pane and
artifacts as a failure, and returns an explicit runtime error to the common GSD
runner. It does not wait for the normal execution timeout, retry the submission,
or fall back to Local execution.

Normal successful operation keeps physical worker panes warm. Completed and
aborted workers release Herdr agent authority after final evidence, so they do
not remain in the agents list; failed/ambiguous workers remain visible until
reviewed or explicitly cleaned.

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
