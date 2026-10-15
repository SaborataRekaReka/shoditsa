import { and, eq, inArray } from 'drizzle-orm'
import { connectionsSchedule, contentItemVersions, contentRevisions, type Database } from '@shoditsa/database'
import { ApiError } from '../../lib/errors.js'

export const connectionScheduleHealth = (today: string, playableDates: Iterable<string>) => {
  const dates = new Set([...playableDates].filter((date) => date >= today))
  let nearestGap = today
  let contiguousScheduledDays = 0
  while (dates.has(nearestGap)) {
    contiguousScheduledDays += 1
    const next = new Date(`${today}T12:00:00Z`)
    next.setUTCDate(next.getUTCDate() + contiguousScheduledDays)
    nearestGap = next.toISOString().slice(0, 10)
  }
  return { scheduledAhead: dates.size, contiguousScheduledDays, reserveTarget: 14, reserveWarning: contiguousScheduledDays < 7, nearestGap }
}

/** Call inside the schedule-write transaction after taking its advisory lock. */
export const assertSchedulableVersions = async (db: Pick<Database, 'select'>, itemVersionIds: string[]) => {
  const uniqueIds = [...new Set(itemVersionIds)]
  if (uniqueIds.length !== itemVersionIds.length) {
    throw new ApiError(422, 'CONNECTIONS_SCHEDULE_DUPLICATE_VERSION', 'Один раунд нельзя поставить на несколько дней')
  }
  const versions = await db.select({ id: contentItemVersions.id, itemId: contentItemVersions.itemId, titleRu: contentItemVersions.titleRu })
    .from(contentItemVersions).innerJoin(contentRevisions, eq(contentRevisions.id, contentItemVersions.revisionId))
    .where(and(inArray(contentItemVersions.id, uniqueIds), eq(contentItemVersions.mode, 'connections'),
      eq(contentItemVersions.allowedInGame, true), eq(contentItemVersions.contentStatus, 'ready'), eq(contentRevisions.status, 'active')))
  if (versions.length !== uniqueIds.length) {
    throw new ApiError(422, 'CONNECTIONS_SCHEDULE_VERSION_INVALID', 'Расписание принимает только готовые версии из active revision')
  }
  const itemIds = versions.map((version) => version.itemId)
  if (new Set(itemIds).size !== itemIds.length) {
    throw new ApiError(422, 'CONNECTIONS_SCHEDULE_DUPLICATE_VERSION', 'Разные версии одного раунда нельзя поставить на несколько дней')
  }
  // No date, cancellation or revision filter: a new version does not make an old puzzle new.
  const used = await db.select({ itemId: contentItemVersions.itemId, puzzleDate: connectionsSchedule.puzzleDate })
    .from(connectionsSchedule).innerJoin(contentItemVersions, eq(contentItemVersions.id, connectionsSchedule.itemVersionId))
    .where(inArray(contentItemVersions.itemId, itemIds))
  if (used.length) {
    throw new ApiError(409, 'CONNECTIONS_SCHEDULE_ROUND_ALREADY_USED', 'Раунд уже назначался. Для нового дня нужен новый раунд; будущие дни можно поменять местами.', { rounds: used })
  }
  return versions
}
