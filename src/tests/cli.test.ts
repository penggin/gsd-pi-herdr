import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('CLI startup prepares every session target through the awaitable runtime factory', () => {
  const source = readFileSync(new URL('../cli.ts', import.meta.url), 'utf8')
  const startup = source.slice(source.indexOf('const { createAgentSession, legacySessionManagerRuntimeFactory }'))

  assert.match(startup, /legacySessionManagerRuntimeFactory\.prepare\(\{ kind: 'memory'/)
  assert.match(startup, /kind: 'continue-recent'/)
  assert.equal((startup.match(/kind: 'open'/g) ?? []).length, 3)
  assert.equal((startup.match(/kind: 'create'/g) ?? []).length, 2)
  assert.doesNotMatch(startup, /SessionManager\.(?:inMemory|open|continueRecent|create)\(/)
})
