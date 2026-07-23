import {
  ECONOMY_RULE_SET,
  ECONOMY_RULES_VERSION,
  GAME_MODE_MANIFEST,
  economyEfficiencyReward,
  economyStreakMilestoneReward,
  type Direction,
  type DifficultyKey,
  type Hint,
  type LibrarySearchIndex,
  type MatchStatus,
  type PeriodKey,
  type Stats,
  type TitleItem,
  type TitleMode,
} from '@shoditsa/contracts'

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

export const MUSIC_ID_REDIRECTS: Record<string, string> = {
  'music:036_эндшпиль': 'music:015_andy-panda',
  'music:118_karas': 'music:117_filatov',
}

export const MUSIC_TYPE_LABELS: Record<string, string> = {
  Person: 'Сольный исполнитель',
  Group: 'Группа или дуэт',
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

const isDailyMusicReady = (item: TitleItem) => item.contentStatus === 'ready' && Boolean(item.allowedInGame)
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
  .normalize('NFKD')
  .toLocaleLowerCase('ru-RU')
  .replace(/\p{M}+/gu, '')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()

export const isPlayableGamePlotHint = (
  item: Pick<TitleItem, 'plotHint' | 'titleRu' | 'titleOriginal'>,
) => {
  const hint = normalizePlotHintText(item.plotHint)
  if (hint.length < 30) return false
  if (/(?:\.\.\.|\u2026)\s*$/.test(hint)) return false
  if (/\[+\s*REDACTED\s*\]+|_KEEP_\d+_/i.test(hint)) return false
  if (/(?:json|undefined|null|nan|stack trace|exception|https?:\/\/|\bapi\b|\bid\s*[:=])/i.test(hint)) return false

  const normalizedHint = normalizePlotHintMatch(hint)
  return [item.titleRu, item.titleOriginal]
    .map(normalizePlotHintMatch)
    .every((title) => title.length < 4 || !normalizedHint.includes(title))
}

export const isAllowedInRegularGame = (
  item: Pick<TitleItem, 'id' | 'mode' | 'contentStatus' | 'allowedInGame'>,
) => {
  const explicitlyAllowed = item.allowedInGame !== false && (item.allowedInGame === true || !isPromoGameItem(item))
  return explicitlyAllowed
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
  .normalize('NFKD')
  .toLocaleLowerCase('ru-RU')
  .replace(/\p{M}+/gu, '')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()

export const normalize = (value: string) => normalizeArtistName(value)

/**
 * The single source of truth for names accepted by every catalog game.
 * `titleOriginal` covers English/original names, while both alias collections
 * cover legacy and imported alternative names.
 */
export const titleSearchNames = (item: Pick<TitleItem, 'titleRu' | 'titleOriginal' | 'alternativeTitles' | 'aliases'>) => {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of [
    item.titleRu,
    item.titleOriginal,
    ...(item.alternativeTitles ?? []),
    ...(item.aliases ?? []),
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
  item: Pick<TitleItem, 'titleRu' | 'titleOriginal' | 'alternativeTitles' | 'aliases'>,
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

const setStatus = (guess: string[], answer: string[]): MatchStatus => {
  if (!guess.length || !answer.length) return 'unknown'
  const g = new Set(guess.map(normalize)); const a = new Set(answer.map(normalize))
  const shared = [...g].filter((value) => a.has(value)).length
  return shared === g.size && shared === a.size ? 'match' : shared ? 'partial' : 'miss'
}
const scalar = (guess: string | null | undefined, answer: string | null | undefined): MatchStatus => {
  if (!guess || !answer) return 'unknown'
  return normalize(guess) === normalize(answer) ? 'match' : 'miss'
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
  return { status: delta <= match ? 'match' : delta <= close ? 'close' : 'miss', direction: delta <= match ? null : compareDirection(guessNumber, answerNumber, options) }
}
const list = (values: string[]) => values.length ? values.join(', ') : 'Нет данных'
const countryCode = (value: string) => {
  const firstChunk = value.split(',')[0]?.trim().toUpperCase() ?? ''
  if (/^[A-Z]{2}$/.test(firstChunk)) return firstChunk
  const fallback = value.toUpperCase().match(/\b[A-Z]{2}\b/)
  return fallback?.[0] ?? null
}

const MUSIC_COUNTRY_LABELS: Record<string, string> = {
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
  const label = MUSIC_COUNTRY_LABELS[code] ?? value
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
  const answerSet = new Set(answer.map(normalize))
  return guess.filter((value) => answerSet.has(normalize(value)))
}
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
    if (text.includes('одиноч')) {
      max = max == null ? 1 : Math.max(max, 1)
      continue
    }
    if (text.includes('мульти') || text.includes('кооп') || text.includes('сетев') || text.includes('online') || text.includes('multiplayer') || text.includes('игрок') || text.includes('player')) {
      max = max == null ? 2 : Math.max(max, 2)
    }
  }
  return max
}

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
    const rubles = item.price.final / 100
    return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(rubles)} ₽`
  }
  return 'Платно'
}

const gamePriceHint = (guess: TitleItem, answer: TitleItem): { status: MatchStatus; direction: Direction } => {
  if (!guess.price || !answer.price) return { status: 'unknown', direction: null }
  if (guess.price.isFree === answer.price.isFree && (guess.price.isFree || guess.price.final == null || answer.price.final == null)) return { status: 'match', direction: null }
  if (guess.price.isFree !== answer.price.isFree) return { status: 'miss', direction: null }
  const guessFinal = toFiniteNumber(guess.price.final)
  const answerFinal = toFiniteNumber(answer.price.final)
  if (guessFinal == null || answerFinal == null) return { status: 'match', direction: null }
  const delta = Math.abs(guessFinal - answerFinal)
  return {
    status: delta <= 10_000 ? 'match' : delta <= 35_000 ? 'close' : 'miss',
    direction: delta <= 10_000 ? null : compareDirection(guessFinal, answerFinal),
  }
}

const compareDiagnoses = (guess: TitleItem, answer: TitleItem): Hint[] => {
  const guessBodySystems = guess.bodySystems ?? []
  const answerBodySystems = answer.bodySystems ?? []
  const guessDiseaseTypes = guess.diseaseTypes ?? []
  const answerDiseaseTypes = answer.diseaseTypes ?? []
  const guessCourse = guess.course ?? []
  const answerCourse = answer.course ?? []
  const guessAgeGroups = guess.typicalAgeGroups ?? []
  const answerAgeGroups = answer.typicalAgeGroups ?? []
  const guessLocalization = guess.localization ?? []
  const answerLocalization = answer.localization ?? []
  const guessSymptoms = guess.keySymptoms ?? []
  const answerSymptoms = answer.keySymptoms ?? []
  const guessDiagnostics = guess.diagnostics ?? []
  const answerDiagnostics = answer.diagnostics ?? []
  const guessRiskFactors = guess.riskFactors ?? []
  const answerRiskFactors = answer.riskFactors ?? []
  const guessContagiousness = normalizeContagiousness(guess.contagiousness)
  const answerContagiousness = normalizeContagiousness(answer.contagiousness)
  const guessIcd = [...(guess.icd10 ?? []), ...(guess.icdGroup ? [guess.icdGroup] : [])]
  const answerIcd = [...(answer.icd10 ?? []), ...(answer.icdGroup ? [answer.icdGroup] : [])]

  const hints: Hint[] = [
    { key: 'body_systems', label: 'Система', value: list(guessBodySystems), status: setStatus(guessBodySystems, answerBodySystems), direction: null, matchedValues: overlaps(guessBodySystems, answerBodySystems) },
    { key: 'disease_types', label: 'Тип', value: list(guessDiseaseTypes), status: setStatus(guessDiseaseTypes, answerDiseaseTypes), direction: null, matchedValues: overlaps(guessDiseaseTypes, answerDiseaseTypes) },
    { key: 'course', label: 'Течение', value: list(guessCourse), status: setStatus(guessCourse, answerCourse), direction: null, matchedValues: overlaps(guessCourse, answerCourse) },
    { key: 'contagiousness', label: 'Заразность', value: guessContagiousness ?? 'Нет данных', status: scalar(guessContagiousness, answerContagiousness), direction: null },
    { key: 'typical_age', label: 'Возраст', value: list(guessAgeGroups), status: setStatus(guessAgeGroups, answerAgeGroups), direction: null, matchedValues: overlaps(guessAgeGroups, answerAgeGroups) },
    { key: 'localization', label: 'Локализация', value: list(guessLocalization), status: setStatus(guessLocalization, answerLocalization), direction: null, matchedValues: overlaps(guessLocalization, answerLocalization) },
    { key: 'symptoms', label: 'Симптомы', value: list(guessSymptoms), status: setStatus(guessSymptoms, answerSymptoms), direction: null, matchedValues: overlaps(guessSymptoms, answerSymptoms) },
    { key: 'diagnostics', label: 'Диагностика', value: list(guessDiagnostics), status: setStatus(guessDiagnostics, answerDiagnostics), direction: null, matchedValues: overlaps(guessDiagnostics, answerDiagnostics) },
    { key: 'risk_factors', label: 'Факторы риска', value: list(guessRiskFactors), status: setStatus(guessRiskFactors, answerRiskFactors), direction: null, matchedValues: overlaps(guessRiskFactors, answerRiskFactors) },
    { key: 'icd', label: 'МКБ', value: list(guessIcd), status: setStatus(guessIcd, answerIcd), direction: null, matchedValues: overlaps(guessIcd, answerIcd) },
  ]

  return guess.id === answer.id ? hints.map((hint) => ({ ...hint, status: 'match', direction: null })) : hints
}

const compareScreenTitles = (guess: TitleItem, answer: TitleItem): Hint[] => {
  const guessCountries = guess.countries ?? []
  const answerCountries = answer.countries ?? []
  const guessGenres = guess.genres ?? []
  const answerGenres = answer.genres ?? []
  const guessCast = guess.cast ?? []
  const answerCast = answer.cast ?? []

  const year = numeric(guess.year, answer.year, 0, 2)
  const kp = numeric(guess.ratings?.kinopoisk, answer.ratings?.kinopoisk, 0.1, 0.3)
  const imdb = numeric(guess.ratings?.imdb, answer.ratings?.imdb, 0.1, 0.3)
  const runtime = numeric(guess.runtimeMinutes, answer.runtimeMinutes, 5, 15)
  const showRuntime = guess.mode !== 'series' && answer.mode !== 'series'
  const showSeriesMeta = guess.mode === 'series' && answer.mode === 'series'
  const guessSeasons = Number.isFinite(Number(guess.seasonsCount)) ? Number(guess.seasonsCount) : null
  const answerSeasons = Number.isFinite(Number(answer.seasonsCount)) ? Number(answer.seasonsCount) : null
  const seasons = numeric(guessSeasons, answerSeasons, 0, 1)
  const guessSeriesStatus = guess.seriesStatus ?? null
  const answerSeriesStatus = answer.seriesStatus ?? null

  const guessShowrunners = guess.showrunners ?? []
  const answerShowrunners = answer.showrunners ?? []
  const guessDirectors = guess.directors ?? []
  const answerDirectors = answer.directors ?? []
  const guessCreators = guess.mode === 'series' && guessShowrunners.length ? guessShowrunners : guessDirectors
  const answerCreators = answer.mode === 'series' && answerShowrunners.length ? answerShowrunners : answerDirectors

  const creatorsG = guessCreators.map((person) => person.nameRu || person.nameOriginal).filter(Boolean)
  const creatorsA = answerCreators.map((person) => person.nameRu || person.nameOriginal).filter(Boolean)
  const creatorNames = new Set(creatorsA.map(normalize))
  const castNames = new Set(answerCast.map((person) => normalize(person.nameRu || person.nameOriginal)))
  const matchedGenres = overlaps(guessGenres, answerGenres)

  const hints: Hint[] = [
    { key: 'year', label: 'Год', value: guess.year != null ? String(guess.year) : '—', ...year },
    { key: 'country', label: 'Страна', value: list(guessCountries), status: setStatus(guessCountries, answerCountries), direction: null },
    ...(showSeriesMeta ? [{ key: 'series_status', label: 'Статус', value: guessSeriesStatus ?? '—', status: scalar(guessSeriesStatus, answerSeriesStatus), direction: null } satisfies Hint] : []),
    ...(showSeriesMeta ? [{ key: 'seasons', label: 'Сезоны', value: seasonCountLabel(guessSeasons), ...seasons } satisfies Hint] : []),
    { key: 'genres', label: 'Жанры', value: list(guessGenres), status: setStatus(guessGenres, answerGenres), direction: null, matchedValues: matchedGenres },
    {
      key: 'creator',
      label: guess.mode === 'series' ? 'Авторы' : 'Режиссёр',
      value: list(creatorsG),
      status: setStatus(creatorsG, creatorsA),
      direction: null,
      people: guessCreators.map((person) => ({ ...person, matched: creatorNames.has(normalize(person.nameRu || person.nameOriginal)) })),
    },
    {
      key: 'cast',
      label: 'Актёры',
      value: people(guessCast),
      status: setStatus(
        guessCast.map((person) => person.nameRu || person.nameOriginal),
        answerCast.map((person) => person.nameRu || person.nameOriginal),
      ),
      direction: null,
      people: guessCast.map((person) => ({ ...person, matched: castNames.has(normalize(person.nameRu || person.nameOriginal)) })),
    },
    { key: 'kp', label: 'Кинопоиск', value: guess.ratings?.kinopoisk?.toFixed(1) ?? '—', ...kp },
    { key: 'imdb', label: 'IMDb', value: guess.ratings?.imdb?.toFixed(1) ?? '—', ...imdb },
    ...(showRuntime ? [{ key: 'runtime', label: 'Хронометраж', value: guess.runtimeMinutes ? `${guess.runtimeMinutes} мин` : '—', ...runtime } satisfies Hint] : []),
    {
      key: 'age',
      label: 'Возраст',
      value: guess.ageRating ?? '—',
      status: guess.ageRating && answer.ageRating ? (guess.ageRating === answer.ageRating ? 'match' : 'miss') : 'unknown',
      direction: null,
    },
  ]

  return guess.id === answer.id ? hints.map((hint) => ({ ...hint, status: 'match', direction: null })) : hints
}

const compareAnimeTitles = (guess: TitleItem, answer: TitleItem): Hint[] => {
  const guessGenres = guess.genres ?? []
  const answerGenres = answer.genres ?? []
  const guessStudios = guess.studios ?? []
  const answerStudios = answer.studios ?? []
  const guessCast = guess.cast ?? []
  const answerCast = answer.cast ?? []
  const guessCreators = mergePeople(guess.directors, guess.showrunners, guess.writers).slice(0, 5)
  const answerCreators = mergePeople(answer.directors, answer.showrunners, answer.writers).slice(0, 5)

  const guessCreatorNames = guessCreators.map((person) => person.nameRu || person.nameOriginal).filter(Boolean)
  const answerCreatorNames = answerCreators.map((person) => person.nameRu || person.nameOriginal).filter(Boolean)
  const creatorSet = new Set(answerCreatorNames.map(normalize))
  const castSet = new Set(answerCast.map((person) => normalize(person.nameRu || person.nameOriginal)))
  const matchedGenres = overlaps(guessGenres, answerGenres)
  const matchedStudios = overlaps(guessStudios, answerStudios)

  const guessKind = guess.animeKindCode ?? guess.animeKind ?? null
  const answerKind = answer.animeKindCode ?? answer.animeKind ?? null
  const guessStatus = guess.animeStatusCode ?? guess.animeStatus ?? guess.seriesStatus ?? null
  const answerStatus = answer.animeStatusCode ?? answer.animeStatus ?? answer.seriesStatus ?? null
  const guessSource = guess.animeSourceCode ?? guess.animeSource ?? null
  const answerSource = answer.animeSourceCode ?? answer.animeSource ?? null
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

  const hasEpisodes = guessEpisodes != null || answerEpisodes != null
  const hasEpisodesAired = guessEpisodesAired != null || answerEpisodesAired != null
  const hasRuntime = guess.runtimeMinutes != null || answer.runtimeMinutes != null
  const hasStudios = guessStudios.length > 0 || answerStudios.length > 0
  const hasSource = Boolean(guessSource || answerSource)
  const hasScore = guessScore != null || answerScore != null
  const hasRank = guess.topRank != null || answer.topRank != null
  const hasAge = Boolean(guess.ageRating || answer.ageRating)
  const hasCreators = guessCreatorNames.length > 0 || answerCreatorNames.length > 0
  const hasCast = guessCast.length > 0 || answerCast.length > 0

  const hints: Hint[] = [
    { key: 'year', label: 'Год', value: guess.year != null ? String(guess.year) : '—', ...year },
    { key: 'anime_kind', label: 'Формат', value: guess.animeKind ?? guessKind ?? '—', status: scalar(guessKind, answerKind), direction: null },
    { key: 'anime_status', label: 'Статус', value: guess.animeStatus ?? guess.seriesStatus ?? guessStatus ?? '—', status: scalar(guessStatus, answerStatus), direction: null },
    ...(hasEpisodes ? [{ key: 'episodes', label: 'Эпизоды', value: guessEpisodes != null ? String(guessEpisodes) : '—', ...episodes } satisfies Hint] : []),
    ...(hasEpisodesAired ? [{ key: 'episodes_aired', label: 'Вышло серий', value: guessEpisodesAired != null ? String(guessEpisodesAired) : '—', ...episodesAired } satisfies Hint] : []),
    ...(hasRuntime ? [{ key: 'runtime', label: 'Длительность', value: guess.runtimeMinutes ? `${guess.runtimeMinutes} мин` : '—', ...runtime } satisfies Hint] : []),
    { key: 'genres', label: 'Жанры', value: list(guessGenres), status: setStatus(guessGenres, answerGenres), direction: null, matchedValues: matchedGenres },
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
    ...(hasAge ? [{ key: 'age', label: 'Возраст', value: guess.ageRating ?? '—', status: scalar(guess.ageRating, answer.ageRating), direction: null } satisfies Hint] : []),
  ]

  return guess.id === answer.id ? hints.map((hint) => ({ ...hint, status: 'match', direction: null })) : hints
}

const compareGames = (guess: TitleItem, answer: TitleItem): Hint[] => {
  const guessGenres = guess.genres ?? []
  const answerGenres = answer.genres ?? []
  const guessCategories = guess.steamCategories ?? []
  const answerCategories = answer.steamCategories ?? []
  const guessPlatforms = guess.platforms ?? []
  const answerPlatforms = answer.platforms ?? []
  const guessDevelopers = guess.developers ?? []
  const answerDevelopers = answer.developers ?? []
  const guessPublishers = guess.publishers ?? []
  const answerPublishers = answer.publishers ?? []
  const guessSteamPositive = gameScore(guess.ratings?.steamPositivePercent)
  const answerSteamPositive = gameScore(answer.ratings?.steamPositivePercent)
  const guessMeta = gameScore(guess.ratings?.metacritic ?? guess.metacritic)
  const answerMeta = gameScore(answer.ratings?.metacritic ?? answer.metacritic)
  const guessPlayers = playersNumber(guessCategories)
  const answerPlayers = playersNumber(answerCategories)
  const guessAge = ageNumber(guess.ageRating)
  const answerAge = ageNumber(answer.ageRating)

  const year = numeric(guess.year, answer.year, 0, 2)
  const rank = numeric(guess.topRank, answer.topRank, 0, 15, { lowerIsUp: true })
  const players = numeric(guessPlayers, answerPlayers, 0, 2)
  const steamPositive = numeric(guessSteamPositive, answerSteamPositive, 1, 5)
  const metacritic = numeric(guessMeta, answerMeta, 1, 5)
  const reviews = reviewHint(guess.votes?.steamReviews, answer.votes?.steamReviews)
  const price = gamePriceHint(guess, answer)
  const age = guessAge != null || answerAge != null
    ? numeric(guessAge, answerAge, 0, 2)
    : { status: scalar(guess.ageRating, answer.ageRating), direction: null }
  const hasGenres = guessGenres.length > 0 || answerGenres.length > 0
  const hasSteamCategories = guessCategories.length > 0 || answerCategories.length > 0
  const hasPlatforms = guessPlatforms.length > 0 || answerPlatforms.length > 0
  const hasDevelopers = guessDevelopers.length > 0 || answerDevelopers.length > 0
  const hasPublishers = guessPublishers.length > 0 || answerPublishers.length > 0
  const hasPlayers = guessPlayers != null || answerPlayers != null
  const hasSteamPositive = guessSteamPositive != null || answerSteamPositive != null
  const hasMetacritic = guessMeta != null || answerMeta != null
  const hasReviews = Boolean(guess.votes?.steamReviews) || Boolean(answer.votes?.steamReviews)
  const hasPrice = Boolean(guess.price) || Boolean(answer.price)
  const hasAge = Boolean(guess.ageRating) || Boolean(answer.ageRating)

  const hints: Hint[] = [
    { key: 'year', label: 'Год', value: guess.year != null ? String(guess.year) : '—', ...year },
    { key: 'rank', label: 'Место в топе', value: guess.topRank != null ? `#${guess.topRank}` : '—', ...rank },
    ...(hasPlayers ? [{ key: 'players', label: 'Игроки', value: playerCountLabel(guessPlayers), ...players } satisfies Hint] : []),
    ...(hasGenres ? [{ key: 'genres', label: 'Жанры', value: list(guessGenres), status: setStatus(guessGenres, answerGenres), direction: null, matchedValues: overlaps(guessGenres, answerGenres) } satisfies Hint] : []),
    ...(hasSteamCategories ? [{ key: 'steam_categories', label: 'Категории', value: list(guessCategories), status: setStatus(guessCategories, answerCategories), direction: null, matchedValues: overlaps(guessCategories, answerCategories) } satisfies Hint] : []),
    ...(hasPlatforms ? [{ key: 'platforms', label: 'Платформы', value: list(guessPlatforms), status: setStatus(guessPlatforms, answerPlatforms), direction: null, matchedValues: overlaps(guessPlatforms, answerPlatforms) } satisfies Hint] : []),
    ...(hasDevelopers ? [{ key: 'developer', label: 'Разработчик', value: list(guessDevelopers), status: setStatus(guessDevelopers, answerDevelopers), direction: null, matchedValues: overlaps(guessDevelopers, answerDevelopers) } satisfies Hint] : []),
    ...(hasPublishers ? [{ key: 'publisher', label: 'Издатель', value: list(guessPublishers), status: setStatus(guessPublishers, answerPublishers), direction: null, matchedValues: overlaps(guessPublishers, answerPublishers) } satisfies Hint] : []),
    ...(hasSteamPositive ? [{ key: 'steam_positive', label: 'Позитив Steam', value: guessSteamPositive != null ? `${guessSteamPositive}%` : '—', ...steamPositive } satisfies Hint] : []),
    ...(hasMetacritic ? [{ key: 'metacritic', label: 'Metacritic', value: formatNumber(guessMeta), ...metacritic } satisfies Hint] : []),
    ...(hasReviews ? [{ key: 'reviews', label: 'Отзывы Steam', value: formatNumber(guess.votes?.steamReviews), ...reviews } satisfies Hint] : []),
    ...(hasPrice ? [{ key: 'price', label: 'Цена', value: gamePriceLabel(guess), ...price } satisfies Hint] : []),
    ...(hasAge ? [{ key: 'age', label: 'Возраст', value: guess.ageRating ?? '—', ...age } satisfies Hint] : []),
  ]

  return guess.id === answer.id ? hints.map((hint) => ({ ...hint, status: 'match', direction: null })) : hints
}

