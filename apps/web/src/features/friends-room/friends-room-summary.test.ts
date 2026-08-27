import { describe, expect, it } from 'vitest'
import type { FriendsRoomSummary } from '@shoditsa/contracts'
import { friendsRoomActionLabel, friendsRoomSummaryTitle } from './friends-room-summary'

const summary = (overrides: Partial<FriendsRoomSummary>): FriendsRoomSummary => ({
  id: 'room-1',
  code: 'AB234',
  gameType: 'quiz',
  mode: 'series',
  packs: [{ mode: 'series', variant: 'all' }],
  players: 2,
  capacity: 8,
  phase: 'lobby',
  currentRound: 0,
  roundsTotal: 6,
  isHost: true,
  joinedAt: '2026-08-27T12:00:00.000Z',
  updatedAt: '2026-08-27T12:00:00.000Z',
  ...overrides,
})

describe('friends room summaries', () => {
  it('labels territory rooms without relying on catalog packs', () => {
    const room = summary({
      gameType: 'territory',
      mode: 'territory',
      packs: [],
      capacity: 2,
      phase: 'active',
      currentRound: 4,
      roundsTotal: 20,
    })

    expect(friendsRoomSummaryTitle(room)).toBe('Захват')
    expect(friendsRoomActionLabel(room)).toBe('Вернуться в игру')
  })

  it('keeps existing quiz and danetki labels', () => {
    expect(friendsRoomSummaryTitle(summary({}))).toBe('Сериалы')
    expect(friendsRoomSummaryTitle(summary({ gameType: 'danetki', mode: 'series', packs: [] }))).toBe('Данетки')
  })
})
