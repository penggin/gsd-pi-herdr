# ADR-049: OpenAI Codex Hosted Web Search

**Status:** Accepted

**Date:** 2026-08-30

**Extends:** ADR-012 provider identity vs. API shape

## Context

GSD previously used hosted search only on supported Anthropic transports. A
ChatGPT-authenticated Codex session still advertised the local
`search-the-web` and `search_and_read` functions, requiring a separate Brave,
Tavily, or Ollama credential even though the Codex Responses transport supports
the Responses API hosted `web_search` tool.

The Responses API accepts built-in tools in the request `tools` array and
returns `web_search_call` output items. The ChatGPT-backed Codex transport uses
that contract with live external web access.

## Decision

- Treat only `api: openai-codex-responses` plus `provider: openai-codex` as
  eligible for Codex hosted search. Similar-looking proxies are not assumed to
  support OpenAI-hosted tools.
- Under `search_provider: auto` or `native`, remove the external search function
  schemas and add a live `web_search` built-in tool to the provider payload.
- Explicit `brave`, `tavily`, or `ollama` preferences keep the existing external
  tool path and suppress hosted search.
- Preserve completed `web_search_call` items and their source URLs in the
  canonical assistant message. Replay the provider item only for the exact same
  provider, API, and model.
- Keep `fetch_page` available. Hosted search replaces discovery, not explicit
  page extraction.

## Consequences

ChatGPT Plus/Pro Codex users no longer need a second search API key for normal
GSD research. The provider remains responsible for search execution and usage
policy. If the active model or transport is not eligible, GSD continues to use
an explicitly configured external provider or exposes no search tool rather
than sending an unsupported hosted-tool schema.

The wire contract follows the official OpenAI Responses built-in tool contract:
<https://developers.openai.com/api/reference/cli/resources/responses/methods/create>.
