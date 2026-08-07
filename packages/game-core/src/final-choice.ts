import type {
  FinalChoiceCandidateSnapshot,
  FinalChoiceFactSnapshot,
  FinalChoiceSnapshot,
  Hint,
  TitleItem,
  TitleMode,
} from '@shoditsa/contracts'
import { compareTitles, isKnownComparisonText } from './index.js'

export const FINAL_CHOICE_ALGORITHM_VERSION = 2

export type FinalChoiceCandidateRole = 'answer' | 'categorical' | 'numeric' | 'balanced'
export type FinalChoiceGenerationSource = 'bank' | 'runtime'

type FactKind = 'categorical' | 'numeric' | 'additional'
type FactDefinition = {
  key: string
  sourceKeys: readonly string[]
  kind: FactKind
  format: (item: TitleItem) => string | null
  ariaLabel: string
}
type ModeConfig = {
  primaryMeta: (item: TitleItem) => string
  facts: readonly FactDefinition[]
  weights: Readonly<Record<string, number>>
}

const compact = (values: Array<string | null | undefined>, limit = 2) => values
  .map((value) => String(value ?? '').replace(/\s+/g, ' ').trim())
  .filter(isKnownComparisonText)
  .slice(0, limit)
  .join(' · ')

const compactNumber = (value: number) => new Intl.NumberFormat('ru-RU', {
  notation: value >= 1_000_000 ? 'compact' : 'standard',
  maximumFractionDigits: 1,
}).format(value)

const firstRating = (item: TitleItem) => {
  if (item.ratings?.kinopoisk != null) return `КП ${item.ratings.kinopoisk.toFixed(1).replace('.', ',')}`
  if (item.ratings?.imdb != null) return `IMDb ${item.ratings.imdb.toFixed(1).replace('.', ',')}`
  return null
}

const fact = (
  key: string,
  sourceKeys: readonly string[],
  kind: FactKind,
  ariaLabel: string,
  format: FactDefinition['format'],
): FactDefinition => ({ key, sourceKeys, kind, ariaLabel, format })

