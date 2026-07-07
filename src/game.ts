import type { Direction, Hint, MatchStatus, PeriodKey, Stats, TitleItem, TitleMode } from './types'

export const PERIODS: Record<PeriodKey, { label: string; short: string; fromYear: number | null }> = {
  all: { label: 'Все годы', short: 'Весь экран', fromYear: null },
  from_1960: { label: 'С 1960 года', short: '1960+', fromYear: 1960 },
  from_1980: { label: 'С 1980 года', short: '1980+', fromYear: 1980 },
  from_1990: { label: 'С 1990 года', short: '1990+', fromYear: 1990 },
  from_2000: { label: 'С 2000 года', short: '2000+', fromYear: 2000 },
  from_2010: { label: 'С 2010 года', short: '2010+', fromYear: 2010 },
  from_2020: { label: 'С 2020 года', short: '2020+', fromYear: 2020 },
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

export const poolFor = (titles: TitleItem[], mode: TitleMode, period: PeriodKey) => {
  const from = PERIODS[period].fromYear
  return titles.filter((item) => {
    if (item.mode !== mode) return false
    if (mode === 'diagnosis' || from === null) return true
    return typeof item.year === 'number' && item.year >= from
  })
}

export const dailyTitle = (pool: TitleItem[], mode: TitleMode, period: PeriodKey, date: string) =>
  pool[hashIndex(`seans|${mode}|${period}|${date}`, pool.length)]

export const normalize = (value: string) => value.toLocaleLowerCase('ru-RU')
  .replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, ' ').trim()

const distance = (a: string, b: string) => {
  const matrix = Array.from({ length: b.length + 1 }, (_, i) => [i])
  for (let j = 0; j <= a.length; j += 1) matrix[0][j] = j
  for (let i = 1; i <= b.length; i += 1) for (let j = 1; j <= a.length; j += 1) {
    matrix[i][j] = b[i - 1] === a[j - 1] ? matrix[i - 1][j - 1] : Math.min(matrix[i - 1][j - 1], matrix[i][j - 1], matrix[i - 1][j]) + 1
  }
  return matrix[b.length][a.length]
}

