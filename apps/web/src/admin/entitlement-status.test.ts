import { describe, expect, it } from 'vitest'
import { canRevokeEntitlement, effectiveEntitlementStatus } from './entitlement-status'

const now = new Date('2026-08-31T12:00:00.000Z').getTime()

describe('effectiveEntitlementStatus', () => {
  it('treats a stored active entitlement with a past end date as expired', () => {
    const entitlement = { status: 'active', startsAt: '2026-07-20T10:47:47.978Z', endsAt: '2026-08-19T10:47:47.978Z' }
    expect(effectiveEntitlementStatus(entitlement, now)).toBe('expired')
    expect(canRevokeEntitlement(entitlement, now)).toBe(false)
  })

  it('distinguishes current, scheduled and revoked access', () => {
    expect(effectiveEntitlementStatus({ status: 'active', startsAt: '2026-08-01T00:00:00.000Z', endsAt: '2026-09-25T00:00:00.000Z' }, now)).toBe('active')
    expect(effectiveEntitlementStatus({ status: 'active', startsAt: '2026-09-25T00:00:00.000Z', endsAt: '2026-10-25T00:00:00.000Z' }, now)).toBe('scheduled')
    expect(effectiveEntitlementStatus({ status: 'revoked', startsAt: '2026-08-01T00:00:00.000Z', endsAt: '2026-09-25T00:00:00.000Z' }, now)).toBe('revoked')
  })
})
