import { describe, expect, it } from 'vitest'
import { ECONOMY_RULE_SET, KPOP_ARTISTS_PACK_ID, type ContentPack } from '@shoditsa/contracts'
import catalog from './club-library-catalog.json'
import { clubDanetkiRemaining, clubLibraryFilter, clubLibraryItems, type ClubLibraryItem } from './club-library-model'

const pack = (overrides: Partial<ContentPack> = {}): ContentPack => ({
  id: 'collection', slug: 'collection', mode: 'game', title: 'Подборка', subtitle: null,
  description: '', coverUrl: null, accessModel: 'club', includedInClub: true, previewItems: 0,
  totalItems: 20, productId: null, priceMinor: null, currency: null, access: 'club', owned: false,
  completedItems: 0, ...overrides,
})
const access = { dailyRoomsStarted: 0, extraRoomsStarted: 0, clubRoomsRemaining: 2, nextSoloCost: 0, nextGroupCost: 0 }

describe('club library data', () => {
  it('uses sourced public metadata without inventing member access or progress', () => {
    const items = clubLibraryItems(null)
    expect(catalog.source).toBe('https://shoditsa.ru/api/v1/packs')
    expect(catalog.asOf).toBe('2026-10-21')
    expect(items.map(item => [item.id, item.totalItems])).toEqual([
      ['dtf-game-comments-25-v1', 20], [KPOP_ARTISTS_PACK_ID, 340],
    ])
    expect(items.every(item => item.completedItems === null && item.access === null)).toBe(true)
    expect(clubLibraryFilter(items, 'in-progress')).toEqual([])
    expect(clubLibraryFilter(items, 'completed')).toEqual([])
  })

  it('preserves a genuinely empty online catalog instead of filling it with the snapshot', () => {
    expect(clubLibraryItems([])).toEqual([])
  })

  it('keeps server progress and access, and includes only club shows', () => {
    const items = clubLibraryItems([
      pack({ completedItems: 7, access: 'personal' }),
      pack({ id: 'outside-club', includedInClub: false }),
    ])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ completedItems: 7, access: 'personal', cadence: 'collection' })
  })

  it('filters started and finished collections while keeping unstarted and empty ones out', () => {
    const items = clubLibraryItems([
      pack({ id: 'new' }), pack({ id: 'started', completedItems: 3 }),
      pack({ id: 'finished', completedItems: 20 }), pack({ id: 'over-total', completedItems: 21 }),
      pack({ id: 'empty', totalItems: 0 }),
    ])
    expect(clubLibraryFilter(items, 'all')).toEqual(items)
    expect(clubLibraryFilter(items, 'in-progress').map(item => item.id)).toEqual(['started'])
    expect(clubLibraryFilter(items, 'completed').map(item => item.id)).toEqual(['finished', 'over-total'])
  })

  it('never treats the K-pop answer pool as a collection to finish', () => {
    const items = [1, 340].flatMap(completedItems => clubLibraryItems([pack({ id: KPOP_ARTISTS_PACK_ID, totalItems: 340, completedItems })]))
    expect(items.every(item => item.cadence === 'daily')).toBe(true)
    expect(clubLibraryFilter(items, 'in-progress')).toEqual([])
    expect(clubLibraryFilter(items, 'completed')).toEqual([])
    const unknown: ClubLibraryItem = { ...items[0], id: 'unknown', cadence: 'collection', completedItems: null }
    expect(clubLibraryFilter([unknown], 'completed')).toEqual([])
  })

  it('leaves Danetki availability unknown without an active member dashboard', () => {
    expect(clubDanetkiRemaining(null, true, ECONOMY_RULE_SET)).toBeNull()
    expect(clubDanetkiRemaining(access, false, ECONOMY_RULE_SET)).toBeNull()
  })

  it('adds unused free stories to remaining club stories without restoring used stories', () => {
    const rules = { ...ECONOMY_RULE_SET, danetki: { ...ECONOMY_RULE_SET.danetki, dailyFreeRooms: 1 } }
    expect(clubDanetkiRemaining(access, true, rules)).toBe(3)
    expect(clubDanetkiRemaining({ ...access, dailyRoomsStarted: 1, clubRoomsRemaining: 1 }, true, rules)).toBe(1)
    expect(clubDanetkiRemaining({ ...access, dailyRoomsStarted: 3, clubRoomsRemaining: 0 }, true, rules)).toBe(0)
  })
})
