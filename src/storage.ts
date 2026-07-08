import { emptyStats } from './game'
import type { AttendanceStats, DailyAttendance, PeriodKey, PeriodUnlocks, SavedGame, Stats, TicketLedgerEntry, TitleMode, Wallet } from './types'

const GAME_PREFIX = 'seans:v1:game:'
const STATS_PREFIX = 'seans:v1:stats:'
const ATTENDANCE_PREFIX = 'seans:v1:attendance:'
const ATTENDANCE_STATS_KEY = 'seans:v1:attendance:stats'
const WALLET_KEY = 'seans:v1:wallet'
const TICKET_LEDGER_KEY = 'seans:v1:ticket-ledger'
const PERIOD_UNLOCKS_KEY = 'seans:v1:period-unlocks'
const FREE_PLAY_USAGE_PREFIX = 'seans:v1:free-play-usage:'
export const gameKey = (mode: string, period: string, date: string) => `${mode}|${period}|${date}`

export const loadGame = (key: string): SavedGame | null => {
  try { const value = localStorage.getItem(GAME_PREFIX + key); return value ? JSON.parse(value) : null } catch { return null }
}
export const saveGame = (game: SavedGame) => localStorage.setItem(GAME_PREFIX + game.key, JSON.stringify(game))
export const removeGame = (key: string) => localStorage.removeItem(GAME_PREFIX + key)
export const allGames = (): SavedGame[] => Object.keys(localStorage).filter((key) => key.startsWith(GAME_PREFIX))
  .map((key) => { try { return JSON.parse(localStorage.getItem(key) || '') as SavedGame } catch { return null } })
  .filter((game): game is SavedGame => Boolean(game)).sort((a, b) => b.date.localeCompare(a.date))
export const loadStats = (mode: TitleMode): Stats => {
  try { const value = localStorage.getItem(STATS_PREFIX + mode); return value ? JSON.parse(value) : emptyStats() } catch { return emptyStats() }
}
export const saveStats = (mode: TitleMode, stats: Stats) => localStorage.setItem(STATS_PREFIX + mode, JSON.stringify(stats))

export const emptyWallet = (): Wallet => ({ tickets: 0, lifetimeTickets: 0 })
export const loadWallet = (): Wallet => {
  try {
    const value = localStorage.getItem(WALLET_KEY)
    if (!value) return emptyWallet()
    const wallet = JSON.parse(value) as Partial<Wallet>
    return {
      tickets: Math.max(0, Math.trunc(Number(wallet.tickets) || 0)),
      lifetimeTickets: Math.max(0, Math.trunc(Number(wallet.lifetimeTickets) || 0)),
    }
  } catch {
    return emptyWallet()
  }
}
export const saveWallet = (wallet: Wallet) => localStorage.setItem(WALLET_KEY, JSON.stringify(wallet))
export const loadTicketLedger = (): TicketLedgerEntry[] => {
  try {
    const value = localStorage.getItem(TICKET_LEDGER_KEY)
    if (!value) return []
    const ledger = JSON.parse(value) as TicketLedgerEntry[]
    return Array.isArray(ledger) ? ledger.sort((a, b) => b.at - a.at) : []
  } catch {
    return []
  }
}
export const addTicketLedgerEntry = (entry: Omit<TicketLedgerEntry, 'id' | 'at'>) => {
  const nextEntry: TicketLedgerEntry = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
  }
  const next = [nextEntry, ...loadTicketLedger()].slice(0, 80)
  localStorage.setItem(TICKET_LEDGER_KEY, JSON.stringify(next))
  return nextEntry
}

export const loadFreePlayUsage = (date: string): number => {
  try {
    const raw = localStorage.getItem(FREE_PLAY_USAGE_PREFIX + date)
    const parsed = Math.trunc(Number(raw))
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
  } catch {
    return 0
  }
}

export const saveFreePlayUsage = (date: string, launches: number) => {
  const safeValue = Math.max(0, Math.trunc(Number(launches) || 0))
  localStorage.setItem(FREE_PLAY_USAGE_PREFIX + date, String(safeValue))
}

export const consumeFreePlayUsage = (date: string): number => {
  const next = loadFreePlayUsage(date) + 1
  saveFreePlayUsage(date, next)
  return next
}

export const emptyAttendanceStats = (): AttendanceStats => ({
  currentDailyStreak: 0,
  bestDailyStreak: 0,
  lastCompletedDate: null,
  gracePasses: 0,
  totalActiveDays: 0,
  fullHouseDays: 0,
})
export const loadAttendanceStats = (): AttendanceStats => {
  try {
    const value = localStorage.getItem(ATTENDANCE_STATS_KEY)
    if (!value) return emptyAttendanceStats()
    return { ...emptyAttendanceStats(), ...(JSON.parse(value) as Partial<AttendanceStats>) }
  } catch {
    return emptyAttendanceStats()
  }
}
export const saveAttendanceStats = (stats: AttendanceStats) => localStorage.setItem(ATTENDANCE_STATS_KEY, JSON.stringify(stats))

export const emptyDailyAttendance = (date: string): DailyAttendance => ({
  date,
  completedModes: [],
  wonModes: [],
  completedSessions: [],
  firstCompletedAt: 0,
  fullHouse: false,
})
export const loadDailyAttendance = (date: string): DailyAttendance => {
  try {
    const value = localStorage.getItem(ATTENDANCE_PREFIX + date)
    if (!value) return emptyDailyAttendance(date)
    const attendance = JSON.parse(value) as Partial<DailyAttendance>
    return {
      ...emptyDailyAttendance(date),
      ...attendance,
      date,
      completedModes: Array.isArray(attendance.completedModes) ? attendance.completedModes : [],
      wonModes: Array.isArray(attendance.wonModes) ? attendance.wonModes : [],
      completedSessions: Array.isArray(attendance.completedSessions) ? attendance.completedSessions : [],
    }
  } catch {
    return emptyDailyAttendance(date)
  }
}
export const saveDailyAttendance = (attendance: DailyAttendance) => localStorage.setItem(ATTENDANCE_PREFIX + attendance.date, JSON.stringify(attendance))

export const loadPeriodUnlocks = (): PeriodUnlocks => {
  try {
    const value = localStorage.getItem(PERIOD_UNLOCKS_KEY)
    return value ? JSON.parse(value) as PeriodUnlocks : {}
  } catch {
    return {}
  }
}
export const savePeriodUnlocks = (unlocks: PeriodUnlocks) => localStorage.setItem(PERIOD_UNLOCKS_KEY, JSON.stringify(unlocks))
export const unlockedPeriodsFor = (mode: TitleMode, unlocks = loadPeriodUnlocks()): PeriodKey[] => {
  const unlocked = new Set<PeriodKey>(['all', ...((unlocks[mode] ?? []) as PeriodKey[])])
  return [...unlocked]
}
export const isPeriodUnlocked = (mode: TitleMode, period: PeriodKey, unlocks = loadPeriodUnlocks()) => unlockedPeriodsFor(mode, unlocks).includes(period)
export const unlockPeriod = (mode: TitleMode, period: PeriodKey) => {
  const unlocks = loadPeriodUnlocks()
  const periods = new Set<PeriodKey>(unlockedPeriodsFor(mode, unlocks))
  periods.add(period)
  const next = { ...unlocks, [mode]: [...periods] }
  savePeriodUnlocks(next)
  return next
}
