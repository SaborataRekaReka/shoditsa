import { sql } from 'drizzle-orm'
import type { Database } from '@shoditsa/database'
import type { AdminCampaignFunnelCounts, AdminCampaignFunnelResponse, AdminCampaignFunnelRow, AdminCampaignPeriod } from '@shoditsa/contracts'
import { completedUtcDay, RAW_ANALYTICS_RETENTION_DAYS } from '../stats/analytics-rollup-service.js'

const DAY_MS = 86_400_000
const ROW_LIMIT = 20_000
const LANDING = '/games/diagnosis' as const
const slug = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value)
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const time = (value: string | Date | null) => value == null ? Number.NaN : new Date(value).getTime()
const rows = <T>(value: unknown): T[] => Array.from(value as Iterable<T>)

export type CampaignEventRow = { eventId: string; occurredAt: string | Date; userId: string; gameSessionId: string | null; properties: unknown }
export type CampaignSessionRow = { id: string; userId: string; startedAt: string | Date; completedAt: string | Date | null; status: string; mode: string; packId: string | null }
export type CampaignSignupRow = { eventId: string; userId: string; acquisitionId: string | null; occurredAt: string | Date; accountCreatedAt: string | Date; entryPath: string | null; utmSource: string | null; utmMedium: string | null; utmCampaign: string | null }
export type CampaignOrderRow = { id: string; userId: string; createdAt: string | Date; paidAt: string | Date | null; status: string; provider: string; productKind: string }
type Dimensions = Pick<AdminCampaignFunnelRow, 'source' | 'medium' | 'campaign' | 'landing'>
type ObservedAcquisition = { id: string; firstAt: number; dimensions: Dimensions; events: CampaignEventRow[]; conflict: boolean }

const campaignDimensions = (properties: Record<string, unknown>): Dimensions | null => {
  const { utm_source: source, utm_medium: medium, utm_campaign: campaign, entry_path: landing } = properties
  if (!slug(source) || !slug(campaign) || !campaign.startsWith('diagnosis_pilot_') || !['paid_social', 'referral'].includes(String(medium)) || landing !== LANDING || source === 'user_test') return null
  return { source, medium: medium as Dimensions['medium'], campaign, landing: LANDING }
}
const dimensionKey = (value: Dimensions) => JSON.stringify([value.source, value.medium, value.campaign, value.landing])
const emptyCounts = (): AdminCampaignFunnelCounts => ({ acquisitions: 0, started: 0, completed: 0, repeatCompleted: 0, registered: 0, registeredAfterCompletion: 0, paidClub: 0, paidClubOrders: 0, matured24h: 0, matured7d: 0 })
const methodology = [
  'Только пилот «Диагнозов»: первая наблюдаемая запись с согласием на аналитику, /games/diagnosis, utm_campaign=diagnosis_pilot_*, medium=paid_social или referral. user_test исключён. Органика в этот отчёт не добавляется.',
  'Единица — acquisition ID браузерного входа, не человек и не визит Метрики. Первая запись ищется только в доступных 38 днях RAW; окно когорты — завершённые дни UTC. Старые неразмеченные входы не восстанавливаются.',
  'Старты и завершения — только публичные серверные сессии «Диагнозов», связанные с событием этого входа и тем же владельцем. Завершение — won/lost/expired, не обязательно победа. Повтор — минимум две разные завершённые сессии.',
  'Новые аккаунты — sign_up success плюс users.createdAt внутри окна, с тем же acquisition ID и теми же UTM. Существующий вход не регистрация. Регистрация не обязана быть после прохождения: этот подэтап указан отдельно.',
  'Оплаты — оплаченные клубные заказы новых аккаунтов этой когорты, созданные и оплаченные после регистрации. Администраторы и provider=stub исключены; остальные тестовые платежи требуют отдельной классификации.',
  'Результаты накапливаются только до конца окна: у поздних входов меньше времени. Это наблюдаемые количества, не равнозрелые конверсии. Число входов с полными 24 часами и 7 днями показано отдельно.',
  'D2–7 удержание и доля согласившихся среди всего трафика пока не рассчитаны: нет проверенной полной межсессионной когорты и общего знаменателя. Отсутствие событий до релиза UTM не означает отсутствие трафика.',
]

