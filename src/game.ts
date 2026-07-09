import type { Direction, Hint, LibrarySearchIndex, MatchStatus, PeriodKey, Stats, TitleItem, TitleMode, DifficultyKey } from './types'

export const PERIODS: Record<PeriodKey, { label: string; short: string; fromYear: number | null }> = {
  all: { label: 'Все годы', short: 'Весь экран', fromYear: null },
  from_1960: { label: 'С 1960 года', short: '1960+', fromYear: 1960 },
  from_1980: { label: 'С 1980 года', short: '1980+', fromYear: 1980 },
  from_1990: { label: 'С 1990 года', short: '1990+', fromYear: 1990 },
  from_2000: { label: 'С 2000 года', short: '2000+', fromYear: 2000 },
  from_2010: { label: 'С 2010 года', short: '2010+', fromYear: 2010 },
  from_2020: { label: 'С 2020 года', short: '2020+', fromYear: 2020 },
}

// Для каждой сложности задаем:
// - целевую долю русских артистов внутри режима (ruShare),
// - вклад RU/INTL сегментов в общий размер пула (ruPoolFraction/intlPoolFraction).
export const DIFFICULTY_ORDER: DifficultyKey[] = ['easy', 'medium', 'hard']
export const DIFFICULTIES: Record<DifficultyKey, { label: string; short: string; hint: string; ruShare: number; ruPoolFraction: number; intlPoolFraction: number }> = {
  easy: {
    label: 'Лёгкий',
    short: 'Разогрев',
    hint: '10% RU / 90% INTL',
    ruShare: 0.1,
    ruPoolFraction: 0.2,
    intlPoolFraction: 0.1,
  },
  medium: {
    label: 'Средний',
    short: 'Плотный чарт',
    hint: '30% RU / 70% INTL',
    ruShare: 0.3,
    ruPoolFraction: 0.55,
    intlPoolFraction: 0.35,
  },
  hard: {
    label: 'Сложный',
    short: 'RU only',
    hint: '100% RU',
    ruShare: 1,
    ruPoolFraction: 1,
    intlPoolFraction: 1,
  },
}

const RUSSIAN_SIGNAL = /росси|russia|russian|ссср|soviet|советск|украин|ukrain|беларус|белорус|belarus|казахстан|kazakh|азербайджан|azerbaij|груз|georgia|армен|armenia|латви|latvia|литв|эстони|молдав|молдов|узбекистан|киргиз|кыргыз|таджик|туркмен|абхаз/i

export const isRussianArtist = (item: TitleItem): boolean => {
  if (item.musicOrigin === 'ru') return true
  if (item.musicOrigin === 'intl') return false
  // Резервная эвристика для данных без явного признака происхождения.
  const haystack = [...(item.countries ?? []), ...(item.genres ?? [])]
  if (haystack.some((value) => RUSSIAN_SIGNAL.test(value))) return true
  return (item.countries ?? []).some((value) => /[А-Яа-яЁё]/.test(value))
}

const artistPopularityRank = (item: TitleItem): number => {
  if (typeof item.topRank === 'number' && Number.isFinite(item.topRank)) return item.topRank
  // Меньше слушателей → менее популярный → больший ранг.
  return Number.MAX_SAFE_INTEGER - (Number(item.popularityScore) || 0)
}

const takeTopByPopularityCount = (items: TitleItem[], count: number): TitleItem[] => {
  if (!items.length || count <= 0) return []
  if (count >= items.length) return items
  const sorted = [...items].sort((a, b) => artistPopularityRank(a) - artistPopularityRank(b))
  return sorted.slice(0, count)
}

