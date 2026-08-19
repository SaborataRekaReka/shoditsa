import { sql } from 'drizzle-orm'
import type {
  AdminAcquisitionActivityBreakdown,
  AdminAcquisitionFunnelBreakdown,
  AdminAcquisitionFunnelPeriod,
  AdminAcquisitionFunnelResponse,
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
  city: 'Города', animal: 'Животные', book: 'Книги', character: 'Персонажи', danetki: 'Данетки', connections: 'Связи',
}
const publicGameModes = new Set(Object.keys(modeLabel))
const namedDanetkiPaths = new Set(['/danetki', '/danetki/dlya-detey', '/danetki/slozhnye', '/danetki/legkie', '/danetki/novye', '/danetki/albatros'])

export const canonicalAnalyticsEntryPath = (value: string | null) => {
  if (!value) return '/other'
  if (value === '/') return '/'
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
  if (eventName === 'game_session_start' || eventName === 'danetki_room_started') return 'starts'
  if (eventName === 'game_session_complete' || eventName === 'danetki_room_completed') return 'completions'
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

export const buildAdminAcquisitionFunnel = (
  clientEvents: AcquisitionClientEventRow[],
  signUpEvents: AcquisitionSignUpRow[],
  periodDays: AdminAcquisitionFunnelPeriod,
  now = new Date(),
  window?: { from: Date; to: Date },
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
  const pageViews = inWindow.filter(({ row }) => row.eventName === 'page_view')
  const pageViewsWithSource = pageViews.filter(({ properties }) => Boolean(sourceOf(properties)))
  const pageViewsWithAcquisition = pageViews.filter(({ properties }) => Boolean(acquisitionIdOf(properties)))
  const unkeyedOrganicEvents = inWindow.filter(({ properties }) => organicSource(sourceOf(properties)) && !acquisitionIdOf(properties)).length
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
      pageViews: pageViews.length,
      pageViewsWithSource: pageViewsWithSource.length,
      pageViewsWithAcquisition: pageViewsWithAcquisition.length,
      successfulSignUps: attributedSignUps.length,
      signUpsAttributedToOrganic: attributedSignUps.filter((entry) => entry.acquisition).length,
      signUpAttributionRate: ratio(attributedSignUps.filter((entry) => entry.acquisition).length, attributedSignUps.length),
      unkeyedOrganicEvents,
      clientEventRetentionDays: CLIENT_EVENT_RETENTION_DAYS,
      retentionTruncationPossible: false,
      limitations,
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
  const [clientResult, signUpResult, dailyResult] = await Promise.all([
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
          or (
            lower(coalesce(nullif(properties->>'entry_source', ''), '')) in ('organic_search', 'organic')
          )
        )
      order by occurred_at asc
      limit ${RAW_EVENT_ROW_LIMIT + 1}`),
    db.execute(sql`
      select id "eventId", occurred_at "occurredAt", user_id "userId"
      from auth_events
      where occurred_at >= ${registrationRawFrom}::timestamptz and occurred_at < ${reportTo}::timestamptz
        and event_name = 'sign_up' and result = 'success'
      order by occurred_at asc
      limit ${SIGN_UP_ROW_LIMIT + 1}`),
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
