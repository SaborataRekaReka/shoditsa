import { and, eq, isNull, sql } from 'drizzle-orm'
import {
  ECONOMY_RULES_VERSION,
  FULL_HOUSE_MODE_IDS,
  type ContentMode,
  type GameCompletionType,
} from '@shoditsa/contracts'
import {
  attendanceStats, connectionsSchedule, dailyAttendance, type Database, userModeStats, walletAccounts, walletLedger,
} from '@shoditsa/database'
import { getMoscowDate, previousDate } from '../../lib/time.js'
import { calculateCompletionReward } from '@shoditsa/game-core'
import { loadEconomyRulesByVersion } from '../economy/rules.js'
import { settlePositiveWalletCredit, walletCreditMetadata } from '../economy/wallet-credit.js'

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
const ALL_MODES: ContentMode[] = [...FULL_HOUSE_MODE_IDS]

export const completeGame = async (tx: Transaction, input: {
  sessionId: string; userId: string; kind: string; mode: ContentMode; difficulty: string | null;
  puzzleDate: string; won: boolean; attemptsCount: number; distributionIndex?: number; rulesVersion?: number; completionType?: GameCompletionType | null; special?: boolean;
}) => {
  const completionType = input.completionType ?? (input.won ? 'direct_win' : 'attempts_exhausted')
  const statsEligible = !input.special && (input.kind === 'daily' || input.kind === 'archive')
  if (statsEligible) {
    const difficulty = input.mode === 'music' ? input.difficulty ?? '-' : '-'
    await tx.insert(userModeStats).values({ userId: input.userId, mode: input.mode, difficultyKey: difficulty }).onConflictDoNothing()
    const current = await tx.select().from(userModeStats).where(and(
      eq(userModeStats.userId, input.userId), eq(userModeStats.mode, input.mode), eq(userModeStats.difficultyKey, difficulty),
    )).for('update').limit(1)
    const row = current[0]
    const distribution = [...row.distribution]
    if (completionType === 'direct_win') {
      distribution[Math.max(0, Math.min(9, input.distributionIndex ?? input.attemptsCount - 1))] += 1
    }
    await tx.update(userModeStats).set({
      played: row.played + 1, won: row.won + (input.won ? 1 : 0),
      currentStreak: input.won ? row.currentStreak + 1 : 0,
      bestStreak: Math.max(row.bestStreak, input.won ? row.currentStreak + 1 : row.bestStreak),
      finalChoiceWins: row.finalChoiceWins + (completionType === 'final_choice_win' ? 1 : 0),
      distribution, updatedAt: new Date(),
    }).where(and(eq(userModeStats.userId, input.userId), eq(userModeStats.mode, input.mode), eq(userModeStats.difficultyKey, difficulty)))
  }

  if (input.special || input.kind !== 'daily' || input.puzzleDate !== getMoscowDate() || completionType === 'expired') return null
  const sessionRulesVersion = input.rulesVersion ?? ECONOMY_RULES_VERSION
  const rules = await loadEconomyRulesByVersion(tx, sessionRulesVersion)
  const now = new Date()
  await tx.insert(attendanceStats).values({ userId: input.userId }).onConflictDoNothing()
  const streakRows = await tx.select().from(attendanceStats).where(eq(attendanceStats.userId, input.userId)).for('update').limit(1)
  const streak = streakRows[0]
  await tx.insert(dailyAttendance).values({
    userId: input.userId, activityDate: input.puzzleDate, firstCompletedAt: now,
    completedModes: [], wonModes: [], fullHouse: false,
  }).onConflictDoNothing()
  const attendanceRows = await tx.select().from(dailyAttendance).where(and(
    eq(dailyAttendance.userId, input.userId), eq(dailyAttendance.activityDate, input.puzzleDate),
  )).for('update').limit(1)
  const attendance = attendanceRows[0]
  const connectionsAvailable = Boolean((await tx.select({ puzzleDate: connectionsSchedule.puzzleDate })
    .from(connectionsSchedule)
    .where(and(eq(connectionsSchedule.puzzleDate, input.puzzleDate), isNull(connectionsSchedule.cancelledAt)))
    .limit(1))[0])
  const routeModes = connectionsAvailable ? ALL_MODES : ALL_MODES.filter((mode) => mode !== 'connections')
  const firstCompletion = attendance.completedModes.length === 0
  const previousRouteCount = routeModes.filter((mode) => attendance.completedModes.includes(mode)).length
  const completedModes = [...new Set([...attendance.completedModes, input.mode])]
  const routeCount = routeModes.filter((mode) => completedModes.includes(mode)).length
  const wonModes = input.won ? [...new Set([...attendance.wonModes, input.mode])] : attendance.wonModes
  const fullHouse = routeModes.every((mode) => completedModes.includes(mode))
  const firstRoute3 = previousRouteCount < 3 && routeCount >= 3
  const firstFullHouse = fullHouse && !attendance.fullHouse

  let currentDailyStreak = streak.currentDailyStreak
  let bestDailyStreak = streak.bestDailyStreak
  let gracePasses = streak.gracePasses
  let totalActiveDays = streak.totalActiveDays
  if (firstCompletion) {
    const yesterday = previousDate(input.puzzleDate)
    const twoDaysAgo = previousDate(yesterday)
    if (!streak.lastCompletedDate) currentDailyStreak = 1
    else if (streak.lastCompletedDate === yesterday) currentDailyStreak += 1
    else if (streak.lastCompletedDate === twoDaysAgo && gracePasses > 0) { currentDailyStreak += 1; gracePasses -= 1 }
    else if (streak.lastCompletedDate !== input.puzzleDate) currentDailyStreak = 1
    totalActiveDays += 1
    bestDailyStreak = Math.max(bestDailyStreak, currentDailyStreak)
    if (currentDailyStreak > 0 && currentDailyStreak % 7 === 0) gracePasses = Math.min(2, gracePasses + 1)
  }
  await tx.update(dailyAttendance).set({ completedModes, wonModes, fullHouse }).where(and(
    eq(dailyAttendance.userId, input.userId), eq(dailyAttendance.activityDate, input.puzzleDate),
  ))
  await tx.update(attendanceStats).set({
    currentDailyStreak, bestDailyStreak, gracePasses, totalActiveDays,
    fullHouseDays: streak.fullHouseDays + (firstFullHouse ? 1 : 0),
    lastCompletedDate: firstCompletion ? input.puzzleDate : streak.lastCompletedDate, updatedAt: now,
  }).where(eq(attendanceStats.userId, input.userId))

  const { components, total, rulesVersion } = calculateCompletionReward({
    won: input.won,
    attemptsCount: input.attemptsCount,
    completionType,
    firstCompletion,
    firstRoute3,
    firstFullHouse,
    dailyStreak: currentDailyStreak,
    rules,
  })
  const resolvedRulesVersion = input.rulesVersion ?? rulesVersion ?? ECONOMY_RULES_VERSION
  const streakMilestone = components.streakMilestone
  const completionTotal = total - streakMilestone

  await tx.insert(walletAccounts).values({ userId: input.userId }).onConflictDoNothing()
  const wallets = await tx.select().from(walletAccounts).where(eq(walletAccounts.userId, input.userId)).for('update').limit(1)
  const wallet = wallets[0]
  const completionCredit = settlePositiveWalletCredit(wallet, completionTotal)
  const milestoneCredit = settlePositiveWalletCredit({
    balance: completionCredit.balanceAfter,
    purchaseDebt: completionCredit.purchaseDebtAfter,
  }, streakMilestone)
  const operationKey = `game-completion:${input.sessionId}`
  const ledger = await tx.insert(walletLedger).values({
    userId: input.userId,
    operationKey,
    type: 'earn',
    reason: 'game-completion',
    amount: completionCredit.spendableAmount,
    balanceAfter: completionCredit.balanceAfter,
    rulesVersion: resolvedRulesVersion,
    metadata: walletCreditMetadata(completionCredit, {
      sessionId: input.sessionId,
      components: { ...components, streakMilestone: 0 },
      source: 'daily-game',
      mode: input.mode,
      sessionKind: input.kind,
      dailyCompletedCount: routeCount,
      streak: currentDailyStreak,
      rulesVersion: resolvedRulesVersion,
    }),
  }).onConflictDoNothing().returning({ id: walletLedger.id })
  if (!ledger[0]) {
    const existing = await tx.select({ id: walletLedger.id, amount: walletLedger.amount, balanceAfter: walletLedger.balanceAfter, metadata: walletLedger.metadata })
      .from(walletLedger).where(eq(walletLedger.operationKey, operationKey)).limit(1)
    const milestone = await tx.select({ amount: walletLedger.amount, balanceAfter: walletLedger.balanceAfter, metadata: walletLedger.metadata })
      .from(walletLedger).where(eq(walletLedger.operationKey, `streak-milestone:${input.userId}:${input.puzzleDate}:${currentDailyStreak}`)).limit(1)
    const gross = (row: { amount: number; metadata: unknown }) => {
      const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata as Record<string, unknown> : {}
      return Math.max(0, Number(metadata.grossAmount) || row.amount)
    }
    return {
      ledgerId: existing[0].id,
      rulesVersion: resolvedRulesVersion,
      total: gross(existing[0]) + (milestone[0] ? gross(milestone[0]) : 0),
      components,
      balanceAfter: milestone[0]?.balanceAfter ?? existing[0].balanceAfter,
      alreadyClaimed: true,
    }
  }
  const balanceAfter = milestoneCredit.balanceAfter
  if (streakMilestone > 0) {
    await tx.insert(walletLedger).values({
      userId: input.userId,
      operationKey: `streak-milestone:${input.userId}:${input.puzzleDate}:${currentDailyStreak}`,
      type: 'earn',
      reason: 'streak-milestone',
      amount: milestoneCredit.spendableAmount,
      balanceAfter,
      rulesVersion: resolvedRulesVersion,
      metadata: walletCreditMetadata(milestoneCredit, {
        sessionId: input.sessionId,
        source: 'streak-milestone',
        mode: input.mode,
        sessionKind: input.kind,
        dailyCompletedCount: routeCount,
        streak: currentDailyStreak,
        rulesVersion: resolvedRulesVersion,
      }),
    }).onConflictDoNothing()
  }
  await tx.update(walletAccounts).set({
    balance: balanceAfter,
    lifetimeEarned: wallet.lifetimeEarned + total,
    purchaseDebt: milestoneCredit.purchaseDebtAfter,
    version: sql`${walletAccounts.version} + 1`,
    updatedAt: now,
  }).where(eq(walletAccounts.userId, input.userId))
  return { ledgerId: ledger[0].id, rulesVersion: resolvedRulesVersion, total, components, balanceAfter, alreadyClaimed: false }
}

