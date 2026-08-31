export type EffectiveEntitlementStatus = 'active' | 'scheduled' | 'expired' | 'revoked'

type EntitlementLike = {
  status?: unknown
  startsAt?: unknown
  endsAt?: unknown
}

const timestamp = (value: unknown) => {
  if (value == null || value === '') return null
  const parsed = new Date(String(value)).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

export const effectiveEntitlementStatus = (
  entitlement: EntitlementLike,
  now = Date.now(),
): EffectiveEntitlementStatus => {
  const storedStatus = String(entitlement.status ?? '')
  if (storedStatus === 'revoked') return 'revoked'
  if (storedStatus === 'expired') return 'expired'

  const startsAt = timestamp(entitlement.startsAt)
  if (startsAt !== null && startsAt > now) return 'scheduled'

  const endsAt = timestamp(entitlement.endsAt)
  if (endsAt !== null && endsAt <= now) return 'expired'

  return 'active'
}

export const canRevokeEntitlement = (entitlement: EntitlementLike, now = Date.now()) => {
  const status = effectiveEntitlementStatus(entitlement, now)
  return String(entitlement.status ?? '') === 'active' && (status === 'active' || status === 'scheduled')
}
