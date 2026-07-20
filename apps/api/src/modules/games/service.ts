import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { GAME_MODE_MANIFEST, normalizeModeVariant, type ApiDifficultyKey, type ApiRole, type AssistHintKey, type Hint, type PeriodKey, type TitleItem, type TitleMode } from '@shoditsa/contracts'
import {
  appSettings, contentItems, contentItemVersions, contentRevisionModes, contentRevisions, dailyChallenges,
  diagnosisVignettes, gameAttempts, gameHintChoices, gameSessions, type Database,
  periodEntitlements,
} from '@shoditsa/database'
import {
  compareTitles,
  dailyTitle,
  localizeMusicCountry,
  musicDifficultyPool,
  musicOriginLabel,
  musicTypeLabel,
  pickDailyVignette,
  poolFor,
} from '@shoditsa/game-core'
import { ApiError } from '../../lib/errors.js'
import type { AppConfig } from '@shoditsa/config'
import { canStartArchiveSession } from '../archive/access.js'
import { getMoscowDate } from '../../lib/time.js'
import { completeGame } from '../stats/rewards.js'
import { recordPackCompletion } from '../packs/progress.js'

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type ReadDatabase = Pick<Database, 'select'>
type SessionRow = typeof gameSessions.$inferSelect

type PromoAnswerRef = {
  mode: 'game'
  titleRu: string
  titleOriginal: string
  year: number
  legacyReleaseYears?: number[]
  steamAppIds: number[]
  aliases: string[]
}

type PromoHint = {
  key: string
  unlockAfterAttempts: 0 | 5 | 8 | 9
  type: 'archetype_comment' | 'satirical_context' | 'community_meme' | 'factual_rescue'
  authorArchetype?: string
  text: string
  spoilerRisk: 'low' | 'medium' | 'high'
}

type PromoPackItem = {
  id: string
  answerRef: PromoAnswerRef
  fallbackAnswerCard: TitleItem
  progressiveHints: PromoHint[]
}

type PromoPackDocument = {
  pack: {
    id: string
    title: string
    subtitle?: string
    itemCount?: number
    recommendedOrder?: string[]
    uiCopy?: { modeTitle?: string; disclaimer?: string }
  }
  items: PromoPackItem[]
}

type ResolvedPromoEntry = {
  promoId: string
  answer: TitleItem
  progressiveHints: PromoHint[]
}

type AnswerPoolResult = {
  items: TitleItem[]
  byItemId: Map<string, string>
}

const PROMO_PACK_ID = 'dtf-games-promo-30-v1'
const PROMO_PACK_FILENAME = 'dtf-games-promo-30.json'
const PROMO_SORT_ORDER_BASE = 2_000_000
const PROMO_PACK_SEARCH_PATHS = [
  join(process.cwd(), 'data', 'promo', PROMO_PACK_FILENAME),
  join(process.cwd(), '..', 'data', 'promo', PROMO_PACK_FILENAME),
]
const promoPackCache = new Map<string, PromoPackDocument | null>()

const normalizePromoText = (value: unknown) => String(value ?? '')
  .normalize('NFKD')
  .toLocaleLowerCase('ru-RU')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/ё/g, 'е')
  .replace(/[^a-zа-я0-9]+/gi, ' ')
  .trim()

const numeric = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : NaN
}

const itemSteamAppIds = (item: TitleItem) => {
  const record = item as Record<string, unknown>
  const raw = [
    record.steamAppId,
    ...(Array.isArray(record.steamAppIds) ? record.steamAppIds : []),
  ]
  return raw
    .map((value) => numeric(value))
    .filter((value) => Number.isInteger(value) && value > 0)
}

const itemNames = (item: TitleItem) => {
  const names = [item.titleRu, item.titleOriginal, ...(item.alternativeTitles ?? [])]
  const normalized = names.map((value) => normalizePromoText(value)).filter(Boolean)
  return [...new Set(normalized)]
}

const refNames = (ref: PromoAnswerRef) => {
  const names = [ref.titleRu, ref.titleOriginal, ...(ref.aliases ?? [])]
  const normalized = names.map((value) => normalizePromoText(value)).filter(Boolean)
  return [...new Set(normalized)]
}

const hasNameOverlap = (left: string[], right: string[]) => {
  if (!left.length || !right.length) return false
  const rightSet = new Set(right)
  return left.some((value) => rightSet.has(value))
}

const matchesPromoAnswerRef = (item: TitleItem, ref: PromoAnswerRef) => {
  if (item.mode !== 'game') return false
  const sourceSteamIds = new Set(itemSteamAppIds(item))
  const targetSteamIds = new Set((ref.steamAppIds ?? []).map((value) => numeric(value)).filter((value) => Number.isInteger(value) && value > 0))
  if (sourceSteamIds.size > 0 && [...targetSteamIds].some((value) => sourceSteamIds.has(value))) return true

  const sourceNames = itemNames(item)
  const targetNames = refNames(ref)
  if (!sourceNames.length || !targetNames.length) return false

  const allowedYears = new Set([ref.year, ...(ref.legacyReleaseYears ?? [])].map((value) => numeric(value)).filter((value) => Number.isInteger(value) && value > 0))
  const itemYear = numeric(item.year)
  if (allowedYears.size > 0 && Number.isInteger(itemYear) && allowedYears.has(itemYear) && hasNameOverlap(sourceNames, targetNames)) return true

  return hasNameOverlap(sourceNames, targetNames)
}

const promoEntriesFromPack = (pack: PromoPackDocument) => pack.items.map<ResolvedPromoEntry>((promoItem) => {
  const answer = promoItem.fallbackAnswerCard
  if (!answer || answer.mode !== 'game' || !String(answer.id ?? '').startsWith('promo:')) {
    throw new ApiError(503, 'PROMO_PACK_CARD_INVALID', `В promo-паке нет самостоятельной карточки для ${promoItem.id}`)
  }
  if (!String(answer.titleRu ?? '').trim()) {
    throw new ApiError(503, 'PROMO_PACK_CARD_INVALID', `У самостоятельной карточки ${promoItem.id} нет названия`)
  }
  return {
    promoId: promoItem.id,
    answer: { ...answer, mode: 'game', allowedInGame: false },
    progressiveHints: promoItem.progressiveHints ?? [],
  }
})

const positiveModulo = (value: number, divisor: number) => ((value % divisor) + divisor) % divisor

