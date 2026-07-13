import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFallbackMusicHint, validateMusicHint } from './adapters/music.mjs'

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

test('fallback hint removes the artist without deleting genre words from a compound alias', () => {
  const alisa = {
    input: { artist: 'Алиса' },
    canonicalName: field('Alisa'),
    displayNameRu: field('Алиса'),
    displayNameEn: field('Alisa'),
    aliases: field(['Алиса (рок-группа)', 'АлисА']),
    topTracks: field([]),
    topAlbums: field([]),
    biography: field('«Алиса» — советская и российская рок-группа, образованная в 1983 году в Ленинграде. Одна из самых популярных групп русского рока. Лидер и автор большинства песен «Алисы» — Константин Кинчев.'),
    officialLinks: field(['https://ru.wikipedia.org/wiki/Алиса_(группа)']),
  }

  const hint = buildFallbackMusicHint(alisa)
  assert.ok(hint)
  assert.equal(hint.text.includes('Алиса'), false)
  assert.equal(hint.text.includes('Алисы'), false)
  assert.equal(hint.text.includes('рок-группа'), true)
  assert.equal(hint.text.includes('русского рока'), true)
  assert.equal(validateMusicHint(hint, alisa).valid, true)
})

test('music hint rejects an inflected Russian artist name', () => {
  const alisa = {
    input: { artist: 'Алиса' },
    canonicalName: field('Alisa'),
    displayNameRu: field('Алиса'),
    displayNameEn: field('Alisa'),
    aliases: field([]),
    topTracks: field([]),
    topAlbums: field([]),
  }
  const result = validateMusicHint({
    text: 'Лидер и автор большинства песен «Алисы» сформировал узнаваемое звучание коллектива, которое менялось от новой волны к более тяжёлому року.',
    sourceUrls: ['https://example.com/profile'],
  }, alisa)

  assert.equal(result.valid, false)
  assert.ok(result.errors.includes('hint_contains_answer_or_title'))
})
