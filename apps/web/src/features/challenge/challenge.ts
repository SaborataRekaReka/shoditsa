import type { DifficultyKey, PeriodKey, TitleMode } from '../../types'

const MODES = new Set<TitleMode>(['movie', 'series', 'anime', 'game', 'music', 'diagnosis'])
const PERIODS = new Set<PeriodKey>(['all', 'from_1960', 'from_1980', 'from_1990', 'from_2000', 'from_2010', 'from_2020'])
const DIFFICULTIES = new Set<DifficultyKey>(['easy', 'medium', 'hard', 'expert', 'experimental'])
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const INSTALLATION_ID_KEY = 'seans:v1:installation-id'

export type ChallengePayload = {
  mode: TitleMode
  date: string
  period: PeriodKey
  difficulty?: DifficultyKey
  opponentAttempts: number
  from: string
}

export type ChallengeOutcome = 'won' | 'lost' | 'tie'

const safeAttempts = (value: string | null) => {
  const attempts = Number(value)
  return Number.isInteger(attempts) && attempts >= 1 && attempts <= 10 ? attempts : null
}

export const parseChallengeUrl = (input: string | URL): ChallengePayload | null => {
  let url: URL
  try {
    url = input instanceof URL ? input : new URL(input, 'https://shoditsa.ru')
  } catch {
    return null
  }
  const mode = url.searchParams.get('play') as TitleMode | null
  const date = url.searchParams.get('date')
  const period = (url.searchParams.get('period') ?? 'all') as PeriodKey
  const difficultyValue = url.searchParams.get('difficulty')
  const difficulty = difficultyValue as DifficultyKey | null
  const opponentAttempts = safeAttempts(url.searchParams.get('challenge'))
  const from = url.searchParams.get('from')?.trim()
  if (!mode || !MODES.has(mode) || !date || !ISO_DATE.test(date) || !PERIODS.has(period) || !opponentAttempts || !from) return null
  if (difficulty && !DIFFICULTIES.has(difficulty)) return null
  return { mode, date, period, ...(difficulty ? { difficulty } : {}), opponentAttempts, from: from.slice(0, 64) }
}

export const buildChallengeUrl = (baseUrl: string, payload: ChallengePayload) => {
  const url = new URL(baseUrl, 'https://shoditsa.ru')
  url.hash = ''
  url.search = ''
  url.searchParams.set('play', payload.mode)
  url.searchParams.set('date', payload.date)
  url.searchParams.set('period', payload.period)
  if (payload.difficulty) url.searchParams.set('difficulty', payload.difficulty)
  url.searchParams.set('challenge', String(payload.opponentAttempts))
  url.searchParams.set('from', payload.from)
  return url.toString()
}

export const getInstallationId = (storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage) => {
  const existing = storage.getItem(INSTALLATION_ID_KEY)
  if (existing) return existing
  const generated = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replaceAll('-', '').slice(0, 12)
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  storage.setItem(INSTALLATION_ID_KEY, generated)
  return generated
}

export const challengeOutcome = (playerAttempts: number, opponentAttempts: number): ChallengeOutcome => (
  playerAttempts < opponentAttempts ? 'won' : playerAttempts > opponentAttempts ? 'lost' : 'tie'
)
