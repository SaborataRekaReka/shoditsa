import assert from 'node:assert/strict'
import test from 'node:test'
import { applyGameManualOverride } from './manual-overrides.mjs'

test('replaces release-specific engine fields on a title-level canonical card', () => {
  const result = applyGameManualOverride({
    id: 'tgdb_1',
    canonicalGameId: 'tgdb_1',
    mode: 'game',
    titleRu: 'Игра',
    platforms: ['Commodore 64'],
  }, {
    byCanonicalGameId: {
      tgdb_1: {
        releaseScope: 'title',
        platforms: ['Arcade', 'Nintendo Entertainment System'],
        reason: 'verified',
      },
    },
  })

  assert.equal(result.releaseScope, 'title')
  assert.deepEqual(result.platforms, ['Arcade', 'Nintendo Entertainment System'])
  assert.ok(result.notes.includes('verified'))
})
