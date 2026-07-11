import { emptyStats } from './game'
import type {
  AssistHintKey,
  AttendanceStats,
  Attempt,
  DailyAttendance,
  DifficultyKey,
  GameStatus,
  HintCheckpoint,
  HintChoice,
  PeriodKey,
  PeriodUnlocks,
  SavedGame,
  Stats,
  TicketLedgerEntry,
  TitleMode,
  Wallet,
} from './types'

const GAME_PREFIX = 'seans:v1:game:'
const STATS_PREFIX = 'seans:v1:stats:'
const ATTENDANCE_PREFIX = 'seans:v1:attendance:'
const ATTENDANCE_STATS_KEY = 'seans:v1:attendance:stats'
const WALLET_KEY = 'seans:v1:wallet'
const TICKET_LEDGER_KEY = 'seans:v1:ticket-ledger'
const PROMO_USAGE_KEY = 'seans:v1:promo-usage'
const PERIOD_UNLOCKS_KEY = 'seans:v1:period-unlocks'
const FREE_PLAY_USAGE_PREFIX = 'seans:v1:free-play-usage:'
const MUSIC_REVIEW_APPROVALS_KEY = 'seans:v1:music-review-approvals'
const MUSIC_REVIEW_CONFLICT_CHOICES_KEY = 'seans:v1:music-review-conflict-choices'
const SAVED_GAME_SCHEMA_VERSION = 2

export type MusicReviewConflictOption = 'A' | 'B'
export type MusicReviewConflictChoice = {
  option: MusicReviewConflictOption
  value: string
  at: number
}
export type MusicReviewConflictChoices = Record<string, Record<string, MusicReviewConflictChoice>>

const TITLE_MODES: TitleMode[] = ['movie', 'series', 'anime', 'game', 'music', 'diagnosis']
const PERIOD_KEYS: PeriodKey[] = ['all', 'from_1960', 'from_1980', 'from_1990', 'from_2000', 'from_2010', 'from_2020']
const GAME_STATUSES: GameStatus[] = ['playing', 'won', 'lost']
const HINT_CHECKPOINTS: HintCheckpoint[] = [5, 8]
const ASSIST_HINT_KEYS: AssistHintKey[] = ['plot', 'slogan', 'cast_main', 'cast_secondary', 'fact', 'awards']
const DIFFICULTY_KEYS: DifficultyKey[] = ['easy', 'medium', 'hard', 'expert', 'experimental']

const isTitleMode = (value: unknown): value is TitleMode => typeof value === 'string' && TITLE_MODES.includes(value as TitleMode)
const isPeriodKey = (value: unknown): value is PeriodKey => typeof value === 'string' && PERIOD_KEYS.includes(value as PeriodKey)
const isGameStatus = (value: unknown): value is GameStatus => typeof value === 'string' && GAME_STATUSES.includes(value as GameStatus)
const isHintCheckpoint = (value: unknown): value is HintCheckpoint => typeof value === 'number' && HINT_CHECKPOINTS.includes(value as HintCheckpoint)
const isAssistHintKey = (value: unknown): value is AssistHintKey => typeof value === 'string' && ASSIST_HINT_KEYS.includes(value as AssistHintKey)
const isDifficultyKey = (value: unknown): value is DifficultyKey => typeof value === 'string' && DIFFICULTY_KEYS.includes(value as DifficultyKey)
const normalizeMusicDifficulty = (difficulty: DifficultyKey) => difficulty === 'experimental' ? 'expert' as const : difficulty
const normalizeMusicGameKey = (key: string) => key.replace(/\|diff:experimental$/, '|diff:expert')

const toSafeInteger = (value: unknown, fallback: number) => {
  const parsed = Math.trunc(Number(value))
  return Number.isFinite(parsed) ? parsed : fallback
}

const normalizeAttempts = (value: unknown): Attempt[] => {
  if (!Array.isArray(value)) return []
  const attempts: Attempt[] = []
  for (const rawAttempt of value) {
    if (!rawAttempt || typeof rawAttempt !== 'object') continue
    const titleId = (rawAttempt as { titleId?: unknown }).titleId
    if (typeof titleId !== 'string' || !titleId) continue
    const hintsValue = (rawAttempt as { hints?: unknown }).hints
    attempts.push({ titleId, hints: Array.isArray(hintsValue) ? (hintsValue as Attempt['hints']) : [] })
    if (attempts.length >= 10) break
  }
  return attempts
}

