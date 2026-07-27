import { and, asc, eq, sql } from 'drizzle-orm'
import { isPlayableModeId, type ApiRole, type ContentPack, type ContentPackDetail } from '@shoditsa/contracts'
import {
  commerceProducts, contentPackEntries, contentPacks, contentItemVersions, gameSessions,
  userPackProgress, type Database,
} from '@shoditsa/database'
import { ApiError } from '../../lib/errors.js'
import { getMoscowDate } from '../../lib/time.js'
import { activeRevision, buildSessionSnapshot } from '../games/service.js'
import { canAccessPack, canViewPack, type PackAccessSource } from './access.js'
import { loadAssignedEconomyRules } from '../economy/rules.js'

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

const publicAccess = (source: PackAccessSource) => source

const packCard = async (
  db: Database | Transaction,
  pack: typeof contentPacks.$inferSelect,
  userId: string | null,
  role: ApiRole,
): Promise<ContentPack> => {
  if (!isPlayableModeId(pack.mode)) throw new ApiError(404, 'PACK_MODE_NOT_PLAYABLE', 'Этот спецпоказ пока недоступен')
  const [counts, progressRows, fullAccess] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(contentPackEntries).where(and(eq(contentPackEntries.packId, pack.id), eq(contentPackEntries.enabled, true))),
    userId ? db.select().from(userPackProgress).where(and(eq(userPackProgress.userId, userId), eq(userPackProgress.packId, pack.id))).limit(1) : Promise.resolve([]),
    canAccessPack(db, userId, pack.id, 1, role),
  ])
  const progress = progressRows[0]
  const source = fullAccess.allowed ? fullAccess.source : 'locked'
  return {
    id: pack.id,
    slug: pack.slug,
    mode: pack.mode,
    title: pack.title,
    subtitle: pack.subtitle,
    description: pack.description,
    coverUrl: pack.coverUrl,
    accessModel: 'club',
    includedInClub: true,
    previewItems: 0,
    totalItems: counts[0]?.count ?? 0,
    productId: null,
    priceMinor: null,
    currency: null,
    access: publicAccess(source),
    owned: false,
    completedItems: userId ? progress?.completedPositions.length ?? 0 : 0,
  }
}

export const listPacks = async (db: Database, userId: string | null, role: ApiRole = 'player') => {
  const rows = await db.select().from(contentPacks).orderBy(asc(contentPacks.createdAt))
  const visibleRows = (await Promise.all(rows.map(async (pack) => (
    await canViewPack(db, userId, pack.id, role, pack.status) ? pack : null
  )))).filter((pack): pack is typeof contentPacks.$inferSelect => Boolean(pack))
  return Promise.all(visibleRows.map((pack) => packCard(db, pack, userId, role)))
}

export const getPack = async (db: Database, packId: string, userId: string | null, role: ApiRole = 'player'): Promise<ContentPackDetail> => {
  const rows = await db.select().from(contentPacks).where(eq(contentPacks.id, packId)).limit(1)
  const pack = rows[0]
  if (!pack || !await canViewPack(db, userId, packId, role, pack.status)) throw new ApiError(404, 'PACK_NOT_FOUND', 'Спецпоказ не найден')
  const [card, entries, progressRows] = await Promise.all([
    packCard(db, pack, userId, role),
    db.select({ position: contentPackEntries.position })
      .from(contentPackEntries).where(and(eq(contentPackEntries.packId, pack.id), eq(contentPackEntries.enabled, true))).orderBy(asc(contentPackEntries.position)),
    userId ? db.select().from(userPackProgress).where(and(eq(userPackProgress.userId, userId), eq(userPackProgress.packId, pack.id))).limit(1) : Promise.resolve([]),
  ])
  const completed = new Set(progressRows[0]?.completedPositions ?? [])
  if (card.access === 'locked') return { ...card, entries: [] }
  return {
    ...card,
    entries: await Promise.all(entries.map(async (entry) => {
      const access = await canAccessPack(db, userId, pack.id, entry.position, role)
      return {
        position: entry.position,
        preview: false,
        completed: completed.has(entry.position),
        accessible: access.allowed,
        // Authoring payload can contain future hints; never expose it through the player catalog.
        prompt: {},
      }
    })),
  }
}