export const FINAL_CHOICE_MODE_CONFIG: Record<TitleMode, ModeConfig> = {
  movie: {
    primaryMeta: (item) => item.year ? String(item.year) : 'Год не указан',
    facts: [
      fact('countries', ['country'], 'categorical', 'Страны', (item) => compact(item.countries ?? []) || null),
      fact('genres', ['genres'], 'categorical', 'Жанры', (item) => compact(item.genres ?? []) || null),
      fact('runtime_rating', ['runtime', 'kp', 'imdb'], 'numeric', 'Хронометраж и рейтинг', (item) => compact([
        item.runtimeMinutes ? `${item.runtimeMinutes} мин` : null,
        firstRating(item),
      ]) || null),
      fact('age', ['age'], 'additional', 'Возрастной рейтинг', (item) => isKnownComparisonText(item.ageRating) ? item.ageRating : null),
    ],
    weights: { countries: 1.15, genres: 1.25, runtime_rating: 1, age: 0.7 },
  },
  series: {
    primaryMeta: (item) => item.year
      ? item.endYear && item.endYear !== item.year ? `${item.year}–${item.endYear}` : String(item.year)
      : 'Период не указан',
    facts: [
      fact('countries', ['country'], 'categorical', 'Страны', (item) => compact(item.countries ?? []) || null),
      fact('genres', ['genres'], 'categorical', 'Жанры', (item) => compact(item.genres ?? []) || null),
      fact('seasons_status', ['seasons', 'series_status'], 'numeric', 'Сезоны и статус', (item) => compact([
        item.seasonsCount != null ? `${item.seasonsCount} сез.` : null,
        item.seriesStatus,
      ]) || null),
      fact('ratings', ['kp', 'imdb'], 'numeric', 'Рейтинг', firstRating),
    ],
    weights: { countries: 1.1, genres: 1.25, seasons_status: 1.1, ratings: 0.8 },
  },
  anime: {
    primaryMeta: (item) => item.year ? String(item.year) : 'Год не указан',
    facts: [
      fact('format_status', ['anime_kind', 'anime_status'], 'categorical', 'Формат и статус', (item) => compact([item.animeKind, item.animeStatus]) || null),
      fact('genres', ['genres'], 'categorical', 'Жанры', (item) => compact(item.genres ?? []) || null),
      fact('episodes', ['episodes', 'episodes_aired'], 'numeric', 'Эпизоды', (item) => {
        const episodes = item.episodes ?? item.animeEpisodesAired
        return episodes != null ? `${episodes} эп.` : null
      }),
      fact('studio', ['studio'], 'categorical', 'Студия', (item) => compact(item.studios ?? []) || null),
      fact('shikimori', ['shiki', 'rank'], 'numeric', 'Рейтинг Shikimori', (item) => item.shikimoriScore != null ? `Shikimori ${item.shikimoriScore.toFixed(2).replace('.', ',')}` : null),
    ],
    weights: { format_status: 1.1, genres: 1.25, episodes: 1, studio: 0.9, shikimori: 0.7 },
  },
  game: {
    primaryMeta: (item) => item.year ? String(item.year) : 'Год не указан',
    facts: [
      fact('genres', ['genres', 'steam_categories'], 'categorical', 'Жанры', (item) => compact(item.genres ?? item.steamCategories ?? []) || null),
      fact('platforms', ['platforms'], 'categorical', 'Платформы', (item) => compact(item.platforms ?? [], 3) || null),
      fact('developer', ['developer'], 'categorical', 'Разработчик', (item) => compact(item.developers ?? []) || null),
      fact('steam_metacritic', ['steam_positive', 'metacritic'], 'numeric', 'Рейтинги Steam и Metacritic', (item) => compact([
        item.ratings?.steamPositivePercent != null
          ? `Steam ${Math.round(item.ratings.steamPositivePercent)}%`
          : null,
        (item.ratings?.metacritic ?? item.metacritic) != null
          ? `MC ${Math.round(item.ratings?.metacritic ?? item.metacritic ?? 0)}`
          : null,
      ]) || null),
      fact('players', ['players', 'rank'], 'numeric', 'Число игроков', (item) => item.votes?.gamesPlayed != null ? `${compactNumber(item.votes.gamesPlayed)} игроков` : item.topRank != null ? `Топ №${item.topRank}` : null),
    ],
    weights: { genres: 1.25, platforms: 1.05, developer: 0.9, steam_metacritic: 1, players: 0.75 },
  },
  music: {
    primaryMeta: (item) => item.activityStartYear ?? item.year
      ? String(item.activityStartYear ?? item.year)
      : 'Период не указан',
    facts: [
      fact('countries', ['country'], 'categorical', 'Страна', (item) => compact(item.countries ?? []) || null),
      fact('genres', ['genres'], 'categorical', 'Жанры', (item) => compact(item.genres ?? []) || null),
      fact('type_scene', ['music_type', 'music_origin'], 'categorical', 'Тип и сцена', (item) => compact([
        item.musicType,
        item.musicOrigin === 'ru' ? 'русскоязычная сцена' : item.musicOrigin === 'intl' ? 'международная сцена' : null,
      ]) || null),
      fact('activity', ['activity_start_year', 'decade', 'music_active'], 'numeric', 'Активность', (item) => compact([
        item.activityStartYear != null ? `с ${item.activityStartYear}` : null,
        item.musicIsActive === true ? 'активен' : item.musicIsActive === false ? 'карьера завершена' : null,
      ]) || null),
    ],
    weights: { countries: 1.15, genres: 1.25, type_scene: 1, activity: 0.9 },
  },
  city: {
    primaryMeta: (item) => item.country || 'Страна не указана',
    facts: [
      fact('continent_languages', ['continent', 'languages'], 'categorical', 'Континент и языки', (item) => compact([
        item.continent,
        compact(item.languages ?? []),
      ]) || null),
      fact('population_timezone', ['population', 'timezone'], 'numeric', 'Население и часовой пояс', (item) => compact([
        item.population != null ? compactNumber(item.population) : null,
        item.timezone,
      ]) || null),
      fact('oxford', ['economy', 'humanCapital', 'qualityOfLife', 'ecology', 'governance'], 'numeric', 'Показатели Oxford', (item) => {
        const ranks = item.ranks
        return compact([
          ranks?.economy != null ? `Экономика №${ranks.economy}` : null,
          ranks?.qualityOfLife != null ? `Жизнь №${ranks.qualityOfLife}` : null,
        ]) || null
      }),
    ],
    weights: { continent_languages: 1.2, population_timezone: 1.1, oxford: 0.9 },
  },
  diagnosis: {
    primaryMeta: (item) => item.icdGroup || compact(item.icd10 ?? []) || 'Группа МКБ-10 не указана',
    facts: [
      fact('body_systems', ['body_systems'], 'categorical', 'Системы организма', (item) => compact(item.bodySystems ?? []) || null),
      fact('symptoms', ['symptoms'], 'categorical', 'Ключевые симптомы', (item) => compact(item.keySymptoms ?? [], 3) || null),
      fact('course_age', ['course', 'typical_age'], 'additional', 'Течение и возраст', (item) => compact([
        compact(item.course ?? []),
        compact(item.typicalAgeGroups ?? []),
      ]) || null),
      fact('diagnostics', ['diagnostics'], 'categorical', 'Диагностика', (item) => compact(item.diagnostics ?? [], 3) || null),
    ],
    weights: { body_systems: 1.2, symptoms: 1.3, course_age: 0.9, diagnostics: 0.9 },
  },
  animal: {
    primaryMeta: (item) => item.scientificName || item.titleOriginal || 'Научное название не указано',
    facts: [
      fact('taxonomy', ['animal_class', 'animal_order', 'animal_family'], 'categorical', 'Классификация', (item) => compact([
        item.taxonomicClass,
        item.animalOrder,
        item.animalFamily,
      ], 3) || null),
      fact('habitat', ['habitats', 'animal_continents'], 'categorical', 'Среда и ареал', (item) => compact([
        compact(item.habitats ?? []),
        compact(item.animalContinents ?? []),
      ]) || null),
      fact('biology', ['body_coverings', 'diets', 'reproduction'], 'categorical', 'Биология', (item) => compact([
        compact(item.bodyCoverings ?? []),
        compact(item.diets ?? []),
        item.reproduction,
      ], 3) || null),
      fact('size', ['body_mass', 'leg_count'], 'numeric', 'Размер', (item) => compact([
        item.bodyMassKg != null ? `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(item.bodyMassKg)} кг` : null,
        item.legCount != null ? `${item.legCount} ног` : null,
      ]) || null),
    ],
    weights: { taxonomy: 1.2, habitat: 1.15, biology: 1.05, size: 1 },
  },
  book: {
    primaryMeta: (item) => compact([compact(item.bookAuthors ?? []), item.bookPublicationYear != null ? String(item.bookPublicationYear) : null]) || 'Сведения не указаны',
    facts: [
      fact('origin', ['book_country', 'book_language'], 'categorical', 'Происхождение', (item) => compact([item.bookCountry, item.bookOriginalLanguage]) || null),
      fact('genres', ['book_genres'], 'categorical', 'Жанры', (item) => compact(item.bookGenres ?? [], 3) || null),
      fact('publication', ['book_year'], 'numeric', 'Год публикации', (item) => item.bookPublicationYear != null ? String(item.bookPublicationYear) : null),
      fact('adaptations', ['book_adaptation', 'book_adaptation_count'], 'additional', 'Экранизации', (item) => item.hasAdaptation == null ? null : item.hasAdaptation ? `${item.bookAdaptationCount ?? 0} экранизаций` : 'Нет экранизаций'),
    ],
    weights: { origin: 1.1, genres: 1.25, publication: 1, adaptations: 0.8 },
  },
  character: {
    primaryMeta: (item) => compact([item.characterSourceWork, item.characterEra]) || 'Источник не указан',
    facts: [
      fact('origin', ['character_source_types', 'character_origin_cultures'], 'categorical', 'Происхождение', (item) => compact([
        compact(item.characterSourceTypes ?? [], 2),
        compact(item.characterOriginCultures ?? [], 2),
      ]) || null),
      fact('identity', ['character_nature', 'character_gender', 'character_age_group'], 'categorical', 'Образ', (item) => compact([
        item.characterNature,
        item.characterGender,
        item.characterAgeGroup,
      ], 3) || null),
      fact('role', ['character_roles', 'character_archetypes'], 'categorical', 'Роль', (item) => compact([
        compact(item.characterRoles ?? [], 2),
        compact(item.characterArchetypes ?? [], 2),
      ]) || null),
      fact('abilities', ['character_abilities', 'character_settings'], 'additional', 'Способности и мир', (item) => compact([
        compact(item.characterAbilities ?? [], 2),
        compact(item.characterSettings ?? [], 2),
      ]) || null),
    ],
    weights: { origin: 1.05, identity: 1.05, role: 1.2, abilities: 1.1 },
  },
}

