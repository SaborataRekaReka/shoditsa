import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compareTitles, isAllowedInRegularGame, musicDifficultyPool, musicYearMeta, poolFor, searchTitles } from '@shoditsa/game-core'
import type { TitleItem } from '@shoditsa/contracts'
import { buildEditorialMusicCatalog, buildEditorialMusicSearchIndex, validateEditorialMusicDocument, type ArtistCompatibility, type EditorialMusicDocument } from '../src/modules/admin/music-editorial-catalog.js'

const source = JSON.parse(readFileSync(new URL('../../../data/music-editorial/music-artists-enriched.v0.2.0.json', import.meta.url), 'utf8')) as EditorialMusicDocument
const compatibility = JSON.parse(readFileSync(new URL('../../../data/music-editorial/compatibility.json', import.meta.url), 'utf8')) as Record<string, ArtistCompatibility>
const items = buildEditorialMusicCatalog(source, 'source-hash', compatibility)

describe('editorial music catalog', () => {
  it('materializes exactly the user-provided roster and preserves source IDs', () => {
    expect(items).toHaveLength(435)
    expect(new Set(items.map((item) => item.id)).size).toBe(435)
    expect(items.map((item) => item.musicCatalog?.sourceId)).toEqual(source.artists.map((artist) => artist.id))
    expect(items.every((item) => item.mode === 'music' && !item.cardType)).toBe(true)
    expect(items.every((item) => isAllowedInRegularGame(item))).toBe(true)
    expect(items.every((item) => item.dataQuality?.verified === false)).toBe(true)
  })

  it('does not misrepresent release debut as career start', () => {
    const michael = items.find((item) => item.musicCatalog?.sourceId === 'music-003')!
    expect(michael.id).toBe('music:001_michael-jackson')
    expect(michael.musicDebutYear).toBe(1971)
    expect(michael.activityStartYear).toBeUndefined()
    expect(michael.year).toBeUndefined()
    expect(musicYearMeta(michael)).toBe('дебют 1971')
    expect(compareTitles(michael, michael).find((hint) => hint.key === 'music_debut_year')).toMatchObject({ label: 'Год дебюта', value: '1971', status: 'match' })
    expect(compareTitles(michael, michael).some((hint) => hint.key === 'activity_start_year')).toBe(false)
    expect(michael.musicIsActive).toBe(false)
  })

  it('keeps null debut releases and normalizes country synonyms without inventing data', () => {
    expect(items.find((item) => item.musicCatalog?.sourceId === 'music-435')).toMatchObject({ countries: ['Латвия'], musicDebutRelease: null })
    const raw = source.artists.find((artist) => artist.countries.includes('Республика Корея') && artist.countries.includes('Южная Корея'))!
    if (raw) expect(items.find((item) => item.musicCatalog?.sourceId === raw.id)?.countries).toEqual(['Южная Корея'])
    expect(items.every((item) => !item.countries?.some((country) => ['LV', 'MD', 'RO', 'Республика Корея', 'Королевство Нидерландов'].includes(country)))).toBe(true)
  })

  it('supports all difficulty pools and music year filters', () => {
    const pool = poolFor(items, 'music', 'all')
    for (const difficulty of ['easy', 'medium', 'hard', 'expert'] as const) expect(musicDifficultyPool(pool, difficulty).length).toBeGreaterThanOrEqual(10)
    const recent = poolFor(items, 'music', 'from_2010')
    expect(recent.length).toBeGreaterThan(0)
    expect(recent.every((item) => Number(item.musicDebutYear) >= 2010)).toBe(true)
  })

  it('has complete self-comparisons and real language/composition comparisons on every artist', () => {
    for (const item of items) {
      const hints = compareTitles(item, item)
      expect(hints.length).toBeGreaterThanOrEqual(8)
      expect(hints.every((hint) => hint.status === 'match' && hint.direction === null), item.id).toBe(true)
      expect(hints.some((hint) => hint.key === 'music_languages')).toBe(true)
      expect(hints.some((hint) => hint.key === 'music_gender')).toBe(true)
      expect(hints.some((hint) => hint.key === 'music_origin')).toBe(false)
    }
    const answer = { ...items[0], musicLanguages: ['русский', 'английский'] }
    const guess = { ...items[1], musicLanguages: ['русский'] }
    expect(compareTitles(guess, answer).find((hint) => hint.key === 'music_languages')).toMatchObject({ status: 'partial', matchedValues: ['русский'] })
  })

  it('keeps old saved sessions on the legacy career-start and scene semantics', () => {
    const legacy: TitleItem = { id: 'old', mode: 'music', titleRu: 'Артист', titleOriginal: 'Artist', alternativeTitles: [], popularityScore: 1, activityStartYear: 1964, countries: ['США'], genres: ['поп'], musicType: 'Person', musicIsActive: false, musicOrigin: 'intl' }
    expect(musicYearMeta(legacy)).toBe('с 1964')
    expect(compareTitles(legacy, legacy).find((hint) => hint.key === 'activity_start_year')).toMatchObject({ label: 'Начало деятельности', value: '1964', status: 'match' })
    expect(compareTitles(legacy, legacy).some((hint) => hint.key === 'music_origin')).toBe(true)
    expect(compareTitles(legacy, legacy).some((hint) => hint.key === 'music_languages')).toBe(false)
  })

  it('builds the existing token-index format and supports original/Cyrillic names', () => {
    const index = buildEditorialMusicSearchIndex(items, '2026-09-02T00:00:00.000Z')
    expect(index.totalItems).toBe(435)
    expect(index.docs).toHaveLength(435)
    expect(index.tokensCount).toBeGreaterThan(400)
    for (const query of ['Michael Jackson', 'Майкл Джексон']) {
      expect(searchTitles(items, query, new Set(), index)[0]?.id).toBe('music:001_michael-jackson')
    }
  })

  it('fails before writing for duplicate IDs, wrong decades, or mismatched identity maps', () => {
    expect(() => validateEditorialMusicDocument({ ...source, count: 2, artists: [source.artists[0], source.artists[0]] })).toThrow(/duplicate/)
    expect(() => validateEditorialMusicDocument({ ...source, count: 1, artists: [{ ...source.artists[0], debut_decade: '1980-е' }] })).toThrow(/decade/)
    expect(() => buildEditorialMusicCatalog(source, 'hash', { ...compatibility, 'music-001': { ...compatibility['music-001'], sourceName: 'Different artist' } })).toThrow(/identity mapping/)
  })
})
