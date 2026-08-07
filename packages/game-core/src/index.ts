import {
  ECONOMY_RULE_SET,
  ECONOMY_RULES_VERSION,
  GAME_MODE_MANIFEST,
  KPOP_ARTISTS_PACK_ID,
  economyEfficiencyReward,
  economyStreakMilestoneReward,
  type EconomyRuleSet,
  type Direction,
  type DifficultyKey,
  type Hint,
  type GameCompletionType,
  type LibrarySearchIndex,
  type MatchStatus,
  type PeriodKey,
  type Stats,
  type TitleItem,
  type TitleMode,
} from '@shoditsa/contracts'

export * from './connections.js'

export const PERIODS: Record<PeriodKey, { label: string; short: string; fromYear: number | null }> = {
  all: { label: 'Все годы', short: 'Весь экран', fromYear: null },
  from_1960: { label: 'С 1960 года', short: '1960+', fromYear: 1960 },
  from_1980: { label: 'С 1980 года', short: '1980+', fromYear: 1980 },
  from_1990: { label: 'С 1990 года', short: '1990+', fromYear: 1990 },
  from_2000: { label: 'С 2000 года', short: '2000+', fromYear: 2000 },
  from_2010: { label: 'С 2010 года', short: '2010+', fromYear: 2010 },
  from_2020: { label: 'С 2020 года', short: '2020+', fromYear: 2020 },
}

export const MUSIC_DATASET_VERSION = 'music-001-300-v1'

export const KPOP_GENERATION_RANGES = [
  { generation: 1, label: '1-е поколение', years: '1990-е — 2004' },
  { generation: 2, label: '2-е поколение', years: '2005–2011' },
  { generation: 3, label: '3-е поколение', years: '2012–2017' },
  { generation: 4, label: '4-е поколение', years: '2018–2022' },
  { generation: 5, label: '5-е поколение', years: '2023 — настоящее время' },
] as const

export const kpopGenerationForYear = (year: number | null | undefined): 1 | 2 | 3 | 4 | 5 | null => {
  if (!Number.isInteger(year)) return null
  if (Number(year) <= 2004) return 1
  if (Number(year) <= 2011) return 2
  if (Number(year) <= 2017) return 3
  if (Number(year) <= 2022) return 4
  return 5
}

export const kpopGenerationLabel = (generation: number | null | undefined) => (
  KPOP_GENERATION_RANGES.find((entry) => entry.generation === generation)?.label ?? 'Поколение не указано'
)

export const isKpopArtistCard = (
  item: Pick<TitleItem, 'mode' | 'cardType'>,
): item is Pick<TitleItem, 'mode' | 'cardType'> & { mode: 'music'; cardType: 'kpop_artist' } => (
  item.mode === 'music' && item.cardType === 'kpop_artist'
)

export const MUSIC_ID_REDIRECTS: Record<string, string> = {
  'music:036_эндшпиль': 'music:015_andy-panda',
  'music:118_karas': 'music:117_filatov',
}

export const MUSIC_TYPE_LABELS: Record<string, string> = {
  Person: 'Сольный исполнитель',
  Group: 'Группа',
  Project: 'Музыкальный проект',
  Unknown: 'Тип уточняется',
}

export const MUSIC_TIER_LABELS: Record<string, string> = {
  core: 'Очень известный',
  popular: 'Популярный',
  niche: 'Жанровый',
  discovery: 'Открытие',
  experimental: 'Экспериментальный',
}

// `experimental` остаётся в DifficultyKey для миграции старых сохранений, но больше
// не является отдельным режимом в интерфейсе.
export const DIFFICULTY_ORDER: DifficultyKey[] = ['easy', 'medium', 'hard', 'expert']
export const DIFFICULTIES: Record<DifficultyKey, { label: string; short: string; hint: string }> = {
  easy: {
    label: 'Лёгкий',
    short: 'Лёгко',
    hint: 'Мировые и национальные звезды',
  },
  medium: {
    label: 'Средний',
    short: 'Средне',
    hint: 'Известные современные и классические артисты',
  },
  hard: {
    label: 'Сложный',
    short: 'Сложно',
    hint: 'Жанровые исполнители',
  },
  expert: {
    label: 'Эксперт',
    short: 'Эксперт',
    hint: 'Редкие имена и необычные проекты',
  },
  experimental: {
    label: 'Эксперт',
    short: 'Эксперт',
    hint: 'Редкие имена и необычные проекты',
  },
}

const MUSIC_POOL_TIERS: Record<DifficultyKey, string[]> = {
  easy: ['core'],
  medium: ['core', 'popular'],
  hard: ['popular', 'niche'],
  expert: ['niche', 'discovery', 'experimental'],
  // Legacy: старые ссылки, сохранения и статистика с этим ключом используют
  // объединённый пул «Эксперт».
  experimental: ['niche', 'discovery', 'experimental'],
}

const MUSIC_STRICT_DIFFICULTIES = new Set<DifficultyKey>(['easy', 'medium', 'hard'])

const PINNED_MUSIC_DAILY: Array<{
  date: string
  datasetVersion: string
  difficulty: DifficultyKey
  answerId: string
}> = [
  {
    date: '2026-07-12',
    datasetVersion: MUSIC_DATASET_VERSION,
    difficulty: 'medium',
    answerId: 'music:010_adele',
  },
]

export const resolveMusicRedirectId = (value: string) => {
  const id = String(value ?? '').trim()
  if (!id) return ''
  return MUSIC_ID_REDIRECTS[id] ?? id
}

export const canonicalMusicId = (item: TitleItem) => {
  const canonical = String(item.canonicalId ?? '').trim()
  if (!canonical) return item.id
  return resolveMusicRedirectId(canonical)
}

export const musicTypeLabel = (value: string | null | undefined) => {
  const key = String(value ?? '').trim()
  if (!key) return MUSIC_TYPE_LABELS.Unknown
  return MUSIC_TYPE_LABELS[key] ?? key
}

export const musicOriginLabel = (value: string | null | undefined) => {
  if (value === 'ru') return 'Русскоязычная сцена'
  if (value === 'intl') return 'Международная сцена'
  return 'Сцена уточняется'
}

export const musicTierLabel = (value: string | null | undefined) => {
  const key = String(value ?? '').trim().toLocaleLowerCase('en-US')
  if (!key) return 'Уровень неизвестен'
  return MUSIC_TIER_LABELS[key] ?? key
}

export const musicCareerStatusLabel = (value: boolean | null | undefined) => {
  if (value == null) return 'Статус уточняется'
  return value ? 'Продолжает карьеру' : 'Завершил карьеру'
}

export const canUseAsArtistPortrait = (url?: string | null) => {
  if (!url) return false
  return !url.includes('ab67616d')
}

const uniqueBy = (items: TitleItem[], keyFn: (item: TitleItem) => string) => {
  const result = new Map<string, TitleItem>()
  for (const item of items) {
    const key = keyFn(item)
    const current = result.get(key)
    if (!current || item.id === key) {
      result.set(key, item)
    }
  }
  return [...result.values()]
}

export const musicActivityStartYear = (item: Pick<TitleItem, 'activityStartYear' | 'year'>) => {
  const value = item.activityStartYear ?? item.year
  return Number.isFinite(value) ? Number(value) : null
}

export const musicEligibilityIssues = (item: TitleItem) => [
  musicActivityStartYear(item) == null ? 'activityStartYear' : null,
  !(item.countries ?? []).length ? 'countries' : null,
  !(item.genres ?? []).length ? 'genres' : null,
  !item.musicType || normalize(item.musicType) === 'unknown' ? 'musicType' : null,
  item.musicIsActive == null ? 'musicIsActive' : null,
  !item.musicOrigin ? 'musicOrigin' : null,
].filter((value): value is string => Boolean(value))

const isDailyMusicReady = (item: TitleItem) =>
  item.contentStatus === 'ready'
  && Boolean(item.allowedInGame)
  && musicEligibilityIssues(item).length === 0
const isBlockedMusic = (item: TitleItem) => item.contentStatus === 'blocked'

export const musicDifficultyPool = (pool: TitleItem[], difficulty: DifficultyKey): TitleItem[] => {
  const tiers = MUSIC_POOL_TIERS[difficulty] ?? MUSIC_POOL_TIERS.medium
  const canonicalPool = uniqueBy(pool, (item) => canonicalMusicId(item))
  const tierPool = canonicalPool.filter((item) => tiers.includes(String(item.gameTier ?? '').toLocaleLowerCase('en-US')))

  const strictPool = tierPool.filter((item) => isDailyMusicReady(item))
  if (MUSIC_STRICT_DIFFICULTIES.has(difficulty)) return strictPool
  if (strictPool.length) return strictPool

  // В расширенных сложностях часть артистов намеренно помечена как limited, поэтому
  // используем fallback, но продолжаем исключать blocked.
  return tierPool.filter((item) => !isBlockedMusic(item))
}

export const getMoscowDate = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date)

export const prettyDate = (date: string) => new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit', month: 'long', timeZone: 'Europe/Moscow',
}).format(new Date(`${date}T12:00:00+03:00`))

