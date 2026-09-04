import { sql } from 'drizzle-orm'
import type {
  AdminAcquisitionActivityBreakdown,
  AdminDanetkiFunnel,
  AdminDiagnosisRecommendations,
  AdminAcquisitionFunnelBreakdown,
  AdminAcquisitionFunnelPeriod,
  AdminAcquisitionFunnelResponse,
  AdminRegistrationSummary,
} from '@shoditsa/contracts'
import type { Database } from '@shoditsa/database'
import {
  ANALYTICS_ROLLUP_LAG_DAYS,
  completedUtcDay,
  ORGANIC_SIGN_UP_ATTRIBUTION_DAYS,
  RAW_ANALYTICS_RETENTION_DAYS,
} from '../stats/analytics-rollup-service.js'

const DAY_MS = 86_400_000
const ATTRIBUTION_WINDOW_DAYS = ORGANIC_SIGN_UP_ATTRIBUTION_DAYS
const CLIENT_EVENT_RETENTION_DAYS = RAW_ANALYTICS_RETENTION_DAYS

export type AcquisitionClientEventRow = {
  eventId: string
  eventName: string
  occurredAt: string | Date
  userId: string
  gameSessionId: string | null
  route: string | null
  properties: unknown
}

export type AcquisitionSignUpRow = {
  eventId: string
  occurredAt: string | Date
  userId: string
  acquisitionId?: string | null
  entrySource?: string | null
  searchEngine?: string | null
  entryPath?: string | null
}

export type AcquisitionDailyRow = {
  activityDate: string | Date
  eventName: string
  entrySource: string
  searchEngine: string
  entryPath: string
  mode: string
  eventsCount: number | string
  usersCount: number | string
  acquisitionsCount: number | string
}

export type AcquisitionRegistrationAggregateRow = {
  accountsCreated: number | string
  signUpSuccesses: number | string
  signInSuccesses: number | string
  signUpsWithAcquisition: number | string
  signUpsAttributedToOrganic: number | string
}

export type AcquisitionReportWindow = {
  reportFrom: Date
  reportTo: Date
  rawFrom: Date
  registrationRawFrom: Date
  archiveTo: Date
}

type PrimitiveRecord = Record<string, unknown>
type Stage = 'starts' | 'completions' | 'nextClicks' | 'nextStarts'
type Acquisition = {
  id: string
  userId: string
  acquiredAt: Date
  entryPath: string
  searchEngine: string
  mode: string
}

export const acquisitionReportWindow = (periodDays: AdminAcquisitionFunnelPeriod, now = new Date()): AcquisitionReportWindow => {
  const reportTo = completedUtcDay(now)
  const reportFrom = new Date(reportTo.getTime() - periodDays * DAY_MS)
  const archiveTo = new Date(reportTo.getTime() - ANALYTICS_ROLLUP_LAG_DAYS * DAY_MS)
  return { reportFrom, reportTo, rawFrom: reportFrom, registrationRawFrom: reportFrom, archiveTo }
}

type StageEvent = {
  stage: Stage
  acquisition: Acquisition
  mode: string
}

const lifecycleNames = new Set([
  'game_session_start', 'game_session_complete', 'game_next_clicked', 'game_next_start',
  'danetki_room_started', 'danetki_room_completed', 'danetki_cross_game_clicked',
  'territory_room_started', 'territory_match_completed',
])

