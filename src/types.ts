export type TitleMode = 'movie' | 'series' | 'diagnosis'
export type PeriodKey = 'all' | 'from_1960' | 'from_1980' | 'from_1990' | 'from_2000' | 'from_2010' | 'from_2020'

export type Person = { nameRu: string; nameOriginal: string; photoUrl?: string | null }
export type FilmAwards = { wins: number; nominations: number; notable: string[] }
export type AssistHintKey = 'plot' | 'slogan' | 'cast_main' | 'cast_secondary' | 'fact' | 'awards'
export type HintCheckpoint = 5 | 8
export type HintChoice = { round: HintCheckpoint; key: AssistHintKey }
export type TitleRatings = {
  kinopoisk?: number | null
  imdb?: number | null
  gameDifficulty?: number | null
  recognizability?: number | null
}
export type TitleVotes = {
  kinopoisk?: number | null
  imdb?: number | null
  gamesPlayed?: number | null
  correctGuesses?: number | null
}
export type TitleItem = {
  id: string
  mode: TitleMode
  titleRu: string
  titleOriginal: string
  alternativeTitles: string[]
  year?: number
  endYear?: number | null
  countries?: string[]
  originalLanguage?: string
  genres?: string[]
  ageRating?: string | null
  runtimeMinutes?: number | null
  directors?: Person[]
  showrunners?: Person[]
  writers?: Person[]
  cast?: Person[]
  studios?: string[]
  kinopoiskId?: number | null
  imdbId?: string | null
  ratings?: TitleRatings
  votes?: TitleVotes
  popularityScore: number
  budget?: { amount: number; currency: string } | null
  posterUrl?: string | null
  backdropUrl?: string | null
  description?: string | null
  plotHint?: string | null
  slogan?: string | null
  supportingCast?: Person[]
  facts?: string[]
  awards?: FilmAwards | null
  topRank?: number | null

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

export type MatchStatus = 'match' | 'close' | 'partial' | 'miss' | 'unknown'
export type Direction = 'up' | 'down' | null
export type HintPerson = Person & { matched?: boolean }
export type Hint = { key: string; label: string; value: string; status: MatchStatus; direction: Direction; people?: HintPerson[]; matchedValues?: string[] }
export type Attempt = { titleId: string; hints: Hint[] }
export type GameStatus = 'playing' | 'won' | 'lost'
export type SavedGame = { key: string; mode: TitleMode; period: PeriodKey; date: string; answerId: string; attempts: Attempt[]; status: GameStatus; usedHints?: AssistHintKey[]; hintChoices?: HintChoice[]; dismissedHintRounds?: HintCheckpoint[]; updatedAt: number }
export type Stats = { played: number; won: number; currentStreak: number; bestStreak: number; distribution: number[] }
