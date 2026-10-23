import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { FriendsRoomSnapshot } from '@shoditsa/contracts'
vi.mock('../application/ApplicationAside', () => ({ ApplicationAside: ({ children }: { children: ReactNode }) => children }))
import { RoomWaitingLobby } from './RoomWaitingLobby'
const room = (): FriendsRoomSnapshot => ({
  id: 'test-room', code: 'AB234', gameType: 'quiz', mode: 'movie', packs: [{ mode: 'movie', variant: 'all' }], capacity: 8, roundsTotal: 6, shufflePacks: false, answerTimeSeconds: 30,
  phase: 'lobby', rulesVersion: 4, currentRound: 0, version: 1, currentUserId: 'host', isHost: true, serverTime: '2026-10-22T00:00:00Z',
  members: [{ userId: 'host', role: 'owner', displayName: 'Ведущий', colorKey: 'player-1', score: 0, answered: false, joinedAt: '2026-10-22T00:00:00Z', leftAt: null, lastSeenAt: '2026-10-22T00:00:00Z', connected: true }],
  round: null, answers: [], messages: [], territory: null, danetkiSessionId: null, danetkiLaunchCost: 0, danetkiLaunch: { kind: 'daily' },
  continuation: { canContinue: false, roundsAdded: 6, nextRoundsTotal: null, accessSource: 'club', cost: 0, balance: 248, shortage: 0, quote: null },
})
const render = (snapshot: FriendsRoomSnapshot, saving = false) => renderToStaticMarkup(createElement(RoomWaitingLobby, { room: snapshot, members: snapshot.members, copied: false, busy: false, saving, territoryEnabled: true, ticketBalance: 248, message: '', messageSending: false, onMessage: vi.fn(), onSend: vi.fn(), onCopy: vi.fn(), onStart: vi.fn(), onLeave: vi.fn(), onConfigure: vi.fn() }))

describe('room waiting controls', () => {
  it('shows the code, participants and separate start action, without the legacy room layout', () => {
    const html = render(room())
    expect(html).toContain('AB234')
    expect(html).toContain('Ведущий')
    expect(html).toContain('Начать одному')
    expect(html).toContain('Скопировать ссылку')
    expect(html).toContain('Кто играет')
    expect(html).not.toContain('role="radiogroup"')
    expect(html).not.toContain('class="room-waiting ')
    expect(html).not.toContain('friends-room__columns')
    expect(html).not.toContain('room-lobby__intro')
  })
  it('makes the participant view read-only and never exposes host start', () => {
    const html = render({ ...room(), isHost: false, currentUserId: 'friend' })
    expect(html).not.toContain('role="radiogroup"')
    expect(html).not.toContain('Начать одному')
    expect(html).toContain('Настройки меняет создатель комнаты.')
    expect(html).not.toContain('Начать игру')
    expect(html).toContain('Ждём, когда создатель начнёт игру.')
  })
  it('requires exactly two connected players for Territory', () => {
    const snapshot = { ...room(), gameType: 'territory' as const, capacity: 2 }
    expect(render(snapshot)).toContain('Ждём второго игрока')
    snapshot.members.push({ ...snapshot.members[0], userId: 'friend', role: 'player', displayName: 'Друг', connected: false })
    expect(render(snapshot)).toContain('Ждём второго игрока')
    snapshot.members[1].connected = true
    expect(render(snapshot)).toContain('Начать игру')
    expect(render(snapshot)).not.toContain('Ждём второго игрока')
  })
  it('cannot start while settings are saving', () => {
    expect(render(room(), true)).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Сохраняем настройки/)
  })
})