const record = (value: unknown): PrimitiveRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as PrimitiveRecord : {}
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null
const property = (properties: PrimitiveRecord, ...keys: string[]) => {
  for (const key of keys) {
    const value = text(properties[key])
    if (value) return value
  }
  return null
}
const isoDate = (value: string | Date) => new Date(value)
const ratio = (numerator: number, denominator: number) => denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 100 : null
const rows = <T>(value: unknown) => Array.from(value as Iterable<T>)
const normalizeSource = (value: string | null) => {
  const source = value?.toLocaleLowerCase('ru-RU') ?? ''
  return source === 'organic_search' || source === 'organic' ? 'organic_search' : source === 'direct' || source === 'referral' ? source : 'unknown'
}
const organicSource = (value: string | null) => normalizeSource(value) === 'organic_search'
const routeMode = (route: string | null) => {
  if (route?.startsWith('/danetki')) return 'danetki'
  return route?.match(/^\/games\/([^/?#]+)/)?.[1] ?? null
}
const pathLabel = (path: string) => path === '/' ? 'Главная' : path
const modeLabel: Record<string, string> = {
  movie: 'Кино', series: 'Сериалы', anime: 'Аниме', game: 'Игры', music: 'Музыка', diagnosis: 'Диагнозы',
  city: 'Города', animal: 'Животные', book: 'Книги', character: 'Персонажи', danetki: 'Данетки', connections: 'Связи', territory: 'Захват',
}
const publicGameModes = new Set(Object.keys(modeLabel))
const namedDanetkiPaths = new Set(['/danetki', '/danetki/dlya-detey', '/danetki/slozhnye', '/danetki/legkie', '/danetki/novye', '/danetki/albatros'])

const danetkiEventNames = [
  'danetki_landing_view', 'danetki_start_clicked', 'danetki_room_started', 'danetki_first_question',
  'danetki_room_completed', 'danetki_result_view', 'danetki_catalog_view', 'danetki_story_view',
  'danetki_story_answer_opened', 'danetki_catalog_play_clicked', 'danetki_registration_offer_view',
  'danetki_registration_offer_clicked', 'danetki_registration_succeeded', 'danetki_cross_game_clicked',
] as const

export const canonicalAnalyticsEntryPath = (value: string | null) => {
  if (!value) return '/other'
  if (value === '/') return '/'
  if (value === '/games/together') return value
  if (namedDanetkiPaths.has(value)) return value
  if (value.startsWith('/danetki/')) return '/danetki/story'
  const gameMode = value.match(/^\/games\/([^/?#]+)/)?.[1]
  if (gameMode && publicGameModes.has(gameMode)) return `/games/${gameMode}`
  return '/other'
}

const acquisitionIdOf = (properties: PrimitiveRecord) => property(properties, 'acquisition_id', 'acquisitionId')
const sourceOf = (properties: PrimitiveRecord) => property(properties, 'entry_source', 'entrySource')
const pathOf = (row: AcquisitionClientEventRow, properties: PrimitiveRecord) => canonicalAnalyticsEntryPath(property(properties, 'entry_path', 'entryPath') ?? row.route)
export const normalizeAnalyticsSearchEngine = (value: string | null) => {
  const engine = value?.toLocaleLowerCase('ru-RU') ?? ''
  if (engine === 'yandex' || engine === 'яндекс') return 'yandex'
  if (engine === 'google' || engine === 'гугл') return 'google'
  return ['bing', 'duckduckgo', 'mailru'].includes(engine) ? engine : engine ? 'other' : 'unknown'
}
const engineOf = (properties: PrimitiveRecord) => normalizeAnalyticsSearchEngine(property(properties, 'entry_search_engine', 'entrySearchEngine'))
const entryModeOfPath = (entryPath: string) => {
  const candidate = routeMode(entryPath)
  return candidate && publicGameModes.has(candidate) ? candidate : 'unknown'
}
const modeOf = (row: AcquisitionClientEventRow, properties: PrimitiveRecord) => {
  const candidate = (row.eventName === 'game_next_clicked' || row.eventName === 'danetki_cross_game_clicked' || row.eventName === 'game_next_start'
    ? property(properties, 'to_mode', 'toMode', 'mode')
    : property(properties, 'mode', 'to_mode', 'toMode')) ?? routeMode(row.route)
  return candidate && publicGameModes.has(candidate) ? candidate : 'unknown'
}
const acquisitionModeOf = (row: AcquisitionClientEventRow, properties: PrimitiveRecord) => entryModeOfPath(pathOf(row, properties))
const acquisitionMapKey = (userId: string, acquisitionId: string) => `${userId}\u0000${acquisitionId}`

const stageOf = (eventName: string): Stage | null => {
  if (eventName === 'game_session_start' || eventName === 'danetki_room_started' || eventName === 'territory_room_started') return 'starts'
  if (eventName === 'game_session_complete' || eventName === 'danetki_room_completed' || eventName === 'territory_match_completed') return 'completions'
  if (eventName === 'game_next_clicked' || eventName === 'danetki_cross_game_clicked') return 'nextClicks'
  if (eventName === 'game_next_start') return 'nextStarts'
  return null
}

const eventKey = (row: AcquisitionClientEventRow, properties: PrimitiveRecord) => {
  if (row.eventName === 'game_next_clicked' || row.eventName === 'danetki_cross_game_clicked' || row.eventName === 'game_next_start') {
    return property(properties, 'transition_id', 'transitionId') ?? row.gameSessionId ?? row.eventId
  }
  if (row.gameSessionId) return row.gameSessionId
  return row.eventId
}

const emptyBreakdown = (key: string, label: string, searchEngine?: string): AdminAcquisitionFunnelBreakdown => ({
  key, label, ...(searchEngine ? { searchEngine } : {}), organicLandings: 0, organicUsers: 0, starts: 0, completions: 0,
  nextClicks: 0, nextStarts: 0, signUps: 0, landingToStartRate: null, startToCompleteRate: null, landingToSignUpRate: null,
})

const finalizeBreakdown = (entry: AdminAcquisitionFunnelBreakdown) => ({
  ...entry,
  landingToStartRate: ratio(entry.starts, entry.organicLandings),
  startToCompleteRate: ratio(entry.completions, entry.starts),
  landingToSignUpRate: ratio(entry.signUps, entry.organicLandings),
})

type NormalizedClientEvent = {
  row: AcquisitionClientEventRow
  at: Date
  properties: PrimitiveRecord
}

const buildDanetkiFunnel = (events: NormalizedClientEvent[]): AdminDanetkiFunnel => {
  const danetkiRows = events.filter(({ row }) => danetkiEventNames.includes(row.eventName as typeof danetkiEventNames[number]))
  const count = (eventName: typeof danetkiEventNames[number], identity: (event: NormalizedClientEvent) => string = ({ row }) => row.eventId) => new Set(
    danetkiRows.filter(({ row }) => row.eventName === eventName).map(identity),
  ).size
  const sessionIdentity = ({ row }: NormalizedClientEvent) => row.gameSessionId ?? row.eventId
  const transitionIdentity = ({ row, properties }: NormalizedClientEvent) => property(properties, 'transition_id', 'transitionId') ?? row.gameSessionId ?? row.eventId
  const catalogViews = count('danetki_catalog_view')
  const storyViews = count('danetki_story_view')
  const answerOpens = count('danetki_story_answer_opened')
  const playClicks = count('danetki_catalog_play_clicked')
  const landingViews = count('danetki_landing_view')
  const startClicks = count('danetki_start_clicked')
  const roomStarts = count('danetki_room_started', sessionIdentity)
  const firstQuestions = count('danetki_first_question', sessionIdentity)
  const roomCompletions = count('danetki_room_completed', sessionIdentity)
  const resultViews = count('danetki_result_view', sessionIdentity)
  const registrationOffers = count('danetki_registration_offer_view')
  const registrationClicks = count('danetki_registration_offer_clicked')
  const registrations = count('danetki_registration_succeeded')
  const nextClicks = count('danetki_cross_game_clicked', transitionIdentity)
  const landings = new Map<string, Date>()
  const startedEntries = new Set<string>()
  const startedRooms = new Map<string, Date>()
  const firstQuestionRooms = new Set<string>()
  const completedRooms = new Set<string>()
  let unkeyedLandingViews = 0
  for (const event of [...danetkiRows].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    const { row, properties, at } = event
    const acquisitionId = acquisitionIdOf(properties)
    const entryKey = acquisitionId ? acquisitionMapKey(row.userId, acquisitionId) : null
    if (row.eventName === 'danetki_landing_view') {
      if (entryKey) landings.set(entryKey, landings.get(entryKey) ?? at)
      else unkeyedLandingViews += 1
    }
    if (row.eventName === 'danetki_room_started' && row.gameSessionId) {
      startedRooms.set(row.gameSessionId, startedRooms.get(row.gameSessionId) ?? at)
      if (entryKey && landings.has(entryKey)) startedEntries.add(entryKey)
    }
    if (!row.gameSessionId || !startedRooms.has(row.gameSessionId)) continue
    if (row.eventName === 'danetki_first_question') firstQuestionRooms.add(row.gameSessionId)
    if (row.eventName === 'danetki_room_completed') completedRooms.add(row.gameSessionId)
  }
  return {
    entryCohort: {
      landings: landings.size, started: startedEntries.size,
      landingToRoomRate: ratio(startedEntries.size, landings.size), unkeyedLandingViews,
    },
    roomCohort: {
      starts: startedRooms.size, firstQuestions: firstQuestionRooms.size, completions: completedRooms.size,
      completionRate: ratio(completedRooms.size, startedRooms.size),
    },
    content: {
      catalogViews,
      storyViews,
      answerOpens,
      playClicks,
      storyToAnswerRate: ratio(answerOpens, storyViews),
      contentToPlayRate: ratio(playClicks, catalogViews + storyViews),
    },
    game: {
      landingViews,
      startClicks,
      roomStarts,
      firstQuestions,
      roomCompletions,
      resultViews,
      registrationOffers,
      registrationClicks,
      registrations,
      nextClicks,
      landingToStartRate: ratio(startClicks, landingViews),
      startToRoomRate: ratio(roomStarts, startClicks),
      roomToFirstQuestionRate: ratio(firstQuestions, roomStarts),
      roomToCompletionRate: ratio(roomCompletions, roomStarts),
      completionToNextRate: ratio(nextClicks, roomCompletions),
    },
  }
}

const buildDiagnosisRecommendations = (events: NormalizedClientEvent[]): AdminDiagnosisRecommendations => {
  const destinations = ['animal', 'character', 'book']
  const publicEvents = events.filter(({ properties }) => !property(properties, 'packId', 'pack_id') && property(properties, 'kind') !== 'special')
  const completed = new Map(publicEvents.filter(({ row, properties }) => row.eventName === 'game_session_complete'
    && row.gameSessionId && modeOf(row, properties) === 'diagnosis').map((event) => [event.row.gameSessionId!, event]))
  const started = new Map(publicEvents.filter(({ row }) => row.eventName === 'game_session_start' && row.gameSessionId)
    .map((event) => [event.row.gameSessionId!, event]))
  const clicks = new Map(publicEvents.filter(({ row, properties }) => row.eventName === 'game_next_clicked'
    && property(properties, 'from_mode') === 'diagnosis'
    && property(properties, 'placement') === 'diagnosis-result-recommendations'
    && destinations.includes(property(properties, 'to_mode') ?? ''))
    .map((event) => [`${event.row.userId}:${property(event.properties, 'transition_id') ?? event.row.eventId}`, event]))
  const next = new Map(publicEvents.filter(({ row }) => row.eventName === 'game_next_start')
    .map((event) => [`${event.row.userId}:${property(event.properties, 'transition_id')}`, event]))
  const modes = new Map(destinations.map((mode) => [mode, { mode, label: modeLabel[mode]!, clicks: 0, confirmedStarts: 0 }]))
  const converted = new Set<string>()
  let confirmedStarts = 0
  let unlinkedClicks = 0
  for (const [key, click] of clicks) {
    const mode = property(click.properties, 'to_mode')!
    modes.get(mode)!.clicks += 1
    const source = click.row.gameSessionId ? completed.get(click.row.gameSessionId) : null
    const linkedSource = source && source.row.userId === click.row.userId && source.at <= click.at
    if (!linkedSource) unlinkedClicks += 1
    const transition = next.get(key)
    const target = transition?.row.gameSessionId ? started.get(transition.row.gameSessionId) : null
    if (!transition || !target || target.row.userId !== click.row.userId || modeOf(target.row, target.properties) !== mode
      || property(transition.properties, 'to_mode') !== mode || transition.at < click.at
      || target.at < click.at || transition.at.getTime() - click.at.getTime() > 15 * 60_000) continue
    confirmedStarts += 1
    modes.get(mode)!.confirmedStarts += 1
    if (linkedSource) converted.add(source.row.gameSessionId!)
  }
  return {
    completedSessions: completed.size, clicks: clicks.size, confirmedStarts,
    completedSessionsWithNextStart: converted.size,
    completeToNextRate: unlinkedClicks ? null : ratio(converted.size, completed.size),
    unlinkedClicks, byMode: [...modes.values()],
  }
}

const registrationSummary = (
  rowsInWindow: AcquisitionSignUpRow[],
  aggregate?: AcquisitionRegistrationAggregateRow,
): AdminRegistrationSummary => {
  const uniqueAccounts = [...new Map(rowsInWindow.map((entry) => [entry.userId, entry])).values()]
  const signUpSuccesses = aggregate ? dailyCount(aggregate.signUpSuccesses) : uniqueAccounts.length
  const signInSuccesses = aggregate ? dailyCount(aggregate.signInSuccesses) : null
  const accountsCreated = aggregate ? dailyCount(aggregate.accountsCreated) : null
  const signUpsWithAcquisition = aggregate
    ? dailyCount(aggregate.signUpsWithAcquisition)
    : uniqueAccounts.filter((entry) => Boolean(text(entry.acquisitionId))).length
  const signUpsAttributedToOrganic = aggregate
    ? dailyCount(aggregate.signUpsAttributedToOrganic)
    : uniqueAccounts.filter((entry) => Boolean(text(entry.acquisitionId)) && organicSource(text(entry.entrySource))).length
  return {
    accountsCreated,
    signUpSuccesses,
    signInSuccesses,
    signUpsWithAcquisition,
    signUpsAttributedToOrganic,
    signUpAccountCoverageRate: accountsCreated == null ? null : ratio(signUpSuccesses, accountsCreated),
    acquisitionCoverageRate: ratio(signUpsWithAcquisition, signUpSuccesses),
    attributedAccountCoverageRate: accountsCreated == null ? null : ratio(signUpsWithAcquisition, accountsCreated),
    unattributedAccounts: accountsCreated == null ? null : Math.max(0, accountsCreated - signUpsWithAcquisition),
    organicAttributionRate: ratio(signUpsAttributedToOrganic, signUpSuccesses),
  }
}

export const buildAdminAcquisitionFunnel = (
  clientEvents: AcquisitionClientEventRow[],
  signUpEvents: AcquisitionSignUpRow[],
  periodDays: AdminAcquisitionFunnelPeriod,
  now = new Date(),
  window?: { from: Date; to: Date },
  registrationAggregate?: AcquisitionRegistrationAggregateRow,
): AdminAcquisitionFunnelResponse => {
  const to = window ? new Date(window.to) : new Date(now)
  const from = window ? new Date(window.from) : new Date(to.getTime() - periodDays * DAY_MS)
  const earliestAttribution = new Date(from.getTime() - ATTRIBUTION_WINDOW_DAYS * DAY_MS)
  const validEvents = clientEvents
    .map((row) => ({ row, at: isoDate(row.occurredAt), properties: record(row.properties) }))
    .filter(({ at }) => Number.isFinite(at.getTime()) && at >= earliestAttribution && at <= to)

  const acquisitionMap = new Map<string, Acquisition>()
  for (const { row, at, properties } of validEvents) {
    const acquisitionId = acquisitionIdOf(properties)
    if (!acquisitionId || !organicSource(sourceOf(properties))) continue
    const candidate: Acquisition = {
      id: acquisitionId,
      userId: row.userId,
      acquiredAt: at,
      entryPath: pathOf(row, properties),
      searchEngine: engineOf(properties),
      mode: acquisitionModeOf(row, properties),
    }
    const mapKey = acquisitionMapKey(row.userId, acquisitionId)
    const current = acquisitionMap.get(mapKey)
    if (!current || candidate.acquiredAt < current.acquiredAt) {
      acquisitionMap.set(mapKey, candidate)
    }
  }

  for (const entry of signUpEvents) {
    const acquisitionId = text(entry.acquisitionId)
    if (!acquisitionId || !organicSource(text(entry.entrySource))) continue
    const acquiredAt = isoDate(entry.occurredAt)
    if (!Number.isFinite(acquiredAt.getTime()) || acquiredAt < earliestAttribution || acquiredAt > to) continue
    const candidate: Acquisition = {
      id: acquisitionId,
      userId: entry.userId,
      acquiredAt,
      entryPath: canonicalAnalyticsEntryPath(text(entry.entryPath)),
      searchEngine: normalizeAnalyticsSearchEngine(text(entry.searchEngine)),
      mode: entryModeOfPath(canonicalAnalyticsEntryPath(text(entry.entryPath))),
    }
    const mapKey = acquisitionMapKey(entry.userId, acquisitionId)
    const current = acquisitionMap.get(mapKey)
    if (!current || candidate.acquiredAt < current.acquiredAt) acquisitionMap.set(mapKey, candidate)
  }

  const cohort = [...acquisitionMap.values()].filter((entry) => entry.acquiredAt >= from && entry.acquiredAt <= to)
  const cohortIds = new Set(cohort.map((entry) => acquisitionMapKey(entry.userId, entry.id)))
  const stageKeys = new Map<Stage, Set<string>>([
    ['starts', new Set()], ['completions', new Set()], ['nextClicks', new Set()], ['nextStarts', new Set()],
  ])
  const activityKeys = new Map<Stage, Set<string>>([
    ['starts', new Set()], ['completions', new Set()], ['nextClicks', new Set()], ['nextStarts', new Set()],
  ])
  const activityModes = new Map<Stage, Map<string, { mode: string; canonical: boolean }>>([
    ['starts', new Map()], ['completions', new Map()], ['nextClicks', new Map()], ['nextStarts', new Map()],
  ])
  const stageEvents: StageEvent[] = []
  for (const { row, at, properties } of validEvents) {
    if (at < from || at > to) continue
    const stage = stageOf(row.eventName)
    const acquisitionId = acquisitionIdOf(properties)
    const mapKey = acquisitionId ? acquisitionMapKey(row.userId, acquisitionId) : null
    const acquisition = mapKey ? acquisitionMap.get(mapKey) : null
    if (!stage || !acquisition || !cohortIds.has(acquisitionMapKey(acquisition.userId, acquisition.id))) continue
    const acquisitionKey = acquisitionMapKey(acquisition.userId, acquisition.id)
    const activityKey = `${acquisitionKey}:${eventKey(row, properties)}`
    activityKeys.get(stage)!.add(activityKey)
    const activityMode = modeOf(row, properties)
    const currentActivity = activityModes.get(stage)!.get(activityKey)
    const canonical = !row.eventName.startsWith('danetki_')
    if (!currentActivity || (canonical && !currentActivity.canonical)) {
      activityModes.get(stage)!.set(activityKey, { mode: activityMode, canonical })
    }
    const seen = stageKeys.get(stage)!
    if (seen.has(acquisitionKey)) continue
    seen.add(acquisitionKey)
    stageEvents.push({ stage, acquisition, mode: acquisition.mode })
  }
  const strictStageKeys = new Map<Stage, Set<string>>([
    ['starts', stageKeys.get('starts')!],
    ['completions', new Set([...stageKeys.get('completions')!].filter((key) => stageKeys.get('starts')!.has(key)))],
    ['nextClicks', new Set([...stageKeys.get('nextClicks')!].filter((key) => stageKeys.get('completions')!.has(key) && stageKeys.get('starts')!.has(key)))],
    ['nextStarts', new Set([...stageKeys.get('nextStarts')!].filter((key) => stageKeys.get('completions')!.has(key) && stageKeys.get('starts')!.has(key)))],
  ])

  const attributedSignUps = signUpEvents
    .map((entry) => ({ ...entry, at: isoDate(entry.occurredAt) }))
    .filter((entry) => Number.isFinite(entry.at.getTime()) && entry.at >= from && entry.at <= to)
    .map((entry) => {
      const acquisition = [...acquisitionMap.values()]
        .filter((candidate) => candidate.userId === entry.userId && candidate.acquiredAt <= entry.at && entry.at.getTime() - candidate.acquiredAt.getTime() <= ATTRIBUTION_WINDOW_DAYS * DAY_MS)
        .sort((left, right) => right.acquiredAt.getTime() - left.acquiredAt.getTime())[0]
      return { ...entry, acquisition: acquisition ?? null }
    })
  const cohortSignUps = attributedSignUps.filter((entry) => entry.acquisition && cohortIds.has(acquisitionMapKey(entry.acquisition.userId, entry.acquisition.id))) as Array<(typeof attributedSignUps)[number] & { acquisition: Acquisition }>
  const cohortSignUpsByAcquisition = [...new Map(cohortSignUps.map((entry) => [acquisitionMapKey(entry.acquisition.userId, entry.acquisition.id), entry])).values()]

  const landingUsers = new Map<string, Set<string>>()
  const modeUsers = new Map<string, Set<string>>()
  const byLanding = new Map<string, AdminAcquisitionFunnelBreakdown>()
  const byMode = new Map<string, AdminAcquisitionFunnelBreakdown>()
  for (const acquisition of cohort) {
    const landingKey = `${acquisition.entryPath}\u0000${acquisition.searchEngine}`
    const landing = byLanding.get(landingKey) ?? emptyBreakdown(landingKey, pathLabel(acquisition.entryPath), acquisition.searchEngine)
    landing.organicLandings += 1
    byLanding.set(landingKey, landing)
    const landingSet = landingUsers.get(landingKey) ?? new Set<string>(); landingSet.add(acquisition.userId); landingUsers.set(landingKey, landingSet)
    const modeKey = acquisition.mode
    const mode = byMode.get(modeKey) ?? emptyBreakdown(modeKey, modeLabel[modeKey] ?? (modeKey === 'unknown' ? 'Не определено' : modeKey))
    mode.organicLandings += 1
    byMode.set(modeKey, mode)
    const modeSet = modeUsers.get(modeKey) ?? new Set<string>(); modeSet.add(acquisition.userId); modeUsers.set(modeKey, modeSet)
  }
  for (const [key, users] of landingUsers) byLanding.get(key)!.organicUsers = users.size
  for (const [key, users] of modeUsers) byMode.get(key)!.organicUsers = users.size

  for (const event of stageEvents) {
    const acquisitionKey = acquisitionMapKey(event.acquisition.userId, event.acquisition.id)
    if (!strictStageKeys.get(event.stage)!.has(acquisitionKey)) continue
    const landingKey = `${event.acquisition.entryPath}\u0000${event.acquisition.searchEngine}`
    const landing = byLanding.get(landingKey)
    if (landing) landing[event.stage] += 1
    const mode = byMode.get(event.mode) ?? emptyBreakdown(event.mode, modeLabel[event.mode] ?? (event.mode === 'unknown' ? 'Не определено' : event.mode))
    mode[event.stage] += 1
    byMode.set(event.mode, mode)
  }
  for (const signup of cohortSignUpsByAcquisition) {
    const landingKey = `${signup.acquisition.entryPath}\u0000${signup.acquisition.searchEngine}`
    const landing = byLanding.get(landingKey)
    if (landing) landing.signUps += 1
    const mode = byMode.get(signup.acquisition.mode)
    if (mode) mode.signUps += 1
  }

  const inWindow = validEvents.filter(({ at }) => at >= from && at <= to)
  const lifecycle = inWindow.filter(({ row }) => lifecycleNames.has(row.eventName))
  const lifecycleWithAcquisition = lifecycle.filter(({ properties }) => Boolean(acquisitionIdOf(properties)))
  const consentOf = (properties: PrimitiveRecord) => property(properties, 'analytics_consent')
  const consentedLifecycle = lifecycle.filter(({ properties }) => consentOf(properties) === 'accepted')
  const rejectedLifecycle = lifecycle.filter(({ properties }) => consentOf(properties) === 'rejected')
  const consentedLifecycleWithAcquisition = consentedLifecycle.filter(({ properties }) => Boolean(acquisitionIdOf(properties)))
  const pageViews = inWindow.filter(({ row }) => row.eventName === 'page_view')
  const pageViewsWithSource = pageViews.filter(({ properties }) => Boolean(sourceOf(properties)))
  const pageViewsWithAcquisition = pageViews.filter(({ properties }) => Boolean(acquisitionIdOf(properties)))
  const consentedPageViews = pageViews.filter(({ properties }) => consentOf(properties) === 'accepted')
  const rejectedPageViews = pageViews.filter(({ properties }) => consentOf(properties) === 'rejected')
  const consentedPageViewsWithAcquisition = consentedPageViews.filter(({ properties }) => Boolean(acquisitionIdOf(properties)))
  const unkeyedOrganicEvents = inWindow.filter(({ properties }) => organicSource(sourceOf(properties)) && !acquisitionIdOf(properties)).length
  const danetki = {
    all: buildDanetkiFunnel(inWindow),
    organic: buildDanetkiFunnel(inWindow.filter(({ properties }) => organicSource(sourceOf(properties)))),
  }
  const registrations = registrationSummary(
    signUpEvents.filter((entry) => {
      const occurredAt = isoDate(entry.occurredAt)
      return Number.isFinite(occurredAt.getTime()) && occurredAt >= from && occurredAt <= to
    }),
    registrationAggregate,
  )
  const territoryRows = inWindow.filter(({ row }) => row.eventName.startsWith('territory_'))
  const territoryCount = (eventName: string, identity: (row: AcquisitionClientEventRow, properties: PrimitiveRecord) => string) => new Set(
    territoryRows
      .filter(({ row }) => row.eventName === eventName)
      .map(({ row, properties }) => identity(row, properties)),
  ).size
  const territory = {
    landingViews: territoryCount('territory_landing_view', (row) => row.eventId),
    roomsCreated: territoryCount('territory_room_created', (row, properties) => property(properties, 'roomId') ?? row.eventId),
    roomStarts: territoryCount('territory_room_started', (row, properties) => property(properties, 'matchId') ?? row.eventId),
    duelsCompleted: territoryCount('territory_duel_completed', (row, properties) => `${property(properties, 'matchId') ?? row.eventId}:${property(properties, 'duelId') ?? property(properties, 'duelNumber') ?? ''}`),
    matchesCompleted: territoryCount('territory_match_completed', (row, properties) => property(properties, 'matchId') ?? row.eventId),
    rematchClicks: territoryCount('territory_rematch_clicked', (row, properties) => `${property(properties, 'matchId') ?? row.eventId}:${row.userId}`),
    rematchStarts: territoryCount('territory_rematch_started', (row, properties) => property(properties, 'matchId') ?? row.eventId),
  }
  const summaryCounts = Object.fromEntries([...strictStageKeys].map(([stage, keys]) => [stage, keys.size])) as Record<Stage, number>
  const activityCounts = Object.fromEntries([...activityKeys].map(([stage, keys]) => [stage, keys.size])) as Record<Stage, number>
  const activityByMode = new Map<string, AdminAcquisitionActivityBreakdown>()
  for (const [stage, identities] of activityModes) {
    for (const { mode } of identities.values()) {
      const entry = activityByMode.get(mode) ?? {
        key: mode,
        label: modeLabel[mode] ?? (mode === 'unknown' ? 'Не определено' : mode),
        sessionStarts: 0,
        sessionCompletions: 0,
        nextClicks: 0,
        nextStarts: 0,
      }
      if (stage === 'starts') entry.sessionStarts += 1
      else if (stage === 'completions') entry.sessionCompletions += 1
      else if (stage === 'nextClicks') entry.nextClicks += 1
      else entry.nextStarts += 1
      activityByMode.set(mode, entry)
    }
  }
  const organicUsers = new Set(cohort.map((entry) => entry.userId)).size
  const limitations = [
    'Технические first-party события собираются всегда; без согласия к ним не добавляются acquisition, referrer и search-параметры, поэтому они не входят в SEO-воронку.',
    'Покрытие among consented считается только для событий с явным analytics_consent; исторические события без статуса остаются в общем знаменателе, но не в consented-знаменателе.',
    'Этапы SEO-воронки считаются только при наличии acquisition_id и entry_source=organic_search.',
    `Регистрация относится к последнему поисковому входу пользователя не более чем за ${ATTRIBUTION_WINDOW_DAYS} дней до sign_up.`,
  ]

  return {
    periodDays,
    generatedAt: now.toISOString(),
    window: { from: from.toISOString(), to: to.toISOString() },
    attributionWindowDays: ATTRIBUTION_WINDOW_DAYS,
    summary: {
      organicLandings: cohort.length,
      organicUsers,
      ...summaryCounts,
      signUps: cohortSignUpsByAcquisition.length,
      landingToStartRate: ratio(summaryCounts.starts, cohort.length),
      startToCompleteRate: ratio(summaryCounts.completions, summaryCounts.starts),
      completeToNextStartRate: ratio(summaryCounts.nextStarts, summaryCounts.completions),
      landingToSignUpRate: ratio(cohortSignUpsByAcquisition.length, cohort.length),
      activity: {
        sessionStarts: activityCounts.starts,
        sessionCompletions: activityCounts.completions,
        nextClicks: activityCounts.nextClicks,
        nextStarts: activityCounts.nextStarts,
      },
    },
    coverage: {
      lifecycleEvents: lifecycle.length,
      lifecycleEventsWithAcquisition: lifecycleWithAcquisition.length,
      lifecycleEventRate: ratio(lifecycleWithAcquisition.length, lifecycle.length),
      consentKnownLifecycleEvents: consentedLifecycle.length + rejectedLifecycle.length,
      consentedLifecycleEvents: consentedLifecycle.length,
      rejectedLifecycleEvents: rejectedLifecycle.length,
      lifecycleEventsConsentedWithAcquisition: consentedLifecycleWithAcquisition.length,
      lifecycleConsentedAcquisitionRate: ratio(consentedLifecycleWithAcquisition.length, consentedLifecycle.length),
      pageViews: pageViews.length,
      pageViewsWithSource: pageViewsWithSource.length,
      pageViewsWithAcquisition: pageViewsWithAcquisition.length,
      consentKnownPageViews: consentedPageViews.length + rejectedPageViews.length,
      consentedPageViews: consentedPageViews.length,
      rejectedPageViews: rejectedPageViews.length,
      pageViewsConsentedWithAcquisition: consentedPageViewsWithAcquisition.length,
      pageViewConsentedAcquisitionRate: ratio(consentedPageViewsWithAcquisition.length, consentedPageViews.length),
      successfulSignUps: attributedSignUps.length,
      signUpsAttributedToOrganic: attributedSignUps.filter((entry) => entry.acquisition).length,
      signUpAttributionRate: ratio(attributedSignUps.filter((entry) => entry.acquisition).length, attributedSignUps.length),
      unkeyedOrganicEvents,
      clientEventRetentionDays: CLIENT_EVENT_RETENTION_DAYS,
      retentionTruncationPossible: false,
      limitations,
    },
    registrations,
    diagnosisRecommendations: {
      all: buildDiagnosisRecommendations(inWindow),
      organic: buildDiagnosisRecommendations(inWindow.filter(({ properties }) => organicSource(sourceOf(properties)))),
    },
    danetki,
    territory: {
      ...territory,
      landingToRoomRate: ratio(territory.roomsCreated, territory.landingViews),
      roomToStartRate: ratio(territory.roomStarts, territory.roomsCreated),
      startToCompleteRate: ratio(territory.matchesCompleted, territory.roomStarts),
      completeToRematchRate: ratio(territory.rematchStarts, territory.matchesCompleted),
    },
    dataSources: {
      strategy: 'raw',
      windowKind: 'completed_utc_days',
      eventTotalsExact: true,
      acquisitionTotalsExact: true,
      uniqueUsersExact: true,
      raw: {
        from: from.toISOString(),
        to: to.toISOString(),
        retentionDays: RAW_ANALYTICS_RETENTION_DAYS,
        exactWindowReady: true,
        retentionStartedAt: null,
        retentionReadyAt: null,
      },
      daily: null,
    },
    byLanding: [...byLanding.values()].map(finalizeBreakdown).sort((left, right) => right.organicLandings - left.organicLandings || right.starts - left.starts).slice(0, 20),
    byMode: [...byMode.values()].map(finalizeBreakdown).sort((left, right) => right.organicLandings - left.organicLandings || right.starts - left.starts),
    activityByMode: [...activityByMode.values()].sort((left, right) => right.sessionStarts - left.sessionStarts || right.sessionCompletions - left.sessionCompletions),
    dailyActivityArchive: null,
  }
}

const dailyDate = (value: string | Date) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
const dailyCount = (value: number | string) => Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0)
const dateKey = (value: Date) => value.toISOString().slice(0, 10)
export const canonicalDailyEventName = (value: string) => value === 'danetki_room_started'
  ? 'game_session_start'
  : value === 'danetki_room_completed'
    ? 'game_session_complete'
    : value === 'danetki_cross_game_clicked'
      ? 'game_next_clicked'
      : value

export const attachAdminAcquisitionDailyArchive = (
  raw: AdminAcquisitionFunnelResponse,
  dailyRows: AcquisitionDailyRow[],
  window: AcquisitionReportWindow,
  guards: { rawRowsTruncated?: boolean; signUpsTruncated?: boolean; dailyRowsTruncated?: boolean } = {},
): AdminAcquisitionFunnelResponse => {
  const archiveFrom = dateKey(window.reportFrom)
  const archiveTo = dateKey(window.archiveTo)
  const completeDays = new Set<string>()
  let rawRetentionStartedAt: string | null = null
  const activity = {
    sessionStarts: 0,
    sessionCompletions: 0,
    nextClicks: 0,
    nextStarts: 0,
  }
  const byMode = new Map<string, AdminAcquisitionActivityBreakdown>()

  for (const row of dailyRows) {
    const activityDate = dailyDate(row.activityDate)
    const eventName = canonicalDailyEventName(row.eventName)
    if (eventName === '__raw_retention_38_started__') {
      if (!rawRetentionStartedAt || activityDate < rawRetentionStartedAt) rawRetentionStartedAt = activityDate
      continue
    }
    if (eventName === '__rollup_complete__' && activityDate >= archiveFrom && activityDate < archiveTo) { completeDays.add(activityDate); continue }
    if (normalizeSource(row.entrySource) !== 'organic_search') continue
    if (activityDate < archiveFrom || activityDate >= archiveTo) continue
    const candidateMode = publicGameModes.has(row.mode) ? row.mode : 'unknown'
    const eventsCount = dailyCount(row.eventsCount)
    const mode = byMode.get(candidateMode) ?? {
      key: candidateMode,
      label: modeLabel[candidateMode] ?? 'Не определено',
      sessionStarts: 0,
      sessionCompletions: 0,
      nextClicks: 0,
      nextStarts: 0,
    }
    if (eventName === 'game_session_start') { activity.sessionStarts += eventsCount; mode.sessionStarts += eventsCount }
    else if (eventName === 'game_session_complete') { activity.sessionCompletions += eventsCount; mode.sessionCompletions += eventsCount }
    else if (eventName === 'game_next_clicked') { activity.nextClicks += eventsCount; mode.nextClicks += eventsCount }
    else if (eventName === 'game_next_start') { activity.nextStarts += eventsCount; mode.nextStarts += eventsCount }
    else continue
    byMode.set(candidateMode, mode)
  }

  const expectedCompleteDays = Math.max(0, Math.round((window.archiveTo.getTime() - window.reportFrom.getTime()) / DAY_MS))
  const dailyCoverageComplete = completeDays.size >= expectedCompleteDays && !guards.dailyRowsTruncated
  const rawRetentionReadyAt = rawRetentionStartedAt
    ? new Date(`${rawRetentionStartedAt}T00:00:00.000Z`).getTime() + (RAW_ANALYTICS_RETENTION_DAYS - ANALYTICS_ROLLUP_LAG_DAYS) * DAY_MS
    : null
  const rawRetentionReady = rawRetentionReadyAt != null && window.reportTo.getTime() >= rawRetentionReadyAt
  const limitations = [
    ...raw.coverage.limitations,
    'Суточный архив показан отдельно как объём активности и не прибавляется к точной raw-воронке, конверсиям или unique users.',
    ...(!rawRetentionReady ? ['38-дневное raw-хранение ещё не накопило полный 31-дневный срез с семидневным lookback; показаны доступные события без подстановки нулей.'] : []),
    ...(!dailyCoverageComplete ? ['Не все UTC-дни архива подтверждены маркерами rollup; это ограничивает только архив активности, не raw-воронку.'] : []),
    ...(guards.rawRowsTruncated || guards.signUpsTruncated || guards.dailyRowsTruncated ? ['Защитный лимит строк сработал; endpoint вернул явно неполный срез вместо перегрузки памяти.'] : []),
  ]

  return {
    ...raw,
    window: { from: window.reportFrom.toISOString(), to: window.reportTo.toISOString() },
    coverage: {
      ...raw.coverage,
      retentionTruncationPossible: !rawRetentionReady,
      limitations,
    },
    dataSources: {
      ...raw.dataSources,
      strategy: 'raw_with_daily_archive',
      windowKind: 'completed_utc_days',
      eventTotalsExact: raw.dataSources.eventTotalsExact && rawRetentionReady,
      acquisitionTotalsExact: raw.dataSources.acquisitionTotalsExact && rawRetentionReady,
      uniqueUsersExact: raw.dataSources.uniqueUsersExact && rawRetentionReady,
      raw: {
        from: window.reportFrom.toISOString(),
        to: window.reportTo.toISOString(),
        retentionDays: RAW_ANALYTICS_RETENTION_DAYS,
        exactWindowReady: rawRetentionReady,
        retentionStartedAt: rawRetentionStartedAt ? `${rawRetentionStartedAt}T00:00:00.000Z` : null,
        retentionReadyAt: rawRetentionReadyAt == null ? null : new Date(rawRetentionReadyAt).toISOString(),
      },
      daily: {
        from: window.reportFrom.toISOString(),
        to: window.archiveTo.toISOString(),
        expectedCompleteDays,
        confirmedCompleteDays: completeDays.size,
        privacyPreserving: true,
        role: 'activity_archive',
        complete: dailyCoverageComplete,
      },
    },
    dailyActivityArchive: dailyCoverageComplete || Object.values(activity).some((value) => value > 0) ? {
      from: window.reportFrom.toISOString(),
      to: window.archiveTo.toISOString(),
      complete: dailyCoverageComplete,
      ...activity,
      byDestinationMode: [...byMode.values()].sort((left, right) => right.sessionStarts - left.sessionStarts || right.sessionCompletions - left.sessionCompletions),
    } : null,
  }
}

export const loadAdminAcquisitionFunnel = async (
  db: Database,
  periodDays: AdminAcquisitionFunnelPeriod,
  now = new Date(),
) => {
  const RAW_EVENT_ROW_LIMIT = 100_000
  const SIGN_UP_ROW_LIMIT = 10_000
  const DAILY_ROW_LIMIT = 5_000
  const window = acquisitionReportWindow(periodDays, now)
  const clientFrom = new Date(window.rawFrom.getTime() - ATTRIBUTION_WINDOW_DAYS * DAY_MS).toISOString()
  const registrationRawFrom = window.registrationRawFrom.toISOString()
  const reportFrom = window.reportFrom.toISOString()
  const reportTo = window.reportTo.toISOString()
  const archiveTo = window.archiveTo.toISOString()
  const [clientResult, signUpResult, registrationAggregateResult, dailyResult] = await Promise.all([
    db.execute(sql`
      select event_id "eventId", event_name "eventName", occurred_at "occurredAt", user_id "userId",
        game_session_id "gameSessionId", route, properties
      from client_events
      where occurred_at >= ${clientFrom}::timestamptz and occurred_at < ${reportTo}::timestamptz
        and (
          event_name in (
            'page_view','game_session_start','game_session_complete','game_next_clicked','game_next_start',
            'danetki_room_started','danetki_room_completed','danetki_cross_game_clicked'
          )
          or left(event_name, 8) = 'danetki_'
          or (
            lower(coalesce(nullif(properties->>'entry_source', ''), '')) in ('organic_search', 'organic')
          )
        )
      order by occurred_at asc
      limit ${RAW_EVENT_ROW_LIMIT + 1}`),
    db.execute(sql`
      select ae.id "eventId", ae.occurred_at "occurredAt", ae.user_id "userId",
        ae.acquisition_id "acquisitionId", ae.entry_source "entrySource",
        ae.search_engine "searchEngine", ae.entry_path "entryPath"
      from auth_events ae
      inner join "user" u on u.id = ae.user_id and u.is_anonymous = false
      where ae.occurred_at >= ${registrationRawFrom}::timestamptz and ae.occurred_at < ${reportTo}::timestamptz
        and ae.event_name = 'sign_up' and ae.result = 'success'
        and not exists (select 1 from player_profiles p where p.user_id = ae.user_id and p.role = 'admin')
      order by ae.occurred_at asc
      limit ${SIGN_UP_ROW_LIMIT + 1}`),
    db.execute(sql`
      select
        (
          select count(*)::int
          from "user" u
          where u."createdAt" >= ${reportFrom}::timestamptz and u."createdAt" < ${reportTo}::timestamptz
            and u.is_anonymous = false
            and not exists (select 1 from player_profiles p where p.user_id = u.id and p.role = 'admin')
        ) "accountsCreated",
        count(distinct ae.user_id) filter (where ae.event_name = 'sign_up' and ae.result = 'success'
          and u."createdAt" >= ${reportFrom}::timestamptz and u."createdAt" < ${reportTo}::timestamptz)::int "signUpSuccesses",
        count(*) filter (where ae.event_name = 'sign_in' and ae.result = 'success')::int "signInSuccesses",
        count(distinct ae.user_id) filter (
          where ae.event_name = 'sign_up' and ae.result = 'success' and ae.acquisition_id is not null
            and u."createdAt" >= ${reportFrom}::timestamptz and u."createdAt" < ${reportTo}::timestamptz
        )::int "signUpsWithAcquisition",
        count(distinct ae.user_id) filter (
          where ae.event_name = 'sign_up' and ae.result = 'success'
            and ae.acquisition_id is not null
            and u."createdAt" >= ${reportFrom}::timestamptz and u."createdAt" < ${reportTo}::timestamptz
            and lower(coalesce(nullif(ae.entry_source, ''), '')) in ('organic_search', 'organic')
        )::int "signUpsAttributedToOrganic"
      from auth_events ae
      inner join "user" u on u.id = ae.user_id and u.is_anonymous = false
      where ae.occurred_at >= ${reportFrom}::timestamptz and ae.occurred_at < ${reportTo}::timestamptz
        and ae.event_name in ('sign_up', 'sign_in')
        and not exists (select 1 from player_profiles p where p.user_id = ae.user_id and p.role = 'admin')`),
    periodDays === 31
      ? db.execute(sql`
          select activity_date "activityDate", event_name "eventName", entry_source "entrySource",
            search_engine "searchEngine", entry_path "entryPath", mode, events_count "eventsCount",
            users_count "usersCount", acquisitions_count "acquisitionsCount"
          from analytics_event_daily
          where (
            activity_date >= (${reportFrom}::timestamptz at time zone 'UTC')::date
            and activity_date < (${archiveTo}::timestamptz at time zone 'UTC')::date
          ) or event_name = '__raw_retention_38_started__'
          order by case when event_name = '__raw_retention_38_started__' then 0 else 1 end, activity_date asc, event_name asc
          limit ${DAILY_ROW_LIMIT + 1}`)
      : Promise.resolve([]),
  ])
  const clientRows = rows<AcquisitionClientEventRow>(clientResult)
  const signUpRows = rows<AcquisitionSignUpRow>(signUpResult)
  const [registrationAggregate] = rows<AcquisitionRegistrationAggregateRow>(registrationAggregateResult)
  const dailyRows = rows<AcquisitionDailyRow>(dailyResult)
  const rawRowsTruncated = clientRows.length > RAW_EVENT_ROW_LIMIT
  const signUpsTruncated = signUpRows.length > SIGN_UP_ROW_LIMIT
  const dailyRowsTruncated = dailyRows.length > DAILY_ROW_LIMIT
  const raw = buildAdminAcquisitionFunnel(
    clientRows.slice(0, RAW_EVENT_ROW_LIMIT),
    signUpRows.slice(0, SIGN_UP_ROW_LIMIT),
    periodDays,
    now,
    { from: window.rawFrom, to: window.reportTo },
    registrationAggregate,
  )
  if (rawRowsTruncated || signUpsTruncated) {
    raw.coverage.limitations.push('Защитный лимит строк сработал; raw-срез неполон и не помечается как точный.')
    raw.dataSources.eventTotalsExact = false
    raw.dataSources.acquisitionTotalsExact = false
    raw.dataSources.uniqueUsersExact = false
  }
  if (periodDays !== 31) return raw
  return attachAdminAcquisitionDailyArchive(raw, dailyRows.slice(0, DAILY_ROW_LIMIT), window, { rawRowsTruncated, signUpsTruncated, dailyRowsTruncated })
}