const hashText = (value: string) => {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash * 31) + value.charCodeAt(index)) >>> 0
  }
  return hash
}

const promoExpectedCount = (pack: PromoPackDocument) => {
  const configured = numeric(pack.pack.itemCount)
  if (Number.isInteger(configured) && configured > 0) return configured
  return pack.items.length
}

const orderResolvedPromoEntries = (pack: PromoPackDocument, entries: ResolvedPromoEntry[]) => {
  const byPromoId = new Map(entries.map((entry) => [entry.promoId, entry]))
  const ordered: ResolvedPromoEntry[] = []
  for (const rawId of pack.pack.recommendedOrder ?? []) {
    const promoId = String(rawId)
    const entry = byPromoId.get(promoId)
    if (!entry) continue
    ordered.push(entry)
    byPromoId.delete(promoId)
  }
  const tail = [...byPromoId.values()].sort((left, right) => left.promoId.localeCompare(right.promoId, 'ru-RU'))
  return [...ordered, ...tail]
}

const assertPromoCoverage = (pack: PromoPackDocument, entries: ResolvedPromoEntry[]) => {
  const expected = promoExpectedCount(pack)
  if (entries.length !== expected) {
    throw new ApiError(503, 'PROMO_PACK_CARD_COUNT_MISMATCH', `Promo-пак содержит ${expected} элементов, но самостоятельных карточек найдено ${entries.length}`)
  }
  const ids = new Set(entries.map((entry) => entry.answer.id))
  if (ids.size !== entries.length) throw new ApiError(503, 'PROMO_PACK_CARD_DUPLICATE', 'В promo-паке повторяются идентификаторы самостоятельных карточек')
}

const materializePromoPool = async (tx: Transaction | Database, revisionId: string, packId: string): Promise<AnswerPoolResult> => {
  const pack = await loadPromoPack(packId)
  if (!pack) throw new ApiError(422, 'PROMO_PACK_NOT_FOUND', 'Указанный promo-пак не найден')

  const entries = orderResolvedPromoEntries(pack, promoEntriesFromPack(pack))
  assertPromoCoverage(pack, entries)
  const ids = entries.map((entry) => entry.answer.id)

  await tx.insert(contentItems).values(entries.map((entry) => ({ id: entry.answer.id, mode: 'game' as const }))).onConflictDoNothing()
  await tx.insert(contentItemVersions).values(entries.map((entry, index) => ({
    itemId: entry.answer.id,
    revisionId,
    mode: 'game' as const,
    titleRu: entry.answer.titleRu,
    titleOriginal: entry.answer.titleOriginal ?? '',
    normalizedTitle: normalizePromoText(entry.answer.titleRu),
    year: entry.answer.year ?? null,
    endYear: entry.answer.endYear ?? null,
    popularityScore: Number.isFinite(entry.answer.popularityScore) ? Number(entry.answer.popularityScore) : 0,
    topRank: entry.answer.topRank ?? null,
    sortOrder: PROMO_SORT_ORDER_BASE + index,
    // Promo cards live in the active revision only as hidden technical
    // versions. The regular Games pool still reads allowedInGame=true and
    // therefore never mixes them into the main daily mode.
    allowedInGame: false,
    contentStatus: 'promo_pack',
    payload: entry.answer,
  }))).onConflictDoNothing()

  const rows = await tx.select({ id: contentItemVersions.id, itemId: contentItemVersions.itemId, payload: contentItemVersions.payload })
    .from(contentItemVersions)
    .where(and(eq(contentItemVersions.revisionId, revisionId), inArray(contentItemVersions.itemId, ids)))
  const rowByItemId = new Map(rows.map((row) => [row.itemId, row]))
  const items: TitleItem[] = []
  const byItemId = new Map<string, string>()
  for (const entry of entries) {
    const row = rowByItemId.get(entry.answer.id)
    if (!row) throw new ApiError(503, 'PROMO_PACK_VERSION_MISSING', `Не удалось подготовить самостоятельную карточку ${entry.answer.id}`)
    items.push(row.payload as TitleItem)
    byItemId.set(entry.answer.id, row.id)
  }
  return { items, byItemId }
}

const answerPoolForSession = async (
  tx: Transaction | Database,
  revisionId: string,
  mode: TitleMode,
  period: PeriodKey,
  difficulty: ApiDifficultyKey | null,
  variantKey: string | null,
) => isPromoSessionVariant(mode, variantKey)
  ? materializePromoPool(tx, revisionId, String(variantKey))
  : answerPool(tx, revisionId, mode, period, difficulty, variantKey)

const selectPromoEntry = (entries: ResolvedPromoEntry[], puzzleDate: string, salt: number, variantKey: string) => {
  if (!entries.length) return null
  const dayStamp = Date.parse(`${puzzleDate}T00:00:00Z`)
  const dayNumber = Number.isFinite(dayStamp) ? Math.floor(dayStamp / 86_400_000) : 0
  const rotation = positiveModulo(hashText(`promo|${variantKey}|${salt}`), entries.length)
  const index = positiveModulo(dayNumber + rotation, entries.length)
  return entries[index] ?? null
}

const loadPromoPack = async (packId: string) => {
  if (packId !== PROMO_PACK_ID) return null
  if (promoPackCache.has(packId)) return promoPackCache.get(packId) ?? null

  for (const filePath of PROMO_PACK_SEARCH_PATHS) {
    try {
      const parsed = JSON.parse(await readFile(filePath, 'utf8')) as PromoPackDocument
      if (parsed?.pack?.id !== packId || !Array.isArray(parsed.items)) continue
      promoPackCache.set(packId, parsed)
      return parsed
    } catch {
      // Try next known path.
    }
  }

  promoPackCache.set(packId, null)
  return null
}

const isPromoSessionVariant = (mode: TitleMode, variantKey: string | null | undefined) => (
  mode === 'game' && variantKey === PROMO_PACK_ID
)

const promoPromptOf = (pack: PromoPackDocument) => ({
  packId: pack.pack.id,
  title: pack.pack.uiCopy?.modeTitle ?? pack.pack.title,
  subtitle: pack.pack.subtitle ?? '',
  disclaimer: pack.pack.uiCopy?.disclaimer ?? 'Все комментарии вымышлены и созданы для игрового режима.',
})

