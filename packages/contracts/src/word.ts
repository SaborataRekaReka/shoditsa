import { Type, type Static } from '@sinclair/typebox'

export const WORD_LAUNCH_DATE = '2026-10-26'
export const WORD_MAX_HINTS = 3

export type WordGuess = { position: number; word: string; rank: number; source: 'guess' | 'hint' }
export type WordGameState = {
  guesses: WordGuess[]
  vocabularySize: number
  attemptsCount: number
  hintsUsed: number
  hintsRemaining: number
  nextHintAt: number | null
  hintAvailable: boolean
  bestRank: number | null
  unlimitedAttempts: true
  status: 'playing' | 'won' | 'lost'
  answer?: string
}

export const WordActionBodySchema = Type.Union([
  Type.Object({ action: Type.Literal('guess'), word: Type.String({ minLength: 1, maxLength: 60 }) }, { additionalProperties: false }),
  Type.Object({ action: Type.Literal('hint') }, { additionalProperties: false }),
  Type.Object({ action: Type.Literal('give_up') }, { additionalProperties: false }),
])
export type WordActionBody = Static<typeof WordActionBodySchema>
export const normalizeWord = (value: string) => value.trim().normalize('NFC').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е')
export const wordTemperature = (rank: number) => rank === 1 ? 'Угадано' : rank <= 10 ? 'Совсем рядом' : rank <= 100 ? 'Горячо' : rank <= 1000 ? 'Тепло' : 'Пока далеко'