/** Pure aggregation: identifiers are used for joins only and never leave the report. */
export function buildAdminCampaignFunnel(input: {
  days: AdminCampaignPeriod; now?: Date; events: CampaignEventRow[]; sessions: CampaignSessionRow[]; signups: CampaignSignupRow[]; orders: CampaignOrderRow[]; truncated?: boolean
}): AdminCampaignFunnelResponse {
  const now = input.now ?? new Date()
  const to = completedUtcDay(now).getTime()
  const from = to - input.days * DAY_MS
  const rawFrom = to - RAW_ANALYTICS_RETENTION_DAYS * DAY_MS
  const acquisitions = new Map<string, ObservedAcquisition>()
  const eventIds = new Set<string>()
  let campaignEvents = 0
  for (const event of [...input.events].sort((a, b) => time(a.occurredAt) - time(b.occurredAt))) {
    const at = time(event.occurredAt)
    const properties = record(event.properties)
    const dimensions = campaignDimensions(properties)
    if (eventIds.has(event.eventId) || !Number.isFinite(at) || at < rawFrom || at >= to || !dimensions || properties.analytics_consent !== 'accepted' || !uuid(properties.acquisition_id)) continue
    eventIds.add(event.eventId)
    campaignEvents++
    const id = properties.acquisition_id
    const acquisition = acquisitions.get(id) ?? { id, firstAt: at, dimensions, events: [], conflict: false }
    if (dimensionKey(acquisition.dimensions) !== dimensionKey(dimensions)) acquisition.conflict = true
    acquisition.events.push(event)
    acquisitions.set(id, acquisition)
  }
  const cohort = [...acquisitions.values()].filter((entry) => entry.firstAt >= from)
  const sessions = new Map(input.sessions.map((entry) => [entry.id, entry]))
  const signupsByAcquisition = new Map<string, CampaignSignupRow[]>()
  for (const signup of input.signups) {
    if (!signup.acquisitionId) continue
    const existing = signupsByAcquisition.get(signup.acquisitionId) ?? []
    existing.push(signup)
    signupsByAcquisition.set(signup.acquisitionId, existing)
  }
  const ordersByUser = new Map<string, CampaignOrderRow[]>()
  for (const order of input.orders) {
    const existing = ordersByUser.get(order.userId) ?? []
    existing.push(order)
    ordersByUser.set(order.userId, existing)
  }
  const groups = new Map<string, AdminCampaignFunnelRow>()
  let sessionLinks = 0
  let matchedSessionLinks = 0
  for (const acquisition of cohort) {
    if (acquisition.conflict) continue
    const key = dimensionKey(acquisition.dimensions)
    const group = groups.get(key) ?? { ...emptyCounts(), ...acquisition.dimensions }
    group.acquisitions++
    if (acquisition.firstAt <= to - DAY_MS) group.matured24h++
    if (acquisition.firstAt <= to - 7 * DAY_MS) group.matured7d++
    const linkedIds = new Set<string>()
    const matchedIds = new Set<string>()
    const completed = new Map<string, number>()
    for (const event of acquisition.events) {
      if (!event.gameSessionId) continue
      linkedIds.add(event.gameSessionId)
      const session = sessions.get(event.gameSessionId)
      const startedAt = session ? time(session.startedAt) : Number.NaN
      if (!session || session.userId !== event.userId || session.mode !== 'diagnosis' || session.packId !== null || !Number.isFinite(startedAt) || startedAt < acquisition.firstAt || startedAt >= to) continue
      matchedIds.add(session.id)
      const completedAt = time(session.completedAt)
      if (['won', 'lost', 'expired'].includes(session.status) && completedAt >= startedAt && completedAt < to) completed.set(session.id, completedAt)
    }
    sessionLinks += linkedIds.size
    matchedSessionLinks += matchedIds.size
    if (matchedIds.size) group.started++
    if (completed.size) group.completed++
    if (completed.size > 1) group.repeatCompleted++
    const firstCompletedAt = completed.size ? Math.min(...completed.values()) : Number.POSITIVE_INFINITY
    const attributedSignups = (signupsByAcquisition.get(acquisition.id) ?? []).filter((signup) => {
      const created = time(signup.accountCreatedAt)
      const at = time(signup.occurredAt)
      return created >= from && created >= acquisition.firstAt && created < to && at >= created && at < to && signup.entryPath === LANDING
        && signup.utmSource === acquisition.dimensions.source && signup.utmMedium === acquisition.dimensions.medium && signup.utmCampaign === acquisition.dimensions.campaign
    })
    if (attributedSignups.length) group.registered++
    if (attributedSignups.some((signup) => time(signup.occurredAt) >= firstCompletedAt)) group.registeredAfterCompletion++
    const paidIds = new Set<string>()
    for (const signup of attributedSignups) {
      const registeredAt = time(signup.occurredAt)
      for (const order of ordersByUser.get(signup.userId) ?? []) {
        const createdAt = time(order.createdAt)
        const paidAt = time(order.paidAt)
        if (order.status === 'paid' && order.provider !== 'stub' && order.productKind === 'club' && createdAt >= registeredAt && paidAt >= createdAt && paidAt < to) paidIds.add(order.id)
      }
    }
    if (paidIds.size) group.paidClub++
    group.paidClubOrders += paidIds.size
    groups.set(key, group)
  }
  const items = [...groups.values()].sort((a, b) => b.acquisitions - a.acquisitions || dimensionKey(a).localeCompare(dimensionKey(b)))
  const summary = emptyCounts()
  for (const item of items) for (const key of Object.keys(summary) as Array<keyof AdminCampaignFunnelCounts>) summary[key] += item[key]
  return {
    generatedAt: now.toISOString(), days: input.days,
    window: { fromInclusive: new Date(from).toISOString(), toExclusive: new Date(to).toISOString(), timezone: 'UTC' },
    status: input.truncated ? 'partial' : summary.acquisitions ? 'observed' : 'no_observations',
    summary, items,
    coverage: { rawFromInclusive: new Date(rawFrom).toISOString(), rawRetentionDays: RAW_ANALYTICS_RETENTION_DAYS, firstObservedAt: acquisitions.size ? new Date(Math.min(...[...acquisitions.values()].map((entry) => entry.firstAt))).toISOString() : null, campaignEvents, sessionLinks, matchedSessionLinks, unmatchedSessionLinks: sessionLinks - matchedSessionLinks, conflictingAcquisitions: cohort.filter((entry) => entry.conflict).length, truncated: Boolean(input.truncated), wholeSiteConsentCoverage: null, retentionD2To7: null },
    methodology,
  }
}

