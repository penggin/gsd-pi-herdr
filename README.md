<!-- GSD Pi - Project overview and setup guide -->

# GSD Pi

[![npm version](https://img.shields.io/npm/v/@opengsd/gsd-pi?label=npm&logo=npm)](https://www.npmjs.com/package/@opengsd/gsd-pi)
[![npm downloads](https://img.shields.io/npm/dm/@opengsd/gsd-pi?label=downloads&logo=npm&color=red)](https://www.npmjs.com/package/@opengsd/gsd-pi)
[![CI](https://img.shields.io/github/actions/workflow/status/open-gsd/gsd-pi/ci.yml?branch=main&label=tests&logo=github)](https://github.com/open-gsd/gsd-pi/actions/workflows/ci.yml)
[![Discord](https://img.shields.io/badge/discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/vY2bv3FrzX)
[![GitHub stars](https://img.shields.io/github/stars/open-gsd/gsd-pi?label=stars&logo=github)](https://github.com/open-gsd/gsd-pi/stargazers)
[![License: MIT](https://img.shields.io/github/license/open-gsd/gsd-pi?label=license)](https://github.com/open-gsd/gsd-pi/blob/main/LICENSE)

GSD Pi is a local-first coding agent for planning, implementing, verifying, and tracking project work from the command line.

It combines a terminal agent, project workflow tools, worktree-aware Git automation, and optional UI integrations so a project can move from idea to reviewed implementation with less manual coordination.

## Downstream Herdr Edition

> This repository is the `penggin/gsd-pi-herdr` managed downstream distribution. It tracks `open-gsd/gsd-pi` while developing a first-class Herdr runtime for persistent, observable subagents.

The Herdr work is currently in planning and feasibility validation; it is not yet a production installation. All integration planning, architecture records, migration evidence, and progress tracking live under [`integrations/herdr/`](./integrations/herdr/README.md).

- [Herdr integration overview](./integrations/herdr/README.md)
- [Canonical living plan](./integrations/herdr/PLANNING.md)
- [Architecture decisions](./integrations/herdr/docs/DECISIONS.md)
- [Planning migration and fork baseline](./integrations/herdr/docs/MIGRATION.md)

The exact upstream mirror is maintained on `upstream-main`; downstream release work is maintained on `main` through reviewed feature and synchronization branches.

## Feature Roll-Up

- **Guided terminal agent** — Start with `gsd`, configure providers, and run planned or quick coding sessions from your shell.
- **Autonomous project workflow** — Break work into milestones, slices, and tasks, then let auto mode plan, implement, verify, and advance.
- **Worktree-aware Git automation** — Keep implementation work isolated while preserving a reviewable main checkout.
- **Local project memory** — Store project requirements, decisions, runtime notes, generated plans, summaries, and validation evidence under `.gsd/`.
- **Multi-provider model routing** — Use the provider your team already has, including API keys, OAuth providers, and external CLI providers such as Claude Code and Cursor Agent.
- **Extension surface** — Add project-specific commands, tools, skills, and UI integrations through bundled or community extensions.
- **Terminal and web surfaces** — Use the TUI by default, or launch `gsd --web` when a visual control plane fits the work better than a terminal.

See [CHANGELOG.md](./CHANGELOG.md) for release-by-release fixes and [Legacy Release History](./docs/archive/legacy-release-history.md) for archived history before the `open-gsd/gsd-pi` baseline.

## Latest Release Highlights

<!-- release-highlights:start -->
Latest release: **v1.16.2**

- **tui:** Hide completed project sentinel.
- **headless:** Classify live workflow outcomes structurally.
- **gsd:** Recover failed UAT closeout.
- **legacy-import:** Take only the code span of a Verification bullet as the verify command (#1982).
- **auto:** Abort the live host turn on permanent provider-error pause; completion gate names its recovery lever and admits blocker reports (#1977).
- **state-reconciliation:** Stop mapping remediation slice ids onto other slices' plan files (#1976).
- **auto:** Keep the verification auto-fix retry bound attempt-independent and pause loudly on durable abort (#1972).
- **legacy-import:** Carry Verification/Inputs/Expected Output from a task's ### section into its import claim (#1970).

<!-- release-highlights:end -->

## Status

This repository is starting a new development baseline at version `1.0.0` under the `open-gsd/gsd-pi` project.

Older release history has been archived outside the active changelog so new work can be reviewed from a clean project surface.

## Install

Recommended — guided installer:

```bash
npx @opengsd/gsd-pi@latest
```

For CI or scripted installs:

```bash
npx @opengsd/gsd-pi@latest --yes
```

Alternative — direct npm global install:

```bash
npm install -g @opengsd/gsd-pi@latest
```

If you want pnpm to own the global install, use pnpm's runner:

```bash
pnpm setup
exec $SHELL -l
pnpm dlx @opengsd/gsd-pi@latest
```

Source: [`open-gsd/gsd-pi`](https://github.com/open-gsd/gsd-pi).

## Migrate From Older Installs

GSD Pi now installs from the scoped package `@opengsd/gsd-pi`. If you previously installed the older unscoped `gsd-pi` package, remove it first so the old global binary does not shadow the new package.

Recommended migration with the guided `npx` installer:

```bash
npm uninstall -g gsd-pi @opengsd/gsd-pi
rm -f ~/.gsd/.update-check ~/.gsd/agent/managed-resources.json
npx @opengsd/gsd-pi@latest
command -v gsd
gsd --version
```

If the old package was installed with `sudo npm install -g`, use `sudo npm uninstall -g gsd-pi` for the old package removal.

To migrate from old npm globals to a pnpm-owned global install:

```bash
npm uninstall -g gsd-pi @opengsd/gsd-pi
rm -f ~/.gsd/.update-check ~/.gsd/agent/managed-resources.json
pnpm setup
exec $SHELL -l
pnpm dlx @opengsd/gsd-pi@latest
command -v gsd
gsd --version
```

Windows PowerShell with the guided `npx` installer:

```powershell
npm uninstall -g gsd-pi @opengsd/gsd-pi
Remove-Item "$env:USERPROFILE\.gsd\.update-check" -Force -ErrorAction SilentlyContinue
Remove-Item "$env:USERPROFILE\.gsd\agent\managed-resources.json" -Force -ErrorAction SilentlyContinue
npx @opengsd/gsd-pi@latest
where.exe gsd
gsd --version
```

After migration, routine upgrades use:

```bash
gsd upgrade
```

You can also run `npx @opengsd/gsd-pi@latest` to launch the guided installer (recommended for new installs). For deeper recovery steps, see [Upgrade GSD Pi](./docs/user-docs/getting-started.md#upgrade-gsd-pi) and [Upgrade from older gsd-pi installs](./docs/user-docs/troubleshooting.md#upgrade-from-older-gsd-pi-installs).

## Uninstall

Remove the global package and optional local GSD state files.

macOS / Linux:

```bash
npm uninstall -g @opengsd/gsd-pi gsd-pi
rm -rf ~/.gsd
```

If you installed GSD with pnpm, use pnpm for the pnpm-owned package. If pnpm reports that its global bin directory is not on `PATH`, run `pnpm setup`, restart your shell, then retry.

```bash
pnpm remove -g @opengsd/gsd-pi
npm uninstall -g gsd-pi
rm -rf ~/.gsd
```

Windows PowerShell:

```powershell
npm uninstall -g @opengsd/gsd-pi gsd-pi
Remove-Item "$env:USERPROFILE\.gsd" -Recurse -Force -ErrorAction SilentlyContinue
```

## Quick Start

Need help choosing settings? Use the [GSD Pi web configurator](https://pi.opengsd.net/) to build a configuration in your browser.

```bash
gsd
```

Run the setup flow, choose your preferred model provider, and open a project directory. Cursor Agent users can choose the `cursor-agent` provider after installing and authenticating the local `cursor-agent` CLI; its default model is `composer-2.5`, and `CURSOR_API_KEY` is supported as an auth signal. GSD stores project planning and runtime state in `.gsd/`, with gitignored sibling runtime directories such as `.gsd-backups/` for migration snapshots. Stale `.gsd-backups/migrate-*` snapshots are pruned after 30 days once the flat-phase `.gsd/phases/` migration is complete.

For a full first-run walkthrough, see [Getting Started With gsd-pi](./docs/user-docs/getting-started.md).

## Common Session Commands

Start GSD from your shell:

```bash
gsd
```

Then use slash commands inside the GSD session:

```text
/gsd config
/gsd auto
/gsd quick "Describe the task"
/gsd status
```

For automation, quick tasks also have a non-interactive entry point with a
structured result and meaningful exit code:

```bash
gsd quick --output-format json "Describe the task"
```

## What GSD Pi Does

- Plans work into milestones, slices, and tasks.
- Runs coding sessions with project context and verification steps.
- Uses Git worktrees to isolate implementation work.
- Tracks project state in a local database with markdown projections for review.
- Supports extension-based tools and provider integrations.
- Produces artifacts such as plans, summaries, validation notes, and reports.

## Repository Layout

| Path | Purpose |
| --- | --- |
| `src/` | Core runtime resources and bundled extensions |
| `packages/` | Workspace packages used by the CLI, agent, TUI, RPC, and native bridge |
| `native/` | Native engine packaging and platform binaries |
| `web/` | Web UI and API surface |
| `integrations/herdr/` | Downstream Herdr runtime planning, plugin/worker assets, and integration tests |
| `integrations/hermes/` | Hermes integration package and documentation |
| `docs/` | User and developer documentation |
| `scripts/` | Build, release, migration, and maintenance scripts |

## Development

```bash
pnpm install --frozen-lockfile
pnpm run build
pnpm test
```

Before opening a pull request, run:

```bash
pnpm run verify:fast    # CI fast-gates locally (scans + policy)
pnpm run verify:pr      # Fast loop: build + typecheck + unit tests
pnpm run verify:merge   # Before PR review: full CI blocking parity
```

Herdr integration changes must also follow [`integrations/herdr/AGENTS.md`](./integrations/herdr/AGENTS.md) and update the living plan before the session ends.

## Versioning

The active public baseline starts at `1.0.0`.

Historical tags and archived refs may exist for traceability, but active release notes should be written from this baseline forward.

## Community

Join the [GSD Discord community](https://discord.gg/vY2bv3FrzX).

## Star History

<a href="https://star-history.dera.page/#open-gsd/gsd-pi&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://star-history.dera.page/svg?repos=open-gsd/gsd-pi&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://star-history.dera.page/svg?repos=open-gsd/gsd-pi&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://star-history.dera.page/svg?repos=open-gsd/gsd-pi&type=date&legend=top-left" />
 </picture>
</a>

## License

MIT
