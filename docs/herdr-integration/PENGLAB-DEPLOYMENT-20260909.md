# Penglab committed-source deployment — 2026-09-09

Status: installed and activated after side-by-side candidate checks. No live GSD
or Herdr session was restarted. This updates GSD-Pi-Herdr only, not OpenCodex,
credentials, role/effort preferences, browser policy or Mac global installation.

## Identity and commits

- Branch: `feature/gsd-upstream-backports-20260907`, pushed to downstream origin.
- `bcf3c54d5`: reviewed upstream/R1–R6 changes, managed image correction and
  bounded execution evidence/log retrieval/provider-result preservation.
- `a47fefe30`: scout evidence-sufficiency prompt and its loader/runner contract.
- `64f7cc3bc595d54ce7629f662e9e71381018cf6c`: independent offline scout evaluator.
- Installed code is the last commit above, `dirty: false`, version **1.16.2**.
  The later deployment-record commit is documentation-only and is not claimed
  as the binary's source commit or silently included in its source archive.
- Package SHA-256:
  `c578bc09d654c115a236d221611ce15aa1d61f092efc4a60c687278d724c7af5`
  (63,509,169 bytes).
- Source archive SHA-256:
  `dc337beccc34dcd0267c42e5de6f0e7dd5bb131810ec9353c624795a2c822871`.
- Source Git tree: `0d2bddff6cfcf073d678ddaebd7bc5b99adcaec1` (Git tree ID,
  not the SHA-256 directory digest used by older dirty snapshots).
- Managed resource fingerprint: `d91674a8a47720ca`.

Installed prefix:
`/srv/penglab/gsd-runs/toolchains/gsd-pi-herdr-1.16.2-64f7cc3b-c578bc09`.
Source archive extraction:
`/srv/penglab/gsd-runs/sources/gsd-pi-herdr-20260909-64f7cc3b`.
The source snapshot is not a Git checkout; its `node_modules` link uses the
candidate's dependencies so the offline evaluator can run without another install.
`sources/current` points there. Four shared GSD executable links were atomically
replaced individually after verifying all previous targets and saving a backup.
Ordinary and login SSH shells resolve the same new binary/build identity.

## Verification

- Fresh `pnpm run typecheck:extensions`, core build, standalone web build,
  `validate-pack`, Pi boundary/patch inventory and final diff checks passed.
- Changed-source: **1,192 pass / 11 skips / zero failures** (1,203 tests).
- Changed package Node tests: **158/158**; agent-loop Vitest: **47/47**.
- Evaluator/upstream/downstream-boundary scripts: **39/39**; Herdr integration
  package/plugin checks: **31/31**. Counts overlap other reported matrices.
- Full subagent/Local/Cmux/Herdr/worker regression: final **174/174**. First run
  had an intermittent Cmux fixture failure (173/174); unchanged isolated Cmux
  passed 7/7 and the unchanged full rerun passed. No Cmux implementation change
  was made to hide it. Track recurrence separately if reproduced.
- Secret scan passed after narrowly excluding the explicit `SYNTHETIC_PASSWORD`
  redaction-test sentinel in its single test file; no real credential exception.
- Package validation passed isolated local/global installs, native/workspace
  resolution, CLI identity, standalone runtime dependencies, MCP handshake and
  optional pack discovery. Packaging restored temporary manifest rewrites.
- Transferred package/source hashes were checked before installation. Retained
  Linux addon/browser binaries match their previously verified hashes in the
  September 8 record; no unreviewed native dependency upgrade was substituted.
- Installed public execution tools run a disposable failing Node fixture,
  preserve stderr's file/line error with stdout present, search/read its saved
  log, and preserve a **1,063-character** result through both messages/input
  payload policies. UAT execution and new scout body also pass. This is a local
  fixture, not a model call or a project's verification completion.
- Isolated resource sync matches the candidate fingerprint and new execution
  files; actual installed MCP exposes **57 tools**, including the expanded
  `gsd_exec_search` schema. Source evaluator fixture/oracle hashes validate.
- Actual browser tools pass viewport PNG, JPEG, 240×120 element PNG, full-page
  PNG and requested verification JPEG from both installed and isolated synced
  resources. Invalid/missing/aborted requests fail explicitly. The same browser
  session, AppArmor label, namespace/seccomp sandbox and global restriction=1
  are preserved; both probes close their own daemons with stopped=true.
- Herdr 0.8.2/protocol20/schema1 required capabilities pass on Mac and Linux.
- Seven policy/config files compare unchanged before/after activation. Existing
  GSD PID 948361 and Herdr PIDs 934555/2298662 were preserved.

## Evidence, next use and rollback

Artifacts: `/srv/penglab/gsd-runs/artifacts/release-20260909-iS4DOW/`.
Private installer/scripts/receipts:
`/srv/penglab/gsd-runs/private/release-20260909-iS4DOW/`.
Key receipts: `candidate.json`, `exec-proof.json`, `launcher-backup.json`,
`activation.json`, `herdr-capability.json`, browser `proof-0y5rkx/proof.json`
(installed) and `proof-Z63ruf/proof.json` (isolated synced resources).
The deployment note is retained separately from immutable package/source archives.

The previous `...1.16.2-0417606d-dirty-230c8983` prefix and September 8 source
snapshot remain available. For rollback, review `launcher-backup.json` and switch
only those five links back at a safe boundary; do not reset a project, restore
old credentials, delete runtime evidence or blindly rewrite configuration.

Next task: when active work permits, exit the existing old GSD process normally
and start/resume through the updated `gsd` launcher. Managed user resources refresh
at normal startup; `--version`/`--build-info` do not hot-reload a running session.
Do not create a second writer on the same active session file. No real model A/B,
subscription usage savings, full live workflow rerun, OpenCodex upgrade or Mac
global reinstallation is claimed by this deployment.
