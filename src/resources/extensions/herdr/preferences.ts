import type { GSDPreferences } from "../gsd/preferences.js";

export interface ResolvedHerdrPreferences {
  enabled: boolean;
  required: boolean;
}

/**
 * Resolve the intentionally-small M1 preference surface.
 *
 * Herdr remains opt-in so merely installing the downstream fork cannot change
 * upstream execution behavior. `required` defaults true once enabled so later
 * monitored worker execution cannot silently become an invisible local run.
 */
export function resolveHerdrPreferences(
  preferences: GSDPreferences | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedHerdrPreferences {
  const configured = preferences?.herdr;
  const disabledByEnvironment = env.GSD_HERDR_DISABLE === "1";
  const requiredByEnvironment = env.GSD_HERDR_REQUIRED === "1";

  return {
    enabled: configured?.enabled === true && !disabledByEnvironment,
    required: requiredByEnvironment || configured?.required !== false,
  };
}
