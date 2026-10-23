import { describe, expect, it } from 'vitest'
import { Value } from '@sinclair/typebox/value'
import { FriendsRoomCreateBodySchema, friendsRoomMinimumRounds } from '@shoditsa/contracts'
import { defaultRoomSetup, normalizeRoomSetup, roomSetupPayload, ROOM_CATEGORIES } from './room-setup-model'

describe('room setup submitted to the existing API', () => {
  it('preserves the chosen categories, variant and rules in a valid create request', () => {
    const payload = roomSetupPayload({ ...defaultRoomSetup(), packs: [{ mode: 'anime', variant: 'from_2010' }, { mode: 'movie', variant: 'all' }], roundsTotal: 12, answerTimeSeconds: 20, shufflePacks: true })
    expect(Value.Check(FriendsRoomCreateBodySchema, payload)).toBe(true)
    expect(payload).toMatchObject({ mode: 'anime', packs: [{ mode: 'anime', variant: 'from_2010' }, { mode: 'movie', variant: 'all' }], roundsTotal: 12, answerTimeSeconds: 20, shufflePacks: true })
  })
  it('keeps at least one valid category and repairs unsupported variants', () => {
    expect(normalizeRoomSetup({ ...defaultRoomSetup(), packs: [] }).packs).toEqual([{ mode: 'movie', variant: 'all' }])
    expect(normalizeRoomSetup({ ...defaultRoomSetup(), packs: [{ mode: 'movie', variant: 'obsolete' }, { mode: 'movie', variant: 'from_2020' }] }).packs).toEqual([{ mode: 'movie', variant: 'all' }])
  })
  it('raises rounds to cover every selected category and follows the server step', () => {
    const setup = normalizeRoomSetup({ ...defaultRoomSetup(), packs: ROOM_CATEGORIES.map(category => ({ mode: category.id, variant: 'all' })), roundsTotal: 3 })
    expect(setup.roundsTotal).toBe(friendsRoomMinimumRounds(ROOM_CATEGORIES.length))
    expect(normalizeRoomSetup({ ...defaultRoomSetup(), roundsTotal: 7 }).roundsTotal).toBe(9)
    expect(normalizeRoomSetup({ ...defaultRoomSetup(), roundsTotal: 999 }).roundsTotal).toBe(30)
  })
  it.each(['danetki', 'territory'] as const)('does not send hidden quiz settings to %s', gameType => {
    expect(roomSetupPayload({ ...defaultRoomSetup(), gameType, roundsTotal: 24 })).toEqual({ gameType })
  })
})