const normalizeHintChoices = (value: unknown): HintChoice[] => {
  if (!Array.isArray(value)) return []
  const seenRounds = new Set<HintCheckpoint>()
  const choices: HintChoice[] = []
  for (const rawChoice of value) {
    if (!rawChoice || typeof rawChoice !== 'object') continue
    const round = (rawChoice as { round?: unknown }).round
    const key = (rawChoice as { key?: unknown }).key
    if (!isHintCheckpoint(round) || !isAssistHintKey(key) || seenRounds.has(round)) continue
    seenRounds.add(round)
    choices.push({ round, key })
  }
  return choices
}

const normalizeUsedHints = (value: unknown): AssistHintKey[] => {
  if (!Array.isArray(value)) return []
  const unique = new Set<AssistHintKey>()
  for (const item of value) {
    if (isAssistHintKey(item)) unique.add(item)
  }
  return [...unique]
}

const legacyHintChoicesFromUsedHints = (value: unknown): HintChoice[] => {
  const hints = normalizeUsedHints(value).slice(0, 2)
  return hints.map((key, index) => ({
    round: (index === 0 ? 5 : 8) as HintCheckpoint,
    key,
  }))
}

const normalizeDismissedHintRounds = (value: unknown, openedRounds: Set<HintCheckpoint>): HintCheckpoint[] => {
  if (!Array.isArray(value)) return []
  const unique = new Set<HintCheckpoint>()
  for (const item of value) {
    if (!isHintCheckpoint(item) || openedRounds.has(item)) continue
    unique.add(item)
  }
  return [...unique]
}

const normalizeAttemptTitleIds = (value: unknown, attempts: Attempt[]): string[] => {
  const fromStored = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item))
    : []
  const fallback = attempts.map((attempt) => attempt.titleId)
  const source = fromStored.length ? fromStored : fallback
  return source.slice(0, 10)
}

const normalizeSavedGame = (value: unknown, fallbackKey?: string): SavedGame | null => {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<SavedGame> & {
    attemptTitleIds?: unknown
    schemaVersion?: unknown
    usedHints?: unknown
    hintChoices?: unknown
    dismissedHintRounds?: unknown
    attempts?: unknown
  }
  const rawKey = typeof raw.key === 'string' && raw.key ? raw.key : fallbackKey
  const key = raw.mode === 'music' && rawKey ? normalizeMusicGameKey(rawKey) : rawKey
  if (!key || !isTitleMode(raw.mode)) return null

  const date = typeof raw.date === 'string' && raw.date ? raw.date : null
  const answerId = typeof raw.answerId === 'string' && raw.answerId ? raw.answerId : null
  if (!date || !answerId) return null

  const attempts = normalizeAttempts(raw.attempts)
  const attemptTitleIds = normalizeAttemptTitleIds(raw.attemptTitleIds, attempts)
  const hintChoices = (() => {
    const direct = normalizeHintChoices(raw.hintChoices)
    if (direct.length) return direct
    return legacyHintChoicesFromUsedHints(raw.usedHints)
  })()
  const openedRounds = new Set(hintChoices.map((choice) => choice.round))

  return {
    key,
    mode: raw.mode,
    period: isPeriodKey(raw.period) ? raw.period : 'all',
    date,
    answerId,
    attempts,
    attemptTitleIds,
    status: isGameStatus(raw.status) ? raw.status : 'playing',
    usedHints: hintChoices.map((choice) => choice.key),
    hintChoices,
    dismissedHintRounds: normalizeDismissedHintRounds(raw.dismissedHintRounds, openedRounds),
    updatedAt: Math.max(0, toSafeInteger(raw.updatedAt, Date.now())),
    schemaVersion: Math.max(1, toSafeInteger(raw.schemaVersion, 1)),
    ...(isDifficultyKey(raw.difficulty) ? { difficulty: normalizeMusicDifficulty(raw.difficulty) } : {}),
  }
}

