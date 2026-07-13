import test from 'node:test'
import assert from 'node:assert/strict'
import { scoreWikidataArtistCandidate, namesReferToSameArtist, validateWikidataArtistIdentity } from '../music/artist-identity.mjs'
import { assessMusicRecord, buildFallbackMusicHint } from './adapters/music.mjs'

test('rejects a same-name album from Wikidata', () => {
  assert.equal(scoreWikidataArtistCandidate({ label: 'Романтика', description: 'альбом Софии Ротару' }, 'София Ротару'), null)
  assert.deepEqual(validateWikidataArtistIdentity({ artistName: 'София Ротару', names: ['Романтика'], typeLabels: ['музыкальный альбом'] }).valid, false)
})

test('matches Cyrillic and Latin spellings of the same artist', () => {
  assert.equal(namesReferToSameArtist('София Ротару', 'Sofia Rotaru'), true)
  assert.equal(namesReferToSameArtist('Владимир Высоцкий', 'Vladimir Vysotsky'), true)
  assert.equal(namesReferToSameArtist('Ласковый май', 'Laskoviy May'), true)
  assert.equal(namesReferToSameArtist('Юрий Шатунов', 'Yuri Shatunov'), true)
})

test('builds a sourced fallback hint without revealing the artist name', () => {
  const record = {
    input: { artist: 'София Ротару' },
    pipeline: { sourceStatus: { wikidata: 'ok', deezer: 'ok', itunes: 'ok' } },
    canonicalName: { primaryValue: 'София Ротару', sourceEvidence: [] },
    artistType: { primaryValue: ['певица'], sourceEvidence: [] },
    topTracks: { primaryValue: [{ title: 'Хуторянка' }], sourceEvidence: [] },
    topAlbums: { primaryValue: [], sourceEvidence: [] }, aliases: { primaryValue: [], sourceEvidence: [] },
    biography: { primaryValue: 'София Ротару — советская и украинская эстрадная певица молдавского происхождения. Известна многоязычным репертуаром и многолетней сценической карьерой.', sourceEvidence: [] },
    officialLinks: { primaryValue: [{ url: 'https://ru.wikipedia.org/wiki/Sofia' }], sourceEvidence: [] },
    matchConfidence: { primaryValue: 1, sourceEvidence: [] }, manualReviewReason: [],
  }
  const assessment = assessMusicRecord(record, 0.75)
  assert.equal(assessment.hardFailure, false)
  const hint = buildFallbackMusicHint(record)
  assert.ok(hint)
  assert.doesNotMatch(hint.text, /София|Ротару/i)
})
