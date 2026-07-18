export type CityPoolMode = 'capitals' | 'capitals-popular' | 'all'

export type CityRanks = {
  economy: number | null
  humanCapital: number | null
  qualityOfLife: number | null
  ecology: number | null
  governance: number | null
}

export type CityItem = {
  id: string
  titleRu: string
  titleOriginal: string
  country: string
  countryFlagUrl: string | null
  continent: string
  languages: string[]
  population: number | null
  cityFlagUrl: string | null
  coatOfArmsUrl: string | null
  alternativeTitles: string[]
  ranks: CityRanks
  timezone: string
  popular: boolean
  capital: boolean
  plotHint?: string
  facts?: string[]
}

export type CityHintStatus = 'match' | 'close' | 'partial' | 'miss' | 'unknown'
export type CityHint = {
  key: string
  label: string
  value: string
  status: CityHintStatus
  direction: 'up' | 'down' | null
}

export type CitySessionStatus = 'playing' | 'won' | 'lost'
export type CityAssistHintKey = 'description' | 'fact' | 'info'
export type CityHintCheckpoint = 5 | 8
export type CityAssistHintChoice = {
  checkpoint: CityHintCheckpoint
  key: CityAssistHintKey
  value: string
  sourceKey?: string
}
export type CityAssistHintOption = {
  key: CityAssistHintKey
  title: string
  subtitle: string
  value: string
  sourceKey?: string
}
export type CitySession = {
  mode: CityPoolMode
  date: string
  answerId: string
  attemptIds: string[]
  hintChoices: CityAssistHintChoice[]
  dismissedHintRounds: CityHintCheckpoint[]
  status: CitySessionStatus
  updatedAt: number
}

export type CityDailySummary = {
  status: 'new' | 'active' | 'completed'
  attempts: number | null
  mode: CityPoolMode | null
}

export const CITY_POOL_OPTIONS: Array<{ mode: CityPoolMode; label: string; shortLabel: string; description: string }> = [
  { mode: 'capitals', label: 'Столицы', shortLabel: 'Столицы', description: 'Только столицы государств' },
  { mode: 'capitals-popular', label: 'Столицы и популярные', shortLabel: 'Столицы +', description: 'Столицы и самые узнаваемые города' },
  { mode: 'all', label: 'Все города', shortLabel: 'Все', description: 'Полный набор без ограничений' },
]

const normalize = (value: string) => String(value ?? '')
  .normalize('NFKD')
  .toLocaleLowerCase('ru-RU')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/ё/g, 'е')
  .replace(/[^a-zа-я0-9]+/gi, ' ')
  .trim()

