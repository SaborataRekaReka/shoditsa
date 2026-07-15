import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { ApiDifficultyKey, ApiRole, AssistHintKey, Hint, PeriodKey, TitleItem, TitleMode } from '@shoditsa/contracts'
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
import { getMoscowDate } from '../../lib/time.js'
import { completeGame } from '../stats/rewards.js'

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
  : answerPool(tx, revisionId, mode, period, difficulty)

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
const compactList = (label: string, values: Array<string | null | undefined>, limit = 3) => {
  const normalized = values.map((value) => cleanHintText(value)).filter(Boolean)
  if (!normalized.length) return ''
  return `${label}: ${normalized.slice(0, limit).join(', ')}`
}

const normalizeHintMatch = (value: unknown) => cleanHintText(value).toLocaleLowerCase('ru-RU').replace(/ё/g, 'е')
const matchedAttemptValues = (attempts: Array<{ hints: Hint[] }>) => new Set(attempts.flatMap((attempt) => attempt.hints.flatMap((hint) => [
  ...(hint.status === 'match' ? [hint.value] : []),
  ...(hint.matchedValues ?? []),
]).map(normalizeHintMatch).filter(Boolean)))

const removeMatchedCandidateValues = (candidate: string, matched: Set<string>) => {
  const separator = candidate.indexOf(':')
  if (separator < 0) return matched.has(normalizeHintMatch(candidate)) ? '' : candidate
  const label = candidate.slice(0, separator)
  const values = candidate.slice(separator + 1).split(',').map((value) => value.trim()).filter(Boolean)
  const remaining = values.filter((value) => !matched.has(normalizeHintMatch(value)))
  return remaining.length ? `${label}: ${remaining.join(', ')}` : ''
}

const infoHintCandidates = (answer: TitleItem) => {
  if (answer.mode === 'music') {
    return [
      compactList('Страна', (answer.countries ?? []).map(localizeMusicCountry), 2),
      answer.activityStartYear ? `Начало деятельности: ${answer.activityStartYear}` : '',
      `Тип: ${musicTypeLabel(answer.musicType)}`,
      answer.musicOrigin ? `Сцена: ${musicOriginLabel(answer.musicOrigin)}` : '',
      compactList('Жанры', answer.genres ?? [], 3),
      compactList('Топ-треки', (answer.topTracks ?? []).map((track) => track.title), 2),
    ].filter(Boolean)
  }

  if (answer.mode === 'game') {
    return [
      answer.year ? `Год релиза: ${answer.year}` : '',
      compactList('Жанры', answer.genres ?? [], 3),
      compactList('Платформы', answer.platforms ?? [], 3),
      compactList('Разработчики', answer.developers ?? [], 2),
      answer.topRank ? `Позиция в топе: #${answer.topRank}` : '',
      answer.ratings?.metacritic != null || answer.metacritic != null ? `Metacritic: ${answer.ratings?.metacritic ?? answer.metacritic}` : '',
    ].filter(Boolean)
  }

  if (answer.mode === 'diagnosis') {
    return [
      compactList('Системы организма', answer.bodySystems ?? [], 3),
      compactList('Ключевые симптомы', answer.keySymptoms ?? [], 3),
      compactList('Диагностика', answer.diagnostics ?? [], 3),
      compactList('МКБ-10', answer.icd10 ?? [], 3),
      answer.icdGroup ? `Группа: ${answer.icdGroup}` : '',
    ].filter(Boolean)
  }

  if (answer.mode === 'anime') {
    return [
      answer.animeKind ? `Формат: ${answer.animeKind}` : '',
      answer.animeStatus ? `Статус: ${answer.animeStatus}` : '',
      answer.episodes ? `Эпизоды: ${answer.episodes}` : '',
      compactList('Студии', answer.studios ?? [], 2),
      compactList('Жанры', answer.genres ?? [], 3),
      answer.year ? `Год релиза: ${answer.year}` : '',
    ].filter(Boolean)
  }

  return [
    answer.year ? `Год релиза: ${answer.year}` : '',
    compactList('Страны', answer.countries ?? [], 2),
    compactList('Жанры', answer.genres ?? [], 3),
    compactList('Режиссёры', (answer.directors ?? []).map((person) => person.nameRu || person.nameOriginal), 2),
    compactList('Каст', (answer.cast ?? []).map((person) => person.nameRu || person.nameOriginal), 3),
  ].filter(Boolean)
}

