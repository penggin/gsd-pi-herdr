# Herdr Integration Architecture Decisions

This file records decisions that materially constrain the downstream Herdr implementation. Historical decisions from the original `penggin/gsd-herdr` overlay plan are retained where useful; decisions made obsolete by moving into a managed GSD-Pi fork are explicitly marked superseded.

## ADR-H001 — Manage `penggin/gsd-pi-herdr` as the downstream distribution

**Status:** Accepted
**Date:** 2026-08-29

### Context

The first plan attempted to keep official GSD-Pi untouched and maintain a small version-specific external-backend patch from a separate integration repository. Because this fork is intended to be the long-term runtime and AI-assisted upstream maintenance cost is acceptable, constraining the architecture to a tiny seam provides less value than implementing the clean internal design.

### Decision

`penggin/gsd-pi-herdr` is the canonical downstream distribution. It may contain deliberate Herdr integration, fixes, refactors, and experimental functionality while regularly synchronizing `open-gsd/gsd-pi`.

Keep `upstream-main` pristine and use `main` for downstream integration.

### Supersedes

The original overlay-repository decision and the requirement that all GSD changes fit into a minimal patch queue.

---

## ADR-H002 — Keep Herdr core unpatched initially

**Status:** Accepted

Herdr v0.8.2 already exposes the required workspace/tab/pane lifecycle, command submission, state reporting, metadata, snapshot, events, and plugin surfaces. Use official Herdr binaries and APIs unless a concrete requirement is proven impossible.

A Herdr fork requires a separate reproduced limitation and plan update.

---

## ADR-H003 — Refactor subagent execution behind runtime backends

**Status:** Accepted

The current implementation has local execution and a separate cmux execution path. The downstream fork will introduce an explicit runtime abstraction rather than adding a third duplicated Herdr path.

Target shape:

```text
Subagent execution semantics
        │
        └── SubagentExecutionBackend
            ├── LocalBackend
            ├── CmuxBackend
            └── HerdrBackend
```

Result parsing, usage accounting, missing-final-response checks, retry semantics, session/fork handling, isolation/merge decisions, and orchestration stay above the runtime-specific layer whenever possible.

---

## ADR-H004 — Keep GSD subagents in JSON mode

**Status:** Accepted

JSON mode is the structured contract the parent currently uses to recover assistant messages, tool results, usage, model metadata, stop reasons, and errors. Herdr integration must preserve that structured stream rather than replacing child execution with a second interactive TUI.

---

## ADR-H005 — Filter worker presentation; never mirror raw JSON/token deltas

**Status:** Accepted

Worker panes display identity, lifecycle, concise tool activity, retries, failures, elapsed time, and optional bounded summaries. Raw JSONL remains an artifact for parent/result processing.

Do not `tee` child JSON-mode stdout directly to the terminal.

---

## ADR-H006 — Use an internal GSD worker runner

**Status:** Accepted

Rather than a shell pipeline or an independently versioned external executable, this managed fork should provide an internal worker entrypoint, tentatively:

```text
gsd __herdr-worker <spec-path>
```

The exact CLI spelling is private and may change before implementation stabilizes.

The runner receives only a validated spec path, spawns the existing GSD child with argv arrays and `shell: false`, captures streams, renders filtered activity, reports worker state, and writes durable artifacts.

---

## ADR-H007 — Separate root-pane and worker-pane authority

**Status:** Accepted

The root reporter activates only for the visible root GSD TUI and must ignore `GSD_SUBAGENT_CHILD=1`. Worker state is reported by the worker runtime against the Herdr pane that actually hosts it.

Parent `HERDR_*` variables must not be blindly inherited as worker identity. The worker pane's Herdr-managed environment is authoritative.

---

## ADR-H008 — Monitoring failure is fatal when Herdr is required

**Status:** Accepted

If configuration requires Herdr monitoring and the backend cannot reserve/launch the worker, the dispatch fails visibly. It must not silently create a local worker that is no longer observable.

Optional fallback may be supported only as an explicit configuration and only before an external launch may have occurred.

---

## ADR-H009 — Use Herdr CLI `pane run` for atomic command submission

**Status:** Accepted for initial implementation

Herdr v0.8.2 documents `pane run` as an atomic command-submission helper that respects bracketed-paste mode. The raw socket API exposes `pane.send_text` and `pane.send_keys` but no raw `pane.run` method.

For starting a worker in a pre-existing shell pane, use the CLI wrapper through the known Herdr binary path rather than racing separate text + Enter operations. Use the raw socket API where direct semantic state, metadata, snapshot, or subscriptions are more suitable.

This decision may be revisited if a future Herdr raw command-launch method is added.

---

## ADR-H010 — Use a persistent worker-pane pool

**Status:** Accepted

Associate a worker tab with the root GSD session and default to four reusable slots. Parallel workers reserve slots; chain steps/retries should reuse a stable pane where practical.

M4 must validate usability, queueing behavior, retention, and multi-session separation before this becomes Accepted.

M4 validated the four-slot queue, successful affinity reuse, failed-pane retention, pane-loss recovery, and root-focus preservation against real Herdr v0.8.2.

---

## ADR-H011 — Use durable versioned worker artifacts

**Status:** Accepted

Long-running work needs evidence across detach/reattach and process crashes. Launch data, stdout JSONL, stderr, state, heartbeat, and final exit evidence will live under an integration-owned versioned runtime root with restrictive permissions and atomic mutable-state updates.

---

## ADR-H012 — Capability-check Herdr, synchronize GSD by upstream lineage

**Status:** Accepted

Herdr compatibility is checked against actual API/CLI capability behavior and the schema bundled with the supported Herdr binary.

GSD compatibility is managed differently now that this is a full downstream fork: record the upstream base commit, synchronize through `upstream-main`, inspect semantic conflicts, and run downstream parity/E2E tests. Version/fingerprint-only patch application is no longer the production model.

---

## ADR-H013 — Target macOS arm64 first

**Status:** Accepted

The initial production target is macOS arm64. Keep process/filesystem abstractions portable where inexpensive, but Windows/Linux support does not block the first stable Herdr integration.

---

## ADR-H014 — Preserve the M0.6 package-overlay investigation as historical evidence

**Status:** Accepted / historical

The previous investigation proved that a published GSD package prefers built `dist/resources`, synchronizes them into the managed agent directory, and can skip resource refresh based on its content fingerprint. Therefore a `src/resources`-only overlay was unsafe.

The downstream fork no longer needs that overlay approach, but the finding is retained under `spikes/M0.6-GSD-PACKAGE-LOADING.md` because it documents GSD's packaging behavior and explains why source-built downstream releases are the cleaner path.

---

## ADR-H015 — Keep the operations plugin observational and use owner-consumed cleanup requests

**Status:** Accepted
**Date:** 2026-08-30

Herdr plugin commands run in separate processes and cannot safely mutate the root GSD process's in-memory pane leases. The plugin may inspect GSD-owned artifacts plus `session.snapshot`, focus live resources, clear stale Herdr presentation authority, and write an owner-only `cleanup.json` request into a terminal worker directory.

Only the matching root GSD pane pool consumes that identity-bound request and changes a retained slot back to reusable. The plugin never launches workers, chooses retry/chain/parallel behavior, deletes live or ambiguous evidence, or treats a pane state as the GSD semantic result.