const decadeFromYear = (year: number | null | undefined) => {
  if (year == null || !Number.isFinite(year)) return null
  return Math.floor(year / 10) * 10
}

const compareMusic = (guess: TitleItem, answer: TitleItem): Hint[] => {
  const guessCountryCodes = countryCodes(guess.countries ?? [])
  const answerCountryCodes = countryCodes(answer.countries ?? [])
  const guessCountries = guessCountryCodes.map(localizeMusicCountry)
  const answerCountries = answerCountryCodes.map(localizeMusicCountry)

  const guessGenres = guess.genres ?? []
  const answerGenres = answer.genres ?? []
  const guessTypeLabel = musicTypeLabel(guess.musicType)
  const answerTypeLabel = musicTypeLabel(answer.musicType)
  const guessOrigin = guess.musicOrigin ?? null
  const answerOrigin = answer.musicOrigin ?? null
  const guessScene = musicOriginLabel(guessOrigin)
  const guessActive = guess.musicIsActive
  const answerActive = answer.musicIsActive

  const guessDecade = decadeFromYear(guess.activityStartYear)
  const answerDecade = decadeFromYear(answer.activityStartYear)
  const decadeHint = numeric(guessDecade, answerDecade, 0, 0)

  const guessSimilar = (guess.similarArtists ?? []).map((artist) => artist.name).filter(Boolean)
  const answerSimilar = (answer.similarArtists ?? []).map((artist) => artist.name).filter(Boolean)
  const hasSimilar = guessSimilar.length > 0 || answerSimilar.length > 0

  const activityStartYear = numeric(guess.activityStartYear, answer.activityStartYear, 0, 2)
  const hasActivityStart = guess.activityStartYear != null || answer.activityStartYear != null
  const activeStatus = scalar(
    guessActive == null ? null : guessActive ? 'active' : 'inactive',
    answerActive == null ? null : answerActive ? 'active' : 'inactive',
  )

  const hints: Hint[] = [
    ...(hasActivityStart ? [{ key: 'activity_start_year', label: 'Начало деятельности', value: guess.activityStartYear != null ? String(guess.activityStartYear) : '—', ...activityStartYear } satisfies Hint] : []),
    ...(hasActivityStart ? [{
      key: 'decade',
      label: 'Десятилетие',
      value: guessDecade != null ? `${guessDecade}-е` : '—',
      ...decadeHint,
    } satisfies Hint] : []),
    {
      key: 'country',
      label: 'Страна',
      value: list(guessCountries),
      status: setStatus(guessCountryCodes, answerCountryCodes),
      direction: null,
      matchedValues: overlaps(guessCountries, answerCountries),
    },
    {
      key: 'genres',
      label: 'Жанры',
      value: list(guessGenres),
      status: setStatus(guessGenres, answerGenres),
      direction: null,
      matchedValues: overlaps(guessGenres, answerGenres),
    },
    {
      key: 'music_type',
      label: 'Тип артиста',
      value: guessTypeLabel,
      status: scalar(guessTypeLabel, answerTypeLabel),
      direction: null,
    },
    {
      key: 'music_active',
      label: 'Карьера',
      value: musicCareerStatusLabel(guessActive),
      status: activeStatus,
      direction: null,
    },
    {
      key: 'music_origin',
      label: 'Сцена',
      value: guessScene,
      status: scalar(guessOrigin, answerOrigin),
      direction: null,
    },
    ...(hasSimilar ? [{
      key: 'similar_artists',
      label: 'Похожие артисты',
      value: list(guessSimilar),
      status: setStatus(guessSimilar, answerSimilar),
      direction: null,
      matchedValues: overlaps(guessSimilar, answerSimilar),
    } satisfies Hint] : []),
  ]

  return guess.id === answer.id ? hints.map((hint) => ({ ...hint, status: 'match', direction: null })) : hints
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
  if (!guess || !answer) return 'unknown'
  return normalize(guess) === normalize(answer) ? 'match' : 'miss'
}