const hashValue = (input: string) => {
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

const normalizedSet = (item: TitleItem) => new Set([
  ...(item.normalizedAnswers ?? []),
  ...(item.acceptedAnswers ?? []),
  item.titleRu,
  item.titleOriginal,
].map((value) => value.trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е')).filter(Boolean))

const overlapsAnswers = (left: TitleItem, right: TitleItem) => {
  const leftValues = normalizedSet(left)
  return [...normalizedSet(right)].some((value) => leftValues.has(value))
}

const canonicalKey = (item: TitleItem) => item.canonicalGameId || item.canonicalId || item.parentCanonicalGameId || item.id
const familyKey = (item: TitleItem) => item.franchiseKey || item.developers?.[0] || item.directors?.[0]?.nameOriginal || item.directors?.[0]?.nameRu || null

const recognitionDistance = (left: TitleItem, right: TitleItem) => {
  const order = ['mass', 'mainstream', 'cult_or_genre', 'special_only', 'reject']
  const leftIndex = order.indexOf(left.recognitionLevel ?? '')
  const rightIndex = order.indexOf(right.recognitionLevel ?? '')
  return leftIndex < 0 || rightIndex < 0 ? 0 : Math.abs(leftIndex - rightIndex)
}

const hintScore = (hint: Hint | undefined): number | null => {
  if (!hint || hint.status === 'unknown') return null
  if (hint.status === 'match') return 1
  if (hint.status === 'close') return 0.7
  if (hint.status === 'partial') return 0.6
  return 0
}

const combinations = <T>(values: readonly T[], size: number): T[][] => {
  if (size === 0) return [[]]
  const result: T[][] = []
  values.forEach((value, index) => {
    for (const tail of combinations(values.slice(index + 1), size - 1)) result.push([value, ...tail])
  })
  return result
}

type ScoredCandidate = {
  item: TitleItem
  scores: number[]
  total: number
  signature: string
}

type CandidateSelectionTier = {
  minMatches: number
  minMisses: number
  distinctSignatures: boolean
  maxPerFamily: number
  allowMissingFacts?: boolean
}

const CANDIDATE_SELECTION_TIERS: readonly CandidateSelectionTier[] = [
  { minMatches: 2, minMisses: 1, distinctSignatures: true, maxPerFamily: 2 },
  { minMatches: 1, minMisses: 1, distinctSignatures: true, maxPerFamily: 2 },
  { minMatches: 1, minMisses: 1, distinctSignatures: false, maxPerFamily: 2 },
  { minMatches: 0, minMisses: 1, distinctSignatures: false, maxPerFamily: 2 },
  { minMatches: 0, minMisses: 0, distinctSignatures: false, maxPerFamily: Number.POSITIVE_INFINITY, allowMissingFacts: true },
]

const scoreCandidate = (candidate: TitleItem, answer: TitleItem, facts: FactDefinition[], config: ModeConfig): ScoredCandidate => {
  const hints = compareTitles(candidate, answer)
  const byKey = new Map(hints.map((hint) => [hint.key, hint]))
  const scores = facts.map((definition) => {
    const available = definition.sourceKeys
      .map((key) => hintScore(byKey.get(key)))
      .filter((value): value is number => value !== null)
    if (!available.length) {
      const candidateValue = definition.format(candidate)
      const answerValue = definition.format(answer)
      return candidateValue && answerValue && candidateValue === answerValue ? 1 : 0
    }
    return available.reduce((sum, value) => sum + value, 0) / available.length
  })
  const totalWeight = facts.reduce((sum, definition) => sum + (config.weights[definition.key] ?? 1), 0)
  const total = scores.reduce((sum, value, index) => sum + value * (config.weights[facts[index].key] ?? 1), 0) / totalWeight
  return {
    item: candidate,
    scores,
    total,
    signature: scores.map((score) => score >= 0.6 ? '1' : '0').join(''),
  }
}

const selectScoredCandidates = (
  scored: ScoredCandidate[],
  answer: TitleItem,
  tier: CandidateSelectionTier,
) => {
  const selected: ScoredCandidate[] = []
  const signatures = new Set<string>()
  const familyCounts = new Map<string, number>()
  const answerFamily = familyKey(answer)
  if (answerFamily) familyCounts.set(answerFamily, 1)

  for (const candidate of scored) {
    const matches = candidate.scores.filter((score) => score >= 0.6).length
    const misses = candidate.scores.length - matches
    if (matches < tier.minMatches || misses < tier.minMisses) continue
    if (tier.distinctSignatures && signatures.has(candidate.signature)) continue
    const family = familyKey(candidate.item)
    if (family && (familyCounts.get(family) ?? 0) >= tier.maxPerFamily) continue
    selected.push(candidate)
    signatures.add(candidate.signature)
    if (family) familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1)
    if (selected.length === 3) break
  }

  return selected
}

const candidateRole = (candidate: ScoredCandidate, facts: FactDefinition[]): FinalChoiceCandidateRole => {
  const mismatchKinds = facts
    .filter((_, index) => candidate.scores[index] < 0.6)
    .map((definition) => definition.kind)
  const categorical = mismatchKinds.includes('categorical')
  const numeric = mismatchKinds.some((kind) => kind === 'numeric' || kind === 'additional')
  if (categorical && !numeric) return 'categorical'
  if (numeric && !categorical) return 'numeric'
  return 'balanced'
}

const candidateSnapshot = (item: TitleItem, config: ModeConfig, facts: FactDefinition[]): FinalChoiceCandidateSnapshot => ({
  item: {
    id: item.id,
    titleRu: item.titleRu,
    ...(item.titleOriginal ? { titleOriginal: item.titleOriginal } : {}),
    ...(item.posterUrl ? { posterUrl: item.posterUrl } : {}),
  },
  primaryMeta: config.primaryMeta(item),
  facts: facts.map((definition) => {
    const value = definition.format(item) ?? 'Нет данных'
    return {
      key: definition.key,
      value,
      ariaLabel: `${definition.ariaLabel}: ${value}`,
    } satisfies FinalChoiceFactSnapshot
  }) as FinalChoiceCandidateSnapshot['facts'],
})

export type BuiltFinalChoice = {
  snapshot: FinalChoiceSnapshot
  candidates: Array<{
    item: TitleItem
    role: FinalChoiceCandidateRole
    score: number
    matchKeys: string[]
    mismatchKeys: string[]
  }>
  generationSource: FinalChoiceGenerationSource
  algorithmVersion: number
}

export const buildFinalChoice = (input: {
  answer: TitleItem
  pool: TitleItem[]
  excludedItemIds?: Iterable<string>
  revealedHintKeys?: Iterable<string>
  seed: string
}): BuiltFinalChoice | null => {
  const config = FINAL_CHOICE_MODE_CONFIG[input.answer.mode]
  const excluded = new Set(input.excludedItemIds ?? [])
  const revealed = new Set(input.revealedHintKeys ?? [])
  const availableFacts = config.facts.filter((definition) => (
    (!revealed.size || definition.sourceKeys.some((key) => revealed.has(key)))
    && definition.format(input.answer) !== null
  ))
  const allAnswerFacts = config.facts.filter((definition) => definition.format(input.answer) !== null)

  const basePool = input.pool.filter((candidate) => (
    candidate.id !== input.answer.id
    && !excluded.has(candidate.id)
    && candidate.allowedInGame !== false
    && canonicalKey(candidate) !== canonicalKey(input.answer)
    && !overlapsAnswers(candidate, input.answer)
    && recognitionDistance(candidate, input.answer) <= 1
  ))

  const isUsableFactSet = (facts: FactDefinition[]) => (
    facts.some((definition) => definition.kind === 'categorical')
    && facts.some((definition) => definition.kind === 'numeric' || definition.kind === 'additional')
  )
  const preferredCombinations = combinations(availableFacts, 3)
  const fallbackCombinations = combinations(allAnswerFacts, 3)
  const preferredFactSets = preferredCombinations.filter(isUsableFactSet)
  const fallbackFactSets = fallbackCombinations.filter(isUsableFactSet)
  const factSets = preferredFactSets.length
    ? preferredFactSets
    : fallbackFactSets.length
      ? fallbackFactSets
      : preferredCombinations.length
        ? preferredCombinations
        : fallbackCombinations
  const scoredByFacts = new Map<string, { complete: ScoredCandidate[]; all: ScoredCandidate[] }>()
  const scoredFor = (selectedFacts: FactDefinition[]) => {
    const key = selectedFacts.map((definition) => definition.key).join('|')
    const cached = scoredByFacts.get(key)
    if (cached) return cached
    const all = basePool
      .map((candidate) => scoreCandidate(candidate, input.answer, selectedFacts, config))
      .sort((left, right) => right.total - left.total || hashValue(`${input.seed}|${left.item.id}`) - hashValue(`${input.seed}|${right.item.id}`))
    const complete = all.filter((candidate) => selectedFacts.every((definition) => definition.format(candidate.item) !== null))
    const result = { complete, all }
    scoredByFacts.set(key, result)
    return result
  }

  for (const tier of CANDIDATE_SELECTION_TIERS) {
    for (const selectedFacts of factSets) {
      const scored = scoredFor(selectedFacts)
      const selected = selectScoredCandidates(tier.allowMissingFacts ? scored.all : scored.complete, input.answer, tier)
      if (selected.length !== 3) continue

      const falseCandidates = selected.map((candidate) => ({
        item: candidate.item,
        role: candidateRole(candidate, selectedFacts),
        score: candidate.total,
        matchKeys: selectedFacts.filter((_, factIndex) => candidate.scores[factIndex] >= 0.6).map((definition) => definition.key),
        mismatchKeys: selectedFacts.filter((_, factIndex) => candidate.scores[factIndex] < 0.6).map((definition) => definition.key),
      }))
      const candidates = [
        {
          item: input.answer,
          role: 'answer' as const,
          score: 1,
          matchKeys: selectedFacts.map((definition) => definition.key),
          mismatchKeys: [],
        },
        ...falseCandidates,
      ].sort((left, right) => hashValue(`${input.seed}|order|${left.item.id}`) - hashValue(`${input.seed}|order|${right.item.id}`))
      const snapshots = candidates.map((candidate) => candidateSnapshot(candidate.item, config, selectedFacts))
      return {
        snapshot: {
          candidates: snapshots as FinalChoiceSnapshot['candidates'],
          displayKeys: selectedFacts.map((definition) => definition.key) as FinalChoiceSnapshot['displayKeys'],
          choicesRemaining: 1,
        },
        candidates,
        generationSource: 'runtime',
        algorithmVersion: FINAL_CHOICE_ALGORITHM_VERSION,
      }
    }
  }
  return null
}
