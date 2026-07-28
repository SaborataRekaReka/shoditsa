import { describe, expect, it } from 'vitest'
import { resolveConnectionsStartDate } from '../src/modules/connections/bootstrap-schedule.js'

describe('connections bootstrap schedule', () => {
  it('keeps the persisted launch date when a deployment runs on a later day', () => {
    expect(resolveConnectionsStartDate({
      stored: '2026-07-27',
      today: '2026-07-28',
    })).toBe('2026-07-27')
  })

  it('lets an explicit argument or deployment setting override the persisted date', () => {
    expect(resolveConnectionsStartDate({
      argument: '2026-08-02',
      configured: '2026-08-01',
      stored: '2026-07-27',
      today: '2026-07-28',
    })).toBe('2026-08-02')
    expect(resolveConnectionsStartDate({
      configured: '2026-08-01',
      stored: '2026-07-27',
      today: '2026-07-28',
    })).toBe('2026-08-01')
  })

  it('uses the current Moscow date only for the initial bootstrap', () => {
    expect(resolveConnectionsStartDate({
      configured: null,
      today: '2026-07-28',
    })).toBe('2026-07-28')
  })
})
