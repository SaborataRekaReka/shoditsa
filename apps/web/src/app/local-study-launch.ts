import { GAME_MODE_MANIFEST, isCatalogGuessModeId, type CatalogGuessModeId, type DifficultyKey, type PeriodKey } from '@shoditsa/contracts'
import { DIFFICULTY_ORDER, PERIODS } from '@shoditsa/game-core'

export function localStudyLaunchDate(search: string, today: string): string {
  const date = new URLSearchParams(search).get('date') ?? ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) return today
  const parsed = new Date(`${date}T12:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : today
}

/** Launch the real offline controller for every catalogue game, including anime. */
export function localStudyLaunchHref(mode: CatalogGuessModeId, options: { period: PeriodKey; difficulty: DifficultyKey; variant: string }) {
  const params = new URLSearchParams()
  if (GAME_MODE_MANIFEST[mode].periodPolicy === 'year' && options.period !== 'all') params.set('period', options.period)
  if (mode === 'music' && options.difficulty !== 'medium') params.set('difficulty', options.difficulty)
  if (mode === 'city' && options.variant !== 'capitals') params.set('variant', options.variant)
  return `/play/${mode}${params.size ? `?${params}` : ''}`
}

export function isStudySessionPresentation({ dev, local, study, source, search }: { dev: boolean; local: boolean; study: boolean; source: 'local' | 'server'; search: string }) {
  const mode = new URLSearchParams(search).get('studyMode')
  return dev && local && study && source === 'local' && !!mode && isCatalogGuessModeId(mode)
}

export function localStudyLaunchOptions(search: string, mode?: string) {
  const params = new URLSearchParams(search)
  if (!mode || !isCatalogGuessModeId(mode) || (params.has('studyMode') && params.get('studyMode') !== mode)) return undefined
  const period = (params.get('period') ?? params.get('studyPeriod')) as PeriodKey
  const difficulty = (params.get('difficulty') ?? params.get('studyDifficulty')) as DifficultyKey
  const variant = params.get('variant') ?? params.get('studyVariant')
  return {
    period: GAME_MODE_MANIFEST[mode].periodPolicy === 'year' && period in PERIODS ? period : 'all' as PeriodKey,
    difficulty: mode === 'music' && DIFFICULTY_ORDER.includes(difficulty) ? difficulty : 'medium' as DifficultyKey,
    variant: mode === 'city' && GAME_MODE_MANIFEST.city.variants.some(item => item.id === variant) ? variant : null,
  }
}