export const musicDifficultyPool = (pool: TitleItem[], difficulty: DifficultyKey): TitleItem[] => {
  const config = DIFFICULTIES[difficulty] ?? DIFFICULTIES.hard

  const russian: TitleItem[] = []
  const foreign: TitleItem[] = []
  for (const item of pool) (isRussianArtist(item) ? russian : foreign).push(item)

  const targetTotal = Math.min(
    pool.length,
    Math.max(
      1,
      Math.ceil(russian.length * Math.max(0, config.ruPoolFraction) + foreign.length * Math.max(0, config.intlPoolFraction)),
    ),
  )

  const strictRussianOnly = config.ruShare >= 1
  let ruTarget = strictRussianOnly
    ? Math.min(russian.length, targetTotal)
    : Math.min(russian.length, Math.max(0, Math.round(targetTotal * Math.max(0, config.ruShare))))
  let intlTarget = strictRussianOnly ? 0 : Math.min(foreign.length, targetTotal - ruTarget)

  // Если одна группа закончилась, добираем остаток второй, не ломая strict RU-only режим.
  if (!strictRussianOnly && ruTarget + intlTarget < targetTotal) {
    const remainAfterIntl = targetTotal - (ruTarget + intlTarget)
    const extraRu = Math.min(Math.max(0, russian.length - ruTarget), remainAfterIntl)
    ruTarget += extraRu

    const remainAfterRu = targetTotal - (ruTarget + intlTarget)
    if (remainAfterRu > 0) {
      const extraIntl = Math.min(Math.max(0, foreign.length - intlTarget), remainAfterRu)
      intlTarget += extraIntl
    }
  }

  return [...takeTopByPopularityCount(russian, ruTarget), ...takeTopByPopularityCount(foreign, intlTarget)]
}

export const getMoscowDate = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date)

export const prettyDate = (date: string) => new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit', month: 'long', timeZone: 'Europe/Moscow',
}).format(new Date(`${date}T12:00:00+03:00`))

const hashIndex = (seed: string, length: number) => {
  let hash = 2166136261
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % length
}

const isAnimatedEntry = (item: TitleItem) =>
  (item.genres ?? []).some((genre) => /мультфильм|аниме|animation|anime/i.test(genre))

const looksLikeFeatureFilm = (item: TitleItem) => {
  const runtime = item.runtimeMinutes ?? null
  const year = item.year ?? null
  const endYear = item.endYear ?? null
  const hasMultipleYears = typeof year === 'number' && typeof endYear === 'number' && endYear > year
  return Boolean(runtime && runtime >= 75 && !hasMultipleYears)
}

const isAllowedInMode = (item: TitleItem, mode: TitleMode) => {
  if (item.mode !== mode) return false
  if (mode !== 'series') return true

  if (isAnimatedEntry(item)) return false
  if (looksLikeFeatureFilm(item)) return false
  return true
}

export const poolFor = (titles: TitleItem[], mode: TitleMode, period: PeriodKey) => {
  const from = PERIODS[period].fromYear
  return titles.filter((item) => {
    if (!isAllowedInMode(item, mode)) return false
    if (mode === 'diagnosis' || from === null) return true
    return typeof item.year === 'number' && item.year >= from
  })
}

export const dailyTitle = (pool: TitleItem[], mode: TitleMode, period: PeriodKey, date: string, salt = 0, variant = '') => {
  const safeSalt = Number.isFinite(salt) ? Math.trunc(salt) : 0
  const variantSuffix = variant ? `|${variant}` : ''
  return pool[hashIndex(`seans|${mode}|${period}|${date}|${safeSalt}${variantSuffix}`, pool.length)]
}

export const pickDailyVignette = <T,>(vignettes: T[], diagnosisId: string, date: string): T | null =>
  vignettes.length ? vignettes[hashIndex(`vignette|${diagnosisId}|${date}`, vignettes.length)] : null

export const normalize = (value: string) => value.toLocaleLowerCase('ru-RU')
  .replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, ' ').trim()

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