const promoSessionPayload = async (mode: TitleMode, variantKey: string | null, answer: TitleItem | undefined, attemptsCount: number) => {
  if (mode !== 'game' || !variantKey || !answer) return { progressiveHints: [] as Array<{ key: string; value: unknown }>, promoPrompt: null as { packId: string; title: string; subtitle: string; disclaimer: string } | null }
  const pack = await loadPromoPack(variantKey)
  if (!pack) return { progressiveHints: [] as Array<{ key: string; value: unknown }>, promoPrompt: null as { packId: string; title: string; subtitle: string; disclaimer: string } | null }

  const entry = pack.items.find((item) => matchesPromoAnswerRef(answer, item.answerRef))
  const progressiveHints = (entry?.progressiveHints ?? [])
    .filter((hint) => hint.unlockAfterAttempts <= attemptsCount)
    .sort((left, right) => left.unlockAfterAttempts - right.unlockAfterAttempts)
    .map((hint) => ({
      key: hint.key,
      value: {
        unlockAfterAttempts: hint.unlockAfterAttempts,
        type: hint.type,
        authorArchetype: hint.authorArchetype ?? null,
        text: hint.text,
        spoilerRisk: hint.spoilerRisk,
      },
    }))

  return { progressiveHints, promoPrompt: promoPromptOf(pack) }
}

