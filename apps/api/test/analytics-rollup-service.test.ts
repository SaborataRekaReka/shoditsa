import { describe, expect, it, vi } from 'vitest'
import type { Database } from '@shoditsa/database'
import {
  ANALYTICS_ROLLUP_LAG_DAYS,
  analyticsRollupBoundary,
  RAW_ANALYTICS_RETENTION_DAYS,
  rollupClientEventRetention,
} from '../src/modules/stats/analytics-rollup-service.js'

describe('analytics daily rollup', () => {
  it('uses completed UTC days with a raw overlap large enough for 31d + attribution', () => {
    const boundary = analyticsRollupBoundary(new Date('2026-08-19T23:59:59.000Z'))

    expect(ANALYTICS_ROLLUP_LAG_DAYS).toBe(30)
    expect(RAW_ANALYTICS_RETENTION_DAYS).toBe(38)
    expect(boundary.today.toISOString()).toBe('2026-08-19T00:00:00.000Z')
    expect(boundary.rollupCutoff.toISOString()).toBe('2026-07-20T00:00:00.000Z')
    expect(boundary.rawCutoff.toISOString()).toBe('2026-07-12T00:00:00.000Z')
  })

  it('archives, marks, and deletes in one transaction without materializing deleted ids', async () => {
    const execute = vi.fn().mockResolvedValue({ count: 4 })
    const transaction = vi.fn(async (callback: (tx: { execute: typeof execute }) => unknown) => callback({ execute }))
    const db = { transaction } as unknown as Database

    const result = await rollupClientEventRetention(db, new Date('2026-08-19T12:00:00.000Z'))

    expect(transaction).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledTimes(5)
    expect(result).toEqual({
      removed: 4,
      rolledUpThroughExclusive: '2026-07-20T00:00:00.000Z',
      rawRetainedFromInclusive: '2026-07-12T00:00:00.000Z',
    })
  })
})