const hashValue = (seed: string) => {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export const cityPool = (items: CityItem[], mode: CityPoolMode) => {
  if (mode === 'capitals') return items.filter((item) => item.capital)
  if (mode === 'capitals-popular') return items.filter((item) => item.capital || item.popular)
  return items
}

export const dailyCity = (items: CityItem[], mode: CityPoolMode, date: string) => {
  const pool = cityPool(items, mode)
  return pool.length ? pool[hashValue(`shoditsa|city|${mode}|${date}|v2`) % pool.length] : null
}

export const searchCities = (items: CityItem[], query: string, used = new Set<string>()) => {
  const normalizedQuery = normalize(query)
  if (!normalizedQuery) return []

  return items.map((item) => {
    const names = [item.titleRu, item.titleOriginal, ...item.alternativeTitles].map(normalize).filter(Boolean)
    const exact = names.some((name) => name === normalizedQuery)
    const starts = names.some((name) => name.startsWith(normalizedQuery))
    const includes = names.some((name) => name.includes(normalizedQuery))
    return { item, score: exact ? 0 : starts ? 1 : includes ? 2 : 99 }
  })
    .filter(({ item, score }) => score < 99 && !used.has(item.id))
    .sort((left, right) => left.score - right.score || left.item.titleRu.localeCompare(right.item.titleRu, 'ru-RU'))
    .slice(0, 8)
    .map(({ item }) => item)
}

const scalarStatus = (guess: string, answer: string): CityHintStatus => {
  if (!guess || !answer) return 'unknown'
  return normalize(guess) === normalize(answer) ? 'match' : 'miss'
}

const listStatus = (guess: string[], answer: string[]): CityHintStatus => {
  if (!guess.length || !answer.length) return 'unknown'
  const guessSet = new Set(guess.map(normalize))
  const answerSet = new Set(answer.map(normalize))
  const shared = [...guessSet].filter((value) => answerSet.has(value)).length
  return shared === guessSet.size && shared === answerSet.size ? 'match' : shared ? 'partial' : 'miss'
}

const numberHint = (
  key: string,
  label: string,
  guess: number | null,
  answer: number | null,
  format: (value: number) => string,
  matchDelta: number,
  closeDelta: number,
  lowerIsUp = false,
): CityHint => {
  if (guess == null || answer == null) return { key, label, value: 'Нет данных', status: 'unknown', direction: null }
  const delta = Math.abs(guess - answer)
  const status: CityHintStatus = delta <= matchDelta ? 'match' : delta <= closeDelta ? 'close' : 'miss'
  const direction = status === 'match' ? null : lowerIsUp ? (answer < guess ? 'up' : 'down') : (answer > guess ? 'up' : 'down')
  return { key, label, value: format(guess), status, direction }
}

const timezoneHours = (value: string) => {
  const match = String(value ?? '').match(/GMT\s*([+-])(\d{1,2})(?::(\d{2}))?/i)
  if (!match) return null
  const hours = Number(match[2]) + Number(match[3] ?? 0) / 60
  return match[1] === '-' ? -hours : hours
}

const populationHint = (guess: number | null, answer: number | null): CityHint => {
  if (guess == null || answer == null) return { key: 'population', label: 'Население', value: 'Нет данных', status: 'unknown', direction: null }
  const relativeDelta = Math.abs(guess - answer) / Math.max(answer, 1)
  const status: CityHintStatus = relativeDelta <= 0.05 ? 'match' : relativeDelta <= 0.2 ? 'close' : 'miss'
  return {
    key: 'population',
    label: 'Население',
    value: new Intl.NumberFormat('ru-RU').format(guess),
    status,
    direction: status === 'match' ? null : answer > guess ? 'up' : 'down',
  }
}

export const compareCities = (guess: CityItem, answer: CityItem): CityHint[] => {
  const guessTimezone = timezoneHours(guess.timezone)
  const answerTimezone = timezoneHours(answer.timezone)
  const rank = (key: keyof CityRanks, label: string) => numberHint(
    key,
    label,
    guess.ranks[key],
    answer.ranks[key],
    (value) => `№ ${value}`,
    10,
    50,
    true,
  )

  return [
    { key: 'country', label: 'Страна', value: guess.country || 'Нет данных', status: scalarStatus(guess.country, answer.country), direction: null },
    { key: 'continent', label: 'Континент', value: guess.continent || 'Нет данных', status: scalarStatus(guess.continent, answer.continent), direction: null },
    { key: 'languages', label: 'Языки', value: guess.languages.join(', ') || 'Нет данных', status: listStatus(guess.languages, answer.languages), direction: null },
    populationHint(guess.population, answer.population),
    numberHint('timezone', 'Часовой пояс', guessTimezone, answerTimezone, () => guess.timezone || 'Нет данных', 0.25, 2),
    rank('economy', 'Экономика'),
    rank('humanCapital', 'Человеческий капитал'),
    rank('qualityOfLife', 'Качество жизни'),
    rank('ecology', 'Экология'),
    rank('governance', 'Работа властей'),
  ]
}

const cleanAssistText = (value: unknown) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
const formatPopulation = (value: number) => new Intl.NumberFormat('ru-RU').format(value)

const cityInfoCandidates = (answer: CityItem) => [
  answer.continent ? { sourceKey: 'continent', value: `Континент: ${answer.continent}` } : null,
  answer.languages.length ? { sourceKey: 'languages', value: `Языки: ${answer.languages.join(', ')}` } : null,
  answer.timezone ? { sourceKey: 'timezone', value: `Часовой пояс: ${answer.timezone}` } : null,
  answer.population != null ? { sourceKey: 'population', value: `Население: ${formatPopulation(answer.population)}` } : null,
  answer.country ? { sourceKey: 'country', value: `Страна: ${answer.country}` } : null,
  answer.ranks.economy != null ? { sourceKey: 'economy', value: `Экономика: № ${answer.ranks.economy}` } : null,
  answer.ranks.humanCapital != null ? { sourceKey: 'humanCapital', value: `Человеческий капитал: № ${answer.ranks.humanCapital}` } : null,
  answer.ranks.qualityOfLife != null ? { sourceKey: 'qualityOfLife', value: `Качество жизни: № ${answer.ranks.qualityOfLife}` } : null,
  answer.ranks.ecology != null ? { sourceKey: 'ecology', value: `Экология: № ${answer.ranks.ecology}` } : null,
  answer.ranks.governance != null ? { sourceKey: 'governance', value: `Работа властей: № ${answer.ranks.governance}` } : null,
].filter((candidate): candidate is { sourceKey: string; value: string } => Boolean(candidate))

export const cityAssistHintOptions = (
  answer: CityItem,
  attempts: CityItem[],
  choices: CityAssistHintChoice[],
): CityAssistHintOption[] => {
  const options: CityAssistHintOption[] = []
  const usedKeys = new Set(choices.map((choice) => choice.key))
  const description = cleanAssistText(answer.plotHint)
  if (description && !usedKeys.has('description')) {
    options.push({
      key: 'description',
      title: 'Описание города',
      subtitle: 'Атмосферная подсказка без названия и прямого спойлера',
      value: description,
    })
  }

  const descriptionMatch = normalize(description)
  const fact = (answer.facts ?? []).map(cleanAssistText)
    .find((candidate) => candidate && normalize(candidate) !== descriptionMatch) ?? ''
  if (fact && !usedKeys.has('fact')) {
    options.push({
      key: 'fact',
      title: 'Интересный факт',
      subtitle: 'Характерная деталь, подтверждённая источником',
      value: fact,
    })
  }

  const revealedKeys = new Set(attempts.flatMap((attempt) => compareCities(attempt, answer)
    .filter((hint) => hint.status === 'match')
    .map((hint) => hint.key)))
  const openedInfoKeys = new Set(choices.flatMap((choice) => choice.key === 'info' && choice.sourceKey ? [choice.sourceKey] : []))
  const info = cityInfoCandidates(answer).find((candidate) => !revealedKeys.has(candidate.sourceKey) && !openedInfoKeys.has(candidate.sourceKey))
  if (info) {
    options.push({
      key: 'info',
      title: 'Неоткрытая информация',
      subtitle: 'Точный признак, который ещё не совпадал в ваших попытках',
      value: info.value,
      sourceKey: info.sourceKey,
    })
  }
  return options
}

export const availableCityHintRounds = (
  attemptsCount: number,
  choices: CityAssistHintChoice[],
): CityHintCheckpoint[] => ([5, 8] as CityHintCheckpoint[])
  .filter((round) => attemptsCount >= round && !choices.some((choice) => choice.checkpoint === round))

const storageKey = (mode: CityPoolMode, date: string) => `shoditsa:city:v1:${date}:${mode}`

export const loadCitySession = (mode: CityPoolMode, date: string): CitySession | null => {
  if (typeof window === 'undefined') return null
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey(mode, date)) ?? 'null') as Partial<CitySession> | null
    if (!parsed || parsed.mode !== mode || parsed.date !== date || typeof parsed.answerId !== 'string' || !Array.isArray(parsed.attemptIds)) return null
    if (parsed.status !== 'playing' && parsed.status !== 'won' && parsed.status !== 'lost') return null
    return {
      mode,
      date,
      answerId: parsed.answerId,
      attemptIds: parsed.attemptIds.filter((value): value is string => typeof value === 'string').slice(0, 10),
      hintChoices: Array.isArray(parsed.hintChoices) ? parsed.hintChoices.flatMap((choice) => {
        if (!choice || typeof choice !== 'object') return []
        const value = choice as Partial<CityAssistHintChoice>
        if ((value.checkpoint !== 5 && value.checkpoint !== 8)
          || (value.key !== 'description' && value.key !== 'fact' && value.key !== 'info')
          || typeof value.value !== 'string' || !value.value.trim()) return []
        return [{ checkpoint: value.checkpoint, key: value.key, value: value.value.trim(), ...(typeof value.sourceKey === 'string' && value.sourceKey ? { sourceKey: value.sourceKey } : {}) }]
      }).slice(0, 2) : [],
      dismissedHintRounds: Array.isArray(parsed.dismissedHintRounds)
        ? parsed.dismissedHintRounds.filter((round): round is CityHintCheckpoint => round === 5 || round === 8)
        : [],
      status: parsed.status,
      updatedAt: Number(parsed.updatedAt) || 0,
    }
  } catch {
    return null
  }
}

export const saveCitySession = (session: CitySession) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(storageKey(session.mode, session.date), JSON.stringify(session))
}

export const cityDailySummary = (date: string): CityDailySummary => {
  const sessions = CITY_POOL_OPTIONS
    .map(({ mode }) => loadCitySession(mode, date))
    .filter((session): session is CitySession => Boolean(session))
    .sort((left, right) => right.updatedAt - left.updatedAt)
  const active = sessions.find((session) => session.status === 'playing' && session.attemptIds.length > 0)
  const completed = sessions.find((session) => session.status === 'won' || session.status === 'lost')
  const selected = active ?? completed ?? sessions[0] ?? null
  return {
    status: active ? 'active' : completed ? 'completed' : 'new',
    attempts: selected?.attemptIds.length ?? null,
    mode: selected?.mode ?? null,
  }
}
