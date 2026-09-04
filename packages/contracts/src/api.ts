import type { AssistHintKey, Hint, TitleItem } from './legacy-types.js'
import type { ApiDifficultyKey, ApiPeriodKey, ContentMode, ContentReportReason, PlayableMode } from './schemas.js'
import type { DanetkiGameState, DanetkiRoomMode } from './danetki.js'
import type { CatalogGuessModeId } from './game-modes.js'
import type { EconomyQuote, EconomyRuleSet } from './economy.js'
import type { ConnectionsGameState, ConnectionsHintSnapshot } from './connections.js'

export type ApiRole = 'player' | 'admin'
export type ApiGameStatus = 'playing' | 'final_choice' | 'won' | 'lost' | 'expired'
export type GameCompletionType =
  | 'direct_win'
  | 'final_choice_win'
  | 'final_choice_loss'
  | 'answer_revealed'
  | 'attempts_exhausted'
  | 'expired'

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

export type UserBadge = {
  key: string
  name: string
  shortLabel: string
  description: string
  styleKey: string
  awardedAt: string
}

export type PublicContentItem = {
  id: string
  mode: CatalogGuessModeId
  titleRu: string
  titleOriginal: string
  year: number | null
  genres?: string[]
  posterUrl: string | null
} & Partial<Omit<TitleItem, 'id' | 'mode' | 'titleRu' | 'titleOriginal' | 'year' | 'genres' | 'posterUrl' | 'comments'>>

export type MetaResponse = {
  serverTime: string
  moscowDate: string
  apiVersion: string
  rulesVersion: number
  activeRevision: { id: string; version: string } | null
  modes: Array<{ mode: PlayableMode; count: number }>
  minimumFrontendVersion: string
  buildSha: string
  auth: {
    emailPassword: boolean
    emailVerification: boolean
    passwordReset: boolean
    yandex: boolean
  }
  commerce: {
    enabled: boolean
    provider: 'none' | 'stub' | 'web' | 'robokassa' | 'cloudpayments'
    currency: string
    archiveFirstDate: string
    freeArchiveDays: number
  }
  features: {
    danetkiEnabled: boolean
    danetkiMultiplayerEnabled: boolean
    finalChoiceEnabled: boolean
    connectionsEnabled: boolean
    connectionsHintsEnabled: boolean
    connectionsLaunchDate: string | null
    territoryEnabled: boolean
  }
}

export type MeResponse = {
  user: ApiUser
  profile: PlayerProfile
  badges: UserBadge[]
  auth: {
    hasPassword: boolean
    providers: string[]
    analyticsOutcome?: { eventId: string; action: 'sign_up' | 'sign_in' } | null
  }
}

export type AuthActionResponse = {
  token: string | null
  user: { id: string; name: string; email: string; emailVerified: boolean; isAnonymous?: boolean }
}

export type WalletAccount = {
  userId?: string
  balance: number
  lifetimeEarned: number
  purchaseDebt?: number
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
  mode: PlayableMode
  difficultyKey: string
  played: number
  won: number
  currentStreak: number
  bestStreak: number
  distribution: number[]
  finalChoiceWins: number
  distributionKind?: 'attempts' | 'mistakes'
  hintsUsed?: number
  perfectWins?: number
}

export type PeriodEntitlement = { mode: PlayableMode; period: ApiPeriodKey; source: string; unlockedAt?: string }
export type ActiveSessionSummary = {
  id: string
  mode: PlayableMode
  kind: 'daily' | 'archive' | 'free_play' | 'pack'
  status: ApiGameStatus
  variantKey: string | null
  period: ApiPeriodKey
  difficulty: ApiDifficultyKey | null
  puzzleDate: string
  attemptsCount: number
  mistakesUsed?: number
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
  freePlayNextCost: number
  economyRules: EconomyRuleSet
  economyQuotes: {
    freePlay: EconomyQuote
    periodUnlock: EconomyQuote
    danetkiSolo: EconomyQuote
    danetkiGroup: EconomyQuote
  }
  danetkiAccess: {
    dailyRoomsStarted: number
    extraRoomsStarted: number
    clubRoomsRemaining: number
    nextSoloCost: number
    nextGroupCost: number
  }
  membership: { active: boolean; endsAt: string | null }
}

export type GameAttemptSnapshot = {
  position: number
  item: PublicContentItem
  hints: Hint[]
}

export type HintCheckpointSnapshot = { round: 5 | 8; state: 'locked' | 'available' | 'opened' }
export type HintChoiceSnapshot = { checkpoint: 5 | 8; hintKey: AssistHintKey; response: { checkpoint: 5 | 8; hintKey: AssistHintKey; value: unknown; sourceKey?: string } }
export type HintOptionSnapshot = { key: AssistHintKey; title: string; subtitle: string }
export type PromoPromptSnapshot = { packId: string; title: string; subtitle: string; disclaimer: string }

export const FINAL_CHOICE_DURATION_MS = 45_000

export type FinalChoiceFactSnapshot = {
  key: string
  value: string
  ariaLabel: string
}

export type FinalChoiceCandidateIdentity = {
  id: string
  titleRu: string
  titleOriginal?: string
  posterUrl?: string
}

