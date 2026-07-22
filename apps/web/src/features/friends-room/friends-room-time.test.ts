import { describe, expect, it } from 'vitest'
import { friendsRoomTimeLeft } from './friends-room-time'

describe('friendsRoomTimeLeft', () => {
  it('uses fresh server time when the client timer was frozen on results', () => {
    expect(friendsRoomTimeLeft({
      endsAt: '2026-07-22T16:00:03.000Z',
      clientNow: Date.parse('2026-07-22T15:58:14.000Z'),
      serverTime: '2026-07-22T16:00:00.000Z',
      maximum: 3,
    })).toBe(3)
  })

  it('never renders more than the configured phase duration', () => {
    expect(friendsRoomTimeLeft({
      endsAt: '2026-07-22T16:02:00.000Z',
      clientNow: Date.parse('2026-07-22T16:00:00.000Z'),
      serverTime: '2026-07-22T16:00:00.000Z',
      maximum: 30,
    })).toBe(30)
  })
})
