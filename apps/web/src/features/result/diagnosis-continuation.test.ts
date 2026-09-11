import { describe, expect, it } from 'vitest'
import type { ArchiveCalendarResponse } from '@shoditsa/contracts'
import { diagnosisArchiveRange, nextFreeDiagnosisDate } from './diagnosis-continuation'

describe('free diagnosis continuation', () => {
  it('uses the server-day and configured free window, including month boundaries', () => {
    expect(diagnosisArchiveRange('2026-09-03', 7)).toEqual({ from: '2026-08-28', to: '2026-09-03' })
  })
  it('selects only the newest available unstarted free date, not source or club access', () => {
    const calendar = { items: [
      { date: '2026-09-11', available: true, access: 'free', session: null },
      { date: '2026-09-10', available: true, access: 'free', session: { id: 'started' } },
      { date: '2026-09-09', available: false, access: 'free', session: null },
      { date: '2026-09-08', available: true, access: 'club', session: null },
      { date: '2026-09-07', available: true, access: 'free', session: null },
      { date: '2026-09-06', available: true, access: 'free', session: null },
    ] } as ArchiveCalendarResponse
    expect(nextFreeDiagnosisDate(calendar, '2026-09-11')).toBe('2026-09-07')
  })
  it('does not invent a free option before loading or when exhausted', () => {
    expect(nextFreeDiagnosisDate(undefined, '2026-09-11')).toBeNull()
    expect(nextFreeDiagnosisDate({ items: [] } as unknown as ArchiveCalendarResponse, '2026-09-11')).toBeNull()
  })
})
