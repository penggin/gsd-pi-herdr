/**
 * /search-provider slash command.
 *
 * Lets users switch between hosted model search and external search backends.
 * Supports direct arg (`/search-provider tavily`) or interactive select UI.
 * Tab completion provides all valid options with external-key status.
 *
 * All provider logic lives in provider.ts (S01) — this is pure UI wiring.
 */

import { supportsCodexNativeWebSearch, supportsNativeWebSearch } from './native-search.js'
import type { ExtensionAPI } from '@gsd/pi-coding-agent'
import type { AutocompleteItem } from '@gsd/pi-tui'
import {
  getTavilyApiKey,
  getBraveApiKey,
  getOllamaApiKey,
  getSearchProviderPreference,
  setSearchProviderPreference,
  resolveSearchProvider,
  type SearchProviderPreference,
} from './provider.js'

const VALID_PREFERENCES: SearchProviderPreference[] = ['native', 'tavily', 'brave', 'ollama', 'auto']

function keyStatus(provider: 'tavily' | 'brave' | 'ollama'): string {
  if (provider === 'tavily') return getTavilyApiKey() ? '✓' : '✗'
  if (provider === 'ollama') return getOllamaApiKey() ? '✓' : '✗'
  return getBraveApiKey() ? '✓' : '✗'
}

function buildSelectOptions(): string[] {
  return [
    `native (no separate API key)`,
    `tavily (key: ${keyStatus('tavily')})`,
    `brave (key: ${keyStatus('brave')})`,
    `ollama (key: ${keyStatus('ollama')})`,
    `auto`,
  ]
}

function parseSelectChoice(choice: string): SearchProviderPreference {
  if (choice.startsWith('native')) return 'native'
  if (choice.startsWith('tavily')) return 'tavily'
  if (choice.startsWith('brave')) return 'brave'
  if (choice.startsWith('ollama')) return 'ollama'
  return 'auto'
}

export function registerSearchProviderCommand(pi: ExtensionAPI): void {
  pi.registerCommand('search-provider', {
    description: 'Switch search provider (native, tavily, brave, ollama, auto)',

    getArgumentCompletions(prefix: string): AutocompleteItem[] | null {
      const trimmed = prefix.trim().toLowerCase()
      return VALID_PREFERENCES
        .filter((p) => p.startsWith(trimmed))
        .map((p) => {
          let description: string
          if (p === 'native') {
            description = 'Hosted search from the active Anthropic or OpenAI Codex model'
          } else if (p === 'auto') {
            description = `Prefer hosted search; external fallback (tavily: ${keyStatus('tavily')}, brave: ${keyStatus('brave')}, ollama: ${keyStatus('ollama')})`
          } else {
            description = `key: ${keyStatus(p)}`
          }
          return { value: p, label: p, description }
        })
    },

    async handler(args, ctx) {
      const trimmed = args.trim().toLowerCase()

      let chosen: SearchProviderPreference

      if (trimmed && (VALID_PREFERENCES as string[]).includes(trimmed)) {
        // Direct arg — apply immediately, no select UI
        chosen = trimmed as SearchProviderPreference
      } else {
        // No arg or invalid arg — show interactive select
        const current = getSearchProviderPreference()
        const options = buildSelectOptions()
        const result = await ctx.ui.select(
          `Search provider (current: ${current})`,
          options,
        )

        if (result === undefined) {
          // User cancelled — bail silently
          return
        }

        chosen = parseSelectChoice(Array.isArray(result) ? result[0] : result)
      }

      setSearchProviderPreference(chosen)
      const effective = resolveSearchProvider()
      // Gate on api shape + provider allowlist: the info note must match the
      // actual runtime behavior in native-search.ts. Claude served via copilot
      // / minimax / kimi is anthropic-shaped but does NOT run native search.
      const nativeName = supportsNativeWebSearch(ctx.model)
        ? 'Anthropic'
        : supportsCodexNativeWebSearch(ctx.model)
          ? 'OpenAI Codex'
          : undefined
      const useNative = nativeName !== undefined && (chosen === 'native' || chosen === 'auto')
      const effectiveLabel = useNative
        ? `${nativeName} built-in`
        : chosen === 'native'
          ? 'unavailable for active model'
          : effective ?? 'none (no API keys)'
      ctx.ui.notify(
        `Search provider set to ${chosen}. Effective provider: ${effectiveLabel}`,
        'info',
      )
    },
  })
}
