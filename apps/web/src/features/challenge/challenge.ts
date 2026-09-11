import type { DifficultyKey, PeriodKey, TitleMode } from '../../types'
import { GAME_MODE_MANIFEST, isCatalogGuessModeId, isPlayableModeId } from '@shoditsa/contracts'

const PERIODS = new Set<PeriodKey>(['all', 'from_1960', 'from_1980', 'from_1990', 'from_2000', 'from_2010', 'from_2020'])
const DIFFICULTIES = new Set<DifficultyKey>(['easy', 'medium', 'hard', 'expert', 'experimental'])
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const INSTALLATION_ID_KEY = 'seans:v1:installation-id'

export type ChallengePayload = {
  mode: TitleMode
  date: string
  period: PeriodKey
  difficulty?: DifficultyKey
  variantKey?: string
  opponentAttempts: ChallengeResult
  /** @deprecated Legacy sender IDs are neither shared nor retained. */
  from?: string
}

export type ChallengeOutcome = 'won' | 'lost' | 'tie'
export type ChallengeResult = number | 'f' | 'x'

const safeAttempts = (value: string | null): ChallengeResult | null => {
  if (value === 'f' || value === 'x') return value
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
  let difficulty = difficultyValue as DifficultyKey | null
  const variantKey = url.searchParams.get('variant')?.trim() || url.searchParams.get('pack')?.trim() || null
  const opponentAttempts = safeAttempts(url.searchParams.get('challenge'))
  if (!mode || !isPlayableModeId(mode) || !isCatalogGuessModeId(mode) || !date || !ISO_DATE.test(date) || !PERIODS.has(period) || !opponentAttempts) return null
  const timestamp = Date.parse(`${date}T00:00:00Z`)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) return null
  if (difficulty && !DIFFICULTIES.has(difficulty)) return null
  // Music snapshots historically repeat the difficulty in variantKey. It is
  // not a special pack: normalize old links to the explicit difficulty field.
  let variant = variantKey === '-' ? null : variantKey
  if (mode === 'music' && variant) {
    if (!DIFFICULTIES.has(variant as DifficultyKey) || (difficulty && difficulty !== variant)) return null
    difficulty = variant as DifficultyKey
    variant = null
  }
  // City is the only additional public catalog variant selector.
  if (variant && (mode !== 'city' || !(GAME_MODE_MANIFEST.city.variants as readonly { id: string }[]).some((item) => item.id === variant))) return null
  return { mode, date, period, ...(difficulty ? { difficulty } : {}), ...(variant ? { variantKey: variant } : {}), opponentAttempts }
}

export const challengeLandingPath = (payload: Pick<ChallengePayload, 'mode'>) => `/games/${payload.mode}`

export const buildChallengeUrl = (baseUrl: string, payload: ChallengePayload) => {
  const url = new URL(baseUrl, 'https://shoditsa.ru')
  // A recipient must never land on the sender's private game session.
  url.pathname = challengeLandingPath(payload)
  url.hash = ''
  url.search = ''
  url.searchParams.set('play', payload.mode)
  url.searchParams.set('date', payload.date)
  if (GAME_MODE_MANIFEST[payload.mode].periodPolicy === 'year' || payload.period !== 'all') {
    url.searchParams.set('period', payload.period)
  }
  const difficulty = payload.difficulty ?? (payload.mode === 'music' && DIFFICULTIES.has(payload.variantKey as DifficultyKey) ? payload.variantKey : undefined)
  if (difficulty) url.searchParams.set('difficulty', difficulty)
  if (payload.variantKey && payload.variantKey !== '-' && payload.mode !== 'music') url.searchParams.set('variant', payload.variantKey)
  url.searchParams.set('challenge', String(payload.opponentAttempts))
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

const challengeRank = (value: ChallengeResult) => value === 'f' ? 11 : value === 'x' ? 12 : value

export const challengeOutcome = (playerAttempts: ChallengeResult, opponentAttempts: ChallengeResult): ChallengeOutcome => {
  const playerRank = challengeRank(playerAttempts)
  const opponentRank = challengeRank(opponentAttempts)
  return playerRank < opponentRank ? 'won' : playerRank > opponentRank ? 'lost' : 'tie'
}

export const challengeResultLabel = (value: ChallengeResult) => value === 'f' ? 'Ф/10' : value === 'x' ? 'X/10' : `${value}/10`