const hashValue = (seed: string) => {
  let hash = 2166136261
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

const hashIndex = (seed: string, length: number) => hashValue(seed) % length

const isAnimatedEntry = (item: TitleItem) =>
  (item.genres ?? []).some((genre) => /мультфильм|аниме|animation|anime/i.test(genre))

const looksLikeFeatureFilm = (item: TitleItem) => {
  const runtime = item.runtimeMinutes ?? null
  const year = item.year ?? null
  const endYear = item.endYear ?? null
  const hasMultipleYears = typeof year === 'number' && typeof endYear === 'number' && endYear > year
  return Boolean(runtime && runtime >= 75 && !hasMultipleYears)
}

export const isPromoGameItem = (item: Pick<TitleItem, 'id' | 'mode' | 'contentStatus'>) =>
  item.mode === 'game' && (item.id.startsWith('promo:') || String(item.contentStatus ?? '') === 'promo_pack')

const normalizePlotHintText = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim()
const normalizePlotHintMatch = (value: unknown) => normalizePlotHintText(value)
  .toLocaleLowerCase('ru-RU')
  .replace(/й/g, '\uE000')
  .normalize('NFKD')
  .replace(/\p{M}+/gu, '')
  .replace(/\uE000/g, 'й')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()

export const plotHintLeaksAnswer = (
  item: Pick<TitleItem, 'plotHint' | 'titleRu' | 'titleOriginal'>,
) => {
  const normalizedHint = normalizePlotHintMatch(item.plotHint)
  return [item.titleRu, item.titleOriginal]
    .map(normalizePlotHintMatch)
    .some((title) => {
      if (title.length < 4) return false
      if (title.length >= 6) return normalizedHint.includes(title)
      return ` ${normalizedHint} `.includes(` ${title} `)
    })
}

export const isPlayableGamePlotHint = (
  item: Pick<TitleItem, 'plotHint' | 'titleRu' | 'titleOriginal'>,
) => {
  const hint = normalizePlotHintText(item.plotHint)
  if (hint.length < 30) return false
  if (/(?:\.\.\.|\u2026)\s*$/.test(hint)) return false
  if (/\[+\s*REDACTED\s*\]+|_KEEP_\d+_/i.test(hint)) return false
  if (/(?:json|undefined|null|nan|stack trace|exception|https?:\/\/|\bapi\b|\bid\s*[:=])/i.test(hint)) return false

  return !plotHintLeaksAnswer({ ...item, plotHint: hint })
}

export const playablePlotHints = (
  item: Pick<TitleItem, 'plotHint' | 'plotHintVariants' | 'titleRu' | 'titleOriginal'>,
) => {
  const result: string[] = []
  const seen = new Set<string>()
  for (const value of [item.plotHint, ...(item.plotHintVariants ?? [])]) {
    const hint = normalizePlotHintText(value)
    const key = normalizePlotHintMatch(hint)
    if (!hint || seen.has(key) || !isPlayableGamePlotHint({ ...item, plotHint: hint })) continue
    seen.add(key)
    result.push(hint)
  }
  return result
}

export const selectPlotHintVariant = (
  item: Pick<TitleItem, 'id' | 'plotHint' | 'plotHintVariants' | 'titleRu' | 'titleOriginal'>,
  seed: string,
) => {
  const variants = playablePlotHints(item)
  return variants.length ? variants[hashIndex(`plot-hint|${item.id}|${seed}`, variants.length)] : null
}

const isPublishableContentStatus = (status: TitleItem['contentStatus']) =>
  !['blocked', 'review', 'duplicate', 'promo_pack'].includes(String(status ?? ''))

export const isAllowedInRegularGame = (
  item: Pick<TitleItem, 'id' | 'mode' | 'contentStatus' | 'allowedInGame' | 'seasonsCount' | 'activityStartYear' | 'year' | 'countries' | 'genres' | 'musicType' | 'musicIsActive' | 'musicOrigin' | 'plotHint' | 'plotHintVariants' | 'titleRu' | 'titleOriginal'>,
) => {
  if (item.allowedInGame === false || isPromoGameItem(item) || !isPublishableContentStatus(item.contentStatus)) return false
  if (playablePlotHints(item).length === 0) return false
  if (item.mode === 'series') return Number.isInteger(item.seasonsCount) && Number(item.seasonsCount) > 0
  if (item.mode === 'music') return musicEligibilityIssues(item as TitleItem).length === 0
  return true
}

const isAllowedInMode = (item: TitleItem, mode: TitleMode) => {
  if (item.mode !== mode) return false
  if (!isAllowedInRegularGame(item)) return false
  if (mode !== 'series') return true

  if (isAnimatedEntry(item)) return false
  if (looksLikeFeatureFilm(item)) return false
  return true
}

export const poolFor = (titles: TitleItem[], mode: TitleMode, period: PeriodKey, variantKey: string | null = null) => {
  if (mode === 'music' && variantKey === KPOP_ARTISTS_PACK_ID) {
    return titles.filter((item) => isKpopArtistCard(item))
  }
  const from = PERIODS[period].fromYear
  const base = titles.filter((item) => {
    if (!isAllowedInMode(item, mode)) return false
    if (from === null) return true
    return typeof item.year === 'number' && item.year >= from
  })
  return GAME_MODE_RULES[mode].pool(base, variantKey)
}

const asDifficultyKey = (value: string): DifficultyKey => {
  if (value === 'experimental') return 'expert'
  return DIFFICULTY_ORDER.includes(value as DifficultyKey) ? value as DifficultyKey : 'medium'
}

const pickMusicDailyTitle = (pool: TitleItem[], period: PeriodKey, date: string, salt: number, variant: string) => {
  if (!pool.length) return null

  const difficulty = asDifficultyKey(variant)
  const canonicalPool = uniqueBy(pool, (item) => canonicalMusicId(item))
    .filter((item) => !isBlockedMusic(item))

  if (!canonicalPool.length) return null

  const pinned = PINNED_MUSIC_DAILY.find((entry) =>
    entry.date === date
    && entry.datasetVersion === MUSIC_DATASET_VERSION
    && entry.difficulty === difficulty,
  )

  if (pinned) {
    const pinnedId = resolveMusicRedirectId(pinned.answerId)
    const pinnedItem = canonicalPool.find((item) => canonicalMusicId(item) === pinnedId || item.id === pinnedId)
    if (pinnedItem) return pinnedItem
  }

  const seed = `seans|music|${period}|${date}|${salt}|${difficulty}|${MUSIC_DATASET_VERSION}`
  let bestItem = canonicalPool[0]
  let bestScore = Number.MAX_SAFE_INTEGER

  for (const item of canonicalPool) {
    const canonicalId = canonicalMusicId(item)
    const score = hashValue(`${seed}|${canonicalId}`)
    const shouldPromote = score < bestScore || (score === bestScore && canonicalId.localeCompare(canonicalMusicId(bestItem), 'ru-RU') < 0)
    if (shouldPromote) {
      bestItem = item
      bestScore = score
    }
  }

  return bestItem
}

export const dailyTitle = (pool: TitleItem[], mode: TitleMode, period: PeriodKey, date: string, salt = 0, variant = '') => {
  const safeSalt = Number.isFinite(salt) ? Math.trunc(salt) : 0
  if (mode === 'music') {
    return pickMusicDailyTitle(pool, period, date, safeSalt, variant)
  }
  const variantSuffix = variant ? `|${variant}` : ''
  return pool[hashIndex(`seans|${mode}|${period}|${date}|${safeSalt}${variantSuffix}`, pool.length)]
}

export const pickDailyVignette = <T,>(vignettes: T[], diagnosisId: string, date: string): T | null =>
  vignettes.length ? vignettes[hashIndex(`vignette|${diagnosisId}|${date}`, vignettes.length)] : null

export const normalizeArtistName = (value: string) => value
  .toLocaleLowerCase('ru-RU')
  .replace(/й/g, '\uE000')
  .normalize('NFKD')
  .replace(/\p{M}+/gu, '')
  .replace(/\uE000/g, 'й')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()

export const normalize = (value: string) => normalizeArtistName(value)

/**
 * Stable identity keys shared by validation, duplicate reporting and repair.
 * External catalog IDs win; title keys include the fields needed to distinguish
 * same-name works such as cities in different countries or release-scoped games.
 */
export const contentIdentityKeys = (item: TitleItem) => {
  const keys = new Set<string>()
  const add = (kind: string, value: unknown) => {
    const normalized = normalize(String(value ?? ''))
    if (normalized) keys.add(`${item.mode}:${kind}:${normalized}`)
  }
  add('canonical', item.canonicalId)
  add('canonical-game', item.canonicalGameId)
  add('kinopoisk', item.kinopoiskId)
  add('imdb', item.imdbId)
  add('shikimori', item.shikimoriId)
  add('steam', item.steamAppId)
  add('igdb', item.igdbId)
  add('thegamesdb', item.externalRanks?.thegamesdb)

  const titles = [item.titleRu, item.titleOriginal].map(normalize).filter(Boolean)
  const primaryTitle = normalize(item.titleRu || item.titleOriginal)
  const sequelToken = primaryTitle.split(' ').at(-1)
  const sequelDiscriminator = sequelToken && /^(?:[2-9]|ii|iii|iv|v|vi|vii|viii|ix)$/.test(sequelToken)
    ? `:part-${sequelToken}`
    : ''
  if (item.mode === 'city') {
    const country = normalize(item.country ?? '')
    if (country) for (const title of titles) keys.add(`${item.mode}:title-country:${title}:${country}`)
  } else if (item.mode === 'music') {
    const origin = normalize(item.musicOrigin ?? '')
    if (origin) for (const title of titles) keys.add(`${item.mode}:title-origin:${title}:${origin}`)
  } else if (item.mode !== 'diagnosis' && Number.isInteger(item.year)) {
    const release = item.mode === 'game' && item.releaseScope === 'release'
      ? `:${normalize(item.releaseLabel ?? '') || 'release'}`
      : ''
    for (const title of titles) keys.add(`${item.mode}:title-year:${title}:${item.year}${release}${sequelDiscriminator}`)
  }
  return [...keys]
}

export const contentDuplicateGroups = (items: TitleItem[]) => {
  const parents = items.map((_, index) => index)
  const find = (index: number): number => parents[index] === index ? index : (parents[index] = find(parents[index]))
  const unite = (left: number, right: number) => {
    const leftRoot = find(left)
    const rightRoot = find(right)
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot
  }
  const byKey = new Map<string, number>()
  items.forEach((item, index) => {
    for (const key of contentIdentityKeys(item)) {
      const existing = byKey.get(key)
      if (existing == null) byKey.set(key, index)
      else unite(existing, index)
    }
  })
  const groups = new Map<number, TitleItem[]>()
  items.forEach((item, index) => groups.set(find(index), [...(groups.get(find(index)) ?? []), item]))
  return [...groups.values()].filter((group) => group.length > 1)
}

/**
 * The single source of truth for names accepted by every catalog game.
 * `titleOriginal` covers English/original names, while the remaining fields
 * cover localized, editorial and imported alternative names.
 */
type SearchableTitleItem = Pick<
  TitleItem,
  'titleRu' | 'titleOriginal' | 'alternativeTitles' | 'aliases' | 'acceptedAnswers' | 'normalizedAnswers' | 'localizedTitles'
>

export const titleSearchNames = (item: SearchableTitleItem) => {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of [
    item.titleRu,
    item.titleOriginal,
    item.localizedTitles?.ru,
    item.localizedTitles?.en,
    ...(item.alternativeTitles ?? []),
    ...(item.aliases ?? []),
    ...(item.acceptedAnswers ?? []),
    ...(item.normalizedAnswers ?? []),
  ]) {
    const title = String(value ?? '').trim()
    const key = normalize(title)
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(title)
  }
  return result
}

export const isExactTitleSearchMatch = (
  query: string,
  item: SearchableTitleItem,
) => {
  const normalizedQuery = normalize(query)
  return Boolean(normalizedQuery) && titleSearchNames(item).some((name) => normalize(name) === normalizedQuery)
}

const queryTokens = (value: string) => normalize(value).split(/\s+/).filter((token) => token.length >= 2)

const candidateIdsFromIndex = (index: LibrarySearchIndex, query: string) => {
  const tokens = queryTokens(query)
  if (!tokens.length) return new Set<string>()

  const result = new Set<string>()
  const tokenEntries = Object.entries(index.tokenToIds)
  const maxCandidates = 500

  for (const token of tokens) {
    const exactIds = index.tokenToIds[token]
    if (exactIds) {
      for (const id of exactIds) {
        result.add(id)
        if (result.size >= maxCandidates) return result
      }
    }

    for (const [indexedToken, ids] of tokenEntries) {
      if (!indexedToken.startsWith(token)) continue
      for (const id of ids) {
        result.add(id)
        if (result.size >= maxCandidates) return result
      }
    }
  }

  return result
}

const distance = (a: string, b: string) => {
  const matrix = Array.from({ length: b.length + 1 }, (_, i) => [i])
  for (let j = 0; j <= a.length; j += 1) matrix[0][j] = j
  for (let i = 1; i <= b.length; i += 1) for (let j = 1; j <= a.length; j += 1) {
    matrix[i][j] = b[i - 1] === a[j - 1] ? matrix[i - 1][j - 1] : Math.min(matrix[i - 1][j - 1], matrix[i][j - 1], matrix[i - 1][j]) + 1
  }
  return matrix[b.length][a.length]
}