export async function loadAdminCampaignFunnel(db: Database, days: AdminCampaignPeriod, now = new Date()): Promise<AdminCampaignFunnelResponse> {
  const to = completedUtcDay(now)
  const from = new Date(to.getTime() - days * DAY_MS)
  const rawFrom = new Date(to.getTime() - RAW_ANALYTICS_RETENTION_DAYS * DAY_MS)
  const loadedEvents = rows<CampaignEventRow>(await db.execute(sql`
    select ce.event_id "eventId", ce.occurred_at "occurredAt", ce.user_id "userId", ce.game_session_id "gameSessionId",
      jsonb_build_object('acquisition_id', ce.properties->>'acquisition_id', 'analytics_consent', ce.properties->>'analytics_consent',
        'entry_path', ce.properties->>'entry_path', 'utm_source', ce.properties->>'utm_source',
        'utm_medium', ce.properties->>'utm_medium', 'utm_campaign', ce.properties->>'utm_campaign') properties
    from client_events ce where ce.occurred_at >= ${rawFrom.toISOString()}::timestamptz and ce.occurred_at < ${to.toISOString()}::timestamptz
      and ce.properties->>'analytics_consent' = 'accepted' and ce.properties->>'entry_path' = ${LANDING}
      and ce.properties->>'utm_campaign' ~ '^diagnosis_pilot_[a-zA-Z0-9_-]+$'
      and ce.properties->>'utm_medium' in ('paid_social', 'referral')
      and not exists (select 1 from player_profiles p where p.user_id = ce.user_id and p.role = 'admin')
    order by ce.occurred_at, ce.id limit ${ROW_LIMIT + 1}`))
  const events = loadedEvents.slice(0, ROW_LIMIT)
  const acquisitionIds = [...new Set(events.map((event) => record(event.properties).acquisition_id).filter(uuid))]
  const sessionIds = [...new Set(events.map((event) => event.gameSessionId).filter(uuid))]
  if (!acquisitionIds.length) return buildAdminCampaignFunnel({ days, now, events, sessions: [], signups: [], orders: [], truncated: loadedEvents.length > ROW_LIMIT })
  const [loadedSessions, loadedSignups] = await Promise.all([
    sessionIds.length ? db.execute(sql`
      select s.id, s.user_id "userId", s."startedAt" "startedAt", s.completed_at "completedAt", s.status, s.mode, s.pack_id "packId"
      from game_sessions s where s.id in (${sql.join(sessionIds.map((id) => sql`${id}::uuid`), sql`, `)})
        and s.mode = 'diagnosis' and s.pack_id is null and s."startedAt" >= ${from.toISOString()}::timestamptz and s."startedAt" < ${to.toISOString()}::timestamptz
        and not exists (select 1 from player_profiles p where p.user_id = s.user_id and p.role = 'admin')
      order by s."startedAt", s.id limit ${ROW_LIMIT + 1}`) : [],
    db.execute(sql`
      select ae.id "eventId", ae.user_id "userId", ae.acquisition_id "acquisitionId", ae.occurred_at "occurredAt", u."createdAt" "accountCreatedAt",
        ae.entry_path "entryPath", ae.utm_source "utmSource", ae.utm_medium "utmMedium", ae.utm_campaign "utmCampaign"
      from auth_events ae join "user" u on u.id = ae.user_id and u.is_anonymous = false
      where ae.acquisition_id in (${sql.join(acquisitionIds.map((id) => sql`${id}::uuid`), sql`, `)})
        and ae.event_name = 'sign_up' and ae.result = 'success'
        and ae.occurred_at >= ${from.toISOString()}::timestamptz and ae.occurred_at < ${to.toISOString()}::timestamptz
        and u."createdAt" >= ${from.toISOString()}::timestamptz and u."createdAt" < ${to.toISOString()}::timestamptz
        and not exists (select 1 from player_profiles p where p.user_id = ae.user_id and p.role = 'admin')
      order by ae.occurred_at, ae.id limit ${ROW_LIMIT + 1}`),
  ])
  const sessions = rows<CampaignSessionRow>(loadedSessions)
  const signups = rows<CampaignSignupRow>(loadedSignups)
  const registeredUserIds = [...new Set(signups.slice(0, ROW_LIMIT).map((signup) => signup.userId))]
  const orders = registeredUserIds.length ? rows<CampaignOrderRow>(await db.execute(sql`
    select o.id, o.user_id "userId", o."createdAt" "createdAt", o.paid_at "paidAt", o.status, o.provider, c.kind "productKind"
    from payment_orders o join commerce_products c on c.id = o.product_id
    where o.user_id in (${sql.join(registeredUserIds.map((id) => sql`${id}::uuid`), sql`, `)})
      and c.kind = 'club' and o.provider <> 'stub' and o.status = 'paid'
      and o."createdAt" >= ${from.toISOString()}::timestamptz and o.paid_at < ${to.toISOString()}::timestamptz
      and not exists (select 1 from player_profiles p where p.user_id = o.user_id and p.role = 'admin')
    order by o.paid_at, o.id limit ${ROW_LIMIT + 1}`)) : []
  return buildAdminCampaignFunnel({ days, now, events, sessions: sessions.slice(0, ROW_LIMIT), signups: signups.slice(0, ROW_LIMIT), orders: orders.slice(0, ROW_LIMIT), truncated: [loadedEvents, sessions, signups, orders].some((data) => data.length > ROW_LIMIT) })
}
