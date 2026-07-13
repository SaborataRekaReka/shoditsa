import type { Hint } from './legacy-types.js'
import type { ApiDifficultyKey, ApiPeriodKey, ContentMode, ContentReportReason } from './schemas.js'

export type ApiRole = 'player' | 'admin'
export type ApiGameStatus = 'playing' | 'won' | 'lost'

export type ApiUser = {
  id: string
  email: string
  name: string
  isAnonymous: boolean
  role: ApiRole
}

export type PlayerProfile = {
  userId: string
  role: ApiRole
  displayName: string | null
  locale: string
  timezone: string
  legacyImportedAt: string | null
}

export type PublicContentItem = {
  id: string
  mode: ContentMode
  titleRu: string
  titleOriginal: string
  year: number | null
  genres?: string[]
  posterUrl: string | null
}

export type MetaResponse = {
  serverTime: string
  moscowDate: string
  apiVersion: string
  rulesVersion: number
  activeRevision: { id: string; version: string } | null
  modes: Array<{ mode: ContentMode; count: number }>
  minimumFrontendVersion: string
  buildSha: string
  auth: {
    emailPassword: boolean
    emailVerification: boolean
    passwordReset: boolean
    yandex: boolean
  }
}

export type MeResponse = {
  user: ApiUser
  profile: PlayerProfile
  auth: { hasPassword: boolean; providers: string[] }
}

export type AuthActionResponse = {
  token: string | null
  user: { id: string; name: string; email: string; emailVerified: boolean; isAnonymous?: boolean }
}

export type WalletAccount = {
  userId?: string
  balance: number
  lifetimeEarned: number
  version?: number
  updatedAt?: string
}

export type AttendanceSummary = {
  currentDailyStreak: number
  bestDailyStreak: number
  lastCompletedDate: string | null
  gracePasses: number
  totalActiveDays: number
  fullHouseDays: number
}

export type TodayAttendance = {
  activityDate: string
  completedModes: ContentMode[]
  wonModes: ContentMode[]
  fullHouse: boolean
}

export type ModeStats = {
  mode: ContentMode
  difficultyKey: string
  played: number
  won: number
  currentStreak: number
  bestStreak: number
  distribution: number[]
}

export type PeriodEntitlement = { mode: ContentMode; period: ApiPeriodKey; source: string; unlockedAt?: string }
export type ActiveSessionSummary = {
  id: string
  mode: ContentMode
  kind: 'daily' | 'archive' | 'free_play'
  status: ApiGameStatus
  period: ApiPeriodKey
  difficulty: ApiDifficultyKey | null
  puzzleDate: string
  attemptsCount: number
  updatedAt: string
}

export type DashboardResponse = {
  wallet: WalletAccount
  attendance: AttendanceSummary | null
  today: TodayAttendance | null
  stats: ModeStats[]
  entitlements: PeriodEntitlement[]
  activeSessions: ActiveSessionSummary[]
  freePlayLaunchesToday: number
}

export type GameAttemptSnapshot = {
  position: number
  item: PublicContentItem
  hints: Hint[]
}

export type HintCheckpointSnapshot = { round: 5 | 8; state: 'locked' | 'available' | 'opened' }
export type HintChoiceSnapshot = { checkpoint: 5 | 8; hintKey: string; response: { checkpoint: 5 | 8; hintKey: string; value: unknown } }

export type GameSessionSnapshot = {
  id: string
  kind: 'daily' | 'archive' | 'free_play'
  mode: ContentMode
  period: ApiPeriodKey
  difficulty: ApiDifficultyKey | null
  puzzleDate: string
  status: ApiGameStatus
  attemptsCount: number
  attemptsRemaining: number
  attempts: GameAttemptSnapshot[]
  hintCheckpoints: HintCheckpointSnapshot[]
  hintChoices: HintChoiceSnapshot[]
  progressiveHints: Array<{ key: string; value: unknown }>
  diagnosisVignette: { id: string; text: string } | null
  serverTime: string
  answer?: PublicContentItem
}

export type GameStartResponse = { session: GameSessionSnapshot }
export type GameResponse = { session: GameSessionSnapshot }
export type CatalogSearchResponse = { items: PublicContentItem[] }
export type AttemptResponse = {
  attempt: GameAttemptSnapshot
  session: Pick<GameSessionSnapshot, 'status' | 'attemptsCount' | 'attemptsRemaining'>
  progressiveHints: Array<{ key: string; value: unknown }>
  answer?: PublicContentItem
  reward?: {
    total: number
    balanceAfter: number
    alreadyClaimed: boolean
    multiplier: number
    components: { completion: number; win: number; speed: number; firstCompletion: number; fullHouse: number }
  }
}
export type HintResponse = { checkpoint: 5 | 8; hintKey: string; value: unknown }
export type GuestResponse = { user?: ApiUser; session?: unknown }
export type PeriodUnlockResponse = { entitlement: PeriodEntitlement; balanceAfter?: number; alreadyUnlocked: boolean }
export type FreePlayResponse = GameSessionSnapshot & { cost: number; balanceAfter: number; ledgerId: string }
export type PromoRedeemResponse = { reward?: { type: 'tickets'; amount: number; balanceAfter: number }; alreadyRedeemed: boolean }

export type LedgerEntry = { id: string; amount: number; balanceAfter: number; reason: string; type: string; createdAt: string }
export type LedgerResponse = { items: LedgerEntry[]; nextCursor: string | null }
export type WalletResponse = { wallet: WalletAccount }
export type ArchiveItem = { id: string; mode: ContentMode; period: ApiPeriodKey; difficulty: ApiDifficultyKey | null; puzzleDate: string; status: ApiGameStatus; attemptsCount: number; completedAt: string | null }
export type ArchiveResponse = { items: ArchiveItem[]; nextCursor: string | null }

export type LegacyImportResponse = {
  id: string
  importedGames: number
  importedWallet: number
  warnings: string[]
  alreadyImported: boolean
}

export type ContentReportResponse = { id: string; reason: ContentReportReason; createdAt: string }

export type AdminReviewItem = {
  id: string
  mode: ContentMode
  titleRu: string
  titleOriginal: string
  contentStatus: string | null
  reviewReasons: string[]
  payload: Record<string, unknown>
  decisions: Array<{ field: string; decision: unknown; reviewerUserId: string; updatedAt: string }>
}

export type AdminReviewQueueResponse = { items: AdminReviewItem[]; nextCursor: string | null }
export type AdminReviewDecisionResponse = { id: string; itemId: string; field: string; decision: unknown; reviewerUserId: string; updatedAt: string }