export const searchTitles = (pool: TitleItem[], query: string, excluded: Set<string>) => {
  const q = normalize(query)
  if (!q) return []
  return pool.map((item) => {
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
const numeric = (guess: number | null | undefined, answer: number | null | undefined, match: number, close: number): { status: MatchStatus; direction: Direction } => {
  if (guess == null || answer == null) return { status: 'unknown', direction: null }
  const delta = Math.abs(guess - answer)
  return { status: delta <= match ? 'match' : delta <= close ? 'close' : 'miss', direction: delta <= match ? null : answer > guess ? 'up' : 'down' }
}
const list = (values: string[]) => values.length ? values.join(', ') : 'Нет данных'
const people = (values: TitleItem['cast']) => list((values ?? []).map((person) => person.nameRu || person.nameOriginal).filter(Boolean))
const overlaps = (guess: string[], answer: string[]) => {
  const answerSet = new Set(answer.map(normalize))
  return guess.filter((value) => answerSet.has(normalize(value)))
}
const formatNumber = (value: number | null | undefined) => value == null ? '—' : new Intl.NumberFormat('ru-RU').format(value)
const gameScore = (value: number | null | undefined) => value == null ? null : Math.round(value)

const reviewHint = (guess: number | null | undefined, answer: number | null | undefined): { status: MatchStatus; direction: Direction } => {
  if (!guess || !answer) return { status: 'unknown', direction: null }
  if (guess === answer) return { status: 'match', direction: null }
  const ratio = Math.max(guess, answer) / Math.max(1, Math.min(guess, answer))
  if (ratio <= 1.25) return { status: 'close', direction: answer > guess ? 'up' : 'down' }
  if (ratio <= 2) return { status: 'partial', direction: answer > guess ? 'up' : 'down' }
  return { status: 'miss', direction: answer > guess ? 'up' : 'down' }
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
  if (guess.price.isFree && answer.price.isFree) return { status: 'match', direction: null }
  if (guess.price.isFree !== answer.price.isFree) return { status: 'miss', direction: null }
  if (guess.price.final == null || answer.price.final == null) return { status: 'unknown', direction: null }
  const delta = Math.abs(guess.price.final - answer.price.final)
  return {
    status: delta <= 10_000 ? 'match' : delta <= 35_000 ? 'close' : 'miss',
    direction: delta <= 10_000 ? null : answer.price.final > guess.price.final ? 'up' : 'down',
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
  const guessIcd = [...(guess.icd10 ?? []), ...(guess.icdGroup ? [guess.icdGroup] : [])]
  const answerIcd = [...(answer.icd10 ?? []), ...(answer.icdGroup ? [answer.icdGroup] : [])]

  const hints: Hint[] = [
    { key: 'body_systems', label: 'Система', value: list(guessBodySystems), status: setStatus(guessBodySystems, answerBodySystems), direction: null, matchedValues: overlaps(guessBodySystems, answerBodySystems) },
    { key: 'disease_types', label: 'Тип', value: list(guessDiseaseTypes), status: setStatus(guessDiseaseTypes, answerDiseaseTypes), direction: null, matchedValues: overlaps(guessDiseaseTypes, answerDiseaseTypes) },
    { key: 'course', label: 'Течение', value: list(guessCourse), status: setStatus(guessCourse, answerCourse), direction: null, matchedValues: overlaps(guessCourse, answerCourse) },
    { key: 'contagiousness', label: 'Заразность', value: guess.contagiousness ?? 'Нет данных', status: scalar(guess.contagiousness, answer.contagiousness), direction: null },
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
    { key: 'runtime', label: 'Хронометраж', value: guess.runtimeMinutes ? `${guess.runtimeMinutes} мин` : '—', ...runtime },
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

  const year = numeric(guess.year, answer.year, 0, 2)
  const rank = numeric(guess.topRank, answer.topRank, 0, 15)
  const steamPositive = numeric(guessSteamPositive, answerSteamPositive, 1, 5)
  const metacritic = numeric(guessMeta, answerMeta, 1, 5)
  const reviews = reviewHint(guess.votes?.steamReviews, answer.votes?.steamReviews)
  const price = gamePriceHint(guess, answer)
  const hasGenres = guessGenres.length > 0 || answerGenres.length > 0
  const hasSteamCategories = guessCategories.length > 0 || answerCategories.length > 0
  const hasPlatforms = guessPlatforms.length > 0 || answerPlatforms.length > 0
  const hasDevelopers = guessDevelopers.length > 0 || answerDevelopers.length > 0
  const hasPublishers = guessPublishers.length > 0 || answerPublishers.length > 0
  const hasSteamPositive = guessSteamPositive != null || answerSteamPositive != null
  const hasMetacritic = guessMeta != null || answerMeta != null
  const hasReviews = Boolean(guess.votes?.steamReviews) || Boolean(answer.votes?.steamReviews)
  const hasPrice = Boolean(guess.price) || Boolean(answer.price)
  const hasAge = Boolean(guess.ageRating) || Boolean(answer.ageRating)

  const hints: Hint[] = [
    { key: 'year', label: 'Год', value: guess.year != null ? String(guess.year) : '—', ...year },
    { key: 'rank', label: 'Место в топе', value: guess.topRank != null ? `#${guess.topRank}` : '—', ...rank },
    ...(hasGenres ? [{ key: 'genres', label: 'Жанры', value: list(guessGenres), status: setStatus(guessGenres, answerGenres), direction: null, matchedValues: overlaps(guessGenres, answerGenres) } satisfies Hint] : []),
    ...(hasSteamCategories ? [{ key: 'steam_categories', label: 'Категории', value: list(guessCategories), status: setStatus(guessCategories, answerCategories), direction: null, matchedValues: overlaps(guessCategories, answerCategories) } satisfies Hint] : []),
    ...(hasPlatforms ? [{ key: 'platforms', label: 'Платформы', value: list(guessPlatforms), status: setStatus(guessPlatforms, answerPlatforms), direction: null, matchedValues: overlaps(guessPlatforms, answerPlatforms) } satisfies Hint] : []),
    ...(hasDevelopers ? [{ key: 'developer', label: 'Разработчик', value: list(guessDevelopers), status: setStatus(guessDevelopers, answerDevelopers), direction: null, matchedValues: overlaps(guessDevelopers, answerDevelopers) } satisfies Hint] : []),
    ...(hasPublishers ? [{ key: 'publisher', label: 'Издатель', value: list(guessPublishers), status: setStatus(guessPublishers, answerPublishers), direction: null, matchedValues: overlaps(guessPublishers, answerPublishers) } satisfies Hint] : []),
    ...(hasSteamPositive ? [{ key: 'steam_positive', label: 'Позитив Steam', value: guessSteamPositive != null ? `${guessSteamPositive}%` : '—', ...steamPositive } satisfies Hint] : []),
    ...(hasMetacritic ? [{ key: 'metacritic', label: 'Metacritic', value: formatNumber(guessMeta), ...metacritic } satisfies Hint] : []),
    ...(hasReviews ? [{ key: 'reviews', label: 'Отзывы Steam', value: formatNumber(guess.votes?.steamReviews), ...reviews } satisfies Hint] : []),
    ...(hasPrice ? [{ key: 'price', label: 'Цена', value: gamePriceLabel(guess), ...price } satisfies Hint] : []),
    ...(hasAge ? [{ key: 'age', label: 'Возраст', value: guess.ageRating ?? '—', status: scalar(guess.ageRating, answer.ageRating), direction: null } satisfies Hint] : []),
  ]

  return guess.id === answer.id ? hints.map((hint) => ({ ...hint, status: 'match', direction: null })) : hints
}

export const compareTitles = (guess: TitleItem, answer: TitleItem): Hint[] => {
  if (guess.mode === 'diagnosis' || answer.mode === 'diagnosis') return compareDiagnoses(guess, answer)
  if (guess.mode === 'game' || answer.mode === 'game') return compareGames(guess, answer)
  return compareScreenTitles(guess, answer)
}

export const emptyStats = (): Stats => ({ played: 0, won: 0, currentStreak: 0, bestStreak: 0, distribution: Array(10).fill(0) })
export const resultText = (mode: TitleMode, date: string, period: PeriodKey, hints: Hint[][], won: boolean) => {
  const rows = hints.map((row) => row.map((hint) => hint.status === 'match' ? '🟩' : hint.status === 'close' || hint.status === 'partial' ? '🟨' : hint.status === 'unknown' ? '⬜' : '⬛').join('')).join('\n')
  const dailyLabel = mode === 'movie' ? 'Фильм дня' : mode === 'series' ? 'Сериал дня' : mode === 'game' ? 'Игра дня' : 'Диагноз дня'
  const icon = mode === 'game' ? '🎮' : mode === 'diagnosis' ? '🩺' : '🎬'
  return `Сеанс — ${dailyLabel}\n${date} · ${PERIODS[period].label}\n${icon} ${won ? hints.length : 'X'}/10\n${rows}`
}