export type FinalChoiceCandidateSnapshot = {
  item: FinalChoiceCandidateIdentity
  primaryMeta: string
  facts: [
    FinalChoiceFactSnapshot,
    FinalChoiceFactSnapshot,
    FinalChoiceFactSnapshot,
  ]
}

export type FinalChoiceSnapshot = {
  candidates: [
    FinalChoiceCandidateSnapshot,
    FinalChoiceCandidateSnapshot,
    FinalChoiceCandidateSnapshot,
    FinalChoiceCandidateSnapshot,
  ]
  displayKeys: [string, string, string]
  choicesRemaining: 1
  selectedItemId?: string
  expiresAt?: string
}

type GameSessionSnapshotBase = {
  rulesVersion: number
  id: string
  kind: 'daily' | 'archive' | 'free_play' | 'pack'
  packId: string | null
  packPosition: number | null
  variantKey: string | null
  period: ApiPeriodKey
  difficulty: ApiDifficultyKey | null
  puzzleDate: string
  status: ApiGameStatus
  completionType: GameCompletionType | null
  finalChoice: FinalChoiceSnapshot | null
  attemptsCount: number
  attemptsRemaining: number
  maxAttempts?: number
  attempts: GameAttemptSnapshot[]
  hintCheckpoints: HintCheckpointSnapshot[]
  hintChoices: HintChoiceSnapshot[]
  hintOptions: HintOptionSnapshot[]
  progressiveHints: Array<{ key: string; value: unknown }>
  promoPrompt: PromoPromptSnapshot | null
  diagnosisVignette: { id: string; text: string } | null
  serverTime: string
  answer?: PublicContentItem
}

export type GameSessionSnapshot =
  | (GameSessionSnapshotBase & {
      engine: 'catalog_guess'
      mode: CatalogGuessModeId
      danetki?: never
      connections?: never
    })
  | (GameSessionSnapshotBase & {
      engine: 'danetki_chat'
      mode: 'danetki'
      danetki: DanetkiGameState
      connections?: never
    })
  | (GameSessionSnapshotBase & {
      engine: 'connections_grid'
      mode: 'connections'
      connections: ConnectionsGameState
      danetki?: never
    })

export type GameStartResponse = { session: GameSessionSnapshot }
export type GameResponse = { session: GameSessionSnapshot }
export type ConnectionsGuessResponse = {
  result: 'correct' | 'wrong' | 'one_away'
  session: Extract<GameSessionSnapshot, { engine: 'connections_grid' }>
  reward?: AttemptResponse['reward']
}
export type ConnectionsHintResponse = {
  hint: ConnectionsHintSnapshot
  session: Extract<GameSessionSnapshot, { engine: 'connections_grid' }>
}

export type DanetkiStartBody = {
  mode: 'danetki'
  kind: 'daily' | 'archive' | 'free_play'
  roomMode: DanetkiRoomMode
  archiveDate?: string | null
}
export type CatalogSearchResponse = { items: PublicContentItem[] }
export type AttemptResponse = {
  attempt: GameAttemptSnapshot
  session: Pick<GameSessionSnapshot, 'status' | 'attemptsCount' | 'attemptsRemaining' | 'maxAttempts' | 'completionType' | 'finalChoice'>
  progressiveHints: Array<{ key: string; value: unknown }>
  answer?: PublicContentItem
  reward?: {
    rulesVersion: number
    total: number
    balanceAfter: number
    alreadyClaimed: boolean
    components: {
      completion: number
      win: number
      efficiency: number
      finalChoiceWin: number
      firstGame: number
      route3: number
      fullRoute: number
      streakMilestone: number
    }
  }
}
export type FinalChoiceResponse = {
  session: Pick<GameSessionSnapshot, 'status' | 'attemptsCount' | 'attemptsRemaining' | 'maxAttempts' | 'completionType'>
  answer: PublicContentItem
  selectedItemId: string | null
  correct: boolean
  timedOut: boolean
  reward: AttemptResponse['reward']
}
export type HintResponse = { checkpoint: 5 | 8; hintKey: AssistHintKey; value: unknown; sourceKey?: string }
export type GuestResponse = { user?: ApiUser; session?: unknown }
export type PeriodUnlockResponse = {
  entitlement: PeriodEntitlement | null
  balanceAfter?: number
  alreadyUnlocked: boolean
  accessSource: 'tickets' | 'club'
  rulesVersion: number
}
export type FreePlayResponse = GameSessionSnapshot & { cost: number; balanceAfter: number; ledgerId: string | null; accessSource: 'tickets' | 'club' }
export type PromoRedeemResponse = { reward?: { type: 'tickets'; amount: number; balanceAfter: number }; alreadyRedeemed: boolean }

export type LedgerEntry = { id: string; amount: number; balanceAfter: number; reason: string; type: string; rulesVersion: number; createdAt: string }
export type LedgerResponse = { items: LedgerEntry[]; nextCursor: string | null }
export type WalletResponse = { wallet: WalletAccount }
export type ArchiveItem = { id: string; mode: PlayableMode; variantKey: string | null; period: ApiPeriodKey; difficulty: ApiDifficultyKey | null; puzzleDate: string; status: ApiGameStatus; attemptsCount: number; completedAt: string | null }
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
