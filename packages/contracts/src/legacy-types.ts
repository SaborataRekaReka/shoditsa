import type { CatalogGuessModeId } from './game-modes.js'

/** Modes powered by the legacy catalog-comparison game engine. */
export type TitleMode = CatalogGuessModeId
export type PeriodKey = 'all' | 'from_1960' | 'from_1980' | 'from_1990' | 'from_2000' | 'from_2010' | 'from_2020'
export type DifficultyKey = 'easy' | 'medium' | 'hard' | 'expert' | 'experimental'
export type MusicOrigin = 'ru' | 'intl'
export type MusicGameTier = 'core' | 'popular' | 'niche' | 'discovery' | 'experimental'
export type MusicContentStatus = 'ready' | 'limited' | 'blocked'

export type Person = { nameRu: string; nameOriginal: string; photoUrl?: string | null }
export type FilmAwards = { wins: number; nominations: number; notable: string[] }
export type AssistHintKey = 'plot' | 'info' | 'fact'
export type HintCheckpoint = 5 | 8
export type HintChoice = { round: HintCheckpoint; key: AssistHintKey }
export type TitleRatings = {
  kinopoisk?: number | null
  imdb?: number | null
  steamPositivePercent?: number | null
  metacritic?: number | null
  gameDifficulty?: number | null
  recognizability?: number | null
}
export type TitleVotes = {
  kinopoisk?: number | null
  imdb?: number | null
  steamReviews?: number | null
  steamPositive?: number | null
  steamNegative?: number | null
  gamesPlayed?: number | null
  correctGuesses?: number | null
}
export type MusicTopTrack = {
  rank: number | null
  title: string
  listeners?: number | null
  playcount?: number | null
  source?: string | null
}
export type MusicTopAlbum = {
  rank: number | null
  title: string
  listeners?: number | null
  source?: string | null
}
export type MusicSimilarArtist = {
  rank: number | null
  name: string
  match?: number | null
  source?: string | null
}
export type GameComment = {
  key: string
  text: string
  unlockAfterAttempts: number
  type?: string
  spoilerRisk?: 'low' | 'medium' | 'high'
  sourceId?: string | null
  sourcePackId?: string | null
  clueStrength?: number
  topics?: string[]
  authorArchetype?: string | null
  authorId?: string | null
  authorName?: string | null
  authorAvatarUrl?: string | null
  authorProfileUrl?: string | null
  authorIsVerified?: boolean
  authorIsPlus?: boolean
  publishedAt?: string | null
  likesCount?: number | null
  dislikesCount?: number | null
  replyCount?: number | null
  reactionCounts?: Record<string, number>
  /** Provenance retained for editorial audit/import; presentation clients render displayText. */
  sourceUrl?: string | null
  sourcePostUrl?: string | null
  sourceExcerpt?: string | null
  sourceVerifiedAt?: string | null
  contentHash?: string | null
  wasRedacted?: boolean
  redactionReasons?: string[]
}
export type GameRecognitionSignals = {
  steamTotalReviews?: number | null
  steamRussianReviews?: number | null
  steamOwnersMidpoint?: number | null
  steamCcu?: number | null
  steamTotalReviewsPercentileByEra?: number | null
  steamRussianReviewsPercentileByEra?: number | null
  igdbPlayed?: number | null
  igdbVisits?: number | null
  currentInterest?: number | null
  chartsCount?: number
  majorAwardsCount?: number
  legacyPtgRank?: number | null
  steamSpyRank?: number | null
  manualCisAdjustment?: number
  manualCisAdjustmentReason?: string | null
  observedAt?: string | null
}
export type GameRecognitionCalibration = {
  knownRate: number | null
  knownResponses: number
  guessRate: number | null
  medianAttemptsToGuess: number | null
  skipRate: number | null
  lastGameplayCalibrationAt: string | null
  minimumResponsesForBlend: number
}
export type TitleItem = {
  id: string
  mode: TitleMode
  titleRu: string
  titleOriginal: string
  alternativeTitles: string[]
  year?: number
  /** First year of public creative activity. Never a birth year. */
  activityStartYear?: number | null
  endYear?: number | null
  releaseDate?: string | null
  countries?: string[]
  originalLanguage?: string
  genres?: string[]
  developers?: string[]
  publishers?: string[]
  platforms?: string[]
  steamCategories?: string[]
  steamTags?: string[]
  supportedLanguages?: string[]
  ageRating?: string | null
  metacritic?: number | null
  runtimeMinutes?: number | null
  episodes?: number | null
  seasonsCount?: number | null
  seriesStatus?: string | null
  animeKind?: string | null
  animeKindCode?: string | null
  animeStatus?: string | null
  animeStatusCode?: string | null
  animeEpisodesAired?: number | null
  animeSource?: string | null
  animeSourceCode?: string | null
  directors?: Person[]
  showrunners?: Person[]
  writers?: Person[]
  cast?: Person[]
  studios?: string[]
  kinopoiskId?: number | null
  imdbId?: string | null
  shikimoriId?: number | null
  shikimoriScore?: number | null
  shikimoriUrl?: string | null
  ratings?: TitleRatings
  votes?: TitleVotes
  popularityScore: number
  price?: {
    isFree: boolean
    currency: string | null
    initial: number | null
    final: number | null
    discountPercent: number
  } | null
  steamAppId?: number | null
  steamUrl?: string | null
  budget?: { amount: number; currency: string } | null
  posterUrl?: string | null
  headerUrl?: string | null
  backdropUrl?: string | null
  screenshots?: string[]
  description?: string | null
  shortDescription?: string | null
  plotHint?: string | null
  slogan?: string | null
  supportingCast?: Person[]
  facts?: string[]
  /** Curated player comments used as progressive clues by comment-based specials. */
  comments?: GameComment[]
  awards?: FilmAwards | null
  topRank?: number | null
  externalRanks?: Record<string, number>
  notes?: string[]
  canonicalId?: string | null
  canonicalGameId?: string | null
  legacyIds?: string[]
  title?: string
  localizedTitles?: { ru: string; en: string }
  acceptedAnswers?: string[]
  normalizedAnswers?: string[]
  releaseYear?: number | null
  franchiseKey?: string | null
  editionType?: 'original' | 'remake' | 'remaster' | 'edition' | 'dlc' | 'technical'
  parentCanonicalGameId?: string | null
  relatedVersions?: string[]
  igdbId?: number | null
  sourceFlags?: string[]
  poolIds?: string[]
  dailyEligible?: boolean
  reviewStatus?: 'verified' | 'machine_verified' | 'review_required' | 'rejected'
  matchConfidence?: number
  verifiedAt?: string | null
  legacyPopularityScore?: number
  legacySteamTags?: string[]
  recognitionSignals?: GameRecognitionSignals
  recognitionComponents?: Record<string, number | null>
  recognitionScore?: number
  cisScore?: number | null
  trendScore?: number | null
  guessabilityScore?: number
  scoreConfidence?: number
  scoreFormulaVersion?: string
  recognitionLevel?: 'mass' | 'mainstream' | 'cult_or_genre' | 'special_only' | 'reject'
  calibration?: GameRecognitionCalibration
  priceSnapshotAt?: string | null
  aliases?: string[]
  gameTier?: MusicGameTier | null
  contentStatus?: MusicContentStatus | null
  allowedInGame?: boolean
  musicType?: string | null
  musicIsActive?: boolean | null
  musicOrigin?: MusicOrigin | null
  topTracks?: MusicTopTrack[]
  topAlbums?: MusicTopAlbum[]
  similarArtists?: MusicSimilarArtist[]
  musicLinks?: string[]
  dataQuality?: {
    source: string[]
    verified: boolean
    missingFields: string[]
  }

  icd10?: string[]
  icdGroup?: string | null
  bodySystems?: string[]
  diseaseTypes?: string[]
  course?: string[]
  contagiousness?: string | null
  typicalAgeGroups?: string[]
  sex?: string | null
  localization?: string[]
  keySymptoms?: string[]
  diagnostics?: string[]
  riskFactors?: string[]
  severityTypical?: string | null
  urgencyTypical?: string | null
  safetyDisclaimer?: string | null

  country?: string
  countryFlagUrl?: string | null
  continent?: string
  languages?: string[]
  population?: number | null
  cityFlagUrl?: string | null
  coatOfArmsUrl?: string | null
  ranks?: {
    economy: number | null
    humanCapital: number | null
    qualityOfLife: number | null
    ecology: number | null
    governance: number | null
  }
  timezone?: string
  popular?: boolean
  capital?: boolean
}

