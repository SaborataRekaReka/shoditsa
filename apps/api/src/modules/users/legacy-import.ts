import { createHash, randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import type { AppConfig } from '@shoditsa/config'
import type { PeriodKey, TitleItem, TitleMode } from '@shoditsa/contracts'
import {
  contentItemVersions, dailyChallenges, gameAttempts, gameSessions, legacyImports, periodEntitlements,
  playerProfiles, type Database, walletAccounts, walletLedger,
} from '@shoditsa/database'
import { compareTitles } from '@shoditsa/game-core'
import { ApiError } from '../../lib/errors.js'

type LegacyGame = { mode?: unknown; period?: unknown; date?: unknown; difficulty?: unknown; attempts?: unknown; attemptTitleIds?: unknown }
type LegacyPayload = { deviceId?: unknown; schemaVersion?: unknown; games?: unknown; wallet?: unknown; periodUnlocks?: unknown }
const modes = new Set<TitleMode>(['movie', 'series', 'anime', 'game', 'music', 'diagnosis'])
const periods = new Set<PeriodKey>(['all', 'from_1960', 'from_1980', 'from_1990', 'from_2000', 'from_2010', 'from_2020'])

export const importLegacy = async (db: Database, config: AppConfig, userId: string, payload: LegacyPayload) => {
  if (!config.legacyImportEnabled) throw new ApiError(410, 'LEGACY_IMPORT_DISABLED', 'Перенос локального прогресса завершён')
  const serialized = JSON.stringify(payload)
  if (Buffer.byteLength(serialized) > 1_000_000) throw new ApiError(413, 'LEGACY_IMPORT_TOO_LARGE', 'Данные переноса превышают 1 МБ')
  const deviceId = typeof payload.deviceId === 'string' && /^[0-9a-f-]{36}$/i.test(payload.deviceId) ? payload.deviceId : null
  const schemaVersion = Number.isInteger(payload.schemaVersion) ? Number(payload.schemaVersion) : 1
  if (!deviceId) throw new ApiError(422, 'LEGACY_DEVICE_ID_INVALID', 'Нужен корректный deviceId')
  const checksum = createHash('sha256').update(serialized).digest('hex')

  return db.transaction(async (tx) => {
    const existing = await tx.select().from(legacyImports).where(and(eq(legacyImports.userId, userId), eq(legacyImports.deviceId, deviceId), eq(legacyImports.schemaVersion, schemaVersion))).limit(1)
    if (existing[0]) return { ...existing[0], alreadyImported: true }
    const warnings: string[] = []
    let importedGames = 0
    const games = Array.isArray(payload.games) ? payload.games.slice(0, 500) as LegacyGame[] : []
    for (const [index, raw] of games.entries()) {
      const mode = typeof raw.mode === 'string' && modes.has(raw.mode as TitleMode) ? raw.mode as TitleMode : null
      const period = typeof raw.period === 'string' && periods.has(raw.period as PeriodKey) ? raw.period as PeriodKey : 'all'
      const date = typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : null
      if (!mode || !date) { warnings.push(`game[${index}]: invalid mode/date`); continue }
      const challenges = await tx.select().from(dailyChallenges).where(and(eq(dailyChallenges.puzzleDate, date), eq(dailyChallenges.mode, mode), eq(dailyChallenges.period, period))).limit(1)
      const challenge = challenges[0]
      if (!challenge) { warnings.push(`game[${index}]: challenge unavailable`); continue }
      const inserted = await tx.insert(gameSessions).values({
        userId, challengeId: challenge.id, kind: 'archive', mode, period, difficulty: challenge.difficulty,
        puzzleDate: date, revisionId: challenge.revisionId, answerItemVersionId: challenge.answerItemVersionId, rulesVersion: 1,
      }).onConflictDoNothing().returning()
      const session = inserted[0]
      if (!session) continue
      const answerRows = await tx.select({ payload: contentItemVersions.payload }).from(contentItemVersions).where(eq(contentItemVersions.id, challenge.answerItemVersionId)).limit(1)
      const answer = answerRows[0].payload as TitleItem
      const rawIds = Array.isArray(raw.attemptTitleIds) ? raw.attemptTitleIds : Array.isArray(raw.attempts) ? raw.attempts.map((entry) => (entry as { titleId?: unknown })?.titleId) : []
      const ids = [...new Set(rawIds.filter((value): value is string => typeof value === 'string' && value.length > 0))].slice(0, 10)
      let status: 'playing' | 'won' | 'lost' = 'playing'
      let position = 0
      for (const itemId of ids) {
        const guesses = await tx.select({ id: contentItemVersions.id, payload: contentItemVersions.payload }).from(contentItemVersions).where(and(
          eq(contentItemVersions.revisionId, challenge.revisionId), eq(contentItemVersions.itemId, itemId), eq(contentItemVersions.mode, mode),
        )).limit(1)
        if (!guesses[0]) { warnings.push(`game[${index}]: unknown guess ${itemId}`); continue }
        position += 1
        const guess = guesses[0].payload as TitleItem
        const correct = guess.id === answer.id
        status = correct ? 'won' : position >= 10 ? 'lost' : 'playing'
        await tx.insert(gameAttempts).values({
          sessionId: session.id, position, guessedItemVersionId: guesses[0].id, isCorrect: correct,
          hintsSnapshot: compareTitles(guess, answer), responseSnapshot: { imported: true, position, status }, idempotencyKey: randomUUID(),
        })
        if (correct) break
      }
      await tx.update(gameSessions).set({ attemptsCount: position, status, completedAt: status === 'playing' ? null : new Date(), updatedAt: new Date() }).where(eq(gameSessions.id, session.id))
      importedGames += 1
    }

    const requestedWallet = Math.max(0, Math.trunc(Number((payload.wallet as { tickets?: unknown } | null)?.tickets ?? payload.wallet ?? 0) || 0))
    const importedWallet = Math.min(config.legacyImportTicketCap, requestedWallet)
    await tx.insert(walletAccounts).values({ userId }).onConflictDoNothing()
    const wallets = await tx.select().from(walletAccounts).where(eq(walletAccounts.userId, userId)).for('update').limit(1)
    if (importedWallet > 0) {
      const balanceAfter = wallets[0].balance + importedWallet
      await tx.insert(walletLedger).values({
        userId, operationKey: `legacy-import:${userId}:${deviceId}:${schemaVersion}`, type: 'migration', reason: 'legacy-import', amount: importedWallet,
        balanceAfter, metadata: { payloadChecksum: checksum, requestedWallet, cap: config.legacyImportTicketCap },
      })
      await tx.update(walletAccounts).set({ balance: balanceAfter, lifetimeEarned: Math.max(wallets[0].lifetimeEarned, balanceAfter), version: sql`${walletAccounts.version} + 1`, updatedAt: new Date() }).where(eq(walletAccounts.userId, userId))
    }
    if (payload.periodUnlocks && typeof payload.periodUnlocks === 'object') {
      for (const [mode, values] of Object.entries(payload.periodUnlocks as Record<string, unknown>)) {
        if (!modes.has(mode as TitleMode) || !Array.isArray(values)) continue
        for (const period of values) if (typeof period === 'string' && periods.has(period as PeriodKey) && period !== 'all') {
          await tx.insert(periodEntitlements).values({ userId, mode: mode as TitleMode, period: period as PeriodKey, source: 'legacy-import' }).onConflictDoNothing()
        }
      }
    }
    const result = await tx.insert(legacyImports).values({ userId, deviceId, schemaVersion, payloadChecksum: checksum, importedGames, importedWallet, warnings }).returning()
    await tx.update(playerProfiles).set({ legacyImportedAt: new Date(), updatedAt: new Date() }).where(eq(playerProfiles.userId, userId))
    return { ...result[0], alreadyImported: false }
  })
}
