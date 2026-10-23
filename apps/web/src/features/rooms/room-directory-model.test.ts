import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { FriendsRoomSummary } from '@shoditsa/contracts'
import { RoomDirectory } from './RoomDirectory'
import { canRejoinRoom, isCurrentRoom, mergeRoomDirectory, roomLeavePresentation } from './room-directory-model'

const room = (overrides: Partial<FriendsRoomSummary> = {}): FriendsRoomSummary => ({
  id: 'current', code: 'AB234', gameType: 'quiz', mode: 'movie', packs: [{ mode: 'movie', variant: 'all' }],
  players: 2, capacity: 8, phase: 'lobby', currentRound: 0, roundsTotal: 5, isHost: true,
  joinedAt: '2026-10-20T12:00:00Z', updatedAt: '2026-10-20T12:00:00Z', leftAt: null, closedAt: null, ...overrides,
})
const render = (rooms: FriendsRoomSummary[], hasCurrentRoom = false) => renderToStaticMarkup(createElement(RoomDirectory, {
  rooms, hasCurrentRoom, busy: false, copiedId: null, onCopy: vi.fn(), onLeave: vi.fn(),
}))

describe('personal room directory', () => {
  it('puts current membership first, merges duplicate IDs, and prefers the current response', () => {
    const active = room()
    const old = room({ id: 'old', closedAt: '2026-10-21T12:00:00Z', updatedAt: '2026-10-21T12:00:00Z' })
    expect(mergeRoomDirectory([active], [old, room({ phase: 'active' })])).toEqual([active, old])
  })
  it('only permits a departed player to rejoin an open lobby', () => {
    expect(isCurrentRoom(room())).toBe(true)
    expect(canRejoinRoom(room({ leftAt: '2026-10-20T12:30:00Z' }))).toBe(true)
    expect(canRejoinRoom(room({ leftAt: '2026-10-20T12:30:00Z', phase: 'active' }))).toBe(false)
    expect(canRejoinRoom(room({ leftAt: '2026-10-20T12:30:00Z', closedAt: '2026-10-20T12:30:00Z' }))).toBe(false)
  })
  it('offers reentry only when no other room is active and capacity is available', () => {
    const previous = room({ leftAt: '2026-10-20T12:30:00Z', isHost: false })
    expect(render([previous])).toContain('href="/games/together?room=AB234"')
    expect(render([previous], true)).not.toContain('href="/games/together?room=AB234"')
    expect(render([room({ ...previous, players: 8 })])).toContain('Нет мест')
  })
  it('does not offer a finished room as an invitation or promise a global close', () => {
    const finished = room({ phase: 'finished' })
    const html = render([finished], true)
    expect(html).toContain('Открыть результаты')
    expect(html).not.toContain('Скопировать приглашение')
    expect(roomLeavePresentation(finished).action).toBe('Выйти')
  })
  it('explains forfeiting an active territory duel for both roles', () => {
    for (const isHost of [true, false]) {
      expect(roomLeavePresentation(room({ gameType: 'territory', phase: 'active', isHost }))).toMatchObject({ action: 'Сдаться и выйти', description: expect.stringContaining('победу') })
    }
    expect(roomLeavePresentation(room({ gameType: 'territory' })).action).toBe('Закрыть комнату')
  })
  it('gives players leave actions and owners close actions before a game finishes', () => {
    expect(render([room({ isHost: false })], true)).not.toContain('Закрыть комнату')
    expect(render([room({ isHost: false })], true)).toContain('Выйти: AB234')
    expect(render([room()], true)).toContain('Закрыть комнату: AB234')
  })
})
