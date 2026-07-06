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
  return titles.filter((item) => item.mode === mode && (from === null || item.year >= from))
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
    const names = [item.titleRu, item.titleOriginal, ...item.alternativeTitles].filter(Boolean).map(normalize)
    const exact = names.some((name) => name === q)
    const starts = names.some((name) => name.startsWith(q))
    const includes = names.some((name) => name.includes(q))
    const typo = q.length > 3 && names.some((name) => distance(name.slice(0, Math.max(q.length, 4)), q) <= (q.length > 7 ? 2 : 1))
    return { item, score: exact ? 0 : starts ? 1 : includes ? 2 : typo ? 3 : 99 }
  }).filter(({ item, score }) => score < 99 && !excluded.has(item.id))
    .sort((a, b) => a.score - b.score || b.item.popularityScore - a.item.popularityScore).slice(0, 8).map(({ item }) => item)
}

const setStatus = (guess: string[], answer: string[]): MatchStatus => {
  if (!guess.length || !answer.length) return 'unknown'
  const g = new Set(guess.map(normalize)); const a = new Set(answer.map(normalize))
  const shared = [...g].filter((value) => a.has(value)).length
  return shared === g.size && shared === a.size ? 'match' : shared ? 'partial' : 'miss'
}
const numeric = (guess: number | null | undefined, answer: number | null | undefined, match: number, close: number): { status: MatchStatus; direction: Direction } => {
  if (guess == null || answer == null) return { status: 'unknown', direction: null }
  const delta = Math.abs(guess - answer)
  return { status: delta <= match ? 'match' : delta <= close ? 'close' : 'miss', direction: delta <= match ? null : answer > guess ? 'up' : 'down' }
}
const list = (values: string[]) => values.length ? values.join(', ') : 'Нет данных'
const people = (values: TitleItem['cast']) => list(values.map((person) => person.nameRu || person.nameOriginal))

export const compareTitles = (guess: TitleItem, answer: TitleItem): Hint[] => {
  const year = numeric(guess.year, answer.year, 0, 2)
  const kp = numeric(guess.ratings.kinopoisk, answer.ratings.kinopoisk, 0.1, 0.3)
  const imdb = numeric(guess.ratings.imdb, answer.ratings.imdb, 0.1, 0.3)
  const runtime = numeric(guess.runtimeMinutes, answer.runtimeMinutes, 5, 15)
  const popularity = numeric(guess.popularityScore, answer.popularityScore, 3, 10)
  const guessCreators = guess.mode === 'series' && guess.showrunners.length ? guess.showrunners : guess.directors
  const answerCreators = answer.mode === 'series' && answer.showrunners.length ? answer.showrunners : answer.directors
  const creatorsG = guessCreators.map((p) => p.nameRu)
  const creatorsA = answerCreators.map((p) => p.nameRu)
  const creatorNames = new Set(creatorsA.map(normalize))
  const castNames = new Set(answer.cast.map((person) => normalize(person.nameRu || person.nameOriginal)))
  const answerGenreNames = new Set(answer.genres.map((genre) => normalize(genre)))
  const matchedGenres = guess.genres.filter((genre) => answerGenreNames.has(normalize(genre)))
  const hints: Hint[] = [
    { key: 'year', label: 'Год', value: String(guess.year), ...year },
    { key: 'country', label: 'Страна', value: list(guess.countries), status: setStatus(guess.countries, answer.countries), direction: null },
    { key: 'genres', label: 'Жанры', value: list(guess.genres), status: setStatus(guess.genres, answer.genres), direction: null, matchedValues: matchedGenres },
    { key: 'creator', label: guess.mode === 'series' ? 'Авторы' : 'Режиссёр', value: list(creatorsG), status: setStatus(creatorsG, creatorsA), direction: null, people: guessCreators.map((person) => ({ ...person, matched: creatorNames.has(normalize(person.nameRu || person.nameOriginal)) })) },
    { key: 'cast', label: 'Актёры', value: people(guess.cast), status: setStatus(guess.cast.map((p) => p.nameRu), answer.cast.map((p) => p.nameRu)), direction: null, people: guess.cast.map((person) => ({ ...person, matched: castNames.has(normalize(person.nameRu || person.nameOriginal)) })) },
    { key: 'kp', label: 'Кинопоиск', value: guess.ratings.kinopoisk?.toFixed(1) ?? '—', ...kp },
    { key: 'imdb', label: 'IMDb', value: guess.ratings.imdb?.toFixed(1) ?? '—', ...imdb },
    { key: 'runtime', label: 'Хронометраж', value: guess.runtimeMinutes ? `${guess.runtimeMinutes} мин` : '—', ...runtime },
    { key: 'age', label: 'Возраст', value: guess.ageRating ?? '—', status: guess.ageRating && answer.ageRating ? (guess.ageRating === answer.ageRating ? 'match' : 'miss') : 'unknown', direction: null },
    { key: 'popularity', label: 'Популярность', value: `${guess.popularityScore}/100`, ...popularity },
  ]
  return guess.id === answer.id ? hints.map((hint) => ({ ...hint, status: 'match', direction: null })) : hints
}

export const emptyStats = (): Stats => ({ played: 0, won: 0, currentStreak: 0, bestStreak: 0, distribution: Array(10).fill(0) })
export const resultText = (mode: TitleMode, date: string, period: PeriodKey, hints: Hint[][], won: boolean) => {
  const rows = hints.map((row) => row.map((hint) => hint.status === 'match' ? '🟩' : hint.status === 'close' || hint.status === 'partial' ? '🟨' : hint.status === 'unknown' ? '⬜' : '⬛').join('')).join('\n')
  return `Сеанс — ${mode === 'movie' ? 'Фильм дня' : 'Сериал дня'}\n${date} · ${PERIODS[period].label}\n🎬 ${won ? hints.length : 'X'}/10\n${rows}`
}
