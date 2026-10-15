import { describe, expect, it } from 'vitest'
import { connectionScheduleHealth } from '../src/modules/connections/schedule-admin.js'

describe('Connections consecutive schedule reserve', () => {
  it('warns when today is empty even if later dates are populated', () => {
    expect(connectionScheduleHealth('2026-10-15', ['2026-10-14', '2026-10-16', '2026-10-17'])).toEqual({
      scheduledAhead: 2, contiguousScheduledDays: 0, reserveTarget: 14, reserveWarning: true, nearestGap: '2026-10-15',
    })
  })
  it('stops at the first gap rather than treating scattered future dates as reserve', () => {
    expect(connectionScheduleHealth('2026-10-15', ['2026-10-18', '2026-10-15', '2026-10-16', '2026-10-16'])).toMatchObject({
      scheduledAhead: 3, contiguousScheduledDays: 2, nearestGap: '2026-10-17', reserveWarning: true,
    })
  })
  it('clears the warning at seven days and retains the fourteen-day target', () => {
    const dates = Array.from({ length: 7 }, (_, offset) => `2026-10-${15 + offset}`)
    expect(connectionScheduleHealth('2026-10-15', dates)).toMatchObject({ contiguousScheduledDays: 7, reserveWarning: false, reserveTarget: 14, nearestGap: '2026-10-22' })
  })
  it('handles month and year boundaries in UTC', () => {
    expect(connectionScheduleHealth('2026-12-31', ['2026-12-31', '2027-01-01'])).toMatchObject({ contiguousScheduledDays: 2, nearestGap: '2027-01-02' })
  })
})
