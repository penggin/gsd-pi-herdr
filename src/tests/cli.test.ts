import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('CLI startup prepares every session target through the awaitable runtime factory', () => {
  const source = readFileSync(new URL('../cli.ts', import.meta.url), 'utf8')
  const startup = source.slice(source.indexOf('const {\n  AgentSessionRuntime,'))

  assert.doesNotMatch(startup, /requireLegacySessionManager/)
  assert.match(source, /createSelectedSessionRuntimeFactory/)
  assert.match(source, /resolveConfiguredSessionDirectory/)
  assert.match(source, /sessionManagerRuntimeFactory\.list\(\{ cwd, sessionDir: effectiveSessionDir \}\)/)
  assert.match(startup, /sessionManagerRuntimeFactory\.prepare\(\{ kind: 'memory'/)
  assert.match(startup, /kind: 'continue-recent'/)
  assert.equal((startup.match(/kind: 'open'/g) ?? []).length, 3)
  assert.equal((startup.match(/kind: 'create'/g) ?? []).length, 2)
  assert.match(
    startup,
    /if \(sessionManagerRuntimeFactory\.backend === 'legacy-v3' && configuredSessionDir === undefined\) \{\s*migrateLegacyFlatSessions/,
  )
  assert.doesNotMatch(startup, /SessionManager\.(?:inMemory|open|continueRecent|create)\(/)
  assert.match(startup, /sessionRuntime = new AgentSessionRuntime\(/)
  assert.match(startup, /new InteractiveMode\(session, \{ sessionRuntime \}\)/)
})