const searchIdentity = (item: TitleItem) => {
  const externalKeys = ['thegamesdb', 'kinopoisk', 'shikimori']
  for (const key of externalKeys) {
    const value = item.externalRanks?.[key]
    if (Number.isFinite(value)) return `${item.mode}:${key}:${value}`
  }
  if (Number.isFinite(item.kinopoiskId)) return `${item.mode}:kinopoisk:${item.kinopoiskId}`
  if (Number.isFinite(item.shikimoriId)) return `${item.mode}:shikimori:${item.shikimoriId}`
  if (Number.isFinite(item.steamAppId)) return `${item.mode}:steam:${item.steamAppId}`
  return `${item.mode}:title:${normalize(item.titleRu || item.titleOriginal)}:${item.year ?? ''}`
}

export const searchTitles = (pool: TitleItem[], query: string, excluded: Set<string>, searchIndex?: LibrarySearchIndex | null) => {
  const q = normalize(query)
  if (!q) return []

  const isMusicPool = pool.some((item) => item.mode === 'music')
  const canonicalById = new Map<string, string>()
  const canonicalItems = new Map<string, TitleItem>()

  if (isMusicPool) {
    for (const item of pool) {
      const canonicalId = canonicalMusicId(item)
      canonicalById.set(item.id, canonicalId)
      canonicalById.set(canonicalId, canonicalId)

      const current = canonicalItems.get(canonicalId)
      if (!current || item.id === canonicalId) {
        canonicalItems.set(canonicalId, item)
      }
    }
    for (const [fromId, toId] of Object.entries(MUSIC_ID_REDIRECTS)) {
      canonicalById.set(fromId, toId)
    }

    const rawQuery = String(query ?? '').trim()
    if (rawQuery.startsWith('music:')) {
      const redirected = resolveMusicRedirectId(rawQuery)
      const directItem = canonicalItems.get(redirected)
      if (directItem && !isBlockedMusic(directItem)) {
        const canonicalId = canonicalMusicId(directItem)
        const excludedId = canonicalById.get(resolveMusicRedirectId(rawQuery)) ?? canonicalId
        if (!excluded.has(excludedId)) return [directItem]
      }
    }
  }

  const excludedCanonical = isMusicPool
    ? new Set([...excluded].map((id) => canonicalById.get(resolveMusicRedirectId(id)) ?? resolveMusicRedirectId(id)))
    : excluded

  const candidateIds = !isMusicPool && searchIndex ? candidateIdsFromIndex(searchIndex, q) : new Set<string>()
  // The generated index is only an acceleration hint. It may be stale or come
  // from an older schema without aliases, so it must never become a hard
  // filter: doing so makes valid original/alternative names disappear.
  const candidatePool = candidateIds.size
    ? [
        ...pool.filter((item) => candidateIds.has(item.id)),
        ...pool.filter((item) => !candidateIds.has(item.id)),
      ]
    : pool

  const seenIdentities = new Set<string>()
  return candidatePool.map((item) => {
    const names = titleSearchNames(item).map(normalize)
    const exact = names.some((name) => name === q)
    const starts = names.some((name) => name.startsWith(q))
    const includes = names.some((name) => name.includes(q))
    const typo = q.length > 3 && names.some((name) => distance(name.slice(0, Math.max(q.length, 4)), q) <= (q.length > 7 ? 2 : 1))
    return { item, score: exact ? 0 : starts ? 1 : includes ? 2 : typo ? 3 : 99 }
  }).filter(({ item, score }) => {
    if (score >= 99) return false
    if (!isMusicPool) return !excluded.has(item.id)

    const canonicalId = canonicalMusicId(item)
    if (item.id !== canonicalId) return false
    if (isBlockedMusic(item)) return false
    return !excludedCanonical.has(canonicalId)
  })
    .sort((a, b) => a.score - b.score || a.item.titleRu.localeCompare(b.item.titleRu, 'ru-RU'))
    .filter(({ item }) => {
      const identity = searchIdentity(item)
      if (seenIdentities.has(identity)) return false
      seenIdentities.add(identity)
      return true
    })
    .slice(0, 8).map(({ item }) => item)
}

const UNAVAILABLE_COMPARISON_VALUES = new Set([
  'Нет данных',
  'Нет в Steam',
  'Не применимо',
  'Без оценки',
  'Без рейтинга',
  'Неизвестно',
  'Not available',
  'Not applicable',
  'Not rated',
  'Unrated',
  'Unknown',
  'N/A',
  'Null',
].map(normalize))

export const isKnownComparisonText = (value: string | null | undefined): value is string => {
  const normalized = normalize(String(value ?? ''))
  return Boolean(normalized) && !UNAVAILABLE_COMPARISON_VALUES.has(normalized)
}

const knownComparisonValues = (values: string[] | null | undefined) => (
  (values ?? []).map((value) => String(value ?? '').trim()).filter(isKnownComparisonText)
)

const knownComparisonText = (value: string | null | undefined) => (
  isKnownComparisonText(value) ? value.trim() : null
)

const setStatus = (guess: string[], answer: string[]): MatchStatus => {
  const comparableGuess = knownComparisonValues(guess)
  const comparableAnswer = knownComparisonValues(answer)
  if (!comparableGuess.length || !comparableAnswer.length) return 'unknown'
  const g = new Set(comparableGuess.map(normalize)); const a = new Set(comparableAnswer.map(normalize))
  const shared = [...g].filter((value) => a.has(value)).length
  return shared === g.size && shared === a.size ? 'match' : shared ? 'partial' : 'miss'
}
const scalar = (guess: string | null | undefined, answer: string | null | undefined): MatchStatus => {
  const comparableGuess = knownComparisonText(guess)
  const comparableAnswer = knownComparisonText(answer)
  if (!comparableGuess || !comparableAnswer) return 'unknown'
  return normalize(comparableGuess) === normalize(comparableAnswer) ? 'match' : 'miss'
}
const normalizeContagiousness = (value: string | null | undefined) => {
  if (!value) return value
  return value.replace(/^(заразность|contagiousness)\s*:\s*/i, '').trim()
}
type DirectionOptions = { lowerIsUp?: boolean }

const toFiniteNumber = (value: unknown): number | null => {
  if (value == null || value === '') return null
  const numberValue = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

const compareDirection = (guess: number, answer: number, options: DirectionOptions = {}): Direction => {
  if (guess === answer) return null
  if (options.lowerIsUp) return answer < guess ? 'up' : 'down'
  return answer > guess ? 'up' : 'down'
}

const numeric = (
  guess: number | null | undefined,
  answer: number | null | undefined,
  match: number,
  close: number,
  options: DirectionOptions = {},
): { status: MatchStatus; direction: Direction } => {
  const guessNumber = toFiniteNumber(guess)
  const answerNumber = toFiniteNumber(answer)
  if (guessNumber == null || answerNumber == null) return { status: 'unknown', direction: null }
  const delta = Math.abs(guessNumber - answerNumber)
  const nearThreshold = Math.max(match, close)
  return {
    status: delta === 0 ? 'match' : delta <= nearThreshold ? 'close' : 'miss',
    direction: delta === 0 ? null : compareDirection(guessNumber, answerNumber, options),
  }
}
const list = (values: string[]) => {
  const comparable = knownComparisonValues(values)
  return comparable.length ? comparable.join(', ') : 'Нет данных'
}
const countryCode = (value: string) => {
  const firstChunk = value.split(',')[0]?.trim().toUpperCase() ?? ''
  if (/^[A-Z]{2}$/.test(firstChunk)) return firstChunk
  const fallback = value.toUpperCase().match(/\b[A-Z]{2}\b/)
  return fallback?.[0] ?? null
}

const MUSIC_COUNTRY_LABELS: Record<string, string> = {
  AZ: 'Азербайджан',
  RU: 'Россия',
  GB: 'Великобритания',
  UK: 'Великобритания',
  US: 'США',
  UA: 'Украина',
  FR: 'Франция',
  DE: 'Германия',
  IT: 'Италия',
  ES: 'Испания',
  SE: 'Швеция',
  NO: 'Норвегия',
  DK: 'Дания',
  FI: 'Финляндия',
  CA: 'Канада',
  AU: 'Австралия',
  NZ: 'Новая Зеландия',
  JP: 'Япония',
  KR: 'Южная Корея',
  CN: 'Китай',
  IN: 'Индия',
  BR: 'Бразилия',
  AR: 'Аргентина',
  MX: 'Мексика',
  TR: 'Турция',
  PL: 'Польша',
}

const flagEmojiByCode = (code: string) => {
  const upperCode = code.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(upperCode)) return ''
  return String.fromCodePoint(...upperCode.split('').map((char) => 0x1f1e6 + char.charCodeAt(0) - 65))
}

export const localizeMusicCountry = (value: string) => {
  const code = countryCode(value)
  if (!code) return value
  let localizedRegion = ''
  try {
    localizedRegion = new Intl.DisplayNames(['ru'], { type: 'region' }).of(code) ?? ''
  } catch {
    localizedRegion = ''
  }
  const label = MUSIC_COUNTRY_LABELS[code] ?? (localizedRegion || value)
  const flag = flagEmojiByCode(code)
  return flag ? `${flag} ${label}` : label
}

const countryCodes = (values: string[]) => {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const code = countryCode(value)
    if (!code || seen.has(code)) continue
    seen.add(code)
    result.push(code)
  }
  return result
}
const people = (values: TitleItem['cast']) => list((values ?? []).map((person) => person.nameRu || person.nameOriginal).filter(Boolean))
const overlaps = (guess: string[], answer: string[]) => {
  const guessSet = new Set(knownComparisonValues(guess).map(normalize))
  return knownComparisonValues(answer).filter((value) => guessSet.has(normalize(value)))
}

export const canonicalMusicGenreLabel = (value: string) => {
  const key = normalize(value)
  const labels: Record<string, string> = {
    'pop': 'поп',
    'dance pop': 'дэнс-поп',
    'edm': 'электронная танцевальная музыка',
    'electronic': 'электронная музыка',
    'hip hop': 'хип-хоп',
    'rap': 'рэп',
    'trap': 'трэп',
    'rock': 'рок',
    'indie pop': 'инди-поп',
    'k pop': 'K-pop',
    'r b': 'R&B',
    'r and b': 'R&B',
    'rhythm and blues': 'R&B',
  }
  return labels[key] ?? value.trim()
}

export const formatRuCount = (count: number, one: string, few: string, many: string) => {
  const absolute = Math.abs(Math.trunc(count))
  const mod100 = absolute % 100
  const mod10 = absolute % 10
  const word = mod100 >= 11 && mod100 <= 14
    ? many
    : mod10 === 1
      ? one
      : mod10 >= 2 && mod10 <= 4
        ? few
        : many
  return `${count} ${word}`
}

