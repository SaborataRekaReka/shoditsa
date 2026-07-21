import { and, asc, eq, sql } from 'drizzle-orm'
import { ECONOMY_RULES_VERSION, isPlayableModeId, type ApiRole, type ContentPack, type ContentPackDetail } from '@shoditsa/contracts'
import {
  commerceProducts, contentPackEntries, contentPacks, contentItemVersions, gameSessions,
  userPackProgress, type Database,
} from '@shoditsa/database'
import { ApiError } from '../../lib/errors.js'
import { getMoscowDate } from '../../lib/time.js'
import { activeRevision, buildSessionSnapshot } from '../games/service.js'
import { canAccessPack, hasPermanentPackAccess, type PackAccessSource } from './access.js'
import { isAdminOnlyPack } from './policy.js'

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

const publicAccess = (source: PackAccessSource) => source

const packCard = async (
  db: Database | Transaction,
  pack: typeof contentPacks.$inferSelect,
  userId: string | null,
  role: ApiRole,
): Promise<ContentPack> => {
  if (!isPlayableModeId(pack.mode)) throw new ApiError(404, 'PACK_MODE_NOT_PLAYABLE', 'Этот спецпоказ пока недоступен')
  const [counts, productRows, progressRows, fullAccess, owned] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(contentPackEntries).where(and(eq(contentPackEntries.packId, pack.id), eq(contentPackEntries.enabled, true))),
    pack.productId ? db.select().from(commerceProducts).where(eq(commerceProducts.id, pack.productId)).limit(1) : Promise.resolve([]),
    userId ? db.select().from(userPackProgress).where(and(eq(userPackProgress.userId, userId), eq(userPackProgress.packId, pack.id))).limit(1) : Promise.resolve([]),
    canAccessPack(db, userId, pack.id, Math.max(1, pack.previewItems + 1), role),
    userId ? hasPermanentPackAccess(db, userId, pack.id) : Promise.resolve(false),
  ])
  const progress = progressRows[0]
  const source = fullAccess.allowed ? fullAccess.source : pack.previewItems > 0 ? 'preview' : 'locked'
  return {
    id: pack.id,
    slug: pack.slug,
    mode: pack.mode,
    title: pack.title,
    subtitle: pack.subtitle,
    description: pack.description,
    coverUrl: pack.coverUrl,
    accessModel: pack.accessModel as ContentPack['accessModel'],
    includedInClub: pack.includedInClub,
    previewItems: pack.previewItems,
    totalItems: counts[0]?.count ?? 0,
    productId: pack.productId,
    priceMinor: productRows[0]?.priceMinor ?? null,
    currency: productRows[0]?.currency ?? null,
    access: publicAccess(source),
    owned,
    completedItems: progress?.completedPositions.length ?? 0,
  }
}

export const listPacks = async (db: Database, userId: string | null, role: ApiRole = 'player') => {
  const where = role === 'admin' ? undefined : eq(contentPacks.status, 'published')
  const rows = where
    ? await db.select().from(contentPacks).where(where).orderBy(asc(contentPacks.createdAt))
    : await db.select().from(contentPacks).orderBy(asc(contentPacks.createdAt))
  const visibleRows = role === 'admin' ? rows : rows.filter((pack) => !isAdminOnlyPack(pack.id))
  return Promise.all(visibleRows.map((pack) => packCard(db, pack, userId, role)))
}

export const getPack = async (db: Database, packId: string, userId: string | null, role: ApiRole = 'player'): Promise<ContentPackDetail> => {
  const rows = await db.select().from(contentPacks).where(eq(contentPacks.id, packId)).limit(1)
  const pack = rows[0]
  if (!pack || (isAdminOnlyPack(packId) && role !== 'admin') || (pack.status !== 'published' && role !== 'admin')) throw new ApiError(404, 'PACK_NOT_FOUND', 'Спецпоказ не найден')
  const [card, entries, progressRows] = await Promise.all([
    packCard(db, pack, userId, role),
    db.select({ position: contentPackEntries.position })
      .from(contentPackEntries).where(and(eq(contentPackEntries.packId, pack.id), eq(contentPackEntries.enabled, true))).orderBy(asc(contentPackEntries.position)),
    userId ? db.select().from(userPackProgress).where(and(eq(userPackProgress.userId, userId), eq(userPackProgress.packId, pack.id))).limit(1) : Promise.resolve([]),
  ])
  const completed = new Set(progressRows[0]?.completedPositions ?? [])
  return {
    ...card,
    entries: await Promise.all(entries.map(async (entry) => {
      const access = await canAccessPack(db, userId, pack.id, entry.position, role)
      return {
        position: entry.position,
        preview: entry.position <= pack.previewItems,
        completed: completed.has(entry.position),
        accessible: access.allowed,
        // Authoring payload can contain future hints; never expose it through the player catalog.
        prompt: {},
      }
    })),
  }
}

export const getPackProgress = async (db: Database, userId: string, packId: string, role: ApiRole = 'player') => {
  if (isAdminOnlyPack(packId) && role !== 'admin') throw new ApiError(404, 'PACK_NOT_FOUND', 'Спецпоказ не найден')
  const exists = await db.select({ id: contentPacks.id }).from(contentPacks).where(eq(contentPacks.id, packId)).limit(1)
  if (!exists[0]) throw new ApiError(404, 'PACK_NOT_FOUND', 'Спецпоказ не найден')
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
) => db.transaction(async (tx) => {
  const packRows = await tx.select().from(contentPacks).where(eq(contentPacks.id, packId)).limit(1)
  const pack = packRows[0]
  if (!pack || (isAdminOnlyPack(packId) && role !== 'admin') || (pack.status !== 'published' && role !== 'admin')) throw new ApiError(404, 'PACK_NOT_FOUND', 'Спецпоказ не найден')
  const entries = await tx.select().from(contentPackEntries).where(and(
    eq(contentPackEntries.packId, packId), eq(contentPackEntries.position, position), eq(contentPackEntries.enabled, true),
  )).limit(1)
  const entry = entries[0]
  if (!entry) throw new ApiError(422, 'PACK_POSITION_INVALID', 'Такой позиции нет в спецпоказе')
  const access = await canAccessPack(tx, userId, packId, position, role)
  if (!access.allowed) throw new ApiError(403, 'PACK_ACCESS_REQUIRED', 'Для этой игры нужен клубный или постоянный доступ к спецпоказу', { packId, position })

  const existing = await tx.select().from(gameSessions).where(and(
    eq(gameSessions.userId, userId), eq(gameSessions.packId, packId), eq(gameSessions.packPosition, position),
  )).limit(1)
  if (existing[0]) return buildSessionSnapshot(tx, existing[0])

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
    rulesVersion: ECONOMY_RULES_VERSION,
  }).onConflictDoNothing().returning()
  const session = inserted[0] ?? (await tx.select().from(gameSessions).where(and(
    eq(gameSessions.userId, userId), eq(gameSessions.packId, packId), eq(gameSessions.packPosition, position),
  )).limit(1))[0]
  await tx.insert(userPackProgress).values({ userId, packId, lastPosition: position })
    .onConflictDoUpdate({ target: [userPackProgress.userId, userPackProgress.packId], set: { lastPosition: position, updatedAt: new Date() } })
  return buildSessionSnapshot(tx, session)
})
