import type {
  ActiveSessionSummary,
  ArchiveItem,
  AttendanceSummary,
  DashboardResponse,
  MetaResponse,
  TodayAttendance,
} from '@shoditsa/contracts'
import { PLAYABLE_MODE_IDS } from '@shoditsa/contracts'
import type { AttendanceStats, DailyAttendance, SavedGame, TitleMode, Wallet } from '../../types'

export const toLegacyWallet = (dashboard: DashboardResponse | null): Wallet => ({
  tickets: dashboard?.wallet.balance ?? 0,
  lifetimeTickets: dashboard?.wallet.lifetimeEarned ?? 0,
})

export const toLegacyAttendance = (attendance: AttendanceSummary | null | undefined): AttendanceStats => ({
  currentDailyStreak: attendance?.currentDailyStreak ?? 0,
  bestDailyStreak: attendance?.bestDailyStreak ?? 0,
  lastCompletedDate: attendance?.lastCompletedDate ?? null,
  gracePasses: attendance?.gracePasses ?? 0,
  totalActiveDays: attendance?.totalActiveDays ?? 0,
  fullHouseDays: attendance?.fullHouseDays ?? 0,
})

export const toLegacyDailyAttendance = (today: TodayAttendance | null | undefined, fallbackDate: string): DailyAttendance => ({
  date: today?.activityDate ?? fallbackDate,
  completedModes: today?.completedModes ?? [],
  wonModes: today?.wonModes ?? [],
  completedSessions: [],
  firstCompletedAt: 0,
  fullHouse: today?.fullHouse ?? false,
})

const placeholderAttempts = (count: number) => Array.from({ length: count }, (_, index) => ({
  titleId: `server-attempt-${index}`,
  hints: [],
}))

export const activeSessionToSavedGame = (session: ActiveSessionSummary): SavedGame => ({
  key: `server:${session.id}`,
  mode: session.mode,
  variantKey: session.variantKey,
  period: session.period,
  date: session.puzzleDate,
  answerId: '',
  attempts: placeholderAttempts(session.attemptsCount),
  status: session.status,
  updatedAt: Date.parse(session.updatedAt) || 0,
  difficulty: session.difficulty ?? undefined,
})

export const archiveItemToSavedGame = (session: ArchiveItem): SavedGame => ({
  key: `server:${session.id}`,
  mode: session.mode,
  variantKey: session.variantKey,
  period: session.period,
  date: session.puzzleDate,
  answerId: '',
  attempts: placeholderAttempts(session.attemptsCount),
  status: session.status,
  updatedAt: session.completedAt ? Date.parse(session.completedAt) : 0,
  difficulty: session.difficulty ?? undefined,
})

export const serverTitleCounts = (meta: MetaResponse | null): Record<TitleMode, number | null> => {
  const counts = Object.fromEntries(PLAYABLE_MODE_IDS.map((mode) => [mode, null])) as Record<TitleMode, number | null>
  for (const entry of meta?.modes ?? []) counts[entry.mode] = entry.count
  return counts
}
