import { Type, type Static } from '@sinclair/typebox'

export const CONNECTIONS_COLORS = ['yellow', 'green', 'blue', 'purple'] as const
export const CONNECTIONS_DIFFICULTIES = ['easy', 'medium', 'hard', 'expert'] as const

export type ConnectionsColor = typeof CONNECTIONS_COLORS[number]
export type ConnectionsDifficulty = typeof CONNECTIONS_DIFFICULTIES[number]

export type ConnectionsEditorial = {
  note?: string
  intendedTraps?: Array<{
    label: string
    words: [string, string, string, string]
  }>
  sources?: Array<{
    groupColor: ConnectionsColor
    url: string
    note?: string
  }>
  reviewedBy?: string
  reviewedAt?: string
}

export type ConnectionsRoundGroup = {
  color: ConnectionsColor
  title: string
  words: [string, string, string, string]
  hint?: string
}

export type ConnectionsRoundPayload = {
  id: string
  externalId?: string
  mode?: 'connections'
  titleRu?: string
  titleOriginal?: string
  alternativeTitles?: string[]
  schemaVersion?: 1
  locale?: string
  difficulty: ConnectionsDifficulty
  tiles: [
    string, string, string, string,
    string, string, string, string,
    string, string, string, string,
    string, string, string, string,
  ]
  groups: [
    ConnectionsRoundGroup,
    ConnectionsRoundGroup,
    ConnectionsRoundGroup,
    ConnectionsRoundGroup,
  ]
  contentStatus?: string
  allowedInGame?: boolean
  popularityScore?: number
  editorial?: ConnectionsEditorial
}

export type ConnectionsTileSnapshot = {
  id: string
  label: string
  initialPosition: number
}

export type ConnectionsSolvedGroupSnapshot = {
  color: ConnectionsColor
  title: string
  tiles: ConnectionsTileSnapshot[]
  autoSolved?: boolean
}

export type ConnectionsGuessSnapshot = {
  position: number
  tileIds: [string, string, string, string]
  result: 'correct' | 'wrong' | 'one_away'
  matchedColor?: ConnectionsColor
  colorRow?: [ConnectionsColor, ConnectionsColor, ConnectionsColor, ConnectionsColor]
}

export type ConnectionsHintSnapshot = {
  checkpoint: 1 | 3
  text: string
}

export type ConnectionsGameState = {
  tiles: ConnectionsTileSnapshot[]
  solvedGroups: ConnectionsSolvedGroupSnapshot[]
  guesses: ConnectionsGuessSnapshot[]
  hints: ConnectionsHintSnapshot[]
  mistakesUsed: number
  mistakesRemaining: number
  maxMistakes: 4
  maxGuesses: 6
  hintAvailableAt: 1 | 3 | null
  status: 'playing' | 'won' | 'lost'
}

export const ConnectionsGuessBodySchema = Type.Object({
  tileIds: Type.Tuple([
    Type.String({ minLength: 1, maxLength: 16 }),
    Type.String({ minLength: 1, maxLength: 16 }),
    Type.String({ minLength: 1, maxLength: 16 }),
    Type.String({ minLength: 1, maxLength: 16 }),
  ]),
}, { additionalProperties: false })

export const ConnectionsHintBodySchema = Type.Object({
  checkpoint: Type.Union([Type.Literal(1), Type.Literal(3)]),
}, { additionalProperties: false })

export type ConnectionsGuessBody = Static<typeof ConnectionsGuessBodySchema>
export type ConnectionsHintBody = Static<typeof ConnectionsHintBodySchema>
