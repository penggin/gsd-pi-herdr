<!-- GSD Pi - Project overview and setup guide -->

# GSD Pi Herdr

[![CI](https://img.shields.io/github/actions/workflow/status/penggin/gsd-pi-herdr/ci.yml?branch=main&label=tests&logo=github)](https://github.com/penggin/gsd-pi-herdr/actions/workflows/ci.yml)
[![GitHub stars](https://img.shields.io/github/stars/penggin/gsd-pi-herdr?label=stars&logo=github)](https://github.com/penggin/gsd-pi-herdr/stargazers)
[![License: MIT](https://img.shields.io/github/license/penggin/gsd-pi-herdr?label=license)](https://github.com/penggin/gsd-pi-herdr/blob/main/LICENSE)

GSD Pi is a local-first coding agent for planning, implementing, verifying, and tracking project work from the command line.

It combines a terminal agent, project workflow tools, worktree-aware Git automation, and optional UI integrations so a project can move from idea to reviewed implementation with less manual coordination.

## About this downstream fork

This repository, `penggin/gsd-pi-herdr`, is a self-contained downstream distribution derived from GSD-Pi. It adds first-class [Herdr](https://github.com/herdrdev/herdr) integration for persistent, observable subagent execution and carries its own package, runtime endpoints, automation, and release evidence.

The Herdr work is developed as part of the GSD runtime rather than as a patch to an installed upstream package. The current design keeps official Herdr unmodified and refactors GSD subagent execution behind shared Local/Cmux/Herdr runtime backends.

Herdr integration documentation is grouped under [`docs/herdr-integration/`](./docs/herdr-integration/):

- **Living plan:** [`docs/herdr-integration/PLANNING.md`](./docs/herdr-integration/PLANNING.md)
- **Architecture:** [`docs/herdr-integration/ARCHITECTURE.md`](./docs/herdr-integration/ARCHITECTURE.md)
- **Integration contract:** [`docs/herdr-integration/INTEGRATION_CONTRACT.md`](./docs/herdr-integration/INTEGRATION_CONTRACT.md)
- **Decisions:** [`docs/herdr-integration/DECISIONS.md`](./docs/herdr-integration/DECISIONS.md)

Branch policy for this distribution:

- `main` is the downstream integration/release line;
- focused work is developed on `feature/*` branches and merged only after relevant regression/parity checks;
- automation compares downstream refs only and does not fetch, modify, publish to, or open issues against the source project.

The public package identity is `@penggin/gsd-pi-herdr`. Until a registry release exists, install the verified tarball built from this repository as described below.

## Feature Roll-Up

- **Guided terminal agent** — Start with `gsd`, configure providers, and run planned or quick coding sessions from your shell.
- **Autonomous project workflow** — Break work into milestones, slices, and tasks, then let auto mode plan, implement, verify, and advance.
- **Worktree-aware Git automation** — Keep implementation work isolated while preserving a reviewable main checkout.
- **Local project memory** — Store project requirements, decisions, runtime notes, generated plans, summaries, and validation evidence under `.gsd/`.
- **Multi-provider model routing** — Use the provider your team already has, including API keys, OAuth providers, and external CLI providers such as Claude Code and Cursor Agent.
- **Extension surface** — Add project-specific commands, tools, skills, and UI integrations through bundled or community extensions.
- **Terminal and web surfaces** — Use the TUI by default, or launch `gsd --web` when a visual control plane fits the work better than a terminal.

See [CHANGELOG.md](./CHANGELOG.md) for release-by-release fixes and [Legacy Release History](./docs/archive/legacy-release-history.md) for inherited history.

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

Milestones M0–M7 of the Herdr integration are complete. The supported runtime baseline is Herdr v0.8.2, protocol 20, with a maximum of four persistent worker panes per root GSD session and queued overflow.

## Install

Build a self-identifying tarball from this checkout:

```bash
pnpm install --frozen-lockfile
pnpm run build:core
pnpm run build:web-host
NPM_CONFIG_USERCONFIG=/dev/null pnpm run validate-pack
npm pack
```

Install the resulting tarball globally and verify its identity:

```bash
npm install -g ./penggin-gsd-pi-herdr-1.16.2.tgz
gsd --build-info
```

The build-info JSON must report `@penggin/gsd-pi-herdr`, `herdrIntegration: true`, and a non-null `releaseMetadata` object. It records the exact downstream commit, source baseline, Herdr compatibility contract, required gates, and whether the tarball was built from a dirty checkout.

Install Herdr v0.8.2 separately, then link the optional operations plugin from the installed package:

```bash
herdr plugin link "$(npm root -g)/@penggin/gsd-pi-herdr/integrations/herdr/plugin"
herdr plugin action list --plugin opengsd.gsd-workers
```

Enable the runtime in GSD preferences:

```yaml
herdr:
  enabled: true
  required: true
```

Start GSD from a Herdr pane. `/herdr-doctor` verifies the environment and `/herdr-status` shows root and worker runtime state.

## Migrate From Older Installs

Install the tarball and make sure its global bin directory precedes any older
`gsd` binary on `PATH`:

```bash
rm -f ~/.gsd/.update-check ~/.gsd/agent/managed-resources.json
npm install -g ./penggin-gsd-pi-herdr-1.16.2.tgz
command -v gsd
gsd --build-info
```

Windows PowerShell:

```powershell
Remove-Item "$env:USERPROFILE\.gsd\.update-check" -Force -ErrorAction SilentlyContinue
Remove-Item "$env:USERPROFILE\.gsd\agent\managed-resources.json" -Force -ErrorAction SilentlyContinue
npm install -g .\penggin-gsd-pi-herdr-1.16.2.tgz
where.exe gsd
gsd --build-info
```

Existing `~/.gsd` provider credentials and project state remain compatible. The downstream managed-resource stamp prevents inherited package resources from being mistaken for this build.

## Uninstall

Remove the global package and optional local GSD state files.

macOS / Linux:

```bash
npm uninstall -g @penggin/gsd-pi-herdr
rm -rf ~/.gsd
```

If you installed GSD with pnpm, use pnpm for the pnpm-owned package. If pnpm reports that its global bin directory is not on `PATH`, run `pnpm setup`, restart your shell, then retry.

```bash
pnpm remove -g @penggin/gsd-pi-herdr
rm -rf ~/.gsd
```

Windows PowerShell:

```powershell
npm uninstall -g @penggin/gsd-pi-herdr
Remove-Item "$env:USERPROFILE\.gsd" -Recurse -Force -ErrorAction SilentlyContinue
```

## Quick Start

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
| `docs/` | User and developer documentation |
| `docs/herdr-integration/` | Downstream Herdr living plan, architecture, contracts, decisions, and spike reports |
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

## Versioning

The active public baseline starts at `1.0.0`.

Historical tags and archived refs may exist for traceability, but active release notes should be written from this baseline forward.

## Community

Join the GSD Discord community: https://discord.gg/vY2bv3FrzX

## License

MIT