export const formatDays = (count: number) => formatRuCount(count, 'день', 'дня', 'дней')
const formatNumber = (value: number | null | undefined) => value == null ? '—' : new Intl.NumberFormat('ru-RU').format(value)
const gameScore = (value: number | null | undefined) => value == null ? null : Math.round(value)
const ageNumber = (value: string | null | undefined) => {
  if (!value) return null
  const match = value.match(/(\d{1,2})/)
  if (!match) return null
  const num = Number(match[1])
  return Number.isFinite(num) ? num : null
}
const positiveNumber = (value: number | null | undefined) => value != null && value > 0 ? value : null
const distinctAnimeEpisodesAired = (episodesAired: number | null, episodes: number | null) => {
  if (episodesAired == null) return null
  return episodesAired === episodes ? null : episodesAired
}
const playerCountWord = (count: number) => {
  const mod100 = Math.abs(count) % 100
  const mod10 = mod100 % 10
  if (mod100 >= 11 && mod100 <= 14) return 'игроков'
  if (mod10 === 1) return 'игрок'
  if (mod10 >= 2 && mod10 <= 4) return 'игрока'
  return 'игроков'
}
const playerCountLabel = (count: number | null | undefined) => count == null ? '—' : `${count} ${playerCountWord(count)}`
const seasonCountWord = (count: number) => {
  const mod100 = Math.abs(count) % 100
  const mod10 = mod100 % 10
  if (mod100 >= 11 && mod100 <= 14) return 'сезонов'
  if (mod10 === 1) return 'сезон'
  if (mod10 >= 2 && mod10 <= 4) return 'сезона'
  return 'сезонов'
}
const seasonCountLabel = (count: number | null | undefined) => count == null ? '—' : `${count} ${seasonCountWord(count)}`
const playersCountFromCategory = (category: string) => {
  const text = normalize(category)
  const matches = [...text.matchAll(/\d{1,2}/g)]
  if (!matches.length || !/(игрок|player)/.test(text)) return null
  const numbers = matches.map((match) => Number(match[0])).filter((num) => Number.isFinite(num))
  if (!numbers.length) return null
  return Math.max(...numbers)
}
const playersNumber = (categories: string[]) => {
  let max: number | null = null
  for (const category of categories) {
    const count = playersCountFromCategory(category)
    if (count != null) {
      max = max == null ? count : Math.max(max, count)
      continue
    }

    const text = normalize(category)
    if (text.includes('одиноч') || text.includes('single-player') || text.includes('single player') || text === 'singleplayer') {
      max = max == null ? 1 : Math.max(max, 1)
      continue
    }
    if (text.includes('мульти') || text.includes('кооп') || text.includes('сетев') || text.includes('online') || text.includes('multiplayer') || text.includes('игрок') || text.includes('player')) {
      max = max == null ? 2 : Math.max(max, 2)
    }
  }
  return max
}

const displayedFieldAvailability = (item: TitleItem, field: string) => (
  item.dataQuality?.fieldAvailability?.[field] ?? null
)

const displayedUnavailableLabel = (item: TitleItem, field: string, fallback = 'Нет данных') => {
  const status = displayedFieldAvailability(item, field)
  if (status === 'not_on_steam') return 'Нет в Steam'
  if (status === 'not_applicable') return 'Не применимо'
  if (status === 'not_available') return 'Нет данных'
  if (status === 'not_rated') return 'Без оценки'
  if (status === 'unrated') return 'Без рейтинга'
  return fallback
}

const compareDisplayedValues = (
  guessValue: number | null,
  answerValue: number | null,
  numericComparison: { status: MatchStatus; direction: Direction },
) => guessValue != null && answerValue != null
  ? numericComparison
  : { status: 'unknown' as const, direction: null }

const reviewHint = (
  guess: number | null | undefined,
  answer: number | null | undefined,
  options: DirectionOptions = {},
): { status: MatchStatus; direction: Direction } => {
  const guessNumber = toFiniteNumber(guess)
  const answerNumber = toFiniteNumber(answer)
  if (guessNumber == null || answerNumber == null) return { status: 'unknown', direction: null }
  if (guessNumber === answerNumber) return { status: 'match', direction: null }
  const ratio = Math.max(guessNumber, answerNumber) / Math.max(1, Math.min(guessNumber, answerNumber))
  const direction = compareDirection(guessNumber, answerNumber, options)
  if (ratio <= 1.25) return { status: 'close', direction }
  if (ratio <= 2) return { status: 'partial', direction }
  return { status: 'miss', direction }
}

const animeScore = (item: TitleItem) => {
  if (item.shikimoriScore != null) return item.shikimoriScore
  if (item.ratings?.recognizability != null) return item.ratings.recognizability
  return null
}

const mergePeople = (...groups: (TitleItem['directors'] | undefined)[]) => {
  const result: NonNullable<TitleItem['cast']> = []
  const seen = new Set<string>()

  for (const group of groups) {
    for (const person of group ?? []) {
      const name = person.nameRu || person.nameOriginal
      const key = normalize(name || '')
      if (!key || seen.has(key)) continue
      seen.add(key)
      result.push(person)
    }
  }

  return result
}

