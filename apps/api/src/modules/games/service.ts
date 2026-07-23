import { and, asc, eq, sql } from 'drizzle-orm'
import { ECONOMY_RULES_VERSION, GAME_MODE_MANIFEST, isCatalogGuessModeId, normalizeModeVariant, type ApiDifficultyKey, type ApiRole, type AssistHintKey, type Hint, type PeriodKey, type TitleItem, type TitleMode } from '@shoditsa/contracts'
import {
  appSettings, contentItemVersions, contentRevisionModes, contentRevisions, dailyChallenges,
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
import { loadPackSessionPrompt } from '../packs/prompt-runtime.js'

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type ReadDatabase = Pick<Database, 'select'>
type SessionRow = typeof gameSessions.$inferSelect

type AnswerPoolResult = {
  items: TitleItem[]
  byItemId: Map<string, string>
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
  return fact ? cropHintText(fact) : ''
}

const plotHintValue = (answer: TitleItem) => {
  const value = cleanHintText(answer.plotHint ?? '')
  const invalid = value.length < 30
    || /(?:\.\.\.|…)\s*$/.test(value)
    || /\[+\s*REDACTED\s*\]+|_KEEP_\d+_/i.test(value)
  return invalid ? '' : cropHintText(value)
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

  const plotAlreadyOpened = choices.some((choice) => choice.hintKey === 'plot')
  const plotValue = plotAlreadyOpened ? '' : plotHintValue(answer)
  if (plotValue) {
    options.push({
      key: 'plot',
      title: 'Подсказка о сюжете',
      subtitle: 'Краткое описание завязки без названия и ключевых спойлеров',
      value: plotValue,
    })
  }

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
      subtitle: 'Дополнительный факт о правильном ответе без спойлеров',
      value: factValue,
    })
  }

  return options
}