const prepareSavedGameForStore = (game: SavedGame): SavedGame => {
  const normalized = normalizeSavedGame({
    ...game,
    attemptTitleIds: Array.isArray(game.attemptTitleIds) && game.attemptTitleIds.length
      ? game.attemptTitleIds
      : game.attempts.map((attempt) => attempt.titleId),
    schemaVersion: SAVED_GAME_SCHEMA_VERSION,
  }, game.key)

  if (normalized) return { ...normalized, schemaVersion: SAVED_GAME_SCHEMA_VERSION }

  return {
    ...game,
    attemptTitleIds: game.attempts.map((attempt) => attempt.titleId).slice(0, 10),
    hintChoices: game.hintChoices ?? [],
    dismissedHintRounds: game.dismissedHintRounds ?? [],
    schemaVersion: SAVED_GAME_SCHEMA_VERSION,
  }
}

export const gameKey = (mode: string, period: string, date: string) => `${mode}|${period}|${date}`

export const loadGame = (key: string): SavedGame | null => {
  try {
    const legacyKey = key.replace(/\|diff:expert$/, '|diff:experimental')
    const value = localStorage.getItem(GAME_PREFIX + key)
      ?? (legacyKey !== key ? localStorage.getItem(GAME_PREFIX + legacyKey) : null)
    if (!value) return null
    const game = normalizeSavedGame(JSON.parse(value), key)
    if (game && game.key !== key) {
      localStorage.setItem(GAME_PREFIX + game.key, JSON.stringify(prepareSavedGameForStore(game)))
      localStorage.removeItem(GAME_PREFIX + legacyKey)
    }
    return game
  } catch {
    return null
  }
}
export const saveGame = (game: SavedGame) => localStorage.setItem(GAME_PREFIX + game.key, JSON.stringify(prepareSavedGameForStore(game)))
export const removeGame = (key: string) => localStorage.removeItem(GAME_PREFIX + key)
export const allGames = (): SavedGame[] => Object.keys(localStorage).filter((key) => key.startsWith(GAME_PREFIX))
  .map((storageKey) => {
    try {
      const key = storageKey.slice(GAME_PREFIX.length)
      const value = localStorage.getItem(storageKey)
      if (!value) return null
      const game = normalizeSavedGame(JSON.parse(value), key)
      if (game && game.key !== key) {
        localStorage.setItem(GAME_PREFIX + game.key, JSON.stringify(prepareSavedGameForStore(game)))
        localStorage.removeItem(storageKey)
      }
      return game
    } catch {
      return null
    }
  })
  .filter((game): game is SavedGame => Boolean(game)).sort((a, b) => b.date.localeCompare(a.date))
const statsKey = (mode: TitleMode, difficulty?: DifficultyKey) => mode === 'music' && difficulty ? `${mode}|${difficulty}` : mode

const parseStats = (value: string | null): Stats => {
  if (!value) return emptyStats()
  try {
    return JSON.parse(value) as Stats
  } catch {
    return emptyStats()
  }
}

const mergeStats = (current: Stats, legacy: Stats): Stats => ({
  played: current.played + legacy.played,
  won: current.won + legacy.won,
  currentStreak: Math.max(current.currentStreak, legacy.currentStreak),
  bestStreak: Math.max(current.bestStreak, legacy.bestStreak),
  distribution: current.distribution.map((value, index) => value + (legacy.distribution[index] ?? 0)),
})

export const loadStats = (mode: TitleMode, difficulty?: DifficultyKey): Stats => {
  try {
    const scoped = parseStats(localStorage.getItem(STATS_PREFIX + statsKey(mode, difficulty)))
    if (mode === 'music' && difficulty === 'expert') {
      const legacyKey = STATS_PREFIX + statsKey(mode, 'experimental')
      const legacy = parseStats(localStorage.getItem(legacyKey))
      if (legacy.played > 0) {
        const merged = mergeStats(scoped, legacy)
        localStorage.setItem(STATS_PREFIX + statsKey(mode, 'expert'), JSON.stringify(merged))
        localStorage.removeItem(legacyKey)
        return merged
      }
    }
    if (mode === 'music' && difficulty) return scoped
    return scoped
  } catch {
    return emptyStats()
  }
}

export const saveStats = (mode: TitleMode, stats: Stats, difficulty?: DifficultyKey) => {
  localStorage.setItem(STATS_PREFIX + statsKey(mode, difficulty), JSON.stringify(stats))
}

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

