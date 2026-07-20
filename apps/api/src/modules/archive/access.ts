import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { AppConfig } from '@shoditsa/config'
import type { ApiDifficultyKey, ApiPeriodKey, ContentMode } from '@shoditsa/contracts'
import { gameSessions, type Database } from '@shoditsa/database'
import { getMoscowDate } from '../../lib/time.js'
import { hasEntitlement } from '../commerce/entitlements.js'

const addDays = (date: string, days: number) => {
  const value = new Date(`${date}T12:00:00+03:00`)
  value.setUTCDate(value.getUTCDate() + days)
  return getMoscowDate(value)
}

export const getFreeArchiveStart = (today: string, freeArchiveDays: number) => addDays(today, -(freeArchiveDays - 1))

export const canStartArchiveSession = async (
  db: Database,
  userId: string,
  puzzleDate: string,
  config: AppConfig,
  now = new Date(),
  selection?: { mode: ContentMode; period: ApiPeriodKey; difficulty: ApiDifficultyKey | null },
) => {
  const today = getMoscowDate(now)
  const freeFrom = getFreeArchiveStart(today, config.commerce.freeArchiveDays)
  if (selection) {
    const existing = await db.select({ id: gameSessions.id }).from(gameSessions).where(and(
      eq(gameSessions.userId, userId),
      inArray(gameSessions.kind, ['daily', 'archive']),
      eq(gameSessions.puzzleDate, puzzleDate),
      eq(gameSessions.mode, selection.mode),
      eq(gameSessions.period, selection.period),
      selection.difficulty === null ? isNull(gameSessions.difficulty) : eq(gameSessions.difficulty, selection.difficulty),
    )).limit(1)
    if (existing[0]) return { allowed: true, source: 'existing-session' as const, freeFrom }
  }
  if (puzzleDate < config.commerce.archiveFirstDate) return { allowed: false, source: 'before-launch' as const, freeFrom }
  if (puzzleDate >= freeFrom && puzzleDate <= today) return { allowed: true, source: 'free-window' as const, freeFrom }
  if (await hasEntitlement(db, userId, 'club', undefined, now)) return { allowed: true, source: 'club' as const, freeFrom }
  return { allowed: false, source: 'locked' as const, freeFrom }
}