export const completeDanetkiDaily = async (tx: Transaction, input: {
  sessionId: string
  userId: string
  puzzleDate: string
  won: boolean
  rulesVersion?: number
}) => {
  if (input.puzzleDate !== getMoscowDate()) return null
  const operationKey = `danetki-daily-completion:${input.userId}:${input.puzzleDate}`
  const existing = await tx.select({ id: walletLedger.id, amount: walletLedger.amount, balanceAfter: walletLedger.balanceAfter, metadata: walletLedger.metadata })
    .from(walletLedger).where(eq(walletLedger.operationKey, operationKey)).limit(1)
  if (existing[0]) {
    const metadata = existing[0].metadata && typeof existing[0].metadata === 'object'
      ? existing[0].metadata as Record<string, unknown>
      : {}
    return {
      ledgerId: existing[0].id,
      total: Math.max(0, Number(metadata.grossAmount) || existing[0].amount),
      balanceAfter: existing[0].balanceAfter,
      alreadyClaimed: true,
    }
  }

  const now = new Date()
  await tx.insert(walletAccounts).values({ userId: input.userId }).onConflictDoNothing()
  const wallet = (await tx.select().from(walletAccounts).where(eq(walletAccounts.userId, input.userId)).for('update').limit(1))[0]
  const rulesVersion = input.rulesVersion ?? ECONOMY_RULES_VERSION
  const rules = await loadEconomyRulesByVersion(tx, rulesVersion)
  const completionReward = rules.danetki.ownerDailyCompletionReward
  const credit = settlePositiveWalletCredit(wallet, completionReward)
  const ledger = (await tx.insert(walletLedger).values({
    userId: input.userId,
    operationKey,
    type: 'earn',
    reason: 'danetki-daily-completion',
    amount: credit.spendableAmount,
    balanceAfter: credit.balanceAfter,
    rulesVersion,
    metadata: walletCreditMetadata(credit, {
      sessionId: input.sessionId,
      source: 'danetki-daily',
      mode: 'danetki',
      sessionKind: 'daily',
      rulesVersion,
    }),
  }).returning({ id: walletLedger.id }))[0]
  const total = completionReward
  await tx.update(walletAccounts).set({
    balance: credit.balanceAfter,
    lifetimeEarned: wallet.lifetimeEarned + total,
    purchaseDebt: credit.purchaseDebtAfter,
    version: sql`${walletAccounts.version} + 1`,
    updatedAt: now,
  }).where(eq(walletAccounts.userId, input.userId))
  return { ledgerId: ledger.id, total, balanceAfter: credit.balanceAfter, alreadyClaimed: false }
}
