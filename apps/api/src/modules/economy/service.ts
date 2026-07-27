import { createHmac, randomInt } from 'node:crypto'
import { and, asc, desc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm'
import type { AppConfig } from '@shoditsa/config'
import {
  FREE_PLAY_MODE_IDS,
  PERIOD_UNLOCKABLE_MODE_IDS,
  economyDanetkiCost,
  economyFreePlayCost,
  type ApiDifficultyKey,
  type ApiRole,
  type PeriodKey,
  type PlayableMode,
} from '@shoditsa/contracts'
import {
  attendanceStats, dailyAttendance, dailyChallenges, danetkiDailyUsage, freePlayUsage, gameSessions, periodEntitlements, playerProfiles,
  promoCodes, promoRedemptions, type Database, userModeStats, walletAccounts, walletLedger,
} from '@shoditsa/database'
import { ApiError } from '../../lib/errors.js'
import { getMoscowDate } from '../../lib/time.js'
import { activeRevision, answerPool, buildSessionSnapshot } from '../games/service.js'
import { getMembershipSummary, hasEntitlement } from '../commerce/entitlements.js'
import { loadAssignedEconomyRules } from './rules.js'
import { settlePositiveWalletCredit, walletCreditMetadata } from './wallet-credit.js'

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
const UNLOCKABLE: PlayableMode[] = [...PERIOD_UNLOCKABLE_MODE_IDS]
const FREE_PLAY: PlayableMode[] = [...FREE_PLAY_MODE_IDS]

const lockedWallet = async (tx: Transaction, userId: string) => {
  await tx.insert(walletAccounts).values({ userId }).onConflictDoNothing()
  return (await tx.select().from(walletAccounts).where(eq(walletAccounts.userId, userId)).for('update').limit(1))[0]
}

const replayFreePlay = async (
  tx: Transaction,
  userId: string,
  session: typeof gameSessions.$inferSelect,
  idempotencyKey: string,
  mode: PlayableMode,
  difficulty: ApiDifficultyKey | null,
) => {
  const requestedDifficulty = mode === 'music' ? difficulty ?? 'medium' : null
  if (session.kind !== 'free_play' || session.mode !== mode || session.difficulty !== requestedDifficulty) {
    throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Этот ключ уже использован для другого запуска')
  }
  const operationKey = `free-play:${userId}:${idempotencyKey}`
  const ledger = await tx.select({ id: walletLedger.id, amount: walletLedger.amount, balanceAfter: walletLedger.balanceAfter })
    .from(walletLedger).where(eq(walletLedger.operationKey, operationKey)).limit(1)
  if (!ledger[0]) {
    const wallet = await lockedWallet(tx, userId)
    return { ...(await buildSessionSnapshot(tx, session)), cost: 0, balanceAfter: wallet.balance, ledgerId: null, accessSource: 'club' as const }
  }
  return {
    ...(await buildSessionSnapshot(tx, session)),
    cost: Math.abs(ledger[0].amount),
    balanceAfter: ledger[0].balanceAfter,
    ledgerId: ledger[0].id,
    accessSource: 'tickets' as const,
  }
}

export const unlockPeriod = async (
  db: Database,
  userId: string,
  role: ApiRole,
  rolloutPercent: number,
  mode: PlayableMode,
  period: PeriodKey,
  idempotencyKey: string,
) => {
  const rules = await loadAssignedEconomyRules(db, userId, role, rolloutPercent)
  return db.transaction(async (tx) => {
  if (!UNLOCKABLE.includes(mode) || period === 'all') throw new ApiError(422, 'PERIOD_NOT_UNLOCKABLE', 'Этот период нельзя разблокировать')
  const operationKey = `period-unlock:${userId}:${idempotencyKey}`
  const replayLedger = (await tx.select({
    balanceAfter: walletLedger.balanceAfter,
    metadata: walletLedger.metadata,
  }).from(walletLedger).where(eq(walletLedger.operationKey, operationKey)).limit(1))[0]
  if (replayLedger) {
    const metadata = replayLedger.metadata && typeof replayLedger.metadata === 'object'
      ? replayLedger.metadata as Record<string, unknown>
      : {}
    if (metadata.mode !== mode || metadata.period !== period) {
      throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Этот ключ уже использован для другого открытия периода')
    }
    const entitlement = (await tx.select().from(periodEntitlements).where(and(
      eq(periodEntitlements.userId, userId),
      eq(periodEntitlements.mode, mode),
      eq(periodEntitlements.period, period),
    )).limit(1))[0]
    return {
      entitlement: entitlement ?? null,
      balanceAfter: replayLedger.balanceAfter,
      alreadyUnlocked: true,
      accessSource: 'tickets' as const,
      rulesVersion: rules.version,
    }
  }
  const existing = await tx.select().from(periodEntitlements).where(and(eq(periodEntitlements.userId, userId), eq(periodEntitlements.mode, mode), eq(periodEntitlements.period, period))).limit(1)
  if (existing[0]) return { entitlement: existing[0], alreadyUnlocked: true, accessSource: 'tickets' as const, rulesVersion: rules.version }
  if (await hasEntitlement(tx, userId, 'club', undefined, new Date())) {
    return { entitlement: null, alreadyUnlocked: false, accessSource: 'club' as const, rulesVersion: rules.version }
  }
  const wallet = await lockedWallet(tx, userId)
  const lockedExisting = await tx.select().from(periodEntitlements).where(and(eq(periodEntitlements.userId, userId), eq(periodEntitlements.mode, mode), eq(periodEntitlements.period, period))).limit(1)
  if (lockedExisting[0]) return { entitlement: lockedExisting[0], alreadyUnlocked: true, accessSource: 'tickets' as const, rulesVersion: rules.version }
  const cost = rules.periodUnlock
  if (wallet.balance < cost) throw new ApiError(409, 'INSUFFICIENT_TICKETS', 'Недостаточно билетов', {
    required: cost,
    balance: wallet.balance,
    shortage: cost - wallet.balance,
    sink: 'period-unlock',
    mode,
    rulesVersion: rules.version,
  })
  const balanceAfter = wallet.balance - cost
  const ledger = await tx.insert(walletLedger).values({
    userId, operationKey, type: 'spend', reason: 'period-unlock', amount: -cost, balanceAfter,
    rulesVersion: rules.version,
    metadata: { mode, period, idempotencyKey, sink: 'period-unlock', rulesVersion: rules.version },
  }).returning({ id: walletLedger.id })
  await tx.update(walletAccounts).set({ balance: balanceAfter, version: sql`${walletAccounts.version} + 1`, updatedAt: new Date() }).where(eq(walletAccounts.userId, userId))
  const entitlement = await tx.insert(periodEntitlements).values({ userId, mode, period, source: 'purchase', ledgerId: ledger[0].id }).returning()
  return { entitlement: entitlement[0], balanceAfter, alreadyUnlocked: false, accessSource: 'tickets' as const, rulesVersion: rules.version }
  })
}

export const startFreePlay = async (
  db: Database,
  userId: string,
  role: ApiRole,
  rolloutPercent: number,
  mode: PlayableMode,
  difficulty: ApiDifficultyKey | null,
  idempotencyKey: string,
  authSessionId: string | null = null,
) => {
  const rules = await loadAssignedEconomyRules(db, userId, role, rolloutPercent)
  return db.transaction(async (tx) => {
  if (!FREE_PLAY.includes(mode)) throw new ApiError(422, 'FREE_PLAY_MODE_NOT_ALLOWED', 'Свободная игра недоступна для этого режима')
  const replay = await tx.select().from(gameSessions).where(and(eq(gameSessions.userId, userId), eq(gameSessions.startIdempotencyKey, idempotencyKey))).limit(1)
  if (replay[0]) return replayFreePlay(tx, userId, replay[0], idempotencyKey, mode, difficulty)
  const unresolvedFinalChoice = await tx.select({ id: gameSessions.id }).from(gameSessions).where(and(
    eq(gameSessions.userId, userId),
    eq(gameSessions.kind, 'free_play'),
    eq(gameSessions.mode, mode),
    eq(gameSessions.status, 'final_choice'),
  )).limit(1)
  if (unresolvedFinalChoice[0]) {
    throw new ApiError(409, 'GAME_ACTIVE_FINAL_CHOICE', 'Сначала завершите финальную сверку', { sessionId: unresolvedFinalChoice[0].id })
  }
  const date = getMoscowDate()
  await tx.insert(freePlayUsage).values({ userId, activityDate: date, launches: 0 }).onConflictDoNothing()
  const usage = (await tx.select().from(freePlayUsage).where(and(eq(freePlayUsage.userId, userId), eq(freePlayUsage.activityDate, date))).for('update').limit(1))[0]
  const lockedReplay = await tx.select().from(gameSessions).where(and(eq(gameSessions.userId, userId), eq(gameSessions.startIdempotencyKey, idempotencyKey))).limit(1)
  if (lockedReplay[0]) return replayFreePlay(tx, userId, lockedReplay[0], idempotencyKey, mode, difficulty)
  const clubActive = await hasEntitlement(tx, userId, 'club', undefined, new Date())
  const cost = clubActive ? 0 : economyFreePlayCost(usage.launches, rules)
  const wallet = await lockedWallet(tx, userId)
  if (wallet.balance < cost) throw new ApiError(409, 'INSUFFICIENT_TICKETS', 'Недостаточно билетов', {
    required: cost,
    balance: wallet.balance,
    shortage: cost - wallet.balance,
    sink: 'free-play',
    mode,
    sessionKind: 'free_play',
    rulesVersion: rules.version,
    hasClub: clubActive,
  })
  const revisionId = await activeRevision(tx)
  const pool = await answerPool(tx, revisionId, mode, 'all', mode === 'music' ? difficulty ?? 'medium' : null)
  if (!pool.items.length) throw new ApiError(503, 'CONTENT_POOL_EMPTY', 'Для режима нет доступных вариантов')
  const answer = pool.items[randomInt(pool.items.length)]
  const balanceAfter = wallet.balance - cost
  const ledger = clubActive ? [] : await tx.insert(walletLedger).values({
    userId, operationKey: `free-play:${userId}:${idempotencyKey}`, type: 'spend', reason: 'free-play', amount: -cost, balanceAfter,
    rulesVersion: rules.version,
    metadata: { mode, launch: usage.launches + 1, sink: 'free-play', sessionKind: 'free_play', hasClub: clubActive, rulesVersion: rules.version },
  }).returning({ id: walletLedger.id })
  const sessions = await tx.insert(gameSessions).values({
    userId, authSessionId, kind: 'free_play', mode, period: 'all', difficulty: mode === 'music' ? difficulty ?? 'medium' : null,
    puzzleDate: date, revisionId, answerItemVersionId: pool.byItemId.get(answer.id)!, rulesVersion: rules.version, startIdempotencyKey: idempotencyKey,
  }).returning()
  if (!clubActive) await tx.update(walletAccounts).set({ balance: balanceAfter, version: sql`${walletAccounts.version} + 1`, updatedAt: new Date() }).where(eq(walletAccounts.userId, userId))
  if (!clubActive) {
    await tx.update(freePlayUsage).set({ launches: usage.launches + 1 }).where(and(eq(freePlayUsage.userId, userId), eq(freePlayUsage.activityDate, date)))
  }
  return { ...(await buildSessionSnapshot(tx, sessions[0])), cost, balanceAfter, ledgerId: ledger[0]?.id ?? null, accessSource: clubActive ? 'club' as const : 'tickets' as const }
  })
}

export const normalizePromoCode = (code: string) => code.trim().toLocaleUpperCase('ru-RU').replace(/Ё/g, 'Е')
export const promoHash = (code: string, pepper: string) => createHmac('sha256', pepper).update(normalizePromoCode(code)).digest('hex')

export const redeemPromo = async (db: Database, config: AppConfig, userId: string, code: string, idempotencyKey: string) => db.transaction(async (tx) => {
  const replay = await tx.select({ id: promoRedemptions.id, ledgerId: promoRedemptions.ledgerId }).from(promoRedemptions).where(and(eq(promoRedemptions.userId, userId), eq(promoRedemptions.idempotencyKey, idempotencyKey))).limit(1)
  if (replay[0]) return { redemption: replay[0], alreadyRedeemed: true }
  const now = new Date()
  const promos = await tx.select().from(promoCodes).where(and(
    eq(promoCodes.codeHash, promoHash(code, config.promoPepper)), eq(promoCodes.enabled, true),
    or(isNull(promoCodes.startsAt), lt(promoCodes.startsAt, now)), or(isNull(promoCodes.endsAt), gt(promoCodes.endsAt, now)),
  )).for('update').limit(1)
  const promo = promos[0]
  if (!promo) throw new ApiError(404, 'PROMO_NOT_FOUND', 'Промокод не найден или недоступен')
  const lockedReplay = await tx.select({ id: promoRedemptions.id, ledgerId: promoRedemptions.ledgerId }).from(promoRedemptions).where(and(eq(promoRedemptions.userId, userId), eq(promoRedemptions.idempotencyKey, idempotencyKey))).limit(1)
  if (lockedReplay[0]) return { redemption: lockedReplay[0], alreadyRedeemed: true }
  const userUses = await tx.select({ id: promoRedemptions.id }).from(promoRedemptions).where(and(eq(promoRedemptions.promoId, promo.id), eq(promoRedemptions.userId, userId)))
  if (userUses.length >= promo.perUserLimit) throw new ApiError(409, 'PROMO_USER_LIMIT', 'Лимит активаций промокода исчерпан')
  if (promo.globalLimit != null) {
    const total = await tx.select({ count: sql<number>`count(*)::int` }).from(promoRedemptions).where(eq(promoRedemptions.promoId, promo.id))
    if (total[0].count >= promo.globalLimit) throw new ApiError(409, 'PROMO_GLOBAL_LIMIT', 'Промокод закончился')
  }
  if (promo.rewardType !== 'tickets') throw new ApiError(422, 'PROMO_REWARD_UNSUPPORTED', 'Тип награды пока не поддерживается')
  const amount = Math.max(0, Math.trunc(Number(promo.rewardValue)))
  const wallet = await lockedWallet(tx, userId)
  const credit = settlePositiveWalletCredit(wallet, amount)
  const ledger = await tx.insert(walletLedger).values({
    userId,
    operationKey: `promo:${promo.id}:${userId}:${userUses.length + 1}`,
    type: 'earn',
    reason: 'promo',
    amount: credit.spendableAmount,
    balanceAfter: credit.balanceAfter,
    rulesVersion: 4,
    metadata: walletCreditMetadata(credit, { promoId: promo.id, source: 'promo', rulesVersion: 4 }),
  }).returning({ id: walletLedger.id })
  await tx.update(walletAccounts).set({
    balance: credit.balanceAfter,
    lifetimeEarned: wallet.lifetimeEarned + amount,
    purchaseDebt: credit.purchaseDebtAfter,
    version: sql`${walletAccounts.version} + 1`,
    updatedAt: now,
  }).where(eq(walletAccounts.userId, userId))
  const redemption = await tx.insert(promoRedemptions).values({ promoId: promo.id, userId, ledgerId: ledger[0].id, redemptionNumber: userUses.length + 1, idempotencyKey }).returning()
  return { redemption: redemption[0], reward: { type: 'tickets', amount, balanceAfter: credit.balanceAfter }, alreadyRedeemed: false }
})

export const dashboard = async (db: Database, userId: string, role: ApiRole = 'player', rolloutPercent = 100) => {
  const activityDate = getMoscowDate()
  const [wallet, attendance, today, stats, entitlements, activeSessions, freePlay, danetkiUsage, membership, rules] = await Promise.all([
    db.select().from(walletAccounts).where(eq(walletAccounts.userId, userId)).limit(1),
    db.select().from(attendanceStats).where(eq(attendanceStats.userId, userId)).limit(1),
    db.select().from(dailyAttendance).where(and(eq(dailyAttendance.userId, userId), eq(dailyAttendance.activityDate, activityDate))).limit(1),
    db.select().from(userModeStats).where(eq(userModeStats.userId, userId)),
    db.select().from(periodEntitlements).where(eq(periodEntitlements.userId, userId)),
    db.select({
      id: gameSessions.id,
      mode: gameSessions.mode,
      kind: gameSessions.kind,
      status: gameSessions.status,
      variantKey: sql<string | null>`coalesce(${gameSessions.packId}, ${dailyChallenges.variantKey})`,
      period: gameSessions.period,
      difficulty: gameSessions.difficulty,
      puzzleDate: gameSessions.puzzleDate,
      attemptsCount: gameSessions.attemptsCount,
      updatedAt: gameSessions.updatedAt,
    })
      .from(gameSessions)
      .leftJoin(dailyChallenges, eq(dailyChallenges.id, gameSessions.challengeId))
      .where(and(eq(gameSessions.userId, userId), sql`${gameSessions.status} in ('playing','final_choice')`))
      .orderBy(desc(gameSessions.updatedAt)),
    db.select({ launches: freePlayUsage.launches }).from(freePlayUsage)
      .where(and(eq(freePlayUsage.userId, userId), eq(freePlayUsage.activityDate, activityDate))).limit(1),
    db.select().from(danetkiDailyUsage)
      .where(and(eq(danetkiDailyUsage.userId, userId), eq(danetkiDailyUsage.activityDate, activityDate))).limit(1),
    getMembershipSummary(db, userId),
    loadAssignedEconomyRules(db, userId, role, rolloutPercent),
  ])
  const staticLaunches = freePlay[0]?.launches ?? 0
  const danetki = danetkiUsage[0] ?? { dailyRooms: 0, extraRooms: 0, clubRooms: 0, paidRooms: 0 }
  const balance = wallet[0]?.balance ?? 0
  const clubRoomsRemaining = membership.active
    ? Math.max(0, rules.danetki.clubExtraRooms - danetki.clubRooms)
    : 0
  return {
    wallet: wallet[0] ?? { balance: 0, lifetimeEarned: 0 },
    attendance: attendance[0] ?? null,
    today: today[0] ?? null,
    stats,
    entitlements,
    activeSessions,
    freePlayLaunchesToday: staticLaunches,
    freePlayNextCost: membership.active ? 0 : economyFreePlayCost(staticLaunches, rules),
    economyRules: rules,
    economyQuotes: {
      freePlay: {
        sink: 'free-play',
        allowed: membership.active || balance >= economyFreePlayCost(staticLaunches, rules),
        accessSource: membership.active ? 'club' : 'tickets',
        cost: membership.active ? 0 : economyFreePlayCost(staticLaunches, rules),
        balance,
        shortage: membership.active ? 0 : Math.max(0, economyFreePlayCost(staticLaunches, rules) - balance),
        paidUsesToday: staticLaunches,
        rulesVersion: rules.version,
      },
      periodUnlock: {
        sink: 'period-unlock',
        allowed: membership.active || balance >= rules.periodUnlock,
        accessSource: membership.active ? 'club' : 'tickets',
        cost: membership.active ? 0 : rules.periodUnlock,
        balance,
        shortage: membership.active ? 0 : Math.max(0, rules.periodUnlock - balance),
        paidUsesToday: 0,
        rulesVersion: rules.version,
      },
      danetkiSolo: {
        sink: 'danetki-room',
        allowed: clubRoomsRemaining > 0 || balance >= economyDanetkiCost('solo', danetki.paidRooms, rules),
        accessSource: clubRoomsRemaining > 0 ? 'club' : 'tickets',
        cost: clubRoomsRemaining > 0 ? 0 : economyDanetkiCost('solo', danetki.paidRooms, rules),
        balance,
        shortage: clubRoomsRemaining > 0 ? 0 : Math.max(0, economyDanetkiCost('solo', danetki.paidRooms, rules) - balance),
        paidUsesToday: danetki.paidRooms,
        rulesVersion: rules.version,
      },
      danetkiGroup: {
        sink: 'danetki-room',
        allowed: clubRoomsRemaining > 0 || balance >= economyDanetkiCost('group', danetki.paidRooms, rules),
        accessSource: clubRoomsRemaining > 0 ? 'club' : 'tickets',
        cost: clubRoomsRemaining > 0 ? 0 : economyDanetkiCost('group', danetki.paidRooms, rules),
        balance,
        shortage: clubRoomsRemaining > 0 ? 0 : Math.max(0, economyDanetkiCost('group', danetki.paidRooms, rules) - balance),
        paidUsesToday: danetki.paidRooms,
        rulesVersion: rules.version,
      },
    },
    danetkiAccess: {
      dailyRoomsStarted: danetki.dailyRooms,
      extraRoomsStarted: danetki.extraRooms,
      clubRoomsRemaining,
      nextSoloCost: clubRoomsRemaining > 0 ? 0 : economyDanetkiCost('solo', danetki.paidRooms, rules),
      nextGroupCost: clubRoomsRemaining > 0 ? 0 : economyDanetkiCost('group', danetki.paidRooms, rules),
    },
    membership: { active: membership.active, endsAt: membership.endsAt },
  }
}

export const ledgerPage = async (db: Database, userId: string, cursor?: string, limit = 30) => {
  const where = cursor ? and(eq(walletLedger.userId, userId), lt(walletLedger.createdAt, new Date(cursor))) : eq(walletLedger.userId, userId)
  const rows = await db.select().from(walletLedger).where(where).orderBy(desc(walletLedger.createdAt)).limit(Math.min(100, limit + 1))
  const hasMore = rows.length > limit
  const items = rows.slice(0, limit)
  return { items, nextCursor: hasMore ? items.at(-1)!.createdAt.toISOString() : null }
}
