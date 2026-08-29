# GSD downstream Herdr integration

This directory is shipped with the managed `penggin/gsd-pi-herdr` downstream distribution. The core backend is built into GSD; `plugin/` is the optional Herdr operations surface.

## Release identity

Every promoted downstream build must carry `herdr-release.json`, generated with:

```bash
pnpm run herdr:capability-check -- --mode supported --output build/herdr-capability.json
pnpm run herdr:release-stamp -- --capability build/herdr-capability.json --output dist/herdr-release.json
```

The stamp records the downstream package/commit/version, repository source base, historical lineage commit, tested Herdr capability report, artifact schema, required gates, and the previous known-good rollback target. A version string alone is not sufficient identity.

The currently promised production contract is in `compatibility.json`. New stable or preview Herdr builds are canaries until their required socket methods, CLI helpers, plugin contract, focused tests, packaging gate, and real credentialed E2E have passed.

## Install and update

Build/install the downstream checkout through the repository's normal pnpm release flow. Install Herdr separately from its official stable distribution, then verify capabilities before replacing an existing downstream build. Do not use `herdr update` for Homebrew, mise, or Nix installations; update those through their package manager.

Before an update:

```bash
pnpm run herdr:repository-impact -- --base origin/main --head HEAD --markdown
pnpm run test:herdr-integration
pnpm run herdr:capability-check -- --mode supported
```

The updater must not fetch or modify the original project, merge `main`, publish, or delete runtime evidence automatically.

## Rollback

`release/known-good.json` preserves the prior verified downstream/upstream/Herdr tuple. Restore that exact downstream artifact/tag if a promoted build regresses. Rollback never deletes `${GSD_HOME}/runtime/herdr/v1`; failed and orphaned evidence remains available until an operator explicitly prunes it.

After rollback, re-run the supported capability check against the installed Herdr binary before starting new monitored subagents.