export type CaseVignette = { id: string; text: string }
export type DiagnosisCaseVignettes = { diagnosisId: string; caseVignettes: CaseVignette[] }
export type CaseVignetteMap = Record<string, CaseVignette[]>

export type LibrarySearchDoc = {
  id: string
  titleRu: string | null
  titleOriginal: string | null
  alternativeTitles: string[]
  year: number | null
  topRank: number | null
  steamAppId: number | null
  icd10: string[]
}

export type LibrarySearchIndex = {
  version: number
  library: string
  generatedAt: string
  totalItems: number
  tokensCount: number
  docs: LibrarySearchDoc[]
  tokenToIds: Record<string, string[]>
}

export type MatchStatus = 'match' | 'close' | 'partial' | 'miss' | 'unknown'
export type Direction = 'up' | 'down' | null
export type HintPerson = Person & { matched?: boolean }
export type Hint = { key: string; label: string; value: string; status: MatchStatus; direction: Direction; people?: HintPerson[]; matchedValues?: string[] }
export type Attempt = { titleId: string; hints: Hint[] }
export type GameStatus = 'playing' | 'won' | 'lost'
export type SavedGame = {
  key: string
  mode: TitleMode
  variantKey?: string | null
  period: PeriodKey
  date: string
  answerId: string
  attempts: Attempt[]
  attemptTitleIds?: string[]
  status: GameStatus
  usedHints?: AssistHintKey[]
  hintChoices?: HintChoice[]
  dismissedHintRounds?: HintCheckpoint[]
  updatedAt: number
  schemaVersion?: number
  difficulty?: DifficultyKey
}
export type Stats = { played: number; won: number; currentStreak: number; bestStreak: number; distribution: number[] }
export type Wallet = { tickets: number; lifetimeTickets: number }
export type TicketLedgerEntry = {
  id: string
  at: number
  type: 'earn' | 'spend'
  amount: number
  balanceAfter: number
  title: string
  detail: string
  date?: string
  mode?: TitleMode
  period?: PeriodKey
}
export type DailyAttendance = {
  date: string
  completedModes: TitleMode[]
  wonModes: TitleMode[]
  completedSessions: string[]
  firstCompletedAt: number
  fullHouse: boolean
}
export type AttendanceStats = {
  currentDailyStreak: number
  bestDailyStreak: number
  lastCompletedDate: string | null
  gracePasses: number
  totalActiveDays: number
  fullHouseDays: number
}
export type PeriodUnlocks = Partial<Record<TitleMode, PeriodKey[]>>