const factHintValue = (answer: TitleItem, matched: Set<string>) => {
  const fact = (answer.facts ?? []).map(cleanHintText).find((candidate) => {
    const normalized = normalizeHintMatch(candidate)
    return normalized && ![...matched].some((value) => value.length >= 3 && normalized.includes(value))
  }) ?? ''
  if (fact) return cropHintText(fact)

  const fallback = cleanHintText(answer.plotHint ?? answer.shortDescription ?? answer.description ?? '')
  return fallback ? cropHintText(fallback) : ''
}

type BuiltHintOption = {
  key: AssistHintKey
  title: string
  subtitle: string
  value: string
}

export const buildHintOptions = (answer: TitleItem, choices: Array<{ hintKey: string }>, attempts: Array<{ hints: Hint[] }> = []): BuiltHintOption[] => {
  const options: BuiltHintOption[] = []
  const matched = matchedAttemptValues(attempts)

  const infoUsedCount = choices.filter((choice) => choice.hintKey === 'info').length
  const infoValue = cleanHintText(infoHintCandidates(answer).map((candidate) => removeMatchedCandidateValues(candidate, matched)).filter(Boolean)[infoUsedCount] ?? '')
  if (infoValue) {
    options.push({
      key: 'info',
      title: 'Неоткрытая информация',
      subtitle: 'Деталь о правильном ответе, которая ещё не показывалась',
      value: infoValue,
    })
  }

  const factAlreadyOpened = choices.some((choice) => choice.hintKey === 'fact')
  const factValue = factAlreadyOpened ? '' : factHintValue(answer, matched)
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

export const answerPool = async (tx: ReadDatabase, revisionId: string, mode: TitleMode, period: PeriodKey, difficulty: ApiDifficultyKey | null) => {
  const rows = await tx.select({ id: contentItemVersions.id, payload: contentItemVersions.payload })
    .from(contentItemVersions).where(and(
      eq(contentItemVersions.revisionId, revisionId), eq(contentItemVersions.mode, mode), eq(contentItemVersions.allowedInGame, true),
    )).orderBy(asc(contentItemVersions.sortOrder))
  let items = poolFor(rows.map((row) => row.payload as TitleItem), mode, period)
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
  kind: 'daily' | 'archive'; mode: TitleMode; period?: PeriodKey; difficulty?: ApiDifficultyKey | null; archiveDate?: string | null; packId?: string | null;
}, authSessionId: string | null = null, actorRole: ApiRole = 'player') => db.transaction(async (tx) => {
  const period = ['game', 'music', 'diagnosis'].includes(input.mode) ? 'all' : input.period ?? 'all'
  const difficulty = input.mode === 'music' ? input.difficulty ?? 'medium' : null
  const packId = input.mode === 'game' && typeof input.packId === 'string' && input.packId.trim().length ? input.packId.trim() : null
  if (packId && actorRole !== 'admin') throw new ApiError(403, 'PROMO_PACK_FORBIDDEN', 'Promo-режим доступен только администратору')
  if (period !== 'all' && ['movie', 'series', 'anime'].includes(input.mode)) {
    const entitlement = await tx.select({ userId: periodEntitlements.userId }).from(periodEntitlements).where(and(
      eq(periodEntitlements.userId, userId), eq(periodEntitlements.mode, input.mode), eq(periodEntitlements.period, period),
    )).limit(1)
    if (!entitlement[0]) throw new ApiError(403, 'PERIOD_LOCKED', 'Сначала разблокируйте этот период')
  }
  const today = getMoscowDate()
  const puzzleDate = input.kind === 'daily' ? today : input.archiveDate
  if (!puzzleDate) throw new ApiError(422, 'ARCHIVE_DATE_REQUIRED', 'Для архивной игры нужна дата')
  if (puzzleDate > today) throw new ApiError(422, 'ARCHIVE_DATE_IN_FUTURE', 'Архивная дата не может быть в будущем')
  const revisionId = await activeRevision(tx)
  const salt = await dailySalt(tx)
  const variant = packId ?? difficulty ?? '-'
  const algorithmVersion = packId ? 2 : 1
  const challengeKey = `${puzzleDate}|${input.mode}|${period}|${variant}|${salt}|v${algorithmVersion}`

  let challenge = await tx.select().from(dailyChallenges).where(eq(dailyChallenges.challengeKey, challengeKey)).limit(1)
  if (!challenge[0]) {
    const pool = await answerPoolForSession(tx, revisionId, input.mode, period, difficulty, packId)
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
      : Promise.resolve(dailyTitle(pool.items, input.mode, period, puzzleDate, salt, difficulty ?? ''))
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
  return buildSessionSnapshot(tx, session)
})

export const buildSessionSnapshot = async (tx: Transaction | Database, session: SessionRow) => {
  const attempts = await tx.select({
    position: gameAttempts.position, hints: gameAttempts.hintsSnapshot, item: contentItemVersions.payload,
  }).from(gameAttempts).innerJoin(contentItemVersions, eq(contentItemVersions.id, gameAttempts.guessedItemVersionId))
    .where(eq(gameAttempts.sessionId, session.id)).orderBy(asc(gameAttempts.position))
  const choices = await tx.select({ checkpoint: gameHintChoices.checkpoint, hintKey: gameHintChoices.hintKey, response: gameHintChoices.responseSnapshot })
    .from(gameHintChoices).where(eq(gameHintChoices.sessionId, session.id)).orderBy(asc(gameHintChoices.checkpoint))
  const challengeVariant = session.challengeId
    ? (await tx.select({ variantKey: dailyChallenges.variantKey }).from(dailyChallenges).where(eq(dailyChallenges.id, session.challengeId)).limit(1))[0]?.variantKey ?? null
    : null
  let diagnosisVignette: { id: string; text: string } | null = null
  if (session.mode === 'diagnosis') {
    const rows = await tx.select({ id: diagnosisVignettes.id, text: diagnosisVignettes.text }).from(diagnosisVignettes)
      .where(eq(diagnosisVignettes.itemVersionId, session.answerItemVersionId)).orderBy(asc(diagnosisVignettes.sortOrder))
    diagnosisVignette = pickDailyVignette(rows, session.answerItemVersionId, session.puzzleDate)
  }
  const answerRows = await tx.select({ payload: contentItemVersions.payload }).from(contentItemVersions).where(eq(contentItemVersions.id, session.answerItemVersionId)).limit(1)
  const answer = answerRows[0]?.payload as TitleItem | undefined
  const isPromoSession = isPromoSessionVariant(session.mode, challengeVariant)
  const promo = await promoSessionPayload(session.mode, challengeVariant, answer, session.attemptsCount)
  const hintOptions = isPromoSession
    ? []
    : answer
      ? buildHintOptions(answer, choices.map((choice) => ({ hintKey: String(choice.hintKey) })), attempts.map((attempt) => ({ hints: attempt.hints as Hint[] })))
      : []
  const result: Record<string, unknown> = {
    id: session.id, kind: session.kind, mode: session.mode, variantKey: challengeVariant, period: session.period, difficulty: session.difficulty,
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

  const variantKey = session.challengeId
    ? (await tx.select({ variantKey: dailyChallenges.variantKey }).from(dailyChallenges).where(eq(dailyChallenges.id, session.challengeId)).limit(1))[0]?.variantKey ?? null
    : null
  const pool = await answerPoolForSession(tx, session.revisionId, session.mode, session.period, session.difficulty, variantKey)
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
  const promo = await promoSessionPayload(session.mode, variantKey, answer, position)
  let reward: Awaited<ReturnType<typeof completeGame>> = null
  if (status !== 'playing') reward = await completeGame(tx, {
    sessionId, userId, kind: session.kind, mode: session.mode, difficulty: session.difficulty,
    puzzleDate: session.puzzleDate, won: status === 'won', attemptsCount: position,
  })
  await tx.update(gameSessions).set({
    attemptsCount: position, status, updatedAt: new Date(), completedAt: status === 'playing' ? null : new Date(),
    rewardLedgerId: reward?.ledgerId ?? null,
  }).where(eq(gameSessions.id, sessionId))
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
  const variantKey = session.challengeId
    ? (await tx.select({ variantKey: dailyChallenges.variantKey }).from(dailyChallenges).where(eq(dailyChallenges.id, session.challengeId)).limit(1))[0]?.variantKey ?? null
    : null
  if (isPromoSessionVariant(session.mode, variantKey)) {
    throw new ApiError(422, 'HINT_DISABLED_FOR_PROMO', 'В промо-режиме доступны только подсказки из пакета')
  }
  const existingChoices = await tx.select({ checkpoint: gameHintChoices.checkpoint, hintKey: gameHintChoices.hintKey }).from(gameHintChoices).where(eq(gameHintChoices.sessionId, sessionId)).orderBy(asc(gameHintChoices.checkpoint))
  if (existingChoices.some((choice) => choice.checkpoint === checkpoint)) throw new ApiError(409, 'HINT_ALREADY_CHOSEN', 'Подсказка на этом этапе уже выбрана')
  const answers = await tx.select({ payload: contentItemVersions.payload }).from(contentItemVersions).where(eq(contentItemVersions.id, session.answerItemVersionId)).limit(1)
  const priorAttempts = await tx.select({ hints: gameAttempts.hintsSnapshot }).from(gameAttempts).where(eq(gameAttempts.sessionId, session.id)).orderBy(asc(gameAttempts.position))
  const options = buildHintOptions(answers[0].payload as TitleItem, existingChoices.map((choice) => ({ hintKey: String(choice.hintKey) })), priorAttempts.map((attempt) => ({ hints: attempt.hints as Hint[] })))
  const selectedOption = options.find((option) => option.key === hintKey)
  if (!selectedOption) throw new ApiError(422, 'HINT_NOT_AVAILABLE', 'Для этого этапа нет доступных вариантов подсказки')
  const response = { checkpoint, hintKey: selectedOption.key, value: selectedOption.value }
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
    mode = session.mode
    revisionId = session.revisionId; period = session.period; difficulty = session.difficulty
    variantKey = session.challengeId
      ? (await db.select({ variantKey: dailyChallenges.variantKey }).from(dailyChallenges).where(eq(dailyChallenges.id, session.challengeId)).limit(1))[0]?.variantKey ?? null
      : null
    const used = await db.select({ itemId: contentItemVersions.itemId }).from(gameAttempts).innerJoin(contentItemVersions, eq(contentItemVersions.id, gameAttempts.guessedItemVersionId)).where(eq(gameAttempts.sessionId, session.id))
    used.forEach((row) => excluded.add(row.itemId))
  } else {
    revisionId = await activeRevision(db)
  }
  const pool = await answerPoolForSession(db, revisionId, mode, period, difficulty ?? null, variantKey)
  const { searchTitles } = await import('@shoditsa/game-core')
  return searchTitles(pool.items, input.q, excluded).slice(0, input.limit ?? 10).map(publicCard)
}
