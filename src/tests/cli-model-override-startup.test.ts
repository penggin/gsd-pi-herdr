import test from 'node:test'
import assert from 'node:assert/strict'

import { applyModelOverride } from '../cli-model-override.js'

function createModelRegistry(available: Array<{ provider: string; id: string }>) {
  return {
    getAvailable: () => available,
  } as any
}

test('applyModelOverride calls setModel when model matches by id', async () => {
  const calls: Array<{ provider: string; id: string }> = []
  const session = {
    setModel: (model: { provider: string; id: string }) => {
      calls.push(model)
    },
  }
  const modelRegistry = createModelRegistry([
    { provider: 'test', id: 'model-1' },
    { provider: 'other', id: 'model-2' },
  ])

  const result = await applyModelOverride(session, modelRegistry, 'model-1')

  assert.equal(result, undefined)
  assert.deepEqual(calls, [{ provider: 'test', id: 'model-1' }])
})

test('applyModelOverride calls setModel when model matches by provider/id', async () => {
  const calls: Array<{ provider: string; id: string }> = []
  const session = {
    setModel: (model: { provider: string; id: string }) => {
      calls.push(model)
    },
  }
  const modelRegistry = createModelRegistry([
    { provider: 'test', id: 'model-1' },
    { provider: 'other', id: 'model-2' },
  ])

  await applyModelOverride(session, modelRegistry, 'other/model-2')

  assert.deepEqual(calls, [{ provider: 'other', id: 'model-2' }])
})

test('applyModelOverride warns on stderr when model is not found', async () => {
  const previousWrite = process.stderr.write
  const stderrLines: string[] = []
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderrLines.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'))
    return true
  }) as typeof process.stderr.write

  try {
    await applyModelOverride(
      { setModel: () => {} },
      createModelRegistry([{ provider: 'test', id: 'model-1' }]),
      'missing/model',
    )

    assert.ok(
      stderrLines.some((line) => line.includes('Warning: Model "missing/model" not found')),
      'expected warning about missing model',
    )
  } finally {
    process.stderr.write = previousWrite
  }
})

test('applyModelOverride does nothing when modelFlag is undefined', async () => {
  let setModelCalled = false
  const session = {
    setModel: () => {
      setModelCalled = true
    },
  }

  await applyModelOverride(session, createModelRegistry([{ provider: 'test', id: 'model-1' }]), undefined)

  assert.equal(setModelCalled, false)
})

test('applyModelOverride waits for the model transition before resolving', async () => {
  let setModelCalled = false
  let releaseModelTransition: (() => void) | undefined
  let overrideSettled = false
  const session = {
    setModel: () => {
      setModelCalled = true
      return new Promise<void>((resolve) => {
        releaseModelTransition = resolve
      })
    },
  }
  const modelRegistry = createModelRegistry([{ provider: 'test', id: 'model-1' }])

  const pending = applyModelOverride(session, modelRegistry, 'test/model-1').then(() => {
    overrideSettled = true
  })

  assert.equal(setModelCalled, true)
  await Promise.resolve()
  assert.equal(overrideSettled, false)

  releaseModelTransition?.()
  await pending
  assert.equal(overrideSettled, true)
})