export const searchTitles = (pool: TitleItem[], query: string, excluded: Set<string>, searchIndex?: LibrarySearchIndex | null) => {
  const q = normalize(query)
  if (!q) return []

  const candidateIds = searchIndex ? candidateIdsFromIndex(searchIndex, q) : new Set<string>()
  const candidatePool = candidateIds.size
    ? pool.filter((item) => candidateIds.has(item.id))
    : pool

  return candidatePool.map((item) => {
    const names = [item.titleRu, item.titleOriginal, ...(item.alternativeTitles ?? [])].filter(Boolean).map(normalize)
    const exact = names.some((name) => name === q)
    const starts = names.some((name) => name.startsWith(q))
    const includes = names.some((name) => name.includes(q))
    const typo = q.length > 3 && names.some((name) => distance(name.slice(0, Math.max(q.length, 4)), q) <= (q.length > 7 ? 2 : 1))
    return { item, score: exact ? 0 : starts ? 1 : includes ? 2 : typo ? 3 : 99 }
  }).filter(({ item, score }) => score < 99 && !excluded.has(item.id))
    .sort((a, b) => a.score - b.score || a.item.titleRu.localeCompare(b.item.titleRu, 'ru-RU')).slice(0, 8).map(({ item }) => item)
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
  if (guess == null || answer == null) return { status: 'unknown', direction: null }
  const delta = Math.abs(guess - answer)
  return { status: delta <= match ? 'match' : delta <= close ? 'close' : 'miss', direction: delta <= match ? null : compareDirection(guess, answer, options) }
}
const list = (values: string[]) => values.length ? values.join(', ') : 'Нет данных'
const countryCode = (value: string) => {
  const firstChunk = value.split(',')[0]?.trim().toUpperCase() ?? ''
  if (/^[A-Z]{2}$/.test(firstChunk)) return firstChunk
  const fallback = value.toUpperCase().match(/\b[A-Z]{2}\b/)
  return fallback?.[0] ?? null
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
  if (guess == null || answer == null) return { status: 'unknown', direction: null }
  if (guess === answer) return { status: 'match', direction: null }
  const ratio = Math.max(guess, answer) / Math.max(1, Math.min(guess, answer))
  const direction = compareDirection(guess, answer, options)
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
  const guessFinal = guess.price.final
  const answerFinal = answer.price.final
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

const compareMusic = (guess: TitleItem, answer: TitleItem): Hint[] => {
  const guessCountries = countryCodes(guess.countries ?? [])
  const answerCountries = countryCodes(answer.countries ?? [])
  const guessGenres = guess.genres ?? []
  const answerGenres = answer.genres ?? []
  const guessType = guess.musicType ?? null
  const answerType = answer.musicType ?? null
  const guessTrack = guess.topTracks?.[0]?.title ?? null
  const answerTrack = answer.topTracks?.[0]?.title ?? null
  const guessAlbum = guess.topAlbums?.[0]?.title ?? null
  const answerAlbum = answer.topAlbums?.[0]?.title ?? null
  const guessListeners = guess.votes?.gamesPlayed ?? null
  const answerListeners = answer.votes?.gamesPlayed ?? null
  const guessActive = guess.musicIsActive
  const answerActive = answer.musicIsActive
  const guessRelated = guess.directors ?? []
  const answerRelated = answer.directors ?? []
  const guessMembers = guess.cast ?? []
  const answerMembers = answer.cast ?? []

  const year = numeric(guess.year, answer.year, 0, 2)
  const rank = numeric(guess.topRank, answer.topRank, 0, 20, { lowerIsUp: true })
  const listeners = reviewHint(guessListeners, answerListeners)
  const relatedNamesGuess = guessRelated.map((person) => person.nameRu || person.nameOriginal).filter(Boolean)
  const relatedNamesAnswer = answerRelated.map((person) => person.nameRu || person.nameOriginal).filter(Boolean)
  const relatedSet = new Set(relatedNamesAnswer.map(normalize))
  const membersNamesGuess = guessMembers.map((person) => person.nameRu || person.nameOriginal).filter(Boolean)
  const membersNamesAnswer = answerMembers.map((person) => person.nameRu || person.nameOriginal).filter(Boolean)
  const membersSet = new Set(membersNamesAnswer.map(normalize))
  const hasRelated = relatedNamesGuess.length > 0 || relatedNamesAnswer.length > 0
  const hasMembers = membersNamesGuess.length > 0 || membersNamesAnswer.length > 0
  const hasTrack = Boolean(guessTrack || answerTrack)
  const hasAlbum = Boolean(guessAlbum || answerAlbum)
  const hasListeners = guessListeners != null || answerListeners != null
  const hasRank = guess.topRank != null || answer.topRank != null
  const activeStatus = scalar(
    guessActive == null ? null : guessActive ? 'active' : 'inactive',
    answerActive == null ? null : answerActive ? 'active' : 'inactive',
  )

  const hints: Hint[] = [
    { key: 'year', label: 'Год дебюта', value: guess.year != null ? String(guess.year) : '—', ...year },
    ...(hasRank ? [{ key: 'rank', label: 'Место в топе', value: guess.topRank != null ? `#${guess.topRank}` : '—', ...rank } satisfies Hint] : []),
    { key: 'country', label: 'Страна', value: list(guessCountries), status: setStatus(guessCountries, answerCountries), direction: null, matchedValues: overlaps(guessCountries, answerCountries) },
    { key: 'genres', label: 'Жанры', value: list(guessGenres), status: setStatus(guessGenres, answerGenres), direction: null, matchedValues: overlaps(guessGenres, answerGenres) },
    { key: 'music_type', label: 'Тип артиста', value: guessType ?? '—', status: scalar(guessType, answerType), direction: null },
    { key: 'music_active', label: 'Статус', value: guessActive == null ? '—' : guessActive ? 'Активен' : 'Неактивен', status: activeStatus, direction: null },
    ...(hasTrack ? [{ key: 'top_track', label: 'Топ-трек', value: guessTrack ?? '—', status: scalar(guessTrack, answerTrack), direction: null } satisfies Hint] : []),
    ...(hasAlbum ? [{ key: 'top_album', label: 'Топ-альбом', value: guessAlbum ?? '—', status: scalar(guessAlbum, answerAlbum), direction: null } satisfies Hint] : []),
    ...(hasListeners ? [{ key: 'listeners', label: 'Слушатели Last.fm', value: formatNumber(guessListeners), ...listeners } satisfies Hint] : []),
    ...(hasRelated ? [{
      key: 'creator',
      label: 'Связанные артисты',
      value: list(relatedNamesGuess),
      status: setStatus(relatedNamesGuess, relatedNamesAnswer),
      direction: null,
      people: guessRelated.map((person) => ({ ...person, matched: relatedSet.has(normalize(person.nameRu || person.nameOriginal)) })),
    } satisfies Hint] : []),
    ...(hasMembers ? [{
      key: 'cast',
      label: 'Участники',
      value: list(membersNamesGuess),
      status: setStatus(membersNamesGuess, membersNamesAnswer),
      direction: null,
      people: guessMembers.map((person) => ({ ...person, matched: membersSet.has(normalize(person.nameRu || person.nameOriginal)) })),
    } satisfies Hint] : []),
  ]

  return guess.id === answer.id ? hints.map((hint) => ({ ...hint, status: 'match', direction: null })) : hints
}

export const compareTitles = (guess: TitleItem, answer: TitleItem): Hint[] => {
  if (guess.mode === 'diagnosis' || answer.mode === 'diagnosis') return compareDiagnoses(guess, answer)
  if (guess.mode === 'game' || answer.mode === 'game') return compareGames(guess, answer)
  if (guess.mode === 'music' || answer.mode === 'music') return compareMusic(guess, answer)
  if (guess.mode === 'anime' || answer.mode === 'anime') return compareAnimeTitles(guess, answer)
  return compareScreenTitles(guess, answer)
}

export const emptyStats = (): Stats => ({ played: 0, won: 0, currentStreak: 0, bestStreak: 0, distribution: Array(10).fill(0) })
export const resultText = (mode: TitleMode, date: string, period: PeriodKey, hints: Hint[][], won: boolean) => {
  const rows = hints.map((row) => row.map((hint) => hint.status === 'match' ? '🟩' : hint.status === 'close' || hint.status === 'partial' ? '🟨' : hint.status === 'unknown' ? '⬜' : '⬛').join('')).join('\n')
  const dailyLabel = mode === 'movie' ? 'Фильм дня' : mode === 'series' ? 'Сериал дня' : mode === 'anime' ? 'Аниме дня' : mode === 'game' ? 'Игра дня' : mode === 'music' ? 'Артист дня' : 'Диагноз дня'
  const icon = mode === 'game' ? '🎮' : mode === 'diagnosis' ? '🩺' : mode === 'anime' ? '🌸' : mode === 'music' ? '🎵' : '🎬'
  return `Сеанс — ${dailyLabel}\n${date} · ${PERIODS[period].label}\n${icon} ${won ? hints.length : 'X'}/10\n${rows}`
}
