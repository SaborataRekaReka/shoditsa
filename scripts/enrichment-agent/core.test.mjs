import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  buildQueue,
  createEmptyState,
  loadState,
  recoverInterruptedEntities,
  saveState,
  sha256,
  summarizeQueue,
} from './core.mjs'

const adapter = {
  entityKey: (item) => item.id,
  fingerprintInput: (item) => item,
}

test('queue distinguishes completed, changed, review, backoff, and new entities', () => {
  const now = Date.parse('2026-07-11T12:00:00.000Z')
  const items = [
    { id: 'completed', value: 1 },
    { id: 'changed', value: 2 },
    { id: 'review', value: 3 },
    { id: 'backoff', value: 4 },
    { id: 'new', value: 5 },
  ]
  const state = createEmptyState('test')
  state.entities = {
    completed: {
      status: 'completed',
      inputFingerprint: sha256(items[0]),
      completedAt: '2026-07-10T12:00:00.000Z',
    },
    changed: {
      status: 'completed',
      inputFingerprint: sha256({ id: 'changed', value: 1 }),
      completedAt: '2026-07-10T12:00:00.000Z',
    },
    review: {
      status: 'review',
      inputFingerprint: sha256(items[2]),
    },
    backoff: {
      status: 'failed',
      inputFingerprint: sha256(items[3]),
      nextRetryAt: '2026-07-12T12:00:00.000Z',
    },
  }

  const queue = buildQueue({ items, state, adapter, refreshDays: 90, now })
  assert.deepEqual(queue.map((item) => item.reason), [
    'completed',
    'input_changed',
    'awaiting_review',
    'backoff',
    'new',
  ])
  assert.deepEqual(summarizeQueue(queue), {
    total: 5,
    runnable: 2,
    byReason: {
      completed: 1,
      input_changed: 1,
      awaiting_review: 1,
      backoff: 1,
      new: 1,
    },
  })
})

test('queue can retry review and refresh stale completed entities', () => {
  const item = { id: 'artist', value: 1 }
  const state = createEmptyState('test')
  state.entities.artist = {
    status: 'review',
    inputFingerprint: sha256(item),
  }
  const reviewQueue = buildQueue({ items: [item], state, adapter, refreshDays: 90, retryReview: true })
  assert.equal(reviewQueue[0].reason, 'retry_review')

  state.entities.artist = {
    status: 'completed',
    inputFingerprint: sha256(item),
    completedAt: '2020-01-01T00:00:00.000Z',
  }
  const refreshQueue = buildQueue({ items: [item], state, adapter, refreshDays: 30 })
  assert.equal(refreshQueue[0].reason, 'refresh_due')
})

test('interrupted entities are recovered and state persists atomically', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'enrichment-agent-'))
  const statePath = path.join(directory, 'state.json')
  try {
    const state = createEmptyState('test')
    state.entities.artist = { status: 'running', attempts: 1 }
    assert.equal(recoverInterruptedEntities(state), 1)
    assert.equal(state.entities.artist.status, 'pending')
    saveState(statePath, state)
    assert.deepEqual(loadState(statePath, 'test').entities.artist, state.entities.artist)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