const gamePriceLabel = (item: TitleItem) => {
  if (!item.price) return 'Нет данных'
  if (item.price.isFree) return 'Бесплатно'
  if (item.price.final != null) {
    const amount = item.price.final / 100
    const currency = String(item.price.currency ?? '').trim().toUpperCase()
    if (/^[A-Z]{3}$/.test(currency)) {
      try {
        return new Intl.NumberFormat('ru-RU', {
          style: 'currency',
          currency,
          maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
        }).format(amount)
      } catch {
        // Fall back to the legacy ruble display for unknown currency codes.
      }
    }
    return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(amount)} ₽`
  }
  return 'Платно'
}

type ComparableGamePrice =
  | { kind: 'free' }
  | { kind: 'amount'; final: number; currency: string }

const comparableGamePrice = (item: TitleItem): ComparableGamePrice | null => {
  if (!item.price) return null
  if (item.price.isFree) return { kind: 'free' }
  const final = toFiniteNumber(item.price.final)
  const currency = String(item.price.currency ?? '').trim().toUpperCase()
  if (final == null || !/^[A-Z]{3}$/.test(currency)) return null
  return { kind: 'amount', final, currency }
}

const gamePriceHint = (guess: TitleItem, answer: TitleItem): { status: MatchStatus; direction: Direction } => {
  const guessPrice = comparableGamePrice(guess)
  const answerPrice = comparableGamePrice(answer)
  if (!guessPrice || !answerPrice) return { status: 'unknown', direction: null }
  if (guessPrice.kind === 'free' && answerPrice.kind === 'free') return { status: 'match', direction: null }
  if (guessPrice.kind !== answerPrice.kind) return { status: 'miss', direction: null }
  if (guessPrice.kind !== 'amount' || answerPrice.kind !== 'amount' || guessPrice.currency !== answerPrice.currency) {
    return { status: 'unknown', direction: null }
  }
  const delta = Math.abs(guessPrice.final - answerPrice.final)
  return {
    status: delta === 0 ? 'match' : delta <= 35_000 ? 'close' : 'miss',
    direction: delta === 0 ? null : compareDirection(guessPrice.final, answerPrice.final),
  }
}

const compareDiagnoses = (guess: TitleItem, answer: TitleItem): Hint[] => {
  const guessBodySystems = knownComparisonValues(guess.bodySystems)
  const answerBodySystems = knownComparisonValues(answer.bodySystems)
  const guessDiseaseTypes = knownComparisonValues(guess.diseaseTypes)
  const answerDiseaseTypes = knownComparisonValues(answer.diseaseTypes)
  const guessCourse = knownComparisonValues(guess.course)
  const answerCourse = knownComparisonValues(answer.course)
  const guessAgeGroups = knownComparisonValues(guess.typicalAgeGroups)
  const answerAgeGroups = knownComparisonValues(answer.typicalAgeGroups)
  const guessLocalization = knownComparisonValues(guess.localization)
  const answerLocalization = knownComparisonValues(answer.localization)
  const guessSymptoms = knownComparisonValues(guess.keySymptoms)
  const answerSymptoms = knownComparisonValues(answer.keySymptoms)
  const guessDiagnostics = knownComparisonValues(guess.diagnostics)
  const answerDiagnostics = knownComparisonValues(answer.diagnostics)
  const guessRiskFactors = knownComparisonValues(guess.riskFactors)
  const answerRiskFactors = knownComparisonValues(answer.riskFactors)
  const guessContagiousness = knownComparisonText(normalizeContagiousness(guess.contagiousness))
  const answerContagiousness = knownComparisonText(normalizeContagiousness(answer.contagiousness))
  const guessIcd = knownComparisonValues([...(guess.icd10 ?? []), ...(guess.icdGroup ? [guess.icdGroup] : [])])
  const answerIcd = knownComparisonValues([...(answer.icd10 ?? []), ...(answer.icdGroup ? [answer.icdGroup] : [])])

  return [
    ...(answerBodySystems.length ? [{ key: 'body_systems', label: 'Система', value: list(guessBodySystems), status: setStatus(guessBodySystems, answerBodySystems), direction: null, matchedValues: overlaps(guessBodySystems, answerBodySystems) } satisfies Hint] : []),
    ...(answerDiseaseTypes.length ? [{ key: 'disease_types', label: 'Тип', value: list(guessDiseaseTypes), status: setStatus(guessDiseaseTypes, answerDiseaseTypes), direction: null, matchedValues: overlaps(guessDiseaseTypes, answerDiseaseTypes) } satisfies Hint] : []),
    ...(answerCourse.length ? [{ key: 'course', label: 'Течение', value: list(guessCourse), status: setStatus(guessCourse, answerCourse), direction: null, matchedValues: overlaps(guessCourse, answerCourse) } satisfies Hint] : []),
    ...(answerContagiousness ? [{ key: 'contagiousness', label: 'Заразность', value: guessContagiousness ?? 'Нет данных', status: scalar(guessContagiousness, answerContagiousness), direction: null } satisfies Hint] : []),
    ...(answerAgeGroups.length ? [{ key: 'typical_age', label: 'Возраст', value: list(guessAgeGroups), status: setStatus(guessAgeGroups, answerAgeGroups), direction: null, matchedValues: overlaps(guessAgeGroups, answerAgeGroups) } satisfies Hint] : []),
    ...(answerLocalization.length ? [{ key: 'localization', label: 'Локализация', value: list(guessLocalization), status: setStatus(guessLocalization, answerLocalization), direction: null, matchedValues: overlaps(guessLocalization, answerLocalization) } satisfies Hint] : []),
    ...(answerSymptoms.length ? [{ key: 'symptoms', label: 'Симптомы', value: list(guessSymptoms), status: setStatus(guessSymptoms, answerSymptoms), direction: null, matchedValues: overlaps(guessSymptoms, answerSymptoms) } satisfies Hint] : []),
    ...(answerDiagnostics.length ? [{ key: 'diagnostics', label: 'Диагностика', value: list(guessDiagnostics), status: setStatus(guessDiagnostics, answerDiagnostics), direction: null, matchedValues: overlaps(guessDiagnostics, answerDiagnostics) } satisfies Hint] : []),
    ...(answerRiskFactors.length ? [{ key: 'risk_factors', label: 'Факторы риска', value: list(guessRiskFactors), status: setStatus(guessRiskFactors, answerRiskFactors), direction: null, matchedValues: overlaps(guessRiskFactors, answerRiskFactors) } satisfies Hint] : []),
    ...(answerIcd.length ? [{ key: 'icd', label: 'МКБ', value: list(guessIcd), status: setStatus(guessIcd, answerIcd), direction: null, matchedValues: overlaps(guessIcd, answerIcd) } satisfies Hint] : []),
  ]
}

const compareScreenTitles = (guess: TitleItem, answer: TitleItem): Hint[] => {
  const guessCountries = knownComparisonValues(guess.countries)
  const answerCountries = knownComparisonValues(answer.countries)
  const guessGenres = knownComparisonValues(guess.genres)
  const answerGenres = knownComparisonValues(answer.genres)
  const guessCast = (guess.cast ?? []).filter((person) => isKnownComparisonText(person.nameRu || person.nameOriginal))
  const answerCast = (answer.cast ?? []).filter((person) => isKnownComparisonText(person.nameRu || person.nameOriginal))

  const year = numeric(guess.year, answer.year, 0, 2)
  const kp = numeric(guess.ratings?.kinopoisk, answer.ratings?.kinopoisk, 0.1, 0.3)
  const imdb = numeric(guess.ratings?.imdb, answer.ratings?.imdb, 0.1, 0.3)
  const runtime = numeric(guess.runtimeMinutes, answer.runtimeMinutes, 5, 15)
  const showRuntime = guess.mode !== 'series' && answer.mode !== 'series'
  const showSeriesMeta = guess.mode === 'series' && answer.mode === 'series'
  const guessSeasons = Number.isFinite(Number(guess.seasonsCount)) ? Number(guess.seasonsCount) : null
  const answerSeasons = Number.isFinite(Number(answer.seasonsCount)) ? Number(answer.seasonsCount) : null
  const seasons = numeric(guessSeasons, answerSeasons, 0, 1)
  const guessSeriesStatus = knownComparisonText(guess.seriesStatus)
  const answerSeriesStatus = knownComparisonText(answer.seriesStatus)
  const guessAgeRating = knownComparisonText(guess.ageRating)
  const answerAgeRating = knownComparisonText(answer.ageRating)

  const guessShowrunners = (guess.showrunners ?? []).filter((person) => isKnownComparisonText(person.nameRu || person.nameOriginal))
  const answerShowrunners = (answer.showrunners ?? []).filter((person) => isKnownComparisonText(person.nameRu || person.nameOriginal))
  const guessDirectors = (guess.directors ?? []).filter((person) => isKnownComparisonText(person.nameRu || person.nameOriginal))
  const answerDirectors = (answer.directors ?? []).filter((person) => isKnownComparisonText(person.nameRu || person.nameOriginal))
  const guessCreators = guess.mode === 'series' && guessShowrunners.length ? guessShowrunners : guessDirectors
  const answerCreators = answer.mode === 'series' && answerShowrunners.length ? answerShowrunners : answerDirectors

  const creatorsG = guessCreators.map((person) => person.nameRu || person.nameOriginal).filter(isKnownComparisonText)
  const creatorsA = answerCreators.map((person) => person.nameRu || person.nameOriginal).filter(isKnownComparisonText)
  const creatorNames = new Set(creatorsA.map(normalize))
  const castNames = new Set(answerCast.map((person) => normalize(person.nameRu || person.nameOriginal)))
  const matchedGenres = overlaps(guessGenres, answerGenres)

  const hints: Hint[] = [
    ...(answer.year != null ? [{ key: 'year', label: 'Год', value: guess.year != null ? String(guess.year) : '—', ...year } satisfies Hint] : []),
    ...(answerCountries.length ? [{ key: 'country', label: 'Страна', value: list(guessCountries), status: setStatus(guessCountries, answerCountries), direction: null, matchedValues: overlaps(guessCountries, answerCountries) } satisfies Hint] : []),
    ...(showSeriesMeta && answerSeriesStatus ? [{ key: 'series_status', label: 'Статус', value: guessSeriesStatus ?? '—', status: scalar(guessSeriesStatus, answerSeriesStatus), direction: null } satisfies Hint] : []),
    ...(showSeriesMeta && answerSeasons != null ? [{ key: 'seasons', label: 'Сезоны', value: seasonCountLabel(guessSeasons), ...seasons } satisfies Hint] : []),
    ...(answerGenres.length ? [{ key: 'genres', label: 'Жанры', value: list(guessGenres), status: setStatus(guessGenres, answerGenres), direction: null, matchedValues: matchedGenres } satisfies Hint] : []),
    ...(creatorsA.length ? [{
      key: 'creator',
      label: guess.mode === 'series' ? 'Авторы' : 'Режиссёр',
      value: list(creatorsG),
      status: setStatus(creatorsG, creatorsA),
      direction: null,
      people: guessCreators.map((person) => ({ ...person, matched: creatorNames.has(normalize(person.nameRu || person.nameOriginal)) })),
    } satisfies Hint] : []),
    ...(answerCast.length ? [{
      key: 'cast',
      label: 'Актёры',
      value: people(guessCast),
      status: setStatus(
        guessCast.map((person) => person.nameRu || person.nameOriginal),
        answerCast.map((person) => person.nameRu || person.nameOriginal),
      ),
      direction: null,
      people: guessCast.map((person) => ({ ...person, matched: castNames.has(normalize(person.nameRu || person.nameOriginal)) })),
    } satisfies Hint] : []),
    ...(answer.ratings?.kinopoisk != null ? [{ key: 'kp', label: 'Кинопоиск', value: guess.ratings?.kinopoisk?.toFixed(1) ?? '—', ...kp } satisfies Hint] : []),
    ...(answer.ratings?.imdb != null ? [{ key: 'imdb', label: 'IMDb', value: guess.ratings?.imdb?.toFixed(1) ?? '—', ...imdb } satisfies Hint] : []),
    ...(showRuntime && answer.runtimeMinutes != null ? [{ key: 'runtime', label: 'Хронометраж', value: guess.runtimeMinutes ? `${guess.runtimeMinutes} мин` : '—', ...runtime } satisfies Hint] : []),
    ...(answerAgeRating ? [{
      key: 'age',
      label: 'Возраст',
      value: guessAgeRating ?? 'Нет данных',
      status: scalar(guessAgeRating, answerAgeRating),
      direction: null,
    } satisfies Hint] : []),
  ]

  return hints
}

const compareAnimeTitles = (guess: TitleItem, answer: TitleItem): Hint[] => {
  const guessGenres = knownComparisonValues(guess.genres)
  const answerGenres = knownComparisonValues(answer.genres)
  const guessStudios = knownComparisonValues(guess.studios)
  const answerStudios = knownComparisonValues(answer.studios)
  const guessCast = (guess.cast ?? []).filter((person) => isKnownComparisonText(person.nameRu || person.nameOriginal))
  const answerCast = (answer.cast ?? []).filter((person) => isKnownComparisonText(person.nameRu || person.nameOriginal))
  const guessCreators = mergePeople(guess.directors, guess.showrunners, guess.writers)
    .filter((person) => isKnownComparisonText(person.nameRu || person.nameOriginal))
    .slice(0, 5)
  const answerCreators = mergePeople(answer.directors, answer.showrunners, answer.writers)
    .filter((person) => isKnownComparisonText(person.nameRu || person.nameOriginal))
    .slice(0, 5)

  const guessCreatorNames = guessCreators.map((person) => person.nameRu || person.nameOriginal).filter(isKnownComparisonText)
  const answerCreatorNames = answerCreators.map((person) => person.nameRu || person.nameOriginal).filter(isKnownComparisonText)
  const creatorSet = new Set(answerCreatorNames.map(normalize))
  const castSet = new Set(answerCast.map((person) => normalize(person.nameRu || person.nameOriginal)))
  const matchedGenres = overlaps(guessGenres, answerGenres)
  const matchedStudios = overlaps(guessStudios, answerStudios)

  const guessKind = knownComparisonText(guess.animeKindCode ?? guess.animeKind)
  const answerKind = knownComparisonText(answer.animeKindCode ?? answer.animeKind)
  const guessStatus = knownComparisonText(guess.animeStatusCode ?? guess.animeStatus ?? guess.seriesStatus)
  const answerStatus = knownComparisonText(answer.animeStatusCode ?? answer.animeStatus ?? answer.seriesStatus)
  const guessSource = knownComparisonText(guess.animeSourceCode ?? guess.animeSource)
  const answerSource = knownComparisonText(answer.animeSourceCode ?? answer.animeSource)
  const guessAgeRating = knownComparisonText(guess.ageRating)
  const answerAgeRating = knownComparisonText(answer.ageRating)
  const guessScore = animeScore(guess)
  const answerScore = animeScore(answer)

  const year = numeric(guess.year, answer.year, 0, 2)
  const rank = numeric(guess.topRank, answer.topRank, 0, 20, { lowerIsUp: true })
  const guessEpisodes = positiveNumber(guess.episodes)
  const answerEpisodes = positiveNumber(answer.episodes)
  const guessEpisodesAired = distinctAnimeEpisodesAired(positiveNumber(guess.animeEpisodesAired), guessEpisodes)
  const answerEpisodesAired = distinctAnimeEpisodesAired(positiveNumber(answer.animeEpisodesAired), answerEpisodes)
  const episodes = numeric(guessEpisodes, answerEpisodes, 0, 2)
  const episodesAired = numeric(guessEpisodesAired, answerEpisodesAired, 0, 2)
  const runtime = numeric(guess.runtimeMinutes, answer.runtimeMinutes, 2, 5)
  const score = numeric(guessScore, answerScore, 0.05, 0.2)

  const hasEpisodes = answerEpisodes != null
  const hasEpisodesAired = answerEpisodesAired != null
  const hasRuntime = answer.runtimeMinutes != null
  const hasStudios = answerStudios.length > 0
  const hasSource = Boolean(answerSource)
  const hasScore = answerScore != null
  const hasRank = answer.topRank != null
  const hasAge = Boolean(answerAgeRating)
  const hasCreators = answerCreatorNames.length > 0
  const hasCast = answerCast.length > 0

  const hints: Hint[] = [
    ...(answer.year != null ? [{ key: 'year', label: 'Год', value: guess.year != null ? String(guess.year) : '—', ...year } satisfies Hint] : []),
    ...(answerKind ? [{ key: 'anime_kind', label: 'Формат', value: guess.animeKind ?? guessKind ?? '—', status: scalar(guessKind, answerKind), direction: null } satisfies Hint] : []),
    ...(answerStatus ? [{ key: 'anime_status', label: 'Статус', value: guess.animeStatus ?? guess.seriesStatus ?? guessStatus ?? '—', status: scalar(guessStatus, answerStatus), direction: null } satisfies Hint] : []),
    ...(hasEpisodes ? [{ key: 'episodes', label: 'Эпизоды', value: guessEpisodes != null ? String(guessEpisodes) : '—', ...episodes } satisfies Hint] : []),
    ...(hasEpisodesAired ? [{ key: 'episodes_aired', label: 'Вышло серий', value: guessEpisodesAired != null ? String(guessEpisodesAired) : '—', ...episodesAired } satisfies Hint] : []),
    ...(hasRuntime ? [{ key: 'runtime', label: 'Длительность', value: guess.runtimeMinutes ? `${guess.runtimeMinutes} мин` : '—', ...runtime } satisfies Hint] : []),
    ...(answerGenres.length ? [{ key: 'genres', label: 'Жанры', value: list(guessGenres), status: setStatus(guessGenres, answerGenres), direction: null, matchedValues: matchedGenres } satisfies Hint] : []),
    ...(hasStudios ? [{ key: 'studio', label: 'Студия', value: list(guessStudios), status: setStatus(guessStudios, answerStudios), direction: null, matchedValues: matchedStudios } satisfies Hint] : []),
    ...(hasSource ? [{ key: 'anime_source', label: 'Первоисточник', value: guess.animeSource ?? guessSource ?? '—', status: scalar(guessSource, answerSource), direction: null } satisfies Hint] : []),
    ...(hasCreators ? [{
      key: 'creator',
      label: 'Авторы',
      value: list(guessCreatorNames),
      status: setStatus(guessCreatorNames, answerCreatorNames),
      direction: null,
      people: guessCreators.map((person) => ({ ...person, matched: creatorSet.has(normalize(person.nameRu || person.nameOriginal)) })),
    } satisfies Hint] : []),
    ...(hasCast ? [{
      key: 'cast',
      label: 'Сэйю',
      value: people(guessCast),
      status: setStatus(
        guessCast.map((person) => person.nameRu || person.nameOriginal),
        answerCast.map((person) => person.nameRu || person.nameOriginal),
      ),
      direction: null,
      people: guessCast.map((person) => ({ ...person, matched: castSet.has(normalize(person.nameRu || person.nameOriginal)) })),
    } satisfies Hint] : []),
    ...(hasScore ? [{ key: 'shiki', label: 'Shikimori', value: guessScore != null ? guessScore.toFixed(2) : '—', ...score } satisfies Hint] : []),
    ...(hasRank ? [{ key: 'rank', label: 'Популярность', value: guess.topRank != null ? `#${guess.topRank}` : '—', ...rank } satisfies Hint] : []),
    ...(hasAge ? [{ key: 'age', label: 'Возраст', value: guessAgeRating ?? 'Нет данных', status: scalar(guessAgeRating, answerAgeRating), direction: null } satisfies Hint] : []),
  ]

  return hints
}