export const getPackProgress = async (db: Database, userId: string, packId: string, role: ApiRole = 'player') => {
  const exists = await db.select({ id: contentPacks.id, status: contentPacks.status }).from(contentPacks).where(eq(contentPacks.id, packId)).limit(1)
  if (!exists[0] || !await canViewPack(db, userId, packId, role, exists[0].status)) throw new ApiError(404, 'PACK_NOT_FOUND', 'Спецпоказ не найден')
  const rows = await db.select().from(userPackProgress).where(and(eq(userPackProgress.userId, userId), eq(userPackProgress.packId, packId))).limit(1)
  const progress = rows[0]
  return {
    packId,
    completedPositions: progress?.completedPositions ?? [],
    lastPosition: progress?.lastPosition ?? null,
    completedAt: progress?.completedAt?.toISOString() ?? null,
  }
}

export const startPackSession = async (
  db: Database,
  userId: string,
  packId: string,
  position: number,
  authSessionId: string | null,
  role: ApiRole = 'player',
  rolloutPercent = 100,
) => {
  const rules = await loadAssignedEconomyRules(db, userId, role, rolloutPercent)
  return db.transaction(async (tx) => {
  const packRows = await tx.select().from(contentPacks).where(eq(contentPacks.id, packId)).limit(1)
  const pack = packRows[0]
  if (!pack || !await canViewPack(tx, userId, packId, role, pack.status)) throw new ApiError(404, 'PACK_NOT_FOUND', 'Спецпоказ не найден')
  const entries = await tx.select().from(contentPackEntries).where(and(
    eq(contentPackEntries.packId, packId), eq(contentPackEntries.position, position), eq(contentPackEntries.enabled, true),
  )).limit(1)
  const entry = entries[0]
  if (!entry) throw new ApiError(422, 'PACK_POSITION_INVALID', 'Такой позиции нет в спецпоказе')
  const existing = await tx.select().from(gameSessions).where(and(
    eq(gameSessions.userId, userId), eq(gameSessions.packId, packId), eq(gameSessions.packPosition, position),
  )).limit(1)
  if (existing[0]) return buildSessionSnapshot(tx, existing[0])

  const access = await canAccessPack(tx, userId, packId, position, role)
  if (!access.allowed) throw new ApiError(403, 'CLUB_REQUIRED', 'Спецпоказы доступны участникам Клуба', {
    feature: 'special',
    packId,
    clubProductIds: ['club_30d', 'club_365d'],
  })

  const revisionId = await activeRevision(tx)
  const versions = await tx.select({ id: contentItemVersions.id }).from(contentItemVersions).where(and(
    eq(contentItemVersions.revisionId, revisionId), eq(contentItemVersions.itemId, entry.answerItemId),
  )).limit(1)
  if (!versions[0]) throw new ApiError(503, 'PACK_CONTENT_NOT_READY', 'Карточка игры недоступна в активной версии каталога')
  const inserted = await tx.insert(gameSessions).values({
    userId,
    authSessionId,
    challengeId: null,
    packId,
    packPosition: position,
    kind: 'pack',
    mode: pack.mode,
    period: 'all',
    difficulty: null,
    puzzleDate: getMoscowDate(),
    revisionId,
    answerItemVersionId: versions[0].id,
    rulesVersion: rules.version,
  }).onConflictDoNothing().returning()
  const session = inserted[0] ?? (await tx.select().from(gameSessions).where(and(
    eq(gameSessions.userId, userId), eq(gameSessions.packId, packId), eq(gameSessions.packPosition, position),
  )).limit(1))[0]
  await tx.insert(userPackProgress).values({ userId, packId, lastPosition: position })
    .onConflictDoUpdate({ target: [userPackProgress.userId, userPackProgress.packId], set: { lastPosition: position, updatedAt: new Date() } })
  return buildSessionSnapshot(tx, session)
  })
}
