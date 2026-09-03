# Codex Remote Compaction V2

GSD uses the Codex backend's opaque Remote Compaction V2 checkpoint when the active model API is exactly
`openai-codex-responses`. This includes Codex-compatible proxies that implement the same `compaction_trigger`
contract; provider identity is not the eligibility gate. Generic `openai-responses`, Azure OpenAI Responses,
OpenAI-compatible chat completions, and external CLI providers continue to use GSD's native plaintext compaction.

GSD remains authoritative for manual, threshold, and overflow compaction. Before compacting, the normal GSD
snapshot, auto-mode gate, and CONTINUE checkpoint logic runs. If compaction is allowed, GSD sends the current
Codex Responses input with one final `compaction_trigger`, validates one bounded opaque `compaction` item, and
stores it in `CompactionEntry.details`. Later requests replay it only when the exact provider and model ID, persisted summary
identity, retained-message fingerprints, and provider payload marker all match.

Use `/codex-compact status` to inspect the effective route and `/codex-compact now` to start compaction. Configure
the feature under `context_management.codex_remote_compaction` in GSD preferences. It is enabled by default for
eligible models.

Non-cancellation transport or protocol failures notify the user and fall back to native plaintext compaction.
User cancellation and session replacement cancel publication instead of starting a second compaction request.

## Security and compatibility

- The raw observed SSE stream is limited to 8 MiB.
- One serialized opaque item is limited to 2 MiB.
- Persisted replacement history is limited to 8 MiB.
- Retained user text defaults to an approximate 64,000-token budget and is configurable from 8,000 to 128,000.
- Credentials and request headers are not stored in checkpoint details.
- Symlinked or additional settings files are not used; configuration stays in GSD's validated preferences.
- Replay fails closed when a marker is absent or duplicated, retained messages changed, or the provider/model differs.

The built-in ChatGPT transport requires an OAuth JWT with `chatgpt_account_id` and uses `/codex/responses`.
Codex-compatible proxy URLs default to opaque bearer auth and `/responses`; these defaults can be made explicit
with `compat.codexAuth: bearer` and `compat.codexEndpoint: responses`. This distinction changes transport only —
Remote V2 eligibility remains based on `model.api`.

Hosted search is a separate capability. Direct OpenAI Codex enables it by default, while a compatible proxy must
set `compat.nativeWebSearch: true` only after a live request proves that the endpoint accepts the Responses
`web_search` tool and streams its search lifecycle events. Remote V2 support does not imply hosted-search support.

The Remote V2 wire contract is controlled by the configured Codex backend and is not a stable public API.
Sessions retain a visible fallback marker so missing or incompatible replay is explicit rather than silently
inventing older context.

## Attribution

The protocol validation, bounded checkpoint, and replay design is derived from
[`@narumitw/pi-codex-compact`](https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-codex-compact).
The original MIT license is preserved in `codex-compact/LICENSE.narumitw`.