const compareGames = (guess: TitleItem, answer: TitleItem): Hint[] => {
  const guessCountries = knownComparisonValues(guess.countries)
  const answerCountries = knownComparisonValues(answer.countries)
  const guessGenres = knownComparisonValues(guess.genres)
  const answerGenres = knownComparisonValues(answer.genres)
  const guessCategories = knownComparisonValues(guess.steamCategories)
  const answerCategories = knownComparisonValues(answer.steamCategories)
  const guessPlatforms = knownComparisonValues(guess.platforms)
  const answerPlatforms = knownComparisonValues(answer.platforms)
  const guessDevelopers = knownComparisonValues(guess.developers)
  const answerDevelopers = knownComparisonValues(answer.developers)
  const guessPublishers = knownComparisonValues(guess.publishers)
  const answerPublishers = knownComparisonValues(answer.publishers)
  const guessSteamPositive = gameScore(guess.ratings?.steamPositivePercent)
  const answerSteamPositive = gameScore(answer.ratings?.steamPositivePercent)
  const guessMeta = gameScore(guess.ratings?.metacritic ?? guess.metacritic)
  const answerMeta = gameScore(answer.ratings?.metacritic ?? answer.metacritic)
  const guessPlayers = playersNumber(guessCategories)
  const answerPlayers = playersNumber(answerCategories)
  const guessAgeRating = knownComparisonText(guess.ageRating)
  const answerAgeRating = knownComparisonText(answer.ageRating)
  const guessAge = ageNumber(guessAgeRating)
  const answerAge = ageNumber(answerAgeRating)
  const guessPlayerLabel = displayedUnavailableLabel(guess, 'steamCategories')
  const guessSteamLabel = displayedUnavailableLabel(guess, 'steamRating')
  const guessMetacriticLabel = displayedUnavailableLabel(guess, 'metacritic')
  const guessReviewsLabel = displayedUnavailableLabel(guess, 'steamReviews')

  const year = numeric(guess.year, answer.year, 0, 2)
  const rank = numeric(guess.topRank, answer.topRank, 0, 15, { lowerIsUp: true })
  const players = compareDisplayedValues(
    guessPlayers,
    answerPlayers,
    numeric(guessPlayers, answerPlayers, 0, 2),
  )
  const steamPositive = compareDisplayedValues(
    guessSteamPositive,
    answerSteamPositive,
    numeric(guessSteamPositive, answerSteamPositive, 1, 5),
  )
  const metacritic = compareDisplayedValues(
    guessMeta,
    answerMeta,
    numeric(guessMeta, answerMeta, 1, 5),
  )
  const guessReviews = positiveNumber(guess.votes?.steamReviews)
  const answerReviews = positiveNumber(answer.votes?.steamReviews)
  const reviews = compareDisplayedValues(
    guessReviews,
    answerReviews,
    reviewHint(guessReviews, answerReviews),
  )
  const price = gamePriceHint(guess, answer)
  const age = guessAge != null || answerAge != null
    ? numeric(guessAge, answerAge, 0, 2)
    : { status: scalar(guessAgeRating, answerAgeRating), direction: null }
  const hasGenres = answerGenres.length > 0
  const hasCountries = answerCountries.length > 0
  const hasPlatforms = answerPlatforms.length > 0
  const hasDevelopers = answerDevelopers.length > 0
  const hasPublishers = answerPublishers.length > 0
  const hasPlayers = answerPlayers != null
  const hasSteamPositive = answerSteamPositive != null
  const hasMetacritic = answerMeta != null
  const hasReviews = answerReviews != null
  const hasPrice = comparableGamePrice(answer) != null
  const hasAge = Boolean(answerAgeRating)

  const hints: Hint[] = [
    ...(answer.year != null ? [{ key: 'year', label: 'Год', value: guess.year != null ? String(guess.year) : '—', ...year } satisfies Hint] : []),
    ...(answer.topRank != null ? [{ key: 'rank', label: 'Место в топе', value: guess.topRank != null ? `#${guess.topRank}` : '—', ...rank } satisfies Hint] : []),
    ...(hasPlayers ? [{ key: 'players', label: 'Игроки', value: guessPlayers != null ? playerCountLabel(guessPlayers) : guessPlayerLabel, ...players } satisfies Hint] : []),
    ...(hasCountries ? [{ key: 'country', label: 'Страна разработки', value: list(guessCountries), status: setStatus(guessCountries, answerCountries), direction: null, matchedValues: overlaps(guessCountries, answerCountries) } satisfies Hint] : []),
    ...(hasGenres ? [{ key: 'genres', label: 'Жанры', value: list(guessGenres), status: setStatus(guessGenres, answerGenres), direction: null, matchedValues: overlaps(guessGenres, answerGenres) } satisfies Hint] : []),
    ...(hasPlatforms ? [{ key: 'platforms', label: 'Платформы', value: list(guessPlatforms), status: setStatus(guessPlatforms, answerPlatforms), direction: null, matchedValues: overlaps(guessPlatforms, answerPlatforms) } satisfies Hint] : []),
    ...(hasDevelopers ? [{ key: 'developer', label: 'Разработчик', value: list(guessDevelopers), status: setStatus(guessDevelopers, answerDevelopers), direction: null, matchedValues: overlaps(guessDevelopers, answerDevelopers) } satisfies Hint] : []),
    ...(hasPublishers ? [{ key: 'publisher', label: 'Издатель', value: list(guessPublishers), status: setStatus(guessPublishers, answerPublishers), direction: null, matchedValues: overlaps(guessPublishers, answerPublishers) } satisfies Hint] : []),
    ...(hasSteamPositive ? [{ key: 'steam_positive', label: 'Позитив Steam', value: guessSteamPositive != null ? `${guessSteamPositive}%` : guessSteamLabel, ...steamPositive } satisfies Hint] : []),
    ...(hasMetacritic ? [{ key: 'metacritic', label: 'Metacritic', value: guessMeta != null ? formatNumber(guessMeta) : guessMetacriticLabel, ...metacritic } satisfies Hint] : []),
    ...(hasReviews ? [{ key: 'reviews', label: 'Отзывы Steam', value: guessReviews != null ? formatNumber(guessReviews) : guessReviewsLabel, ...reviews } satisfies Hint] : []),
    ...(hasPrice ? [{ key: 'price', label: 'Цена', value: guess.price ? gamePriceLabel(guess) : displayedUnavailableLabel(guess, 'price'), ...price } satisfies Hint] : []),
    ...(hasAge ? [{ key: 'age', label: 'Возраст', value: guessAgeRating ?? displayedUnavailableLabel(guess, 'ageRating'), ...age } satisfies Hint] : []),
  ]

  return hints
}

const decadeFromYear = (year: number | null | undefined) => {
  if (year == null || !Number.isFinite(year)) return null
  return Math.floor(year / 10) * 10
}

const compareKpopArtists = (guess: TitleItem, answer: TitleItem): Hint[] => {
  const debutYear = numeric(guess.activityStartYear, answer.activityStartYear, 0, 1)
  const generation = numeric(guess.kpopGeneration, answer.kpopGeneration, 0, 0)
  const debutMembers = numeric(guess.kpopDebutMembers, answer.kpopDebutMembers, 0, 1)
  const guessPerformerType = knownComparisonText(guess.kpopPerformerType)
  const answerPerformerType = knownComparisonText(answer.kpopPerformerType)
  const guessGender = knownComparisonText(guess.kpopGender)
  const answerGender = knownComparisonText(answer.kpopGender)
  const guessCurrentLabel = knownComparisonText(guess.kpopCurrentLabel)
  const answerCurrentLabel = knownComparisonText(answer.kpopCurrentLabel)
  const guessActivityStatus = knownComparisonText(guess.kpopActivityStatus)
  const answerActivityStatus = knownComparisonText(answer.kpopActivityStatus)
  const generationValue = guess.kpopGeneration
    ? `${kpopGenerationLabel(guess.kpopGeneration)} · ${KPOP_GENERATION_RANGES[guess.kpopGeneration - 1]?.years ?? ''}`
    : 'Нет данных'

  return [
    ...(answer.activityStartYear != null ? [{
      key: 'kpop_debut_year',
      label: 'Год дебюта',
      value: guess.activityStartYear != null ? String(guess.activityStartYear) : 'Нет данных',
      ...debutYear,
    } satisfies Hint] : []),
    ...(answer.kpopGeneration != null ? [{
      key: 'kpop_generation',
      label: 'Поколение K-pop',
      value: generationValue,
      ...generation,
    } satisfies Hint] : []),
    ...(answerPerformerType ? [{
      key: 'kpop_performer_type',
      label: 'Тип исполнителя',
      value: guessPerformerType || 'Нет данных',
      status: scalar(guessPerformerType, answerPerformerType),
      direction: null,
    } satisfies Hint] : []),
    ...(answerGender ? [{
      key: 'kpop_gender',
      label: 'Пол',
      value: guessGender || 'Нет данных',
      status: scalar(guessGender, answerGender),
      direction: null,
    } satisfies Hint] : []),
    ...(answerCurrentLabel ? [{
      key: 'kpop_current_label',
      label: 'Текущий корейский лейбл',
      value: guessCurrentLabel || 'Нет данных',
      status: scalar(guessCurrentLabel, answerCurrentLabel),
      direction: null,
    } satisfies Hint] : []),
    ...(answer.kpopDebutMembers != null ? [{
      key: 'kpop_debut_members',
      label: 'Участников на дебюте',
      value: guess.kpopDebutMembers != null ? String(guess.kpopDebutMembers) : 'Нет данных',
      ...debutMembers,
    } satisfies Hint] : []),
    ...(answerActivityStatus ? [{
      key: 'kpop_activity_status',
      label: 'Статус активности',
      value: guessActivityStatus || 'Нет данных',
      status: scalar(guessActivityStatus, answerActivityStatus),
      direction: null,
    } satisfies Hint] : []),
  ]
}

