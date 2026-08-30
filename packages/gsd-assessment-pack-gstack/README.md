# GSD Assessment Pack: GStack adapters

Optional, report-only Assessment Gate adapters for GSD Pi. This package is not required by GSD core and does not add an extension, executable, provider SDK, or runtime dependency.

## Install

Install GSD Pi first, then install the pack for the current user:

```sh
gsd install npm:@penggin/gsd-assessment-pack-gstack
```

For one project only:

```sh
gsd install npm:@penggin/gsd-assessment-pack-gstack --local
```

Before the first npm registry bootstrap, a source checkout can be registered directly:

```sh
gsd install /absolute/path/to/gsd-pi-herdr/packages/gsd-assessment-pack-gstack
```

Confirm discovery inside GSD:

```text
/gsd gate list
/gsd gate info gstack-design-review
/gsd gate info gstack-second-opinion
```

Remove it with:

```sh
gsd remove npm:@penggin/gsd-assessment-pack-gstack
```

## Included pilot gates

- `gstack-design-review`: suggested, pre-milestone, repository/artifact read only.
- `gstack-second-opinion`: manual, post-validation, exact validation revision required.

Both gates require explicit approval before execution and return only `gsd.findings/v1`. GSD remains the sole authority for milestones, tasks, validation, remediation, Git lifecycle, and shipping.

See `UPSTREAM.md` for provenance and adapter changes. The upstream MIT notice is preserved in `LICENSES/GSTACK-MIT.txt`.
