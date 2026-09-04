import type { ModelRegistry as ModelRegistryInstance } from '@gsd/pi-coding-agent'

/**
 * Apply the --model CLI flag override to the active session.
 * Searches available models by exact id or provider/id pattern and warns
 * on stderr when the requested model is not found in the registry.
 *
 * Await the model transition so its persistence, capability-based thinking
 * clamp, and model-select hooks settle before startup applies --thinking or
 * begins the first request.
 */
export async function applyModelOverride(
  session: { setModel(model: { provider: string; id: string }): unknown | Promise<unknown> },
  modelRegistry: ModelRegistryInstance,
  modelFlag: string | undefined,
): Promise<void> {
  if (!modelFlag) return
  const available = modelRegistry.getAvailable()
  const match =
    available.find((m) => m.id === modelFlag) ||
    available.find((m) => `${m.provider}/${m.id}` === modelFlag)
  if (match) {
    await session.setModel(match)
  } else {
    process.stderr.write(`[gsd] Warning: Model "${modelFlag}" not found. Using configured default.\n`)
  }
}
