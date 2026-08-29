# M7 downstream tarball smoke

Date: 2026-08-30

Platform: macOS arm64

Herdr: official v0.8.2, protocol 20

## Purpose

Prove that the package produced by this downstream checkout is independently
installable and that an installed root GSD can complete the public `subagent`
path through a real Herdr worker pane. No original-project remote, registry,
issue tracker, branch, or installation was used.

## Package and capability evidence

- Package: `@penggin/gsd-pi-herdr@1.16.2`
- Development tarball size: 53,594,644 bytes
- Tarball SHA-1: `5c0dffbe6eacc19bc430c9865f15af8486c03f83`
- The package was installed offline into a temporary npm prefix.
- Installed `gsd --build-info` reported the downstream package and embedded
  `dist/herdr-release.json`. Because the checkout still contained the changes
  under validation, the stamp correctly reported `dirty=true` and
  `buildKind=development`.
- The official Herdr binary passed the installed compatibility checker:
  version 0.8.2, protocol 20, API schema v1, schema SHA-256
  `c48f1f54ee0150ca27e11fd44455fe94aeadb20fdf4e4a62393ed822a4e5b150`,
  all 13 required methods present, and pane-run/plugin-link/plugin-manifest
  checks true.
- The installed plugin was linked and enabled under isolated XDG config/state.

## Live public dispatch

The installed loader was started inside a fresh `herdr --no-session` TTY with
an isolated `GSD_HOME` and preferences:

```yaml
herdr:
  enabled: true
  required: true
```

`/herdr-status` and `/herdr-doctor` reported an eligible, detected v0.8.2
runtime, an active root reporter, root pane `w1:p1`, and a successful
`pane.get` probe. The parent then invoked the public `subagent` tool with one
scout whose required response was `HERDR_TARBALL_E2E_OK`.

Observed result:

- root focus remained on `w1:p1`;
- tab `GSD Workers · dd7d233c` was created without focus;
- worker pane `w1:p2` reported `agent=gsd-worker`, `status=done`, display name
  `GSD worker`, and completed token metadata;
- the parent rendered the exact semantic final value
  `HERDR_TARBALL_E2E_OK` through the common runner;
- parent usage was input 33,291, output 13, total 33,304, cost 0.033369;
- the private worker published `launch.json`, `stdout.jsonl`, `stderr.log`,
  `state.json`, `heartbeat.json`, `ownership.json`, and immutable `exit.json`;
- one-time `env.json` was absent after launch;
- `exit.json` recorded exit code 0 and `aborted=false`;
- `stdout.jsonl` contained 20 JSON-mode events, including the semantic final
  response and usage consumed by the common parent parser;
- the visible worker pane contained only the private launch command,
  `[23:32:22] working`, and `[23:32:25] turn settled`. It contained no raw
  `message_update`, token delta, usage JSON, or tool-result body.

The isolated Herdr client was detached and exited cleanly after evidence
capture. No persistent Herdr session remained.

## Conclusion

This closes the missing distribution-level path:

```text
installed downstream GSD
→ public subagent tool
→ common runSingleAgentWithBackend
→ HerdrBackend
→ official Herdr v0.8.2 worker pane
→ gsd __herdr-worker
→ real JSON-mode child
→ artifact relay
→ parent semantic final + usage
```

A clean-commit tarball must still be stamped and package-gated after these
changes are committed. Publishing, tagging, pushing, and merging remain outside
this validation.
