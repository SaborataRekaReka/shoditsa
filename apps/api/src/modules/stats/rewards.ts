import { and, eq, sql } from 'drizzle-orm'
import type { ContentMode } from '@shoditsa/contracts'
import {
  attendanceStats, dailyAttendance, type Database, userModeStats, walletAccounts, walletLedger,
} from '@shoditsa/database'
import { getMoscowDate, previousDate } from '../../lib/time.js'
import { calculateCompletionReward } from '@shoditsa/game-core'

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
const ALL_MODES: ContentMode[] = ['movie', 'series', 'anime', 'game', 'music', 'diagnosis']

export const completeGame = async (tx: Transaction, input: {
  sessionId: string; userId: string; kind: string; mode: ContentMode; difficulty: string | null;
  puzzleDate: string; won: boolean; attemptsCount: number;
}) => {
  const statsEligible = input.kind === 'daily' || input.kind === 'archive'
  if (statsEligible) {
    const difficulty = input.mode === 'music' ? input.difficulty ?? '-' : '-'
    await tx.insert(userModeStats).values({ userId: input.userId, mode: input.mode, difficultyKey: difficulty }).onConflictDoNothing()
    const current = await tx.select().from(userModeStats).where(and(
      eq(userModeStats.userId, input.userId), eq(userModeStats.mode, input.mode), eq(userModeStats.difficultyKey, difficulty),
    )).for('update').limit(1)
    const row = current[0]
    const distribution = [...row.distribution]
    if (input.won) distribution[Math.max(0, Math.min(9, input.attemptsCount - 1))] += 1
    await tx.update(userModeStats).set({
      played: row.played + 1, won: row.won + (input.won ? 1 : 0),
      currentStreak: input.won ? row.currentStreak + 1 : 0,
      bestStreak: Math.max(row.bestStreak, input.won ? row.currentStreak + 1 : row.bestStreak),
      distribution, updatedAt: new Date(),
    }).where(and(eq(userModeStats.userId, input.userId), eq(userModeStats.mode, input.mode), eq(userModeStats.difficultyKey, difficulty)))
  }

  if (input.kind !== 'daily' || input.puzzleDate !== getMoscowDate()) return null
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
  const firstCompletion = attendance.completedModes.length === 0
  const completedModes = [...new Set([...attendance.completedModes, input.mode])]
  const wonModes = input.won ? [...new Set([...attendance.wonModes, input.mode])] : attendance.wonModes
  const fullHouse = ALL_MODES.every((mode) => completedModes.includes(mode))
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

  const { components, multiplier, total } = calculateCompletionReward({ won: input.won, attemptsCount: input.attemptsCount, firstCompletion, firstFullHouse, dailyStreak: currentDailyStreak })

  await tx.insert(walletAccounts).values({ userId: input.userId }).onConflictDoNothing()
  const wallets = await tx.select().from(walletAccounts).where(eq(walletAccounts.userId, input.userId)).for('update').limit(1)
  const wallet = wallets[0]
  const balanceAfter = wallet.balance + total
  const operationKey = `game-completion:${input.sessionId}`
  const ledger = await tx.insert(walletLedger).values({
    userId: input.userId, operationKey, type: 'earn', reason: 'game-completion', amount: total, balanceAfter,
    metadata: { sessionId: input.sessionId, components, multiplier },
  }).onConflictDoNothing().returning({ id: walletLedger.id })
  if (!ledger[0]) {
    const existing = await tx.select({ id: walletLedger.id, amount: walletLedger.amount, balanceAfter: walletLedger.balanceAfter, metadata: walletLedger.metadata })
      .from(walletLedger).where(eq(walletLedger.operationKey, operationKey)).limit(1)
    return { ledgerId: existing[0].id, total: existing[0].amount, components, multiplier, balanceAfter: existing[0].balanceAfter, alreadyClaimed: true }
  }
  await tx.update(walletAccounts).set({ balance: balanceAfter, lifetimeEarned: wallet.lifetimeEarned + total, version: sql`${walletAccounts.version} + 1`, updatedAt: now }).where(eq(walletAccounts.userId, input.userId))
  return { ledgerId: ledger[0].id, total, components, multiplier, balanceAfter, alreadyClaimed: false }
}