const compareMusic = (guess: TitleItem, answer: TitleItem): Hint[] => {
  if (isKpopArtistCard(guess) && isKpopArtistCard(answer)) return compareKpopArtists(guess, answer)

  const guessCountryCodes = countryCodes(knownComparisonValues(guess.countries))
  const answerCountryCodes = countryCodes(knownComparisonValues(answer.countries))
  const guessCountries = guessCountryCodes.map(localizeMusicCountry)
  const answerCountries = answerCountryCodes.map(localizeMusicCountry)

  const guessGenres = knownComparisonValues(guess.genres).map(canonicalMusicGenreLabel)
  const answerGenres = knownComparisonValues(answer.genres).map(canonicalMusicGenreLabel)
  const guessMusicType = knownComparisonText(guess.musicType)
  const answerMusicType = knownComparisonText(answer.musicType)
  const guessTypeLabel = musicTypeLabel(guessMusicType)
  const answerTypeLabel = musicTypeLabel(answerMusicType)
  const guessOrigin = knownComparisonText(guess.musicOrigin)
  const answerOrigin = knownComparisonText(answer.musicOrigin)
  const guessScene = musicOriginLabel(guessOrigin)
  const guessActive = guess.musicIsActive
  const answerActive = answer.musicIsActive

  const guessActivityStartYear = musicActivityStartYear(guess)
  const answerActivityStartYear = musicActivityStartYear(answer)
  const guessDecade = decadeFromYear(guessActivityStartYear)
  const answerDecade = decadeFromYear(answerActivityStartYear)
  const decadeHint = numeric(guessDecade, answerDecade, 0, 0)

  const guessSimilar = (guess.similarArtists ?? []).map((artist) => artist.name).filter(isKnownComparisonText)
  const answerSimilar = (answer.similarArtists ?? []).map((artist) => artist.name).filter(isKnownComparisonText)

  const activityStartYear = numeric(guessActivityStartYear, answerActivityStartYear, 0, 2)
  const hasActivityStart = answerActivityStartYear != null
  const activeStatus = scalar(
    guessActive == null ? null : guessActive ? 'active' : 'inactive',
    answerActive == null ? null : answerActive ? 'active' : 'inactive',
  )

  const hints: Hint[] = [
    ...(hasActivityStart ? [{ key: 'activity_start_year', label: 'Начало деятельности', value: guessActivityStartYear != null ? String(guessActivityStartYear) : '—', ...activityStartYear } satisfies Hint] : []),
    ...(hasActivityStart ? [{
      key: 'decade',
      label: 'Десятилетие',
      value: guessDecade != null ? `${guessDecade}-е` : '—',
      ...decadeHint,
    } satisfies Hint] : []),
    ...(answerCountryCodes.length ? [{
      key: 'country',
      label: 'Страна',
      value: list(guessCountries),
      status: setStatus(guessCountryCodes, answerCountryCodes),
      direction: null,
      matchedValues: overlaps(guessCountries, answerCountries),
    } satisfies Hint] : []),
    ...(answerGenres.length ? [{
      key: 'genres',
      label: 'Жанры',
      value: list(guessGenres),
      status: setStatus(guessGenres, answerGenres),
      direction: null,
      matchedValues: overlaps(guessGenres, answerGenres),
    } satisfies Hint] : []),
    ...(answerMusicType ? [{
      key: 'music_type',
      label: 'Тип артиста',
      value: guessTypeLabel,
      status: scalar(guessTypeLabel, answerTypeLabel),
      direction: null,
    } satisfies Hint] : []),
    ...(answerActive != null ? [{
      key: 'music_active',
      label: 'Карьера',
      value: musicCareerStatusLabel(guessActive),
      status: activeStatus,
      direction: null,
    } satisfies Hint] : []),
    ...(answerOrigin ? [{
      key: 'music_origin',
      label: 'Сцена',
      value: guessScene,
      status: scalar(guessOrigin, answerOrigin),
      direction: null,
    } satisfies Hint] : []),
    ...(answerSimilar.length ? [{
      key: 'similar_artists',
      label: 'Похожие артисты',
      value: list(guessSimilar),
      status: setStatus(guessSimilar, answerSimilar),
      direction: null,
      matchedValues: overlaps(guessSimilar, answerSimilar),
    } satisfies Hint] : []),
  ]

  return hints
}

export type CityPoolMode = 'capitals' | 'capitals-popular' | 'all'

export const cityPoolMode = (value: string | null | undefined): CityPoolMode => (
  value === 'capitals' || value === 'capitals-popular' || value === 'all' ? value : 'capitals'
)

const filterCityPool = (items: TitleItem[], variantKey: string | null) => {
  const variant = cityPoolMode(variantKey)
  if (variant === 'capitals') return items.filter((item) => item.capital === true)
  if (variant === 'capitals-popular') return items.filter((item) => item.capital === true || item.popular === true)
  return items
}

const cityScalarStatus = (guess: string, answer: string): MatchStatus => {
  return scalar(guess, answer)
}

const cityListStatus = (guess: string[], answer: string[]): MatchStatus => {
  return setStatus(guess, answer)
}

const cityNumberHint = (
  key: string,
  label: string,
  guess: number | null,
  answer: number | null,
  format: (value: number) => string,
  matchDelta: number,
  closeDelta: number,
  lowerIsUp = false,
): Hint => {
  if (guess == null || answer == null) return { key, label, value: 'Нет данных', status: 'unknown', direction: null }
  const delta = Math.abs(guess - answer)
  const status: MatchStatus = delta === 0 ? 'match' : delta <= Math.max(matchDelta, closeDelta) ? 'close' : 'miss'
  const direction = status === 'match' ? null : lowerIsUp ? (answer < guess ? 'up' : 'down') : (answer > guess ? 'up' : 'down')
  return { key, label, value: format(guess), status, direction }
}

const cityTimezoneHours = (value: string) => {
  const match = String(value ?? '').match(/GMT\s*([+-])(\d{1,2})(?::(\d{2}))?/i)
  if (!match) return null
  const hours = Number(match[2]) + Number(match[3] ?? 0) / 60
  return match[1] === '-' ? -hours : hours
}

const cityPopulationHint = (guess: number | null, answer: number | null): Hint => {
  if (guess == null || answer == null) return { key: 'population', label: 'Население', value: 'Нет данных', status: 'unknown', direction: null }
  const relativeDelta = Math.abs(guess - answer) / Math.max(answer, 1)
  const status: MatchStatus = guess === answer ? 'match' : relativeDelta <= 0.2 ? 'close' : 'miss'
  return {
    key: 'population', label: 'Население', value: new Intl.NumberFormat('ru-RU').format(guess), status,
    direction: status === 'match' ? null : answer > guess ? 'up' : 'down',
  }
}

export const compareCities = (guess: TitleItem, answer: TitleItem): Hint[] => {
  const guessRanks = guess.ranks
  const answerRanks = answer.ranks
  const guessCountry = knownComparisonText(guess.country)
  const answerCountry = knownComparisonText(answer.country)
  const guessContinent = knownComparisonText(guess.continent)
  const answerContinent = knownComparisonText(answer.continent)
  const guessLanguages = knownComparisonValues(guess.languages)
  const answerLanguages = knownComparisonValues(answer.languages)
  const rank = (key: keyof NonNullable<TitleItem['ranks']>, label: string) => cityNumberHint(
    key, label, guessRanks?.[key] ?? null, answerRanks?.[key] ?? null, (value) => `№ ${value}`, 10, 50, true,
  )
  return [
    ...(answerCountry ? [{ key: 'country', label: 'Страна', value: guessCountry || 'Нет данных', status: cityScalarStatus(guessCountry ?? '', answerCountry), direction: null } satisfies Hint] : []),
    ...(answerContinent ? [{ key: 'continent', label: 'Континент', value: guessContinent || 'Нет данных', status: cityScalarStatus(guessContinent ?? '', answerContinent), direction: null } satisfies Hint] : []),
    ...(answerLanguages.length ? [{ key: 'languages', label: 'Языки', value: list(guessLanguages), status: cityListStatus(guessLanguages, answerLanguages), direction: null, matchedValues: overlaps(guessLanguages, answerLanguages) } satisfies Hint] : []),
    ...(answer.population != null ? [cityPopulationHint(guess.population ?? null, answer.population)] : []),
    ...(cityTimezoneHours(answer.timezone ?? '') != null ? [cityNumberHint('timezone', 'Часовой пояс', cityTimezoneHours(guess.timezone ?? ''), cityTimezoneHours(answer.timezone ?? ''), () => guess.timezone || 'Нет данных', 0.25, 2)] : []),
    ...(answerRanks?.economy != null ? [rank('economy', 'Экономика')] : []),
    ...(answerRanks?.humanCapital != null ? [rank('humanCapital', 'Человеческий капитал')] : []),
    ...(answerRanks?.qualityOfLife != null ? [rank('qualityOfLife', 'Качество жизни')] : []),
    ...(answerRanks?.ecology != null ? [rank('ecology', 'Экология')] : []),
    ...(answerRanks?.governance != null ? [rank('governance', 'Работа властей')] : []),
  ]
}

const animalMassHint = (guess: number | null | undefined, answer: number | null | undefined): Hint => {
  const guessMass = Number(guess)
  const answerMass = Number(answer)
  if (!Number.isFinite(guessMass) || guessMass <= 0 || !Number.isFinite(answerMass) || answerMass <= 0) {
    return { key: 'body_mass', label: 'Масса', value: 'Нет данных', status: 'unknown', direction: null }
  }
  const ratio = Math.max(guessMass, answerMass) / Math.min(guessMass, answerMass)
  const status: MatchStatus = ratio <= 1.1 ? 'match' : ratio <= 2.5 ? 'close' : 'miss'
  const formatMass = (value: number) => value >= 1000
    ? `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value / 1000)} т`
    : value >= 1
      ? `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value)} кг`
      : `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value * 1000)} г`
  return {
    key: 'body_mass',
    label: 'Масса',
    value: formatMass(guessMass),
    status,
    direction: status === 'match' ? null : answerMass > guessMass ? 'up' : 'down',
  }
}