const cityListStatus = (guess: string[], answer: string[]): MatchStatus => {
  if (!guess.length || !answer.length) return 'unknown'
  const guessSet = new Set(guess.map(normalize))
  const answerSet = new Set(answer.map(normalize))
  const shared = [...guessSet].filter((value) => answerSet.has(value)).length
  return shared === guessSet.size && shared === answerSet.size ? 'match' : shared ? 'partial' : 'miss'
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
  const status: MatchStatus = delta <= matchDelta ? 'match' : delta <= closeDelta ? 'close' : 'miss'
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
  const status: MatchStatus = relativeDelta <= 0.05 ? 'match' : relativeDelta <= 0.2 ? 'close' : 'miss'
  return {
    key: 'population', label: 'Население', value: new Intl.NumberFormat('ru-RU').format(guess), status,
    direction: status === 'match' ? null : answer > guess ? 'up' : 'down',
  }
}

export const compareCities = (guess: TitleItem, answer: TitleItem): Hint[] => {
  const guessRanks = guess.ranks
  const answerRanks = answer.ranks
  const rank = (key: keyof NonNullable<TitleItem['ranks']>, label: string) => cityNumberHint(
    key, label, guessRanks?.[key] ?? null, answerRanks?.[key] ?? null, (value) => `№ ${value}`, 10, 50, true,
  )
  const hints: Hint[] = [
    { key: 'country', label: 'Страна', value: guess.country || 'Нет данных', status: cityScalarStatus(guess.country ?? '', answer.country ?? ''), direction: null },
    { key: 'continent', label: 'Континент', value: guess.continent || 'Нет данных', status: cityScalarStatus(guess.continent ?? '', answer.continent ?? ''), direction: null },
    { key: 'languages', label: 'Языки', value: (guess.languages ?? []).join(', ') || 'Нет данных', status: cityListStatus(guess.languages ?? [], answer.languages ?? []), direction: null },
    cityPopulationHint(guess.population ?? null, answer.population ?? null),
    cityNumberHint('timezone', 'Часовой пояс', cityTimezoneHours(guess.timezone ?? ''), cityTimezoneHours(answer.timezone ?? ''), () => guess.timezone || 'Нет данных', 0.25, 2),
    rank('economy', 'Экономика'), rank('humanCapital', 'Человеческий капитал'), rank('qualityOfLife', 'Качество жизни'),
    rank('ecology', 'Экология'), rank('governance', 'Работа властей'),
  ]
  return guess.id === answer.id ? hints.map((hint) => ({ ...hint, status: 'match', direction: null })) : hints
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
}

