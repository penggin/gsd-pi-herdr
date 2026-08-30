# Upstream provenance

This package is optional and is not a dependency of GSD Pi core.

- Upstream repository: `https://github.com/garrytan/gstack`
- Audited revision: `07b59e396c6be5a86619a43151cb9ed62a15ae69`
- License: MIT; the upstream notice is preserved in `LICENSES/GSTACK-MIT.txt`.

## Adapter mapping

### `gstack-design-review`

- Upstream source skill: `plan-design-review/SKILL.md.tmpl` (`version: 2.0.0` at the audited revision)
- Retained idea: opinionated pre-implementation critique of product and interaction design decisions.
- Removed or changed: interactive plan editing, source/plan writes, shell access, mockup generation, GStack state, branch detection, dashboard state, and automatic workflow routing.
- GSD boundary: returns only `gsd.findings/v1`; GSD alone decides whether an approved brief becomes milestone input.

### `gstack-second-opinion`

- Upstream source skill: `codex/SKILL.md.tmpl` (`version: 1.0.0` at the audited revision)
- Retained idea: an independent, adversarial second review after primary validation.
- Removed or changed: Codex CLI/provider dependency, nested process spawning, authentication probes, source writes, Git mutation, GStack telemetry/state, and pass/fail authority over shipping.
- GSD boundary: provider-neutral report-only review bound to the current GSD validation revision; findings never reopen a milestone or invalidate validation automatically.

These adapters are newly written for the GSD Assessment Gate contract. They are not verbatim copies of upstream skill bodies.
