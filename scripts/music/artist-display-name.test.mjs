import assert from 'node:assert/strict'
import test from 'node:test'
import { chooseArtistDisplayNames } from './artist-display-name.mjs'

test('keeps the curated stage name primary when a provider returns a civil name', () => {
  const result = chooseArtistDisplayNames({
    inputName: 'Oxxxymiron',
    canonicalName: 'Oxxxymiron',
    displayRu: 'Мирон Янович Фёдоров',
    displayEn: 'Oxxxymiron',
    artistKey: 'oxxxymiron',
  })

  assert.equal(result.titleRu, 'Oxxxymiron')
  assert.equal(result.titleOriginal, 'Oxxxymiron')
  assert.ok(result.aliases.includes('Мирон Янович Фёдоров'))
})

test('falls back without creating an empty playable title', () => {
  assert.equal(chooseArtistDisplayNames({ artistKey: 'artist-1' }).titleRu, 'artist-1')
})