const legacyMediaUrl = (value: string | null | undefined, mode: TitleMode, itemId: string) => {
  if (!value) return null
  if (/^\/?media\//.test(value) || /^https?:\/\//.test(value)) return value
  const normalized = value.replace(/^\.\//, '/')
  const people = normalized.match(/^\/data\/libraries\/people\/img\/(.+)$/)
  if (people) return `/media/people/${people[1]}`
  const content = normalized.match(/^\/data\/libraries\/[^/]+\/img\/(.+)$/)
  return content ? `/media/content/${mode}/${content[1]}` : value
}

const legacyPeoplePhotoUrl = (value: string | null | undefined) => {
  if (!value) return null
  if (/^\/?media\//.test(value) || /^https?:\/\//.test(value)) return value
  const normalized = value.replace(/^\.\//, '/')
  const people = normalized.match(/^\/data\/libraries\/people\/img\/(.+)$/)
  return people ? `/media/people/${people[1]}` : value
}

const normalizePeoplePhotos = <T extends { photoUrl?: string | null }>(people?: T[]) =>
  people?.map((person) => ({ ...person, photoUrl: legacyPeoplePhotoUrl(person.photoUrl) ?? undefined }))

const normalizeHintPeople = (hints: Hint[]) => hints.map((hint) => (
  hint.people?.length
    ? { ...hint, people: hint.people.map((person) => ({ ...person, photoUrl: legacyPeoplePhotoUrl(person.photoUrl) ?? undefined })) }
    : hint
))

const cleanHintText = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim()
const cropHintText = (value: string, max = 190) => value.length > max ? `${value.slice(0, max).trimEnd()}…` : value
const normalizeHintMatch = (value: unknown) => cleanHintText(value).toLocaleLowerCase('ru-RU').replace(/ё/g, 'е')

type RevealedFieldEvidence = { fullyRevealed: boolean; values: Set<string>; excludedValues: Set<string> }
type RevealedAttemptEvidence = { byHintKey: Map<string, RevealedFieldEvidence>; values: Set<string> }
type InfoHintCandidate = { sourceKey: string | null; label: string; values: string[] }

const addRevealedValue = (target: Set<string>, value: unknown) => {
  const normalized = normalizeHintMatch(value)
  if (normalized) target.add(normalized)
}

const addRevealedDisplayValues = (target: Set<string>, value: unknown) => {
  for (const part of cleanHintText(value).split(',').map((entry) => entry.trim()).filter(Boolean)) {
    addRevealedValue(target, part)
  }
}

const revealedAttemptEvidence = (attempts: Array<{ hints: Hint[] }>): RevealedAttemptEvidence => {
  const byHintKey = new Map<string, RevealedFieldEvidence>()
  const values = new Set<string>()

  for (const attempt of attempts) {
    for (const hint of attempt.hints) {
      const field = byHintKey.get(hint.key) ?? { fullyRevealed: false, values: new Set<string>(), excludedValues: new Set<string>() }
      if (hint.status === 'match') {
        field.fullyRevealed = true
        addRevealedValue(values, hint.value)
        addRevealedDisplayValues(values, hint.value)
      } else if (hint.status === 'partial') {
        addRevealedDisplayValues(field.values, hint.value)
        addRevealedDisplayValues(values, hint.value)
      } else if (hint.status === 'miss' && hint.direction == null) {
        addRevealedDisplayValues(field.excludedValues, hint.value)
      }
      for (const value of hint.matchedValues ?? []) {
        addRevealedValue(field.values, value)
        addRevealedValue(values, value)
      }
      for (const person of hint.people ?? []) {
        if (!person.matched) continue
        addRevealedValue(field.values, person.nameRu)
        addRevealedValue(field.values, person.nameOriginal)
        addRevealedValue(values, person.nameRu)
        addRevealedValue(values, person.nameOriginal)
      }
      byHintKey.set(hint.key, field)
    }
  }

  return { byHintKey, values }
}

const infoListCandidate = (sourceKey: string | null, label: string, values: Array<string | null | undefined>, limit = 3): InfoHintCandidate | null => {
  const normalized = values.map((value) => cleanHintText(value)).filter(Boolean).slice(0, limit)
  return normalized.length ? { sourceKey, label, values: normalized } : null
}

const infoScalarCandidate = (sourceKey: string | null, label: string, value: unknown): InfoHintCandidate | null => {
  const normalized = cleanHintText(value)
  return normalized ? { sourceKey, label, values: [normalized] } : null
}

const presentInfoCandidates = (candidates: Array<InfoHintCandidate | null>): InfoHintCandidate[] =>
  candidates.filter((candidate): candidate is InfoHintCandidate => candidate !== null)

const SMALL_CATEGORICAL_DOMAINS: Record<string, string[][]> = {
  anime_kind: [
    ['tv сериал', 'tv-сериал', 'сериал', 'tv'],
    ['фильм', 'movie'],
  ],
  anime_status: [
    ['вышло', 'released', 'завершен', 'завершён'],
    ['онгоинг', 'ongoing', 'выходит'],
  ],
  series_status: [
    ['вышло', 'released', 'завершен', 'завершён'],
    ['онгоинг', 'ongoing', 'выходит'],
  ],
  music_active: [
    ['продолжает карьеру', 'активен', 'активна', 'active'],
    ['завершил карьеру', 'завершила карьеру', 'не активен', 'не активна', 'inactive'],
  ],
  music_origin: [
    ['русскоязычная сцена', 'ru'],
    ['международная сцена', 'intl'],
  ],
}

const categoricalGroup = (groups: string[][], value: string) => {
  const normalized = normalizeHintMatch(value)
  return groups.findIndex((group) => group.some((entry) => normalizeHintMatch(entry) === normalized))
}

const isTriviallyInferredCandidate = (candidate: InfoHintCandidate, evidence: RevealedAttemptEvidence) => {
  if (!candidate.sourceKey || candidate.values.length !== 1) return false
  const groups = SMALL_CATEGORICAL_DOMAINS[candidate.sourceKey]
  const field = evidence.byHintKey.get(candidate.sourceKey)
  if (!groups || !field?.excludedValues.size) return false

  const answerGroup = categoricalGroup(groups, candidate.values[0])
  if (answerGroup < 0) return false
  const excludedGroups = new Set([...field.excludedValues]
    .map((value) => categoricalGroup(groups, value))
    .filter((group) => group >= 0))
  return groups.every((_, group) => group === answerGroup || excludedGroups.has(group))
}

const renderInfoCandidate = (candidate: InfoHintCandidate, evidence: RevealedAttemptEvidence) => {
  const field = candidate.sourceKey ? evidence.byHintKey.get(candidate.sourceKey) : null
  if (field?.fullyRevealed) return ''
  if (isTriviallyInferredCandidate(candidate, evidence)) return ''
  const remaining = candidate.values.filter((value) => !field?.values.has(normalizeHintMatch(value)))
  return remaining.length ? `${candidate.label}: ${remaining.join(', ')}` : ''
}

const infoHintCandidates = (answer: TitleItem): InfoHintCandidate[] => {
  if (answer.mode === 'music') {
    return presentInfoCandidates([
      infoListCandidate('country', 'Страна', (answer.countries ?? []).map(localizeMusicCountry), 2),
      infoScalarCandidate('activity_start_year', 'Начало деятельности', answer.activityStartYear),
      infoScalarCandidate('music_type', 'Тип', musicTypeLabel(answer.musicType)),
      answer.musicOrigin ? infoScalarCandidate('music_origin', 'Сцена', musicOriginLabel(answer.musicOrigin)) : null,
      infoListCandidate('genres', 'Жанры', answer.genres ?? [], 3),
      infoListCandidate(null, 'Топ-треки', (answer.topTracks ?? []).map((track) => track.title), 2),
    ])
  }

  if (answer.mode === 'game') {
    return presentInfoCandidates([
      answer.year ? infoScalarCandidate('year', 'Год релиза', answer.year) : null,
      infoListCandidate('genres', 'Жанры', answer.genres ?? [], 3),
      infoListCandidate('platforms', 'Платформы', answer.platforms ?? [], 3),
      infoListCandidate('developer', 'Разработчики', answer.developers ?? [], 2),
      answer.topRank ? infoScalarCandidate('rank', 'Позиция в топе', `#${answer.topRank}`) : null,
      answer.ratings?.metacritic != null || answer.metacritic != null
        ? infoScalarCandidate('metacritic', 'Metacritic', answer.ratings?.metacritic ?? answer.metacritic)
        : null,
    ])
  }

  if (answer.mode === 'diagnosis') {
    return presentInfoCandidates([
      infoListCandidate('body_systems', 'Системы организма', answer.bodySystems ?? [], 3),
      infoListCandidate('symptoms', 'Ключевые симптомы', answer.keySymptoms ?? [], 3),
      infoListCandidate('diagnostics', 'Диагностика', answer.diagnostics ?? [], 3),
      infoListCandidate('icd', 'МКБ-10', answer.icd10 ?? [], 3),
      answer.icdGroup ? infoScalarCandidate('icd', 'Группа', answer.icdGroup) : null,
    ])
  }

  if (answer.mode === 'anime') {
    return presentInfoCandidates([
      answer.animeKind ? infoScalarCandidate('anime_kind', 'Формат', answer.animeKind) : null,
      answer.animeStatus ? infoScalarCandidate('anime_status', 'Статус', answer.animeStatus) : null,
      answer.episodes ? infoScalarCandidate('episodes', 'Эпизоды', answer.episodes) : null,
      infoListCandidate('studio', 'Студии', answer.studios ?? [], 2),
      infoListCandidate('genres', 'Жанры', answer.genres ?? [], 3),
      answer.year ? infoScalarCandidate('year', 'Год релиза', answer.year) : null,
    ])
  }

  if (answer.mode === 'city') {
    const ranks = answer.ranks
    return presentInfoCandidates([
      infoScalarCandidate('country', 'Страна', answer.country),
      infoScalarCandidate('continent', 'Континент', answer.continent),
      infoListCandidate('languages', 'Языки', answer.languages ?? [], 3),
      answer.population != null ? infoScalarCandidate('population', 'Население', new Intl.NumberFormat('ru-RU').format(answer.population)) : null,
      infoScalarCandidate('timezone', 'Часовой пояс', answer.timezone),
      ranks?.economy != null ? infoScalarCandidate('economy', 'Экономика', `№ ${ranks.economy}`) : null,
      ranks?.qualityOfLife != null ? infoScalarCandidate('qualityOfLife', 'Качество жизни', `№ ${ranks.qualityOfLife}`) : null,
    ])
  }

  return presentInfoCandidates([
    answer.year ? infoScalarCandidate('year', 'Год релиза', answer.year) : null,
    infoListCandidate('country', 'Страны', answer.countries ?? [], 2),
    infoListCandidate('genres', 'Жанры', answer.genres ?? [], 3),
    infoListCandidate('creator', 'Режиссёры', (answer.directors ?? []).map((person) => person.nameRu || person.nameOriginal), 2),
    infoListCandidate('cast', 'Каст', (answer.cast ?? []).map((person) => person.nameRu || person.nameOriginal), 3),
  ])
}

const modelFactValues = (answer: TitleItem) => new Set([
    ...infoHintCandidates(answer).map((candidate) => `${candidate.label}: ${candidate.values.join(', ')}`),
    answer.mode === 'anime' && answer.animeEpisodesAired != null ? `Вышло эпизодов: ${answer.animeEpisodesAired}` : '',
  ].map(normalizeHintMatch).filter(Boolean))

const factHintValue = (answer: TitleItem, matched: Set<string>) => {
  const modelFacts = modelFactValues(answer)
  const isRedundant = (candidate: string) => {
    const normalized = normalizeHintMatch(candidate)
    return !normalized
      || modelFacts.has(normalized)
      || [...matched].some((value) => value.length >= 3 && normalized.includes(value))
  }
  const fact = (answer.facts ?? []).map(cleanHintText).find((candidate) => !isRedundant(candidate)) ?? ''
  if (fact) return cropHintText(fact)

  const fallback = cleanHintText(answer.plotHint ?? '')
  const invalidFallback = fallback.length < 30
    || /(?:\.\.\.|…)\s*$/.test(fallback)
    || /\[+\s*REDACTED\s*\]+|_KEEP_\d+_/i.test(fallback)
  return fallback && !invalidFallback && !isRedundant(fallback) ? cropHintText(fallback) : ''
}

type BuiltHintOption = {
  key: AssistHintKey
  title: string
  subtitle: string
  value: string
  sourceKey?: string
}

type ExistingHintChoice = { hintKey: string; response?: unknown }

const hintChoiceSourceKey = (choice: ExistingHintChoice) => {
  if (!choice.response || typeof choice.response !== 'object') return null
  const sourceKey = (choice.response as { sourceKey?: unknown }).sourceKey
  return typeof sourceKey === 'string' && sourceKey ? sourceKey : null
}

export const buildHintOptions = (answer: TitleItem, choices: ExistingHintChoice[], attempts: Array<{ hints: Hint[] }> = []): BuiltHintOption[] => {
  const options: BuiltHintOption[] = []
  const evidence = revealedAttemptEvidence(attempts)

  const openedInfoSourceKeys = new Set(choices
    .filter((choice) => choice.hintKey === 'info')
    .map(hintChoiceSourceKey)
    .filter((sourceKey): sourceKey is string => Boolean(sourceKey)))
  const legacyInfoUsedCount = choices.filter((choice) => choice.hintKey === 'info' && !hintChoiceSourceKey(choice)).length
  const infoCandidate = infoHintCandidates(answer)
    .filter((candidate) => !candidate.sourceKey || !openedInfoSourceKeys.has(candidate.sourceKey))
    .map((candidate) => ({ candidate, value: cleanHintText(renderInfoCandidate(candidate, evidence)) }))
    .filter((entry) => Boolean(entry.value))[legacyInfoUsedCount]
  if (infoCandidate) {
    options.push({
      key: 'info',
      title: 'Неоткрытая информация',
      subtitle: 'Деталь о правильном ответе, которая ещё не показывалась',
      value: infoCandidate.value,
      ...(infoCandidate.candidate.sourceKey ? { sourceKey: infoCandidate.candidate.sourceKey } : {}),
    })
  }

  const factAlreadyOpened = choices.some((choice) => choice.hintKey === 'fact')
  const factValue = factAlreadyOpened ? '' : factHintValue(answer, evidence.values)
  if (factValue) {
    options.push({
      key: 'fact',
      title: 'Интересный факт',
      subtitle: 'Факт из карточки или поле подсказки без спойлеров',
      value: factValue,
    })
  }

  return options
}

export const publicCard = (item: TitleItem) => ({
  ...item,
  titleOriginal: item.titleOriginal ?? '',
  year: item.mode === 'music' ? null : item.year ?? null,
  genres: item.genres ?? [],
  posterUrl: legacyMediaUrl(item.posterUrl, item.mode, item.id),
  developers: item.developers ?? [],
  publishers: item.publishers ?? [],
  platforms: item.platforms ?? [],
  steamCategories: item.steamCategories ?? [],
  keySymptoms: item.keySymptoms ?? [],
  diagnostics: item.diagnostics ?? [],
  riskFactors: item.riskFactors ?? [],
  topTracks: item.topTracks ?? [],
  topAlbums: item.topAlbums ?? [],
  similarArtists: item.similarArtists ?? [],
  directors: normalizePeoplePhotos(item.directors),
  showrunners: normalizePeoplePhotos(item.showrunners),
  writers: normalizePeoplePhotos(item.writers),
  cast: normalizePeoplePhotos(item.cast),
  supportingCast: normalizePeoplePhotos(item.supportingCast),
})

export const answerPool = async (tx: ReadDatabase, revisionId: string, mode: TitleMode, period: PeriodKey, difficulty: ApiDifficultyKey | null, variantKey: string | null = null) => {
  const rows = await tx.select({ id: contentItemVersions.id, payload: contentItemVersions.payload })
    .from(contentItemVersions).where(and(
      eq(contentItemVersions.revisionId, revisionId), eq(contentItemVersions.mode, mode), eq(contentItemVersions.allowedInGame, true),
    )).orderBy(asc(contentItemVersions.sortOrder))
  let items = poolFor(rows.map((row) => row.payload as TitleItem), mode, period, variantKey)
  if (mode === 'music') items = musicDifficultyPool(items, difficulty ?? 'medium')
  const byItemId = new Map(rows.map((row) => [(row.payload as TitleItem).id, row.id]))
  return { items, byItemId }
}

export const activeRevision = async (tx: ReadDatabase) => {
  const rows = await tx.select({ id: contentRevisions.id }).from(contentRevisions).where(eq(contentRevisions.status, 'active')).limit(1)
  if (!rows[0]) throw new ApiError(503, 'CONTENT_NOT_READY', 'Активная ревизия контента не настроена')
  return rows[0].id
}

const dailySalt = async (tx: Transaction) => {
  const rows = await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, 'daily_global_salt')).limit(1)
  return Number(rows[0]?.value ?? 0) || 0
}

export const startGame = async (db: Database, userId: string, input: {
  kind: 'daily' | 'archive'; mode: TitleMode; period?: PeriodKey; difficulty?: ApiDifficultyKey | null; archiveDate?: string | null; variantKey?: string | null; packId?: string | null;
}, authSessionId: string | null = null, actorRole: ApiRole = 'player', config?: AppConfig) => db.transaction(async (tx) => {
  const capabilities = GAME_MODE_MANIFEST[input.mode]
  const period = capabilities.periodPolicy === 'all' ? 'all' : input.period ?? 'all'
  const difficulty = input.mode === 'music' ? input.difficulty ?? 'medium' : null
  const requestedVariant = input.variantKey ?? input.packId ?? null
  const packId = input.mode === 'game' && typeof requestedVariant === 'string' && requestedVariant.trim().length ? requestedVariant.trim() : null
  const modeVariant = input.mode === 'city' ? normalizeModeVariant(input.mode, requestedVariant) ?? 'capitals' : packId
  if (input.mode === 'city' && requestedVariant && !normalizeModeVariant(input.mode, requestedVariant)) {
    throw new ApiError(422, 'GAME_VARIANT_INVALID', 'Недопустимый вариант режима')
  }
  if (packId && actorRole !== 'admin') throw new ApiError(403, 'PROMO_PACK_FORBIDDEN', 'Promo-режим доступен только администратору')
  if (period !== 'all' && capabilities.periodPolicy === 'year') {
    const entitlement = await tx.select({ userId: periodEntitlements.userId }).from(periodEntitlements).where(and(
      eq(periodEntitlements.userId, userId), eq(periodEntitlements.mode, input.mode), eq(periodEntitlements.period, period),
    )).limit(1)
    if (!entitlement[0]) throw new ApiError(403, 'PERIOD_LOCKED', 'Сначала разблокируйте этот период')
  }
  const today = getMoscowDate()
  const puzzleDate = input.kind === 'daily' ? today : input.archiveDate
  if (!puzzleDate) throw new ApiError(422, 'ARCHIVE_DATE_REQUIRED', 'Для архивной игры нужна дата')
  if (puzzleDate > today) throw new ApiError(422, 'ARCHIVE_DATE_IN_FUTURE', 'Архивная дата не может быть в будущем')
  if (input.kind === 'archive' && config) {
    const access = await canStartArchiveSession(tx as unknown as Database, userId, puzzleDate, config, new Date(), { mode: input.mode, period, difficulty })
    if (access.source === 'before-launch') throw new ApiError(422, 'ARCHIVE_DATE_BEFORE_LAUNCH', 'Эта дата была до запуска архива', { archiveDate: puzzleDate, archiveFirstDate: config.commerce.archiveFirstDate })
    if (!access.allowed) throw new ApiError(403, 'ARCHIVE_CLUB_REQUIRED', 'Эта дата входит в полный архив клуба. Сегодня и предыдущие шесть дней доступны всем', { archiveDate: puzzleDate, freeFrom: access.freeFrom })
  }
  const revisionId = await activeRevision(tx)
  const salt = await dailySalt(tx)
  const variant = modeVariant ?? difficulty ?? '-'
  const algorithmVersion = modeVariant ? 2 : 1
  const challengeKey = `${puzzleDate}|${input.mode}|${period}|${variant}|${salt}|v${algorithmVersion}`

  let challenge = await tx.select().from(dailyChallenges).where(eq(dailyChallenges.challengeKey, challengeKey)).limit(1)
  if (!challenge[0]) {
    const pool = await answerPoolForSession(tx, revisionId, input.mode, period, difficulty, modeVariant)
    const answer = packId
      ? (() => {
        const resolve = async () => {
          const pack = await loadPromoPack(packId)
          if (!pack) throw new ApiError(422, 'PROMO_PACK_NOT_FOUND', 'Указанный promo-пак не найден')
          const resolved = orderResolvedPromoEntries(pack, promoEntriesFromPack(pack))
          assertPromoCoverage(pack, resolved)
          const selected = selectPromoEntry(resolved, puzzleDate, salt, variant)
          if (!selected) throw new ApiError(503, 'PROMO_PACK_EMPTY', 'В promo-паке нет доступных элементов для запуска')
          return selected.answer
        }
        return resolve()
      })()
      : Promise.resolve(dailyTitle(pool.items, input.mode, period, puzzleDate, salt, input.mode === 'city' ? variant : difficulty ?? ''))
    const selectedAnswer = await answer
    if (!selectedAnswer) throw new ApiError(503, 'CONTENT_POOL_EMPTY', 'Для выбранного режима нет доступных вариантов')
    const answerItemVersionId = pool.byItemId.get(selectedAnswer.id)
    if (!answerItemVersionId) throw new ApiError(503, 'CONTENT_VERSION_NOT_FOUND', 'Не удалось определить версию ответа для текущей ревизии')
    const inserted = await tx.insert(dailyChallenges).values({
      challengeKey, puzzleDate, mode: input.mode, period, difficulty, variantKey: variant,
      revisionId, answerItemVersionId, globalSalt: salt, algorithmVersion,
    }).onConflictDoNothing().returning()
    challenge = inserted[0] ? inserted : await tx.select().from(dailyChallenges).where(eq(dailyChallenges.challengeKey, challengeKey)).limit(1)
  }
  const insertedSession = await tx.insert(gameSessions).values({
    userId, authSessionId, challengeId: challenge[0].id, kind: input.kind, mode: input.mode, period, difficulty,
    puzzleDate, revisionId: challenge[0].revisionId, answerItemVersionId: challenge[0].answerItemVersionId, rulesVersion: 1,
  }).onConflictDoNothing().returning()
  const session = insertedSession[0] ?? (await tx.select().from(gameSessions).where(and(eq(gameSessions.userId, userId), eq(gameSessions.challengeId, challenge[0].id))).limit(1))[0]
  if (session.status !== 'playing') throw new ApiError(409, 'GAME_ALREADY_COMPLETED', 'Игра уже завершена')
  return buildSessionSnapshot(tx, session)
})

export const buildSessionSnapshot = async (tx: Transaction | Database, session: SessionRow) => {
  const attempts = await tx.select({
    position: gameAttempts.position, hints: gameAttempts.hintsSnapshot, item: contentItemVersions.payload,
  }).from(gameAttempts).innerJoin(contentItemVersions, eq(contentItemVersions.id, gameAttempts.guessedItemVersionId))
    .where(eq(gameAttempts.sessionId, session.id)).orderBy(asc(gameAttempts.position))
  const choices = await tx.select({ checkpoint: gameHintChoices.checkpoint, hintKey: gameHintChoices.hintKey, response: gameHintChoices.responseSnapshot })
    .from(gameHintChoices).where(eq(gameHintChoices.sessionId, session.id)).orderBy(asc(gameHintChoices.checkpoint))
  const challengeVariant = session.packId ?? (session.challengeId
    ? (await tx.select({ variantKey: dailyChallenges.variantKey }).from(dailyChallenges).where(eq(dailyChallenges.id, session.challengeId)).limit(1))[0]?.variantKey ?? null
    : null)
  let diagnosisVignette: { id: string; text: string } | null = null
  if (session.mode === 'diagnosis') {
    const rows = await tx.select({ id: diagnosisVignettes.id, text: diagnosisVignettes.text }).from(diagnosisVignettes)
      .where(eq(diagnosisVignettes.itemVersionId, session.answerItemVersionId)).orderBy(asc(diagnosisVignettes.sortOrder))
    diagnosisVignette = pickDailyVignette(rows, session.answerItemVersionId, session.puzzleDate)
  }
  const answerRows = await tx.select({ payload: contentItemVersions.payload }).from(contentItemVersions).where(eq(contentItemVersions.id, session.answerItemVersionId)).limit(1)
  const answer = answerRows[0]?.payload as TitleItem | undefined
  const sessionMode = session.mode as TitleMode
  const isPromoSession = isPromoSessionVariant(sessionMode, challengeVariant)
  const promo = await promoSessionPayload(sessionMode, challengeVariant, answer, session.attemptsCount)
  const hintOptions = isPromoSession
    ? []
    : answer
      ? buildHintOptions(answer, choices.map((choice) => ({ hintKey: String(choice.hintKey), response: choice.response })), attempts.map((attempt) => ({ hints: attempt.hints as Hint[] })))
      : []
  const result: Record<string, unknown> = {
    id: session.id, kind: session.kind, mode: sessionMode, variantKey: challengeVariant, packId: session.packId, packPosition: session.packPosition, period: session.period, difficulty: session.difficulty,
    puzzleDate: session.puzzleDate, status: session.status, attemptsCount: session.attemptsCount,
    attemptsRemaining: 10 - session.attemptsCount,
    attempts: attempts.map((entry) => ({
      position: entry.position,
      item: publicCard(entry.item as TitleItem),
      hints: normalizeHintPeople(entry.hints as Hint[]),
    })),
    hintCheckpoints: [5, 8].map((round) => ({
      round,
      state: choices.some((choice) => choice.checkpoint === round)
        ? 'opened'
        : session.attemptsCount >= round && hintOptions.length > 0
          ? 'available'
          : 'locked',
    })),
    hintChoices: isPromoSession ? [] : choices,
    hintOptions: hintOptions.map(({ key, title, subtitle }) => ({ key, title, subtitle })),
    progressiveHints: promo.progressiveHints,
    promoPrompt: promo.promoPrompt,
    diagnosisVignette,
    serverTime: new Date().toISOString(),
  }
  if ((session.mode === 'music' || session.status !== 'playing') && answer) result.answer = publicCard(answer)
  return result
}

export const getOwnedSession = async (db: Database, userId: string, sessionId: string) => {
  const session = await db.select().from(gameSessions).where(and(eq(gameSessions.id, sessionId), eq(gameSessions.userId, userId))).limit(1)
  if (!session[0]) throw new ApiError(404, 'GAME_NOT_FOUND', 'Игровая сессия не найдена')
  return buildSessionSnapshot(db, session[0])
}

export const submitAttempt = async (db: Database, userId: string, sessionId: string, itemId: string, idempotencyKey: string) => db.transaction(async (tx) => {
  const replay = await tx.select({ response: gameAttempts.responseSnapshot }).from(gameAttempts).where(and(eq(gameAttempts.sessionId, sessionId), eq(gameAttempts.idempotencyKey, idempotencyKey))).limit(1)
  if (replay[0]) return replay[0].response
  const sessions = await tx.select().from(gameSessions).where(and(eq(gameSessions.id, sessionId), eq(gameSessions.userId, userId))).for('update').limit(1)
  const session = sessions[0]
  if (!session) throw new ApiError(404, 'GAME_NOT_FOUND', 'Игровая сессия не найдена')
  const lockedReplay = await tx.select({ response: gameAttempts.responseSnapshot }).from(gameAttempts).where(and(eq(gameAttempts.sessionId, sessionId), eq(gameAttempts.idempotencyKey, idempotencyKey))).limit(1)
  if (lockedReplay[0]) return lockedReplay[0].response
  if (session.status !== 'playing') throw new ApiError(409, 'GAME_ALREADY_COMPLETED', 'Игра уже завершена')
  if (session.attemptsCount >= 10) throw new ApiError(409, 'GAME_ATTEMPTS_EXHAUSTED', 'Попытки закончились')

  const variantKey = session.packId ?? (session.challengeId
    ? (await tx.select({ variantKey: dailyChallenges.variantKey }).from(dailyChallenges).where(eq(dailyChallenges.id, session.challengeId)).limit(1))[0]?.variantKey ?? null
    : null)
  const sessionMode = session.mode as TitleMode
  const pool = await answerPoolForSession(tx, session.revisionId, sessionMode, session.period, session.difficulty, variantKey)
  const guess = pool.items.find((item) => item.id === itemId)
  if (!guess) throw new ApiError(422, 'GAME_ITEM_OUTSIDE_POOL', 'Вариант недоступен в этой игре')
  const guessedVersionId = pool.byItemId.get(guess.id)!
  const duplicate = await tx.select({ id: gameAttempts.id }).from(gameAttempts).where(and(eq(gameAttempts.sessionId, sessionId), eq(gameAttempts.guessedItemVersionId, guessedVersionId))).limit(1)
  if (duplicate[0]) throw new ApiError(409, 'GAME_DUPLICATE_GUESS', 'Этот вариант уже был в попытках')
  const answers = await tx.select({ payload: contentItemVersions.payload }).from(contentItemVersions).where(eq(contentItemVersions.id, session.answerItemVersionId)).limit(1)
  const answer = answers[0].payload as TitleItem
  const isCorrect = guess.id === answer.id
  const position = session.attemptsCount + 1
  const status = isCorrect ? 'won' : position >= 10 ? 'lost' : 'playing'
  const hints = normalizeHintPeople(compareTitles(guess, answer) as Hint[])
  const promo = await promoSessionPayload(sessionMode, variantKey, answer, position)
  let reward: Awaited<ReturnType<typeof completeGame>> = null
  if (status !== 'playing') reward = await completeGame(tx, {
    sessionId, userId, kind: session.kind, mode: sessionMode, difficulty: session.difficulty,
    puzzleDate: session.puzzleDate, won: status === 'won', attemptsCount: position,
  })
  await tx.update(gameSessions).set({
    attemptsCount: position, status, updatedAt: new Date(), completedAt: status === 'playing' ? null : new Date(),
    rewardLedgerId: reward?.ledgerId ?? null,
  }).where(eq(gameSessions.id, sessionId))
  if (status !== 'playing' && session.kind === 'pack' && session.packId && session.packPosition) {
    await recordPackCompletion(tx, userId, session.packId, session.packPosition)
  }
  const response: Record<string, unknown> = {
    attempt: { position, item: publicCard(guess), hints },
    session: { status, attemptsCount: position, attemptsRemaining: 10 - position },
    progressiveHints: promo.progressiveHints,
    promoPrompt: promo.promoPrompt,
  }
  if (status !== 'playing') { response.answer = publicCard(answer); response.reward = reward }
  await tx.insert(gameAttempts).values({
    sessionId, position, guessedItemVersionId: guessedVersionId, isCorrect, hintsSnapshot: hints, responseSnapshot: response, idempotencyKey,
  })
  return response
})

export const chooseHint = async (db: Database, userId: string, sessionId: string, checkpoint: 5 | 8, hintKey: AssistHintKey, idempotencyKey: string) => db.transaction(async (tx) => {
  const replay = await tx.select({ response: gameHintChoices.responseSnapshot }).from(gameHintChoices).where(and(eq(gameHintChoices.sessionId, sessionId), eq(gameHintChoices.idempotencyKey, idempotencyKey))).limit(1)
  if (replay[0]) return replay[0].response
  const sessions = await tx.select().from(gameSessions).where(and(eq(gameSessions.id, sessionId), eq(gameSessions.userId, userId))).for('update').limit(1)
  const session = sessions[0]
  if (!session) throw new ApiError(404, 'GAME_NOT_FOUND', 'Игровая сессия не найдена')
  const lockedReplay = await tx.select({ response: gameHintChoices.responseSnapshot }).from(gameHintChoices).where(and(eq(gameHintChoices.sessionId, sessionId), eq(gameHintChoices.idempotencyKey, idempotencyKey))).limit(1)
  if (lockedReplay[0]) return lockedReplay[0].response
  if (session.attemptsCount < checkpoint) throw new ApiError(422, 'HINT_CHECKPOINT_LOCKED', 'Эта подсказка пока недоступна')
  const variantKey = session.packId ?? (session.challengeId
    ? (await tx.select({ variantKey: dailyChallenges.variantKey }).from(dailyChallenges).where(eq(dailyChallenges.id, session.challengeId)).limit(1))[0]?.variantKey ?? null
    : null)
  if (isPromoSessionVariant(session.mode as TitleMode, variantKey)) {
    throw new ApiError(422, 'HINT_DISABLED_FOR_PROMO', 'В промо-режиме доступны только подсказки из пакета')
  }
  const existingChoices = await tx.select({ checkpoint: gameHintChoices.checkpoint, hintKey: gameHintChoices.hintKey, response: gameHintChoices.responseSnapshot }).from(gameHintChoices).where(eq(gameHintChoices.sessionId, sessionId)).orderBy(asc(gameHintChoices.checkpoint))
  if (existingChoices.some((choice) => choice.checkpoint === checkpoint)) throw new ApiError(409, 'HINT_ALREADY_CHOSEN', 'Подсказка на этом этапе уже выбрана')
  const answers = await tx.select({ payload: contentItemVersions.payload }).from(contentItemVersions).where(eq(contentItemVersions.id, session.answerItemVersionId)).limit(1)
  const priorAttempts = await tx.select({ hints: gameAttempts.hintsSnapshot }).from(gameAttempts).where(eq(gameAttempts.sessionId, session.id)).orderBy(asc(gameAttempts.position))
  const options = buildHintOptions(answers[0].payload as TitleItem, existingChoices.map((choice) => ({ hintKey: String(choice.hintKey), response: choice.response })), priorAttempts.map((attempt) => ({ hints: attempt.hints as Hint[] })))
  const selectedOption = options.find((option) => option.key === hintKey)
  if (!selectedOption) throw new ApiError(422, 'HINT_NOT_AVAILABLE', 'Для этого этапа нет доступных вариантов подсказки')
  const response = {
    checkpoint,
    hintKey: selectedOption.key,
    value: selectedOption.value,
    ...(selectedOption.sourceKey ? { sourceKey: selectedOption.sourceKey } : {}),
  }
  await tx.insert(gameHintChoices).values({ sessionId, checkpoint, hintKey, responseSnapshot: response, idempotencyKey })
  return response
})

export const searchCatalog = async (db: Database, input: { mode: TitleMode; q: string; period?: PeriodKey; difficulty?: ApiDifficultyKey; sessionId?: string; limit?: number }, userId?: string) => {
  let mode = input.mode
  let revisionId: string
  let period = input.period ?? 'all'
  let difficulty = input.difficulty ?? null
  let variantKey: string | null = null
  const excluded = new Set<string>()
  if (input.sessionId) {
    const sessions = await db.select().from(gameSessions).where(eq(gameSessions.id, input.sessionId)).limit(1)
    const session = sessions[0]
    if (!session || (userId && session.userId !== userId)) throw new ApiError(404, 'GAME_NOT_FOUND', 'Игровая сессия не найдена')
    mode = session.mode as TitleMode
    revisionId = session.revisionId; period = session.period; difficulty = session.difficulty
    variantKey = session.packId ?? (session.challengeId
      ? (await db.select({ variantKey: dailyChallenges.variantKey }).from(dailyChallenges).where(eq(dailyChallenges.id, session.challengeId)).limit(1))[0]?.variantKey ?? null
      : null)
    const used = await db.select({ itemId: contentItemVersions.itemId }).from(gameAttempts).innerJoin(contentItemVersions, eq(contentItemVersions.id, gameAttempts.guessedItemVersionId)).where(eq(gameAttempts.sessionId, session.id))
    used.forEach((row) => excluded.add(row.itemId))
  } else {
    revisionId = await activeRevision(db)
  }
  const pool = await answerPoolForSession(db, revisionId, mode, period, difficulty ?? null, variantKey)
  const { searchTitles } = await import('@shoditsa/game-core')
  return searchTitles(pool.items, input.q, excluded).slice(0, input.limit ?? 10).map(publicCard)
}
