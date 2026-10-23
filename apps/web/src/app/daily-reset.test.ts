import { describe, expect, it } from 'vitest'
import { getDailyReset } from './daily-reset'

describe('daily puzzle countdown', () => {
  it('uses Moscow midnight rather than the viewer timezone', () => {
    expect(getDailyReset(Date.parse('2026-10-21T18:46:00Z'))).toEqual({
      date: '2026-10-21', resetAt: Date.parse('2026-10-21T21:00:00Z'), label: '2 ч 14 мин', minutes: 134, remainingFraction: 134 / 1440,
    })
  })
  it('never shows zero or a negative duration before midnight', () => {
    expect(getDailyReset(Date.parse('2026-10-21T23:59:00+03:00')).label).toBe('1 мин')
    expect(getDailyReset(Date.parse('2026-10-21T23:59:59.999+03:00')).label).toBe('< 1 мин')
  })
  it('switches the date and starts the next countdown at midnight, including year rollover', () => {
    expect(getDailyReset(Date.parse('2027-01-01T00:00:00+03:00'))).toEqual({
      date: '2027-01-01', resetAt: Date.parse('2027-01-02T00:00:00+03:00'), label: '24 ч', minutes: 1440, remainingFraction: 1,
    })
  })
  it('drops seconds and unnecessary zero minutes', () => {
    expect(getDailyReset(Date.parse('2026-10-21T22:00:01+03:00')).label).toBe('2 ч')
    expect(getDailyReset(Date.parse('2026-10-21T23:15:20+03:00')).label).toBe('45 мин')
  })
})
