import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { KPOP_ARTISTS_PACK_ID } from '@shoditsa/contracts'
import { TodayCard } from '../quest-game/StudyTodayWidget'
import { readGameAvailability, summarizeAvailability, writeStudyActivity, STUDY_ACTIVITY_KEY } from './game-availability'

const today = '2026-10-21'
function memoryStorage(values: Record<string, string> = {}) {
  const records = new Map(Object.entries(values))
  return {
    get length() { return records.size },
    key: (index: number) => [...records.keys()][index] ?? null,
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => { records.set(key, value) },
  }
}
const save = (mode: string, status: string, date = today, extra = {}) => JSON.stringify({ mode, status, date, attemptTitleIds: ['guess'], ...extra })

describe('local daily availability', () => {
  it('counts ten daily catalogues and leaves server-only games unknown', () => {
    const result = readGameAvailability(null, today)
    expect(summarizeAvailability(result)).toEqual({ new: 10, 'in-progress': 0, completed: 0, online: 3 })
    expect(result.connections).toBe('online')
    expect(result.danetki).toBe('online')
    expect(result.word).toBe('online')
  })
  it('distinguishes unstarted, started, won and lost daily puzzles', () => {
    const storage = memoryStorage({
      'seans:v1:game:movie': save('movie', 'playing'),
      'seans:v1:game:series': save('series', 'playing', today, { attemptTitleIds: [] }),
      'seans:v1:game:animal': save('animal', 'won'),
      'seans:v1:game:book': save('book', 'lost'),
      'seans:v1:game:character': save('character', 'final_choice'),
    })
    const result = readGameAvailability(storage, today)
    expect(result.movie).toBe('in-progress')
    expect(result.series).toBe('new')
    expect(result.animal).toBe('completed')
    expect(result.book).toBe('completed')
    expect(result.character).toBe('in-progress')
    expect(summarizeAvailability(result).new).toBe(6)
  })
  it('does not consume today for yesterday, free play, or a separate content pack', () => {
    const result = readGameAvailability(memoryStorage({
      'seans:v1:game:movie': save('movie', 'won', '2026-10-20'),
      'seans:v1:game:series|salt:10': save('series', 'lost'),
      'seans:v1:game:book|free:2': save('book', 'won'),
      'seans:v1:game:music': save('music', 'won', today, { variantKey: KPOP_ARTISTS_PACK_ID }),
    }), today)
    expect(summarizeAvailability(result).new).toBe(10)
  })
  it('recognizes the active daily schedule revision without counting old revisions or free play', () => {
    const result = readGameAvailability(memoryStorage({
      'seans:v1:game:series|salt:3': save('series', 'playing'),
      'seans:v1:game:movie|salt:2': save('movie', 'won'),
      'seans:v1:game:animal': save('animal', 'won'),
      'seans:v1:game:book|free:3': save('book', 'won'),
    }), today, 3)
    expect(result.series).toBe('in-progress')
    expect(result.movie).toBe('new')
    expect(result.animal).toBe('new')
    expect(result.book).toBe('new')
  })
  it('keeps a finished result ahead of another unfinished save, independent of key order', () => {
    for (const values of [
      { 'seans:v1:game:movie:a': save('movie', 'won'), 'seans:v1:game:movie:b': save('movie', 'playing') },
      { 'seans:v1:game:movie:a': save('movie', 'playing'), 'seans:v1:game:movie:b': save('movie', 'won') },
    ]) expect(readGameAvailability(memoryStorage(values), today).movie).toBe('completed')
  })
  it('tolerates malformed or inaccessible storage without mutating any player save', () => {
    const storage = memoryStorage({ 'seans:v1:game:broken': '{', unrelated: 'private', 'seans:v1:game:movie': save('movie', 'won') })
    const before = Array.from({ length: storage.length }, (_, index) => storage.getItem(storage.key(index)!))
    readGameAvailability(storage, today)
    expect(Array.from({ length: storage.length }, (_, index) => storage.getItem(storage.key(index)!))).toEqual(before)
    expect(summarizeAvailability(readGameAvailability({ get length(): number { throw new Error('blocked') }, key: () => null, getItem: () => null }, today)).new).toBe(10)
  })
  it('keeps standalone demo progress separate from the actual daily game', () => {
    const original = save('movie', 'won')
    const storage = memoryStorage({ 'seans:v1:game:movie': original })
    writeStudyActivity(storage, today, 2, 'playing')
    expect(storage.getItem('seans:v1:game:movie')).toBe(original)
    expect(storage.getItem(STUDY_ACTIVITY_KEY)).toBeTruthy()
    expect(readGameAvailability(storage, today).anime).toBe('new')
    writeStudyActivity(storage, today, 3, 'won')
    storage.setItem('seans:v1:game:anime', save('anime', 'playing'))
    expect(readGameAvailability(storage, today).anime).toBe('in-progress')
    expect(readGameAvailability(storage, '2026-10-22').anime).toBe('new')
  })
})

describe('today card indicators', () => {
  const availability = readGameAvailability(null, today)
  it('links all thirteen game icons and reflects the same daily states as the catalogue', () => {
    const html = renderToStaticMarkup(createElement(TodayCard, { date: today, availability: { ...availability, movie: 'completed', anime: 'in-progress' } }))
    expect(html.match(/data-day-game=/g)).toHaveLength(13)
    expect(html).toContain('Кино: Сегодняшняя загадка уже завершена')
    expect(html).toContain('Аниме: Загадка уже начата')
    expect(html).not.toContain('>∞<')
  })
  it('shows infinity only for club free play, never for limited server-only games', () => {
    const html = renderToStaticMarkup(createElement(TodayCard, { date: today, availability, clubActive: true }))
    expect(html.match(/hs-today-game--club"/g)).toHaveLength(10)
    expect(html).toContain('hs-today-game--online" href="/games/danetki"')
    expect(html).toContain('hs-today-game--online" href="/games/connections"')
    expect(html).toContain('hs-today-game--online" href="/games/word"')
  })
  it('keeps the completed checkmark even with club free play available', () => {
    const html = renderToStaticMarkup(createElement(TodayCard, { date: today, availability: { ...availability, movie: 'completed' }, clubActive: true }))
    expect(html).toContain('hs-today-game--completed" href="/games/movie"')
    expect(html.match(/hs-today-game--club"/g)).toHaveLength(9)
    expect(html).toContain('Кино: Сегодняшняя загадка уже завершена')
  })
})
