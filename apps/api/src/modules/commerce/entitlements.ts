import { and, desc, eq, gt, isNull, lte, or } from 'drizzle-orm'
import { userEntitlements, type Database } from '@shoditsa/database'

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type ReadDatabase = Database | Transaction
type Product = {
  id: string
  kind: string
  durationDays: number | null
  entitlementKey: string | null
  scope: string | null
  metadata: unknown
}
type Order = { id: string }

const activeWhere = (userId: string, now: Date) => and(
  eq(userEntitlements.userId, userId),
  eq(userEntitlements.status, 'active'),
  lte(userEntitlements.startsAt, now),
  or(isNull(userEntitlements.endsAt), gt(userEntitlements.endsAt, now)),
)

export const getActiveEntitlements = (db: ReadDatabase, userId: string, now = new Date()) => db.select()
  .from(userEntitlements).where(activeWhere(userId, now)).orderBy(desc(userEntitlements.endsAt))

export const hasEntitlement = async (db: ReadDatabase, userId: string, key: string, scope?: string | null, now = new Date()) => {
  const filters = [activeWhere(userId, now), eq(userEntitlements.entitlementKey, key)]
  if (scope !== undefined) filters.push(scope === null ? isNull(userEntitlements.scope) : eq(userEntitlements.scope, scope))
  return Boolean((await db.select({ id: userEntitlements.id }).from(userEntitlements).where(and(...filters)).limit(1))[0])
}

export const getMembershipSummary = async (db: ReadDatabase, userId: string, now = new Date()) => {
  const rows = await db.select().from(userEntitlements).where(and(
    activeWhere(userId, now),
    eq(userEntitlements.entitlementKey, 'club'),
  )).orderBy(desc(userEntitlements.endsAt)).limit(1)
  const membership = rows[0]
  return membership
    ? { active: true, startsAt: membership.startsAt.toISOString(), endsAt: membership.endsAt?.toISOString() ?? null, source: membership.sourceType as 'order' | 'admin' | 'promo' | 'migration' | 'yandex' }
    : { active: false, startsAt: null, endsAt: null, source: null }
}

export const grantProductEntitlement = async (tx: Transaction, input: { userId: string; order: Order; product: Product; occurredAt: Date }) => {
  const key = input.product.entitlementKey
  if (!key) return null
  const scope = input.product.scope ?? null
  const existing = await tx.select().from(userEntitlements).where(and(
    eq(userEntitlements.sourceType, 'order'),
    eq(userEntitlements.sourceId, input.order.id),
    eq(userEntitlements.entitlementKey, key),
    scope === null ? isNull(userEntitlements.scope) : eq(userEntitlements.scope, scope),
  )).limit(1)
  if (existing[0]) return existing[0]

  let startsAt = input.occurredAt
  let endsAt: Date | null = null
  if (input.product.kind === 'club') {
    const grants = await tx.select().from(userEntitlements).where(and(
      eq(userEntitlements.userId, input.userId),
      eq(userEntitlements.entitlementKey, 'club'),
      eq(userEntitlements.status, 'active'),
    )).for('update')
    const maximumEndsAt = grants.reduce<Date | null>((latest, grant) => {
      if (!grant.endsAt) return latest
      return !latest || grant.endsAt > latest ? grant.endsAt : latest
    }, null)
    if (maximumEndsAt && maximumEndsAt > startsAt) startsAt = maximumEndsAt
    endsAt = new Date(startsAt.getTime() + (input.product.durationDays ?? 0) * 86_400_000)
  }

  const inserted = await tx.insert(userEntitlements).values({
    userId: input.userId,
    entitlementKey: key,
    scope,
    startsAt,
    endsAt,
    sourceType: 'order',
    sourceId: input.order.id,
    metadata: { productId: input.product.id },
  }).onConflictDoNothing().returning()
  if (inserted[0]) return inserted[0]
  return (await tx.select().from(userEntitlements).where(and(
    eq(userEntitlements.sourceType, 'order'),
    eq(userEntitlements.sourceId, input.order.id),
    eq(userEntitlements.entitlementKey, key),
    scope === null ? isNull(userEntitlements.scope) : eq(userEntitlements.scope, scope),
  )).limit(1))[0] ?? null
}

export const revokeOrderEntitlements = async (tx: Transaction, orderId: string, occurredAt = new Date()) => tx.update(userEntitlements).set({
  status: 'revoked', revokedAt: occurredAt, updatedAt: occurredAt,
}).where(and(eq(userEntitlements.sourceType, 'order'), eq(userEntitlements.sourceId, orderId), eq(userEntitlements.status, 'active'))).returning()
