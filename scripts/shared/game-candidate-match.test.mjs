import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeGameCandidateTitle, pickBestGameCandidate } from './game-candidate-match.mjs'

test('normalizes sequel numbers written as Roman numerals', () => {
  assert.equal(normalizeGameCandidateTitle('Divinity: Original Sin II'), 'divinity original sin 2')
})

test('prefers the actual sequel over a prefix-matching previous game', () => {
  const original = { id: 10221, game_title: 'Divinity: Original Sin', release_date: '2014-06-30' }
  const sequel = { id: 50001, game_title: 'Divinity: Original Sin II', release_date: '2017-09-14' }
  const picked = pickBestGameCandidate({ name: 'Divinity: Original Sin 2', year: 2017 }, [original, sequel])

  assert.equal(picked?.id, 50001)
})

test('rejects a previous game when no matching sequel candidate exists', () => {
  const original = { id: 10221, game_title: 'Divinity: Original Sin', release_date: '2014-06-30' }
  const picked = pickBestGameCandidate({ name: 'Divinity: Original Sin 2', year: 2017 }, [original])

  assert.equal(picked, null)
})