export const compareAnimals = (guess: TitleItem, answer: TitleItem): Hint[] => {
  const scalarHint = (key: string, label: string, guessValue: string | null | undefined, answerValue: string | null | undefined): Hint => ({
    key,
    label,
    value: knownComparisonText(guessValue) ?? 'Нет данных',
    status: scalar(guessValue, answerValue),
    direction: null,
  })
  const listHint = (key: string, label: string, guessValues: string[] | undefined, answerValues: string[] | undefined): Hint => {
    const comparableGuess = knownComparisonValues(guessValues)
    const comparableAnswer = knownComparisonValues(answerValues)
    return {
      key,
      label,
      value: list(comparableGuess),
      status: setStatus(comparableGuess, comparableAnswer),
      direction: null,
      matchedValues: overlaps(comparableGuess, comparableAnswer),
    }
  }
  const answerCoverings = knownComparisonValues(answer.bodyCoverings)
  const answerHabitats = knownComparisonValues(answer.habitats)
  const answerContinents = knownComparisonValues(answer.animalContinents)
  const answerDiets = knownComparisonValues(answer.diets)
  const answerLocomotion = knownComparisonValues(answer.locomotion)

  return [
    ...(knownComparisonText(answer.taxonomicClass) ? [scalarHint('animal_class', 'Класс', guess.taxonomicClass, answer.taxonomicClass)] : []),
    ...(knownComparisonText(answer.animalOrder) ? [scalarHint('animal_order', 'Отряд', guess.animalOrder, answer.animalOrder)] : []),
    ...(knownComparisonText(answer.animalFamily) ? [scalarHint('animal_family', 'Семейство', guess.animalFamily, answer.animalFamily)] : []),
    ...(answerCoverings.length ? [listHint('body_coverings', 'Покров тела', guess.bodyCoverings, answer.bodyCoverings)] : []),
    ...(answerHabitats.length ? [listHint('habitats', 'Среда обитания', guess.habitats, answer.habitats)] : []),
    ...(answerContinents.length ? [listHint('animal_continents', 'Ареал', guess.animalContinents, answer.animalContinents)] : []),
    ...(answerDiets.length ? [listHint('diets', 'Питание', guess.diets, answer.diets)] : []),
    ...(answerLocomotion.length ? [listHint('locomotion', 'Передвижение', guess.locomotion, answer.locomotion)] : []),
    ...(knownComparisonText(answer.reproduction) ? [scalarHint('reproduction', 'Размножение', guess.reproduction, answer.reproduction)] : []),
    ...(answer.bodyMassKg != null ? [animalMassHint(guess.bodyMassKg, answer.bodyMassKg)] : []),
    ...(answer.legCount != null ? [{
      key: 'leg_count',
      label: 'Число ног',
      value: guess.legCount != null ? String(guess.legCount) : 'Нет данных',
      status: guess.legCount == null ? 'unknown' : guess.legCount === answer.legCount ? 'match' : 'miss',
      direction: guess.legCount == null || guess.legCount === answer.legCount ? null : answer.legCount > guess.legCount ? 'up' : 'down',
    } satisfies Hint] : []),
  ]
}

const formatBookYear = (value: number | null | undefined) => {
  const year = toFiniteNumber(value)
  if (year == null) return 'Нет данных'
  return year < 0 ? `${Math.abs(year)} до н. э.` : String(year)
}

export const compareBooks = (guess: TitleItem, answer: TitleItem): Hint[] => {
  const listHint = (key: string, label: string, guessValues: string[] | undefined, answerValues: string[] | undefined): Hint => {
    const comparableGuess = knownComparisonValues(guessValues)
    const comparableAnswer = knownComparisonValues(answerValues)
    return {
      key,
      label,
      value: list(comparableGuess),
      status: setStatus(comparableGuess, comparableAnswer),
      direction: null,
      matchedValues: overlaps(comparableGuess, comparableAnswer),
    }
  }
  const scalarHint = (key: string, label: string, guessValue: string | null | undefined, answerValue: string | null | undefined): Hint => ({
    key,
    label,
    value: knownComparisonText(guessValue) ?? 'Нет данных',
    status: scalar(guessValue, answerValue),
    direction: null,
  })
  const booleanHint = (key: string, label: string, guessValue: boolean | undefined, answerValue: boolean | undefined): Hint => ({
    key,
    label,
    value: guessValue == null ? 'Нет данных' : guessValue ? 'Да' : 'Нет',
    status: guessValue == null || answerValue == null ? 'unknown' : guessValue === answerValue ? 'match' : 'miss',
    direction: null,
  })
  const year = numeric(guess.bookPublicationYear, answer.bookPublicationYear, 0, 10)
  const adaptationCount = numeric(guess.bookAdaptationCount, answer.bookAdaptationCount, 0, 2)

  return [
    ...(knownComparisonValues(answer.bookAuthors).length ? [listHint('book_authors', 'Автор', guess.bookAuthors, answer.bookAuthors)] : []),
    ...(knownComparisonText(answer.bookCountry) ? [scalarHint('book_country', 'Страна', guess.bookCountry, answer.bookCountry)] : []),
    ...(knownComparisonText(answer.bookOriginalLanguage) ? [scalarHint('book_language', 'Язык оригинала', guess.bookOriginalLanguage, answer.bookOriginalLanguage)] : []),
    ...(answer.bookPublicationYear != null ? [{ key: 'book_year', label: 'Год публикации', value: formatBookYear(guess.bookPublicationYear), ...year } satisfies Hint] : []),
    ...(knownComparisonValues(answer.bookGenres).length ? [listHint('book_genres', 'Жанры', guess.bookGenres, answer.bookGenres)] : []),
    ...(answer.isPartOfSeries != null ? [booleanHint('book_series', 'Часть цикла', guess.isPartOfSeries, answer.isPartOfSeries)] : []),
    ...(answer.hasAdaptation != null ? [booleanHint('book_adaptation', 'Экранизация', guess.hasAdaptation, answer.hasAdaptation)] : []),
    ...(answer.bookAdaptationCount != null ? [{
      key: 'book_adaptation_count',
      label: 'Экранизаций',
      value: guess.bookAdaptationCount == null ? 'Нет данных' : String(guess.bookAdaptationCount),
      ...adaptationCount,
    } satisfies Hint] : []),
    ...(answer.hasAwards != null ? [booleanHint('book_awards', 'Премии', guess.hasAwards, answer.hasAwards)] : []),
  ]
}

export const compareCharacters = (guess: TitleItem, answer: TitleItem): Hint[] => {
  const scalarHint = (key: string, label: string, guessValue: string | null | undefined, answerValue: string | null | undefined): Hint => ({
    key,
    label,
    value: knownComparisonText(guessValue) ?? 'Нет данных',
    status: scalar(guessValue, answerValue),
    direction: null,
  })
  const listHint = (key: string, label: string, guessValues: string[] | undefined, answerValues: string[] | undefined): Hint => {
    const comparableGuess = knownComparisonValues(guessValues)
    const comparableAnswer = knownComparisonValues(answerValues)
    return {
      key,
      label,
      value: list(comparableGuess),
      status: setStatus(comparableGuess, comparableAnswer),
      direction: null,
      matchedValues: overlaps(comparableGuess, comparableAnswer),
    }
  }
  const eraOrder = numeric(guess.characterEraOrder, answer.characterEraOrder, 0, 1)
  const eraHint: Hint = {
    key: 'character_era',
    label: 'Эпоха',
    value: knownComparisonText(guess.characterEra) ?? 'Нет данных',
    status: scalar(guess.characterEra, answer.characterEra) === 'match' ? 'match' : eraOrder.status,
    direction: scalar(guess.characterEra, answer.characterEra) === 'match' ? null : eraOrder.direction,
  }

  return [
    eraHint,
    listHint('character_source_types', 'Источник', guess.characterSourceTypes, answer.characterSourceTypes),
    listHint('character_origin_cultures', 'Культура', guess.characterOriginCultures, answer.characterOriginCultures),
    scalarHint('character_nature', 'Природа', guess.characterNature, answer.characterNature),
    scalarHint('character_gender', 'Пол', guess.characterGender, answer.characterGender),
    scalarHint('character_age_group', 'Возраст', guess.characterAgeGroup, answer.characterAgeGroup),
    listHint('character_roles', 'Роль', guess.characterRoles, answer.characterRoles),
    listHint('character_archetypes', 'Архетип', guess.characterArchetypes, answer.characterArchetypes),
    listHint('character_abilities', 'Способности', guess.characterAbilities, answer.characterAbilities),
    listHint('character_settings', 'Мир', guess.characterSettings, answer.characterSettings),
  ]
}

export type GameModeRules = {
  pool: (items: TitleItem[], variantKey: string | null) => TitleItem[]
  compare: (guess: TitleItem, answer: TitleItem) => Hint[]
}

const unchangedPool: GameModeRules['pool'] = (items) => items

export const GAME_MODE_RULES: Record<TitleMode, GameModeRules> = {
  movie: { pool: unchangedPool, compare: compareScreenTitles },
  series: { pool: unchangedPool, compare: compareScreenTitles },
  anime: { pool: unchangedPool, compare: compareAnimeTitles },
  game: { pool: unchangedPool, compare: compareGames },
  city: { pool: filterCityPool, compare: compareCities },
  music: { pool: unchangedPool, compare: compareMusic },
  diagnosis: { pool: unchangedPool, compare: compareDiagnoses },
  animal: { pool: unchangedPool, compare: compareAnimals },
  book: { pool: unchangedPool, compare: compareBooks },
  character: { pool: unchangedPool, compare: compareCharacters },
}

export const compareTitles = (guess: TitleItem, answer: TitleItem): Hint[] => {
  if (guess.mode !== answer.mode) return []
  return GAME_MODE_RULES[guess.mode].compare(guess, answer)
}

export const emptyStats = (): Stats => ({ played: 0, won: 0, currentStreak: 0, bestStreak: 0, distribution: Array(10).fill(0) })
export const calculateCompletionReward = (input: {
  won: boolean
  attemptsCount: number
  completionType?: GameCompletionType
  firstCompletion: boolean
  firstRoute3?: boolean
  firstFullHouse: boolean
  dailyStreak: number
  rules?: EconomyRuleSet
}) => {
  const rules = input.rules ?? ECONOMY_RULE_SET
  const completionType = input.completionType ?? (input.won ? 'direct_win' : 'attempts_exhausted')
  const directWin = input.won && completionType === 'direct_win'
  const completed = completionType !== 'expired'
  const components = {
    completion: completed ? rules.rewards.completion : 0,
    win: directWin ? rules.rewards.win : 0,
    efficiency: economyEfficiencyReward(directWin, input.attemptsCount, rules),
    finalChoiceWin: completionType === 'final_choice_win' ? rules.rewards.finalChoiceWin : 0,
    firstGame: completed && input.firstCompletion ? rules.rewards.firstGame : 0,
    route3: completed && input.firstRoute3 ? rules.rewards.route3 : 0,
    fullRoute: completed && input.firstFullHouse ? rules.rewards.fullRoute : 0,
    streakMilestone: completed && input.firstCompletion ? economyStreakMilestoneReward(input.dailyStreak, rules) : 0,
  }
  return {
    rulesVersion: rules.version ?? ECONOMY_RULES_VERSION,
    components,
    total: Object.values(components).reduce((sum, value) => sum + value, 0),
  }
}
export const resultText = (mode: TitleMode, date: string, period: PeriodKey, hints: Hint[][], won: boolean, maxAttempts = 10, completionType?: GameCompletionType) => {
  const rows = hints.map((row) => row.map((hint) => hint.status === 'match' ? '🟩' : hint.status === 'close' || hint.status === 'partial' ? '🟨' : hint.status === 'unknown' ? '⬜' : '⬛').join('')).join('\n')
  const modeDefinition = GAME_MODE_MANIFEST[mode]
  const dailyLabel = `${modeDefinition.dailyLabel} дня`
  const icon = modeDefinition.shareIcon
  const result = completionType === 'final_choice_win' ? 'Ф' : won ? hints.length : 'X'
  const [year, month, day] = date.split('-').map(Number)
  const monthLabel = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'][month - 1]
  const dateLabel = year && monthLabel && day ? `${day} ${monthLabel} ${year}` : date
  const selectionLabel = modeDefinition.periodPolicy === 'year'
    ? `${dateLabel} · ${PERIODS[period].label}`
    : dateLabel
  return `Сеанс — ${dailyLabel}\n${selectionLabel}\n${icon} ${result}/${maxAttempts}\n${rows}`
}

export * from './final-choice.js'