export const publicCard = (item: TitleItem) => ({
  ...(({ comments: _privateComments, ...publicItem }) => publicItem)(item),
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
  kind: 'daily' | 'archive'; mode: TitleMode; period?: PeriodKey; difficulty?: ApiDifficultyKey | null; archiveDate?: string | null; variantKey?: string | null;
}, authSessionId: string | null = null, _actorRole: ApiRole = 'player', config?: AppConfig) => db.transaction(async (tx) => {
  const capabilities = GAME_MODE_MANIFEST[input.mode]
  const period = capabilities.periodPolicy === 'all' ? 'all' : input.period ?? 'all'
  const difficulty = input.mode === 'music' ? input.difficulty ?? 'medium' : null
  const requestedVariant = input.variantKey ?? null
  const modeVariant = input.mode === 'city' ? normalizeModeVariant(input.mode, requestedVariant) ?? 'capitals' : null
  if (input.mode === 'city' && requestedVariant && !normalizeModeVariant(input.mode, requestedVariant)) {
    throw new ApiError(422, 'GAME_VARIANT_INVALID', 'Недопустимый вариант режима')
  }
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
    const pool = await answerPool(tx, revisionId, input.mode, period, difficulty, modeVariant)
    const selectedAnswer = dailyTitle(pool.items, input.mode, period, puzzleDate, salt, input.mode === 'city' ? variant : difficulty ?? '')
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
    puzzleDate, revisionId: challenge[0].revisionId, answerItemVersionId: challenge[0].answerItemVersionId, rulesVersion: ECONOMY_RULES_VERSION,
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
  const packPrompt = session.kind === 'pack'
    ? await loadPackSessionPrompt(tx, {
        packId: session.packId,
        packPosition: session.packPosition,
        answerItemVersionId: session.answerItemVersionId,
        attemptsCount: session.attemptsCount,
      })
    : null
  const promptRuntime = packPrompt
  const isPromptSession = Boolean(packPrompt)
  const maxAttempts = packPrompt?.maxAttempts ?? 10
  const hintOptions = isPromptSession
    ? []
    : answer
      ? buildHintOptions(answer, choices.map((choice) => ({ hintKey: String(choice.hintKey), response: choice.response })), attempts.map((attempt) => ({ hints: attempt.hints as Hint[] })))
      : []
  const result: Record<string, unknown> = {
    engine: 'catalog_guess', rulesVersion: session.rulesVersion,
    id: session.id, kind: session.kind, mode: sessionMode, variantKey: challengeVariant, packId: session.packId, packPosition: session.packPosition, period: session.period, difficulty: session.difficulty,
    puzzleDate: session.puzzleDate, status: session.status, attemptsCount: session.attemptsCount,
    attemptsRemaining: Math.max(0, maxAttempts - session.attemptsCount),
    maxAttempts,
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
    hintChoices: isPromptSession ? [] : choices,
    hintOptions: hintOptions.map(({ key, title, subtitle }) => ({ key, title, subtitle })),
    progressiveHints: promptRuntime?.progressiveHints ?? [],
    promoPrompt: promptRuntime?.promoPrompt ?? null,
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
  if (!isCatalogGuessModeId(session.mode)) throw new ApiError(422, 'GAME_ACTION_ENGINE_MISMATCH', 'Для этой игры действие недоступно')
  const lockedReplay = await tx.select({ response: gameAttempts.responseSnapshot }).from(gameAttempts).where(and(eq(gameAttempts.sessionId, sessionId), eq(gameAttempts.idempotencyKey, idempotencyKey))).limit(1)
  if (lockedReplay[0]) return lockedReplay[0].response
  if (session.status !== 'playing') throw new ApiError(409, 'GAME_ALREADY_COMPLETED', 'Игра уже завершена')
  const packPrompt = session.kind === 'pack'
    ? await loadPackSessionPrompt(tx, {
        packId: session.packId,
        packPosition: session.packPosition,
        answerItemVersionId: session.answerItemVersionId,
        attemptsCount: session.attemptsCount,
      })
    : null
  const maxAttempts = packPrompt?.maxAttempts ?? 10
  if (session.attemptsCount >= maxAttempts) throw new ApiError(409, 'GAME_ATTEMPTS_EXHAUSTED', 'Попытки закончились')

  const variantKey = session.packId ?? (session.challengeId
    ? (await tx.select({ variantKey: dailyChallenges.variantKey }).from(dailyChallenges).where(eq(dailyChallenges.id, session.challengeId)).limit(1))[0]?.variantKey ?? null
    : null)
  const sessionMode = session.mode as TitleMode
  const pool = await answerPool(tx, session.revisionId, sessionMode, session.period, session.difficulty, variantKey)
  const guess = pool.items.find((item) => item.id === itemId)
  if (!guess) throw new ApiError(422, 'GAME_ITEM_OUTSIDE_POOL', 'Вариант недоступен в этой игре')
  const guessedVersionId = pool.byItemId.get(guess.id)!
  const duplicate = await tx.select({ id: gameAttempts.id }).from(gameAttempts).where(and(eq(gameAttempts.sessionId, sessionId), eq(gameAttempts.guessedItemVersionId, guessedVersionId))).limit(1)
  if (duplicate[0]) throw new ApiError(409, 'GAME_DUPLICATE_GUESS', 'Этот вариант уже был в попытках')
  const answers = await tx.select({ payload: contentItemVersions.payload }).from(contentItemVersions).where(eq(contentItemVersions.id, session.answerItemVersionId)).limit(1)
  const answer = answers[0].payload as TitleItem
  const isCorrect = guess.id === answer.id
  const position = session.attemptsCount + 1
  const status = isCorrect ? 'won' : position >= maxAttempts ? 'lost' : 'playing'
  const hints = normalizeHintPeople(compareTitles(guess, answer) as Hint[])
  const promptAfterAttempt = packPrompt
    ? await loadPackSessionPrompt(tx, {
        packId: session.packId,
        packPosition: session.packPosition,
        answerItemVersionId: session.answerItemVersionId,
        attemptsCount: position,
      })
    : null
  const promptRuntime = promptAfterAttempt
  let reward: Awaited<ReturnType<typeof completeGame>> = null
  if (status !== 'playing') reward = await completeGame(tx, {
    sessionId, userId, kind: session.kind, mode: sessionMode, difficulty: session.difficulty,
    puzzleDate: session.puzzleDate, won: status === 'won', attemptsCount: position, rulesVersion: session.rulesVersion,
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
    session: { status, attemptsCount: position, attemptsRemaining: Math.max(0, maxAttempts - position), maxAttempts },
    progressiveHints: promptRuntime?.progressiveHints ?? [],
    promoPrompt: promptRuntime?.promoPrompt ?? null,
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
  if (!isCatalogGuessModeId(session.mode)) throw new ApiError(422, 'GAME_ACTION_ENGINE_MISMATCH', 'Для этой игры действие недоступно')
  const lockedReplay = await tx.select({ response: gameHintChoices.responseSnapshot }).from(gameHintChoices).where(and(eq(gameHintChoices.sessionId, sessionId), eq(gameHintChoices.idempotencyKey, idempotencyKey))).limit(1)
  if (lockedReplay[0]) return lockedReplay[0].response
  if (session.attemptsCount < checkpoint) throw new ApiError(422, 'HINT_CHECKPOINT_LOCKED', 'Эта подсказка пока недоступна')
  const variantKey = session.packId ?? (session.challengeId
    ? (await tx.select({ variantKey: dailyChallenges.variantKey }).from(dailyChallenges).where(eq(dailyChallenges.id, session.challengeId)).limit(1))[0]?.variantKey ?? null
    : null)
  const packPrompt = session.kind === 'pack'
    ? await loadPackSessionPrompt(tx, {
        packId: session.packId,
        packPosition: session.packPosition,
        answerItemVersionId: session.answerItemVersionId,
        attemptsCount: session.attemptsCount,
      })
    : null
  if (packPrompt) {
    throw new ApiError(422, 'HINT_DISABLED_FOR_PACK', 'В спецпоказе доступны только подсказки из пакета')
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
  const pool = await answerPool(db, revisionId, mode, period, difficulty ?? null, variantKey)
  const { searchTitles } = await import('@shoditsa/game-core')
  return searchTitles(pool.items, input.q, excluded).slice(0, input.limit ?? 10).map(publicCard)
}
