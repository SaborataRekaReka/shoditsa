import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Credentials, RoomView } from './contracts'
import { knownRoomCredentials, markSvoyakUnavailable, observeSvoyakRoom, rememberRoom, roomCredentials, savedSvoyakRooms } from './room-directory-storage'
import { isCurrentRoom, roomDirectoryHref, roomInvitationHref } from '../rooms/room-directory-model'

const credentials: Credentials = { code: 'ABCDEF', token: 'test-only-token', memberId: 'host' }
const room = (patch: Partial<RoomView> = {}): RoomView => ({ code: 'ABCDEF', stage: 'lobby', hostId: 'host', members: [{ id: 'host' }], me: { id: 'host' }, settings: { rounds: 3, themesPerRound: 3 }, played: 0, serverNow: 1_792_620_000_000, ...patch } as RoomView)
beforeEach(() => {
  const storage: Record<string, unknown> = {}
  Object.defineProperties(storage, {
    getItem: { value: (key: string) => storage[key] ?? null },
    setItem: { value: (key: string, value: string) => { storage[key] = value } },
  })
  vi.stubGlobal('sessionStorage', storage)
})
afterEach(() => vi.unstubAllGlobals())
describe('Svoyak membership in the shared lobby', () => {
  it('discovers existing room credentials, validates them, and keeps secrets out of summaries and URLs', () => {
    rememberRoom(credentials)
    sessionStorage.setItem('svoyak:room:v1:BADBAD', '{"code":"BADBAD"}')
    expect(knownRoomCredentials()).toEqual([credentials])
    expect(roomCredentials('BADBAD')).toBeNull()
    observeSvoyakRoom(room(), credentials)
    const summary = savedSvoyakRooms()[0]
    expect(summary).toMatchObject({ gameType: 'svoyak', isHost: true, capacity: 13 })
    expect(isCurrentRoom(summary)).toBe(true)
    expect(roomDirectoryHref(summary)).toBe('/svoyak/rooms/ABCDEF')
    expect(roomInvitationHref(summary)).toBe('/svoyak/join/ABCDEF')
    expect(JSON.stringify(summary)).not.toContain(credentials.token)
  })
  it('does not restore membership on a late poll after explicitly leaving', () => {
    observeSvoyakRoom(room(), credentials)
    observeSvoyakRoom(room({ stage: 'playing' }), credentials, true)
    observeSvoyakRoom(room({ stage: 'playing' }), credentials)
    expect(isCurrentRoom(savedSvoyakRooms()[0])).toBe(false)
    observeSvoyakRoom(room({ stage: 'playing' }), credentials, false, true)
    expect(isCurrentRoom(savedSvoyakRooms()[0])).toBe(true)
  })
  it('keeps closed and unavailable rooms in history without blocking new games', () => {
    observeSvoyakRoom(room({ stage: 'closed' }), credentials)
    expect(isCurrentRoom(savedSvoyakRooms()[0])).toBe(false)
    observeSvoyakRoom(room(), credentials, false, true)
    markSvoyakUnavailable(credentials.code)
    expect(isCurrentRoom(savedSvoyakRooms()[0])).toBe(false)
  })
})