export const loadPromoUsage = (): Record<string, number> => {
  try {
    const value = localStorage.getItem(PROMO_USAGE_KEY)
    const usage = value ? JSON.parse(value) as Record<string, unknown> : {}
    return Object.fromEntries(Object.entries(usage).map(([code, count]) => [code, Math.max(0, Math.trunc(Number(count) || 0))]))
  } catch {
    return {}
  }
}

export const savePromoUsage = (usage: Record<string, number>) => localStorage.setItem(PROMO_USAGE_KEY, JSON.stringify(usage))

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

export const loadMusicReviewApprovals = (): Record<string, number> => {
  try {
    const raw = localStorage.getItem(MUSIC_REVIEW_APPROVALS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([id, approvedAt]) => {
          const normalizedId = typeof id === 'string' ? id.trim() : ''
          const value = Math.trunc(Number(approvedAt))
          if (!normalizedId || !Number.isFinite(value) || value <= 0) return null
          return [normalizedId, value] as const
        })
        .filter((entry): entry is readonly [string, number] => Boolean(entry)),
    )
  } catch {
    return {}
  }
}

export const saveMusicReviewApprovals = (approvals: Record<string, number>) => {
  localStorage.setItem(MUSIC_REVIEW_APPROVALS_KEY, JSON.stringify(approvals))
}

export const setMusicReviewApproval = (id: string, approved: boolean) => {
  const normalizedId = id.trim()
  if (!normalizedId) return loadMusicReviewApprovals()
  const next = { ...loadMusicReviewApprovals() }
  if (approved) next[normalizedId] = Date.now()
  else delete next[normalizedId]
  saveMusicReviewApprovals(next)
  return next
}

export const loadMusicReviewConflictChoices = (): MusicReviewConflictChoices => {
  try {
    const raw = localStorage.getItem(MUSIC_REVIEW_CONFLICT_CHOICES_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    const entries = Object.entries(parsed)
      .map(([itemId, fieldMap]) => {
        if (typeof itemId !== 'string' || !itemId.trim()) return null
        if (!fieldMap || typeof fieldMap !== 'object' || Array.isArray(fieldMap)) return null

        const normalizedFieldMap = Object.fromEntries(
          Object.entries(fieldMap as Record<string, unknown>)
            .map(([field, value]) => {
              if (typeof field !== 'string' || !field.trim()) return null
              if (!value || typeof value !== 'object' || Array.isArray(value)) return null
              const candidate = value as Partial<MusicReviewConflictChoice>
              const option = candidate.option === 'A' || candidate.option === 'B' ? candidate.option : null
              const normalizedValue = typeof candidate.value === 'string' ? candidate.value.trim() : ''
              const at = Math.trunc(Number(candidate.at))
              if (!option || !normalizedValue || !Number.isFinite(at) || at <= 0) return null
              return [field.trim(), { option, value: normalizedValue, at }] as const
            })
            .filter((entry): entry is readonly [string, MusicReviewConflictChoice] => Boolean(entry)),
        )

        if (!Object.keys(normalizedFieldMap).length) return null
        return [itemId.trim(), normalizedFieldMap] as const
      })
      .filter((entry): entry is readonly [string, Record<string, MusicReviewConflictChoice>] => Boolean(entry))

    return Object.fromEntries(entries)
  } catch {
    return {}
  }
}

export const saveMusicReviewConflictChoices = (choices: MusicReviewConflictChoices) => {
  localStorage.setItem(MUSIC_REVIEW_CONFLICT_CHOICES_KEY, JSON.stringify(choices))
}

export const setMusicReviewConflictChoice = (
  itemId: string,
  field: string,
  option: MusicReviewConflictOption,
  value: string,
) => {
  const normalizedItemId = itemId.trim()
  const normalizedField = field.trim()
  const normalizedValue = value.trim()
  if (!normalizedItemId || !normalizedField || !normalizedValue) return loadMusicReviewConflictChoices()

  const next = { ...loadMusicReviewConflictChoices() }
  const existingFieldMap = next[normalizedItemId] ?? {}
  next[normalizedItemId] = {
    ...existingFieldMap,
    [normalizedField]: {
      option,
      value: normalizedValue,
      at: Date.now(),
    },
  }
  saveMusicReviewConflictChoices(next)
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
