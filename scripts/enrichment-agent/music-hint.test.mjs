import assert from 'node:assert/strict'
import test from 'node:test'
import { validateMusicHint } from './adapters/music.mjs'

const field = (primaryValue) => ({ primaryValue })
const record = {
  input: { artist: 'Example Artist' },
  canonicalName: field('Example Artist'),
  displayNameRu: field('Пример Артист'),
  displayNameEn: field('Example Artist'),
  aliases: field(['EA']),
  topTracks: field([{ title: 'Secret Song' }]),
  topAlbums: field([{ title: 'Hidden Album' }]),
}

test('music hint accepts a sourced Russian distinctive fact', () => {
  const result = validateMusicHint({
    text: 'До сольной карьеры этот музыкант работал инженером, а первый большой успех пришёл после выступления на независимом фестивале.',
    sourceUrls: ['https://example.com/profile', 'https://example.org/interview'],
  }, record)

  assert.equal(result.valid, true)
  assert.deepEqual(result.errors, [])
})

test('music hint rejects artist and release title spoilers', () => {
  const artistLeak = validateMusicHint({
    text: 'Example Artist начал карьеру с необычного фестивального выступления и позднее получил международную известность благодаря экспериментам со звуком.',
    sourceUrls: ['https://example.com/profile'],
  }, record)
  const trackLeak = validateMusicHint({
    text: 'Музыкант получил международную известность после выхода Secret Song и большого фестивального выступления в начале своей сольной карьеры.',
    sourceUrls: ['https://example.com/profile'],
  }, record)

  assert.equal(artistLeak.valid, false)
  assert.equal(trackLeak.valid, false)
  assert.ok(artistLeak.errors.includes('hint_contains_answer_or_title'))
  assert.ok(trackLeak.errors.includes('hint_contains_answer_or_title'))
})
