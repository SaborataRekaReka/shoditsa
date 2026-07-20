import { and, desc, eq, gte, inArray, isNull, lte } from 'drizzle-orm'
import type { AppConfig } from '@shoditsa/config'
import type { ArchiveCalendarQuery } from '@shoditsa/contracts'
import { dailyChallenges, gameSessions, type Database } from '@shoditsa/database'
import { ApiError } from '../../lib/errors.js'
import { getMoscowDate } from '../../lib/time.js'
import { hasEntitlement } from '../commerce/entitlements.js'
import { getFreeArchiveStart } from './access.js'

const datesBetween = (from: string, to: string) => {
  const items: string[] = []
  const cursor = new Date(`${from}T12:00:00Z`)
  const last = new Date(`${to}T12:00:00Z`)
  while (cursor <= last && items.length <= 62) {
    items.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return items
}

export const archiveCalendar = async (db: Database, config: AppConfig, userId: string, query: ArchiveCalendarQuery, now = new Date()) => {
  if (query.from > query.to) throw new ApiError(422, 'ARCHIVE_RANGE_INVALID', 'Начало периода должно быть раньше окончания')
  const dates = datesBetween(query.from, query.to)
  if (dates.length > 62) throw new ApiError(422, 'ARCHIVE_RANGE_TOO_LARGE', 'За один раз можно загрузить не более 62 дней')
  const today = getMoscowDate(now)
  if (query.to > today) throw new ApiError(422, 'ARCHIVE_DATE_IN_FUTURE', 'Архивная дата не может быть в будущем')
  const period = query.period ?? 'all'
  const difficulty = query.mode === 'music' ? query.difficulty ?? 'medium' : null
  const rows = await db.select({
    id: gameSessions.id,
    mode: gameSessions.mode,
    variantKey: dailyChallenges.variantKey,
    period: gameSessions.period,
    difficulty: gameSessions.difficulty,
    puzzleDate: gameSessions.puzzleDate,
    status: gameSessions.status,
    attemptsCount: gameSessions.attemptsCount,
    completedAt: gameSessions.completedAt,
  }).from(gameSessions).leftJoin(dailyChallenges, eq(dailyChallenges.id, gameSessions.challengeId)).where(and(
    eq(gameSessions.userId, userId),
    inArray(gameSessions.kind, ['daily', 'archive']),
    eq(gameSessions.mode, query.mode),
    eq(gameSessions.period, period),
    difficulty === null ? isNull(gameSessions.difficulty) : eq(gameSessions.difficulty, difficulty),
    gte(gameSessions.puzzleDate, query.from),
    lte(gameSessions.puzzleDate, query.to),
  )).orderBy(desc(gameSessions.updatedAt))
  const latestByDate = new Map<string, typeof rows[number]>()
  for (const row of rows) if (!latestByDate.has(row.puzzleDate)) latestByDate.set(row.puzzleDate, row)
  const clubActive = await hasEntitlement(db, userId, 'club', undefined, now)
  const freeFrom = getFreeArchiveStart(today, config.commerce.freeArchiveDays)
  return {
    access: { archiveFirstDate: config.commerce.archiveFirstDate, freeFrom, clubActive },
    items: dates.map((date) => ({
      date,
      access: date < config.commerce.archiveFirstDate ? 'locked' as const : date >= freeFrom ? 'free' as const : clubActive ? 'club' as const : 'locked' as const,
      session: latestByDate.get(date) ?? null,
    })),
  }
}