export const compareTitles = (guess: TitleItem, answer: TitleItem): Hint[] => {
  if (guess.mode !== answer.mode) return []
  return GAME_MODE_RULES[guess.mode].compare(guess, answer)
}

export const emptyStats = (): Stats => ({ played: 0, won: 0, currentStreak: 0, bestStreak: 0, distribution: Array(10).fill(0) })
export const calculateCompletionReward = (input: {
  won: boolean
  attemptsCount: number
  firstCompletion: boolean
  firstRoute3?: boolean
  firstFullHouse: boolean
  dailyStreak: number
}) => {
  const components = {
    completion: ECONOMY_RULE_SET.rewards.completion,
    win: input.won ? ECONOMY_RULE_SET.rewards.win : 0,
    efficiency: economyEfficiencyReward(input.won, input.attemptsCount),
    firstGame: input.firstCompletion ? ECONOMY_RULE_SET.rewards.firstGame : 0,
    route3: input.firstRoute3 ? ECONOMY_RULE_SET.rewards.route3 : 0,
    fullRoute: input.firstFullHouse ? ECONOMY_RULE_SET.rewards.fullRoute : 0,
    streakMilestone: input.firstCompletion ? economyStreakMilestoneReward(input.dailyStreak) : 0,
  }
  return {
    rulesVersion: ECONOMY_RULES_VERSION,
    components,
    total: Object.values(components).reduce((sum, value) => sum + value, 0),
  }
}
export const resultText = (mode: TitleMode, date: string, period: PeriodKey, hints: Hint[][], won: boolean, maxAttempts = 10) => {
  const rows = hints.map((row) => row.map((hint) => hint.status === 'match' ? '🟩' : hint.status === 'close' || hint.status === 'partial' ? '🟨' : hint.status === 'unknown' ? '⬜' : '⬛').join('')).join('\n')
  const modeDefinition = GAME_MODE_MANIFEST[mode]
  const dailyLabel = `${modeDefinition.dailyLabel} дня`
  const icon = modeDefinition.shareIcon
  return `Сеанс — ${dailyLabel}\n${date} · ${PERIODS[period].label}\n${icon} ${won ? hints.length : 'X'}/${maxAttempts}\n${rows}`
}
