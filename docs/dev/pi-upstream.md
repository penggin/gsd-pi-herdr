# Pi upstream tracking and upgrade runbook

GSD vendors the [earendil-works/pi](https://github.com/earendil-works/pi) monorepo (formerly `badlogic/pi-mono` / `@mariozechner/pi-*`) into `packages/pi-*`. GSD-specific session, mode, and CLI code lives in `@gsd/agent-core` and `@gsd/agent-modes` per [ADR-010](./ADR-010-pi-clean-seam-architecture.md).

**Overlay policy (2026-05-26):** Vendored pi is **upstream + allowlisted deltas**, not pristine upstream. See [ADR-010 amendment](./ADR-010-pi-clean-seam-architecture.md) and the executable checklist in [pi-overlay-execution-plan.md](./pi-overlay-execution-plan.md).

## Current status (Phase 2 complete)

| Item | Value |
|---|---|
| Upstream repo | `earendil-works/pi` |
| Pinned ref | **v0.75.5** |
| npm scope (upstream) | `@earendil-works/pi-*` |
| GSD packages | `@gsd/pi-*`, `@gsd/agent-core`, `@gsd/agent-modes` |
| Build | `npm run build:pi` |
| Boundary | `npm run verify:pi-boundary` (also in `scripts/ci-fast-gates.sh`) |
| Patch inventory CI | `npm run verify:pi-patches` |
| Read-only freshness audit | `pnpm run audit:pi-upstream` |
| Automated freshness audit | `.github/workflows/pi-upstream-audit.yml` (weekly, manual, and contract PRs) |
| Claude tool schemas | `npm run test:pi-claude-schemas` |

Phase 2 used **GSD shim restoration** (incremental compat on upstream v0.75.5 APIs) rather than a full upstream modes sync. `@gsd/agent-modes` was migrated from the old GSD fork and reconciled via shims in pi-tui, pi-coding-agent, pi-ai, and agent-core.

## Pin metadata

See [`scripts/pi-upstream.json`](../../scripts/pi-upstream.json):

| Upstream path | GSD package |
|---|---|
| `packages/agent` | `@gsd/pi-agent-core` |
| `packages/ai` | `@gsd/pi-ai` |
| `packages/tui` | `@gsd/pi-tui` |
| `packages/coding-agent` | `@gsd/pi-coding-agent` |

Protected from vendor overwrite: `packages/gsd-agent-core`, `packages/gsd-agent-modes`.

`pinnedRef` is the reproducible vendor baseline, not the newest reviewed
upstream version. `upstreamAudit` records the latest stable tag and main commit
whose behavior has been classified for selective import. Keep these two
concepts separate: updating the audit baseline must never vendor or overwrite
downstream code. Run `pnpm run audit:pi-upstream`; it performs only
`git ls-remote`, reports `current` when both refs match, and exits 2 when a new
stable release or main commit requires review.

The downstream workflow runs the same fail-closed check every Wednesday and
can also be dispatched manually. It has only `contents: read` permission and
retains the report and diagnostics for 30 days whether the audit passes,
detects a moved ref, or encounters a network error. A failed freshness run is
a request for read-only review; it never fetches, vendors, opens an issue, or
updates the reviewed baseline automatically.

`patchAllowlist` in the same JSON file lists every path GSD may diverge from upstream under `packages/pi-*`. CI (`verify:pi-patches`) fails if you change other pi-* files without updating the allowlist. By default the script checks **working tree** changes only; set `VERIFY_PI_PATCHES_BRANCH=1` to include the full branch diff vs main (vendor bumps).

## Verification (after every vendor or seam change)

```bash
npm run build:pi
npm run verify:pi-boundary
npm run verify:pi-patches
npm run test:pi-claude-schemas
npm run test:smoke
```

Optional fuller checks:

```bash
npm run build
npm test
node scripts/verify-pi-boundary.cjs
```

Smoke tests exercise CLI `--help` and `--version` only; they do not require API keys. **Smoke does not catch Cloud Code Assist tool-schema 400s** — use golden B (`test:pi-claude-schemas`).

## Upgrade workflow

1. **Ensure seam is green** — run verification commands above on current pin before touching upstream.
2. **Vendor upstream** (does not touch GSD packages):
   ```bash
   node scripts/vendor-pi.cjs --ref vX.Y.Z
   ```
   Or stepwise:
   ```bash
   node scripts/vendor-pi-deps.cjs --ref vX.Y.Z          # pi-ai, pi-agent-core, pi-tui
   node scripts/vendor-pi-coding-agent-core.cjs --ref vX.Y.Z
   node scripts/apply-seam.cjs                           # post-vendor deletes, import rewrites, boundary verify
   ```
   Seam config: `scripts/pi-seam.json` (forbidden paths, protected files, import rewrites, theme/tool fixes).
3. **Reconcile GSD shims** — re-apply every path in `patchAllowlist`. Prefer **incremental shims** over restoring entire pre-vendor GSD files (HEAD restore of `model-registry.ts` / `settings-manager.ts` broke v0.75.5 compat in Phase 2).
4. **Normalize package.json** — preserve `@gsd/pi-*` names, `gsd.linkable`, workspace `tsc` build scripts, and subpath exports (`./*` → `./dist/*`).
5. **Fix import extensions** — GSD uses Node16 `.js` suffix imports; upstream may use `.ts` for `tsgo`. Bulk-fix or adopt upstream `tsconfig.build.json` if switching compilers.
6. **Merge dependency deltas** — upstream may rename packages (`typebox` vs `@sinclair/typebox`). Merge without dropping `@gsd/native` shims.
7. **Build GSD layers** — errors should surface in `@gsd/agent-core` and `@gsd/agent-modes`, not in vendored pi-* except documented shims.
8. **Session event migration** (pi ≥ 0.65): use `session_start` + `reason` instead of deprecated `session_switch` / `session_fork` / `session_directory`.
9. **Update pin** in `scripts/pi-upstream.json` and note manual patches in this file.
10. **Verify** — full verification block above (+ optional live Cloud Code Assist smoke — see execution plan “Golden C”).

## GSD patches that must survive vendoring

Every row must have a matching entry in `scripts/pi-upstream.json` → `patchAllowlist`.

| Area | Location | Purpose |
|---|---|---|
| Clean seam | `packages/gsd-agent-core`, `packages/gsd-agent-modes` | Session, SDK, modes, CLI |
| Type seam | `packages/pi-coding-agent/src/core/gsd-seam-types.ts` | Avoid compile-time pi ↔ agent-core cycle |
| Session types | `packages/pi-coding-agent/src/core/extension-session-types.ts` | Re-export session types from `@gsd/agent-core` |
| Ambient shim | `packages/pi-coding-agent/src/agent-core.d.ts` | Extension types without package dep |
| Extension loader | `packages/pi-coding-agent/src/core/extensions/loader.ts` | `@gsd/agent-*`, `@earendil-works/*` aliases |
| GSD core files | `model-discovery.ts`, `discovery-cache.ts`, `models-json-writer.ts`, `package-commands.ts`, `local-model-check.ts`, `capability-patches.ts`, `bash-interceptor.ts`, `constants.ts` | Provider discovery, offline mode, capability patches |
| Keybindings | `packages/gsd-agent-core/src/keybindings.ts` | Legacy `AppAction` names + `app.*` keybinding map (pi re-exports via shim) |
| Model registry shims | `packages/pi-coding-agent/src/core/model-registry.ts` | `discoverModels`, `isAllLocalChain`, `getApiKey`, GSD auth modes |
| Settings shims | `packages/pi-coding-agent/src/core/settings-manager.ts` | Adaptive TUI, compaction override, gitignore picker |
| Interactive stream dedup | `packages/gsd-agent-modes/src/modes/interactive/controllers/chat-controller.ts`, `packages/gsd-agent-modes/src/modes/interactive/components/chat-turn-connect.ts` | Reconcile mismatched tool IDs across event streams |
| pi-tui shims | `style.ts`, `editor-keybindings.ts`, `Container.detachChildren`, `Markdown.maxLines`, `Input.secure`, `Image.getDimensions` | GSD interactive mode compat |
| pi-ai shims | `ServerToolUse` / `WebSearchResult` types, `server_tool_use` event, `supportsXhigh()` | GSD content blocks + thinking level |
| Tool argument normalization tests | `packages/pi-ai/src/utils/tests/normalize-tool-arguments.test.ts` | Regression coverage for shared validation/transcript argument normalization |
| **Claude tool schemas** | `packages/pi-ai/src/providers/google-shared.ts` | Cloud Code Assist / Claude `input_schema` sanitization (`toClaudeInputSchemaRoot`, `normalizeClaudeToolSchemaForGoogle`) |
| **Claude schema tests** | `packages/pi-ai/test/google-shared-convert-tools.test.ts`, `src/resources/extensions/gsd/tests/claude-tool-schema-golden.test.ts` | Golden B regression |
| OAuth cache breakpoint | `packages/pi-ai/src/providers/anthropic.ts` (`buildParams`) | Drop `cache_control` from the constant Claude Code identity block when a real system prompt follows — the trailing breakpoint already covers it; saves one of Anthropic's 4 cache breakpoints |
| OAuth cache breakpoint test | `packages/pi-ai/test/cache-retention.test.ts` | Regression coverage for single-breakpoint OAuth system array |
| `cacheRetention` passthrough | `packages/pi-agent-core/src/agent.ts` (`AgentOptions.cacheRetention`, `Agent.cacheRetention`, `createLoopConfig`) | Threads a settable prompt-cache TTL preference into `AgentLoopConfig`/`StreamOptions` — previously the field existed on `StreamOptions` but nothing populated it for the `Agent` class (only the separate, unused `AgentHarness` had it) |
| `cacheRetention` passthrough test | `packages/pi-agent-core/test/agent.test.ts` | Regression coverage for `cacheRetention` reaching `streamFn` options, pattern-matched off the existing `sessionId` passthrough test |
| Harness summary request isolation | `packages/pi-agent-core/src/harness/agent-harness.ts`, `packages/pi-agent-core/src/harness/compaction/{compaction,branch-summarization}.ts` | Preserve GSD provider request/payload/response hooks while assigning every compaction or branch-summary call a fresh session identity and `cacheRetention: none`; hook patches cannot reattach summaries to the root affinity/cache |
| Harness summary regression tests | `packages/pi-agent-core/test/harness/{agent-harness,agent-harness-stream,compaction}.test.ts` | Exercise the local `@gsd/pi-ai` faux registry and lock summary transport/retry/metadata/header hooks, response observability, cache isolation, and distinct routing identities |
| Shared bounded assistant retry | `packages/pi-ai/src/utils/retry.ts`, `packages/pi-ai/test/retry-classification.test.ts` | Extend the downstream transient-error classifier with abort-aware bounded exponential backoff and lifecycle callbacks; account quota/billing failures remain terminal and focused tests cover success, exhaustion, disabled policy, and cancellation |
| Harness summary retry lifecycle | `packages/pi-agent-core/src/harness/types.ts`, `packages/pi-agent-core/src/harness/agent-harness.ts`, `packages/pi-agent-core/src/harness/compaction/{compaction,branch-summarization}.ts` | Apply the shared policy only to generated compaction/branch summaries and emit observable scheduled/start/finished events without creating workflow authority or retrying deterministic failures |
| Harness operation ownership and shutdown | `packages/pi-agent-core/src/harness/agent-harness.ts`, `packages/pi-agent-core/test/harness/agent-harness.test.ts` | Track turns, compaction, and branch navigation as cancellable operations; make shutdown idempotent, await active operations and in-flight idle mutations, reject reuse after close, and prevent late summary persistence or leaf movement |
| Summary and tool usage persistence | `packages/{pi-ai,pi-agent-core,pi-coding-agent,gsd-agent-core}` usage-bearing result, hook, session, and stats paths | Preserve provider usage for generated or extension-provided compaction, branch summaries, and LLM-backed tools; aggregate split/chunked summary calls and include durable auxiliary usage in session totals without changing GSD workflow accounting |
| Harness-v4 compatibility seam | `packages/pi-agent-core/src/harness/session/session-v4-harness-adapter.ts`, `packages/pi-agent-core/test/harness/agent-harness-v4-parity.test.ts` | Adapt the working downstream harness session contract onto the isolated memory/JSONL v4 stores for parity tests only; retain strict v4 durability, native lane/fact writes, and compaction retained tails without selecting v4 in the application runtime |
| Proxy EOF settlement | `packages/pi-agent-core/src/proxy.ts`, `packages/pi-agent-core/test/proxy.test.ts` | Flush a terminal SSE event without a trailing newline and convert a premature proxy EOF into a canonical terminal error instead of leaving `result()` pending indefinitely |
| Parallel preflight abort | `packages/pi-agent-core/src/agent-loop.ts`, `packages/pi-agent-core/test/agent-loop.test.ts` | Do not start already-prepared parallel side-effecting tools when a later preflight aborts the batch; still emit paired terminal tool events/results |
| Session replacement settlement | `packages/gsd-agent-core/src/agent-session-runtime.ts`, `packages/pi-coding-agent/test/suite/regressions/8724-in-memory-fork-active-tool.test.ts` | Abort and settle an active turn before mutating an in-memory manager for fork, keeping late aborted tool results on the outgoing session rather than the replacement |
| Post-tool compaction boundary | `packages/pi-agent-core/src/{agent-loop,agent,types}.ts`, `packages/gsd-agent-core/src/agent-session.ts`, focused agent-loop and `6879-post-tool-compaction` regressions | Prepare only a turn that will actually run, compact oversized tool output before its follow-up provider request, refresh model/system/tool context, and re-poll steering that arrives during compaction |
| Compaction seam characterization | `packages/gsd-agent-core/src/session/agent-session-compaction.test.ts`, `packages/pi-coding-agent/test/suite/agent-session-compaction.test.ts` | Keep threshold, overflow, stale-boundary, custom-stream, and queued-continuation regressions bound to the split `AgentSessionCompactionModule` instead of the removed pre-split `_checkCompaction`/`_runAutoCompaction` methods |
| Anthropic per-turn effort binding | `packages/pi-ai/src/{providers/anthropic,types,model-catalog,models.generated}.{ts,json}`, generator and focused regressions | Capability-gate Anthropic's mid-conversation effort/binding beta to verified transport/model pairs, persist each response's native effort, reconstruct signed-thinking prefixes, and surface redacted input-transformation diagnostics |
| Responses output-cap compatibility | `packages/pi-ai/src/{providers/openai-responses,types,model-catalog}.ts`, `packages/pi-coding-agent/src/core/model-registry.ts`, focused regressions | Keep `max_output_tokens` enabled by default while allowing custom OpenAI Responses-compatible gateways that reject the field to opt out explicitly |
| Plain-HTTP proxy tunneling | `packages/pi-coding-agent/src/core/http-dispatcher.ts`, `packages/pi-coding-agent/test/http-dispatcher.test.ts` | Force CONNECT tunneling for proxied HTTP origins so repeated provider calls, including the request after a tool result, keep reliable transport semantics across Undici releases |
| Fireworks GLM and Copilot Fable routing | `packages/pi-ai/scripts/generate-models.ts`, generated catalog, focused catalog/provider regressions | Route every Fireworks GLM endpoint through Chat Completions and expose GitHub Copilot Claude Fable 5 through Anthropic Messages so provider-specific reasoning controls reach the API |
| Optional vLLM scheduler priority | `packages/pi-ai/src/{providers/openai-completions,types,model-catalog}.ts`, `packages/pi-coding-agent/src/core/model-registry.ts`, focused request/config regressions | Allow an explicitly configured OpenAI-compatible vLLM model to send a numeric top-level `priority`; omit the field for every existing model by default |
| NO_PROXY domain boundary matching | `packages/pi-ai/src/utils/node-http-proxy.ts`, `packages/pi-ai/test/node-http-proxy.test.ts` | Exclude both root domains and their real subdomains, without substring false matches, while handling wildcard forms, ports, and bracketed or bare IPv6 hosts |
| Write-result unit correctness | `packages/pi-coding-agent/src/core/tools/write.ts`, `packages/pi-coding-agent/test/write-tool-result.test.ts` | Report a successful destination without mislabeling JavaScript UTF-16 code-unit length as a byte count |
| Restricted-runtime terminal refresh | `packages/pi-tui/src/terminal.ts`, `packages/pi-tui/test/regression-sigwinch-kill-eacces.test.ts` | Treat the POSIX `SIGWINCH` self-signal as a best-effort dimension refresh so seccomp/LSM denial cannot crash TUI startup |
| Execution-context cwd binding | `packages/pi-coding-agent/src/core/tools/{bash,edit,find,grep,ls,read,write}.ts`, `packages/pi-coding-agent/test/tool-context-cwd.test.ts` | Resolve cwd-sensitive operations against the current extension/session context when available instead of a stale tool-construction directory |
| Zed terminal capabilities | `packages/pi-tui/src/terminal-image.ts`, `packages/pi-tui/test/terminal-image.test.ts`, `packages/pi-coding-agent/docs/terminal-setup.md` | Recognize Zed's integrated terminal as truecolor- and hyperlink-capable and document modified-key forwarding |
| Selector-state visibility | `packages/gsd-agent-modes/src/modes/interactive/components/{model-selector,scoped-models-selector,settings-selector,theme-selector,thinking-selector}.ts` plus focused regression | Adapt upstream selector fixes to the fork-owned interactive layer: keep saved/current markers visible while browsing and make an all-enabled scoped-model toggle disable only the selected model |
| `cacheRetention` setting test | `packages/pi-coding-agent/test/settings-manager.test.ts` | Regression coverage for `getCacheRetention`/`setCacheRetention` persistence, pattern-matched off `httpIdleTimeoutMs` |
| Theme path | `packages/pi-coding-agent/src/theme/` | Shared theme (not under `modes/`) |
| Copy assets | `packages/pi-coding-agent/scripts/copy-assets.cjs` | Theme + LSP assets |
| Root staging | `scripts/copy-themes.cjs`, `scripts/copy-export-html.cjs` | Bun binary / pkg layout |

## CI boundary

```bash
npm run verify:pi-boundary
npm run verify:pi-patches
```

Fails if `packages/pi-*/src/` imports `@gsd/agent-*` or `@opengsd/*` outside the allowlist, or if pi-* files change without `patchAllowlist` coverage.

`verify:pi-boundary` also chains `bash scripts/check-mcp-bridge-boundary.sh`, which fails if `packages/mcp-server/src/workflow-tools.ts` imports core GSD extension modules (`bootstrap/write-gate`, `bootstrap/dynamic-tools`, `gsd-db`, `state`, `preferences`, `db-writer`, `doctor`, `journal`, `milestone-ids`) directly instead of through `src/resources/extensions/gsd/mcp-bridge.ts`.

## Tool schema authoring

GSD extension tools must pass golden B when sanitized for Claude. Authoring rules: [tool-schema-authoring.md](./tool-schema-authoring.md).

## Legacy names

Docs and extension loader still accept `@mariozechner/pi-*` during transition. New code should reference `earendil-works/pi` and `@earendil-works/pi-*`.

## Known limitations after v0.75.5 vendor

- **Provider discovery** is wired via `ModelRegistry.discoverModels()` + `model-discovery.ts` adapters; cache at `~/.pi/agent/discovery-cache.json`. Static providers (Anthropic, Bedrock) still have no runtime discovery.
- **GSD content blocks** (`serverToolUse`, `webSearchResult`) use type guards in agent-modes (`gsd-content-blocks.ts`) rather than extending upstream `AssistantMessage.content` unions (avoids breaking pi-ai providers).
- **Extension context** uses optional `setCompactionThresholdOverride` and legacy keybinding action names; upstream uses `app.*` keybinding IDs internally.
- **Cloud Code Assist** requires strict Claude tool schemas; sanitizer in `google-shared.ts` plus golden B tests are mandatory overlay deltas.
