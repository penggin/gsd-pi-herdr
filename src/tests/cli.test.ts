import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('CLI startup prepares every session target through the awaitable runtime factory', () => {
  const source = readFileSync(new URL('../cli.ts', import.meta.url), 'utf8')
  const startup = source.slice(source.indexOf('const {\n  AgentSessionRuntime,'))

  assert.doesNotMatch(startup, /requireLegacySessionManager/)
  assert.match(startup, /GSD_INTERNAL_SESSION_BACKEND/)
  assert.match(startup, /createHarnessV4SessionManagerRuntimeFactory/)
  assert.match(startup, /Unsupported GSD_INTERNAL_SESSION_BACKEND/)
  assert.match(startup, /sessionManagerRuntimeFactory\.prepare\(\{ kind: 'memory'/)
  assert.match(startup, /kind: 'continue-recent'/)
  assert.equal((startup.match(/kind: 'open'/g) ?? []).length, 3)
  assert.equal((startup.match(/kind: 'create'/g) ?? []).length, 2)
  assert.match(
    startup,
    /if \(sessionManagerRuntimeFactory\.backend === 'legacy-v3'\) \{\s*migrateLegacyFlatSessions/,
  )
  assert.doesNotMatch(startup, /SessionManager\.(?:inMemory|open|continueRecent|create)\(/)
  assert.match(startup, /sessionRuntime = new AgentSessionRuntime\(/)
  assert.match(startup, /new InteractiveMode\(session, \{ sessionRuntime \}\)/)
})
