# ADR-041: Engine Hook Contract

> **Disposition under [ADR-046](ADR-046-database-authoritative-workflow-lifecycle.md): Amended and retained.** The hook fire matrix and tool-name normalization remain valid. Hooks may submit typed results to the Lifecycle Kernel, but lifecycle correctness cannot depend on native-only hooks or hook-owned state transitions.

## Status

Accepted (2026-06-12)

## Context

Under the external claude-code-cli engine, `tool_call`/`tool_result` hooks never fire — the engine pre-executes tools, so `prepareToolCall`'s `externalResult` branch returns before `beforeToolCall` and skips the `afterToolCall` finalization. Only `tool_execution_start`/`tool_execution_end` are emitted unconditionally (agent-loop, both sequential and parallel paths). This load-bearing fact lived in one inline comment; enforcement placed on the wrong hook is silently dead on one engine class. Three tool-name normalizers coexisted (`canonicalToolName` prefix-strip, `canonicalWorkflowToolName` prefix-strip + alias, and a hand-rolled `canonicalHeadlessToolName`), and callers had to just know which to pick.

## Decision

`engine-hook-contract.ts` declares the verified fire matrix as typed constants:

- `UNIVERSAL_TOOL_HOOKS = ["tool_execution_start", "tool_execution_end"]` — emitted unconditionally in `packages/pi-agent-core/src/agent-loop.ts`.
- `NATIVE_ONLY_TOOL_HOOKS = ["tool_call", "tool_result"]` — wired to `beforeToolCall`/`afterToolCall` in `packages/gsd-agent-core/src/session/agent-session-extensions.ts`; skipped by the `externalResult` short-circuit.
- Non-tool events (session_*, agent_end, message_update, …) are deliberately unclassified — only verified guarantees are declared.
- The module is the normalizer seam: it re-exports `canonicalToolName` (MCP prefix strip — use for raw hook tool names) and `canonicalWorkflowToolName` (strip + workflow alias resolution — use for workflow-surface membership), with doc comments saying which to use when. `canonicalHeadlessToolName` delegates to the shared strip (divergence existed only on malformed names that cannot match real tools; pinned by a parity test).
- Every tool-hook registration in `register-hooks.ts` carries a contract-referencing comment stating its guarantee. This change is behavior-neutral: no enforcement moved between hooks.

## Consequences

- "Does this fire under claude-code-cli?" is answered at import time; a new engine updates one contract.
- The original guard set now has one ordered pre-execution evaluator shared by
  native Pi `tool_call` and the Claude SDK `PreToolUse` hook. It enforces loop,
  deferred/pending approval, queue, planning-unit, worktree, authoritative-state,
  and context-depth policy from one disk-reconciled host snapshot, while host
  effects such as harness-abort evidence and approval-gate deferral are applied
  separately and exactly once. Claude's adapter-specific destructive-command
  permission remains layered after that shared decision. This closes policy
  parity for native Pi and Claude Code; it does not claim parity for an external
  CLI that offers no true pre-execution interception API. `tool_execution_start`
  remains observation/arming only and must never be treated as rollback-capable.
- Complements ADR-036 (Tool Surface Readiness): same spirit, applied to the hook surface instead of the tool surface.
