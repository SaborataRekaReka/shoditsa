import { describe, expect, it } from 'vitest'
import { FRIENDS_ROOM_PACK_VARIANTS, type TitleItem } from '@shoditsa/contracts'
import { buildFriendsRoomPackSchedule, friendsRoomItemMatchesPack, normalizeFriendsRoomPacks } from '../src/modules/friends-room/packs.js'

const item = (values: Partial<TitleItem>): TitleItem => ({
  id: 'item',
  mode: 'city',
  titleRu: 'Карточка',
  titleOriginal: '',
  popularityScore: 1,
  ...values,
} as TitleItem)

describe('friends room packs', () => {
  it('uses the same periods and music difficulties as the main games', () => {
    expect(FRIENDS_ROOM_PACK_VARIANTS.movie.map((variant) => variant.id)).toEqual([
      'all', 'from_2020', 'from_2010', 'from_2000', 'from_1990', 'from_1980', 'from_1960',
    ])
    expect(FRIENDS_ROOM_PACK_VARIANTS.series.map((variant) => variant.id)).toEqual([
      'all', 'from_2020', 'from_2010', 'from_2000', 'from_1990', 'from_1980', 'from_1960',
    ])
    expect(FRIENDS_ROOM_PACK_VARIANTS.music.map((variant) => variant.id)).toEqual(['easy', 'medium', 'hard', 'expert'])
  })

  it('keeps several selected packs in their chosen order', () => {
    expect(normalizeFriendsRoomPacks([
      { mode: 'city', variant: 'capitals' },
      { mode: 'movie', variant: 'from_1990' },
    ])).toEqual([
      { mode: 'city', variant: 'capitals' },
      { mode: 'movie', variant: 'from_1990' },
    ])
  })

  it('uses the smart default variant for a city pack', () => {
    expect(normalizeFriendsRoomPacks(undefined, 'city')).toEqual([{ mode: 'city', variant: 'capitals' }])
    expect(normalizeFriendsRoomPacks(undefined, 'music')).toEqual([{ mode: 'music', variant: 'medium' }])
  })

  it('filters city and era variants without mixing categories', () => {
    expect(friendsRoomItemMatchesPack(item({ mode: 'city', capital: true }), { mode: 'city', variant: 'capitals' })).toBe(true)
    expect(friendsRoomItemMatchesPack(item({ mode: 'city', capital: false }), { mode: 'city', variant: 'capitals' })).toBe(false)
    expect(friendsRoomItemMatchesPack(item({ mode: 'movie', year: 1999 }), { mode: 'movie', variant: 'from_2000' })).toBe(false)
    expect(friendsRoomItemMatchesPack(item({ mode: 'movie', year: 2010 }), { mode: 'movie', variant: 'from_2000' })).toBe(true)
  })

  it('shuffles a full pack cycle once and keeps it stable for the room', () => {
    const packs = normalizeFriendsRoomPacks([
      { mode: 'series', variant: 'all' },
      { mode: 'movie', variant: 'all' },
      { mode: 'anime', variant: 'all' },
      { mode: 'game', variant: 'all' },
      { mode: 'city', variant: 'capitals' },
      { mode: 'music', variant: 'medium' },
    ])
    const fullSchedule = buildFriendsRoomPackSchedule(packs, 6, 'room-one', true)

    expect(new Set(fullSchedule.map((pack) => pack.mode)).size).toBe(6)
    expect(buildFriendsRoomPackSchedule(packs, 6, 'room-one', true)).toEqual(fullSchedule)
  })

  it('keeps the selected order unless shuffle is enabled', () => {
    const packs = normalizeFriendsRoomPacks([
      { mode: 'city', variant: 'capitals' },
      { mode: 'movie', variant: 'all' },
      { mode: 'music', variant: 'medium' },
    ])
    expect(buildFriendsRoomPackSchedule(packs, 6, 'room-three').map((pack) => pack.mode)).toEqual([
      'city', 'movie', 'music', 'city', 'movie', 'music',
    ])
  })

  it('keeps pack counts balanced through a thirty-round game', () => {
    const packs = normalizeFriendsRoomPacks([
      { mode: 'series', variant: 'all' },
      { mode: 'movie', variant: 'all' },
      { mode: 'city', variant: 'capitals' },
      { mode: 'music', variant: 'medium' },
      { mode: 'diagnosis', variant: 'all' },
      { mode: 'game', variant: 'all' },
    ])
    const counts = new Map<string, number>()
    for (const pack of buildFriendsRoomPackSchedule(packs, 30, 'room-two')) {
      counts.set(pack.mode, (counts.get(pack.mode) ?? 0) + 1)
    }
    expect([...counts.values()]).toEqual([5, 5, 5, 5, 5, 5])
  })
})
