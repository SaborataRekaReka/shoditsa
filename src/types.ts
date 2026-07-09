export type TitleMode = 'movie' | 'series' | 'anime' | 'game' | 'music' | 'diagnosis'
export type PeriodKey = 'all' | 'from_1960' | 'from_1980' | 'from_1990' | 'from_2000' | 'from_2010' | 'from_2020'
export type DifficultyKey = 'easy' | 'medium' | 'hard'
export type MusicOrigin = 'ru' | 'intl'

export type Person = { nameRu: string; nameOriginal: string; photoUrl?: string | null }
export type FilmAwards = { wins: number; nominations: number; notable: string[] }
export type AssistHintKey = 'plot' | 'slogan' | 'cast_main' | 'cast_secondary' | 'fact' | 'awards'
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
export type TitleItem = {
  id: string
  mode: TitleMode
  titleRu: string
  titleOriginal: string
  alternativeTitles: string[]
  year?: number
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
  awards?: FilmAwards | null
  topRank?: number | null
  externalRanks?: Record<string, number>
  notes?: string[]
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
