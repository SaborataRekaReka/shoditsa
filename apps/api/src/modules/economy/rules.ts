import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import {
  ECONOMY_RULE_SET_V4,
  isEconomyRuleSet,
  type ApiRole,
  type EconomyRuleSet,
} from '@shoditsa/contracts'
import { economyRuleAssignments, economyRuleSets, type Database } from '@shoditsa/database'
import { ApiError } from '../../lib/errors.js'

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type ReadDatabase = Pick<Database, 'select'> | Pick<Transaction, 'select'>

const unavailable = (details: Record<string, unknown>) => new ApiError(
  503,
  'ECONOMY_RULES_UNAVAILABLE',
  'Правила экономики временно недоступны',
  details,
)

const checkedRules = (row: typeof economyRuleSets.$inferSelect | undefined, expectedVersion?: number): EconomyRuleSet => {
  if (!row) throw unavailable({ reason: 'missing', ...(expectedVersion == null ? {} : { rulesVersion: expectedVersion }) })
  if (!isEconomyRuleSet(row.rules) || row.rules.version !== row.version) {
    throw unavailable({ reason: 'invalid', rulesVersion: row.version })
  }
  return row.rules
}

export const loadActiveEconomyRules = async (db: ReadDatabase): Promise<EconomyRuleSet> => {
  const rows = await db.select().from(economyRuleSets).where(eq(economyRuleSets.active, true)).limit(2)
  if (rows.length !== 1) throw unavailable({ reason: rows.length ? 'multiple-active' : 'missing-active' })
  return checkedRules(rows[0])
}

export const loadEconomyRulesByVersion = async (db: ReadDatabase, version: number): Promise<EconomyRuleSet> => {
  const rows = await db.select().from(economyRuleSets).where(eq(economyRuleSets.version, version)).limit(1)
  return checkedRules(rows[0], version)
}

export const fallbackEconomyRules = (value: unknown): EconomyRuleSet => (
  isEconomyRuleSet(value) ? value : ECONOMY_RULE_SET_V4
)

export const stableEconomyBucket = (userId: string) => (
  createHash('sha256').update(userId).digest().readUInt32BE(0) % 100
)

export const loadAssignedEconomyRules = async (
  db: Database,
  userId: string,
  role: ApiRole,
  rolloutPercent = 100,
): Promise<EconomyRuleSet> => db.transaction(async (tx) => {
  const existing = await tx.select().from(economyRuleAssignments)
    .where(eq(economyRuleAssignments.userId, userId))
    .for('update')
    .limit(1)
  if (existing[0]) return loadEconomyRulesByVersion(tx, existing[0].rulesVersion)

  const active = await loadActiveEconomyRules(tx)
  const percentage = Math.max(0, Math.min(100, Math.trunc(rolloutPercent)))
  const assigned = role === 'admin'
    ? { rulesVersion: active.version, cohort: 'admin' as const }
    : percentage >= 100
      ? { rulesVersion: active.version, cohort: 'rollout' as const }
      : stableEconomyBucket(userId) < percentage
        ? { rulesVersion: active.version, cohort: 'canary' as const }
        : { rulesVersion: 3, cohort: 'control' as const }

  await tx.insert(economyRuleAssignments).values({ userId, ...assigned }).onConflictDoNothing()
  const persisted = await tx.select().from(economyRuleAssignments)
    .where(eq(economyRuleAssignments.userId, userId))
    .limit(1)
  if (!persisted[0]) throw unavailable({ reason: 'assignment-failed', userId })
  return loadEconomyRulesByVersion(tx, persisted[0].rulesVersion)
})
