import { and, eq, sql } from 'drizzle-orm'
import { appSettings, registrationPlayCredits, registrationModePlayCredits, type Database } from '@shoditsa/database'
import { REGISTRATION_BONUS_MODE_IDS, REGISTRATION_BONUS_ROUNDS, GROWTH_DEFINITIONS_VERSION, GROWTH_MEASUREMENT_FROM, GROWTH_NOT_BEFORE, GROWTH_OFFER_VISIBILITY_VERSION, GROWTH_STAGES, growthFeatures, type GrowthPolicy, type GrowthStage, type PlayableModeId, type RegistrationBonusSummary } from '@shoditsa/contracts'
import { ApiError } from '../../lib/errors.js'

export const GROWTH_SETTING = 'growth.diagnosisContinuation'
export const EPISODE_FACTS_SETTING = 'analytics.gameSessionFacts'
export const normalizeGrowthPolicy = (value: unknown): GrowthPolicy => {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null
  return {
    stage: GROWTH_STAGES.includes(raw.stage as GrowthStage) ? raw.stage as GrowthStage : 'baseline',
    changedAt: date(raw.changedAt),
    registrationOpenedAt: date(raw.registrationOpenedAt),
  }
}
export const loadGrowthPolicy = async (db: Database): Promise<GrowthPolicy> => normalizeGrowthPolicy(
  (await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, GROWTH_SETTING)).limit(1))[0]?.value,
)
export const nextGrowthStageAt = (policy: GrowthPolicy) => new Date(Math.max(
  Date.parse(GROWTH_NOT_BEFORE),
  policy.stage !== 'baseline' && policy.changedAt
    ? Date.parse(policy.changedAt.slice(0, 10)) + 8 * 86_400_000 // seven complete UTC days after activation
    : 0,
)).toISOString()

export const advanceGrowthPolicy = (policy: GrowthPolicy, stage: GrowthStage, now = new Date()): GrowthPolicy => {
  if (stage === policy.stage) return policy
  if (stage !== 'baseline') {
    if (GROWTH_STAGES.indexOf(stage) !== GROWTH_STAGES.indexOf(policy.stage) + 1) {
      throw new ApiError(409, 'GROWTH_STAGE_ORDER', 'Включайте этапы по одному: повторная игра → регистрация → клуб')
    }
    if (now.getTime() < Date.parse(nextGrowthStageAt(policy))) {
      throw new ApiError(409, 'GROWTH_MEASUREMENT_WINDOW', `Сначала завершите окно измерения. Следующий этап доступен ${nextGrowthStageAt(policy).slice(0, 10)}`)
    }
  }
  return { stage, changedAt: now.toISOString(), registrationOpenedAt: policy.registrationOpenedAt ?? (stage === 'registration' ? now.toISOString() : null) }
}

export const grantRegistrationPlays = async (db: Database, createdUser: { id: string; isAnonymous?: boolean | null }) => {
  if (createdUser.isAnonymous) return
  const policy = await loadGrowthPolicy(db)
  if (!growthFeatures(policy).registration) return
  await db.transaction(async (tx) => {
    await tx.insert(registrationPlayCredits).values({ userId: createdUser.id }).onConflictDoNothing()
    await tx.insert(registrationModePlayCredits).values(REGISTRATION_BONUS_MODE_IDS.filter((mode) => mode !== 'diagnosis').map((mode) => ({ userId: createdUser.id, mode }))).onConflictDoNothing()
  })
}

type CreditTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]
export const lockRegistrationCredit = async (tx: CreditTransaction, userId: string, mode: PlayableModeId) => mode === 'diagnosis'
  ? (await tx.select().from(registrationPlayCredits).where(eq(registrationPlayCredits.userId, userId)).for('update').limit(1))[0]
  : (await tx.select().from(registrationModePlayCredits).where(and(eq(registrationModePlayCredits.userId, userId), eq(registrationModePlayCredits.mode, mode))).for('update').limit(1))[0]

export const consumeRegistrationCredit = async (tx: CreditTransaction, userId: string, mode: PlayableModeId) => {
  // Call only after locking and checking the entitlement, inside the session transaction.
  if (mode === 'diagnosis') await tx.update(registrationPlayCredits).set({ remaining: sql`${registrationPlayCredits.remaining} - 1` }).where(eq(registrationPlayCredits.userId, userId))
  else await tx.update(registrationModePlayCredits).set({ remaining: sql`${registrationModePlayCredits.remaining} - 1` }).where(and(eq(registrationModePlayCredits.userId, userId), eq(registrationModePlayCredits.mode, mode)))
}

export const registrationBonusSummary = async (db: Database | CreditTransaction, userId: string): Promise<RegistrationBonusSummary> => {
  const [diagnosis, other] = await Promise.all([
    db.select({ remaining: registrationPlayCredits.remaining }).from(registrationPlayCredits).where(eq(registrationPlayCredits.userId, userId)).limit(1),
    db.select({ mode: registrationModePlayCredits.mode, remaining: registrationModePlayCredits.remaining }).from(registrationModePlayCredits).where(eq(registrationModePlayCredits.userId, userId)),
  ])
  const bonus = { granted: diagnosis[0] ? REGISTRATION_BONUS_ROUNDS : 0, remaining: diagnosis[0]?.remaining ?? 0 }
  return { mode: 'diagnosis', ...bonus, byMode: { diagnosis: bonus, ...Object.fromEntries(other.map((row) => [row.mode, { granted: REGISTRATION_BONUS_ROUNDS, remaining: row.remaining }])) } }
}

export const growthMeasurementWindow = (from: string, to: string) => ({
  from: new Date(Math.max(Date.parse(from), Date.parse(GROWTH_MEASUREMENT_FROM))).toISOString(),
  coverage: Date.parse(to) <= Date.parse(GROWTH_MEASUREMENT_FROM) ? 'not_started' as const
    : Date.parse(from) < Date.parse(GROWTH_MEASUREMENT_FROM) ? 'partial' as const : 'complete' as const,
})

export const episodeFactsWindow = (from: string, to: string, value: unknown) => {
  const date = value && typeof value === 'object' ? (value as Record<string, unknown>).recordingStartedAt : null
  if (typeof date !== 'string' || !Number.isFinite(Date.parse(date))) {
    return { recordingStartedAt: null, fullDaysFrom: null, coverage: 'unavailable' as const }
  }
  const recordingStartedAt = new Date(date).toISOString()
  const fullDaysFrom = new Date(Date.parse(recordingStartedAt.slice(0, 10)) + 86_400_000).toISOString()
  return { recordingStartedAt, fullDaysFrom,
    coverage: Date.parse(to) <= Date.parse(fullDaysFrom) ? 'legacy_partial' as const
      : Date.parse(from) < Date.parse(fullDaysFrom) ? 'partial' as const : 'complete' as const }
}

/** Completed UTC days, staff excluded. Activity counts and linked cohorts stay separate. */
export const growthReport = async (db: Database, days: number) => {
  const policy = await loadGrowthPolicy(db)
  const to = new Date(new Date().toISOString().slice(0, 10)).toISOString()
  const from = new Date(Date.parse(to) - days * 86_400_000).toISOString()
  const measurement = growthMeasurementWindow(from, to)
  const [sessions, accounts, commerce, events, firstFreeArchive, factsSetting, registrationBonusByMode] = await Promise.all([
    db.execute(sql`
      with completed as (
        select g.id, g.user_id, g.completed_at from game_session_facts g left join player_profiles p on p.user_id=g.user_id
        where g.mode='diagnosis' and g.kind in ('daily','archive','free_play')
          and g.completed_at >= ${from} and g.completed_at < ${to} and coalesce(p.role,'player') <> 'admin'
      ), all_first_completed as (
        select distinct on (user_id) * from completed order by user_id, completed_at, id
      ), first_completed as (
        select distinct on (user_id) * from completed where completed_at >= ${measurement.from} order by user_id, completed_at, id
      ), repeats as (
        select g.* from game_session_facts g join first_completed c on c.id=g.source_session_id and c.user_id=g.user_id
        where g.mode='diagnosis' and g.kind in ('daily','archive','free_play')
          and g.id <> c.id and g."startedAt" >= c.completed_at and g."startedAt" < ${to}
      ), activity as (
        select g.* from game_session_facts g left join player_profiles p on p.user_id=g.user_id
        where g.mode='diagnosis' and g."startedAt" >= ${from} and g."startedAt" < ${to} and coalesce(p.role,'player') <> 'admin'
      ) select
        (select count(*)::int from completed) as completions,
        (select count(*)::int from all_first_completed) as "firstCompleters",
        (select count(*)::int from first_completed) as "measuredCompleters",
        (select count(*)::int from repeats) as "repeatStarts",
        (select count(*)::int from repeats where completed_at >= "startedAt" and completed_at < ${to}) as "repeatCompletions",
        (select count(distinct source_session_id)::int from repeats) as "repeatingCompleters",
        (select coalesce(jsonb_agg(to_jsonb(b) order by b."accessSource"),'[]'::jsonb) from (
          select coalesce(access_source,'unknown') as "accessSource", count(*)::int as "repeatStarts",
            count(*) filter(where completed_at >= "startedAt" and completed_at < ${to})::int as "repeatCompletions",
            count(distinct source_session_id)::int as "repeatingCompleters"
          from repeats group by 1
        ) b) as "repeatByAccessSource",
        (select count(*)::int from activity where access_source='registration_bonus') as "bonusStarts",
        (select count(*)::int from activity where access_source='registration_bonus' and completed_at < ${to}) as "bonusCompletions",
        (select count(*)::int from activity where access_source='club' and "startedAt">=${measurement.from}) as "clubStarts"`),
    db.execute(sql`select
      (select count(*)::int from "user" u left join player_profiles p on p.user_id=u.id where not u.is_anonymous and u."createdAt">=${from} and u."createdAt"<${to} and coalesce(p.role,'player')<>'admin') as created,
      (select count(distinct a.user_id)::int from auth_events a join "user" u on u.id=a.user_id left join player_profiles p on p.user_id=u.id where a.event_name='sign_up' and not u.is_anonymous and u."createdAt">=${from} and u."createdAt"<${to} and coalesce(p.role,'player')<>'admin') as "signUps",
      (select count(*)::int from registration_play_credits b left join player_profiles p on p.user_id=b.user_id where b.granted_at>=${from} and b.granted_at<${to} and coalesce(p.role,'player')<>'admin') as "bonusGranted",
      (select count(distinct g.user_id)::int from game_session_facts g join registration_play_credits b on b.user_id=g.user_id left join player_profiles p on p.user_id=g.user_id where b.granted_at>=${from} and b.granted_at<${to} and g.access_source='registration_bonus' and g."startedAt"<${to} and coalesce(p.role,'player')<>'admin') as "bonusPlayers"`),
    db.execute(sql`with orders as (
      select o.* from payment_orders o join commerce_products c on c.id=o.product_id left join player_profiles p on p.user_id=o.user_id
      where c.kind='club' and o."createdAt">=${from} and o."createdAt"<${to} and coalesce(p.role,'player')<>'admin' and o.provider<>'stub'
    ) select count(*)::int as orders, count(*) filter(where status='paid')::int as "paidOrders",
      count(distinct user_id) filter(where status='paid')::int as "payingUsers",
      coalesce(sum(amount_minor) filter(where status='paid'),0)::int as "revenueMinor",
      count(distinct user_id) filter(where status='paid' and exists(select 1 from game_session_facts g where g.user_id=orders.user_id and g.access_source='club' and g."startedAt">=orders.paid_at and g."startedAt">=${measurement.from} and g."startedAt"<${to}))::int as "paidUsersUsedClub" from orders`),
    db.execute(sql`select e.event_name as "eventName", coalesce(e.properties->>'growth_stage','unversioned') as stage,
      coalesce(e.properties->>'analytics_consent','unknown') as consent, count(*)::int as events, count(distinct e.user_id)::int as users
      from client_events e left join player_profiles p on p.user_id=e.user_id
      where e.occurred_at>=${from} and e.occurred_at<${to} and coalesce(p.role,'player')<>'admin'
      and e.event_name in ('diagnosis_replay_offer_view','diagnosis_replay_clicked','registration_bonus_offer_view','registration_bonus_offer_clicked','club_context_offer_view','club_context_offer_clicked','commerce_plan_selected','checkout_started')
      and (e.event_name not in ('commerce_plan_selected','checkout_started') or e.properties->>'productId' in ('club_30d','club_365d'))
      group by 1,2,3 order by 1,2,3`),
    db.execute(sql`select min(g."startedAt") as "firstObservedAt"
      from game_session_facts g left join player_profiles p on p.user_id=g.user_id
      where g.mode='diagnosis' and g.access_source='free_archive'
        and g."startedAt"<${to} and coalesce(p.role,'player')<>'admin'`),
    db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, EPISODE_FACTS_SETTING)).limit(1),
    db.execute(sql`with grants as (
      select user_id, 'diagnosis'::text as mode, granted_at from registration_play_credits
      union all select user_id, mode::text, granted_at from registration_mode_play_credits
    ), grant_counts as (
      select b.mode, count(*)::int as n from grants b left join player_profiles p on p.user_id=b.user_id
      where b.granted_at>=${from} and b.granted_at<${to} and coalesce(p.role,'player')<>'admin' group by b.mode
    ), usage_counts as (
      select g.mode::text as mode, count(*)::int as starts,
        count(*) filter(where g.completed_at>=g."startedAt" and g.completed_at<${to} and g.completion_status in ('won','lost'))::int as completions
      from game_session_facts g left join player_profiles p on p.user_id=g.user_id
      where g.access_source='registration_bonus' and g."startedAt">=${from} and g."startedAt"<${to} and coalesce(p.role,'player')<>'admin' group by g.mode
    ) select coalesce(g.mode,u.mode) as mode, coalesce(g.n,0)::int as "grantedAccounts", coalesce(u.starts,0)::int as starts, coalesce(u.completions,0)::int as completions
    from grant_counts g full join usage_counts u on u.mode=g.mode order by 1`),
  ])
  const noMeasurement = measurement.coverage === 'not_started'
  const firstObservedAt = firstFreeArchive[0]?.firstObservedAt
  return { policy, effective: growthFeatures(policy), notBefore: GROWTH_NOT_BEFORE, nextStageAvailableAt: nextGrowthStageAt(policy), period: { from, toExclusive: to, days },
    measurement: { ...measurement, definitionsVersion: GROWTH_DEFINITIONS_VERSION, offerVisibilityVersion: GROWTH_OFFER_VISIBILITY_VERSION,
      freeArchiveFirstObservedAt: firstObservedAt ? new Date(String(firstObservedAt)).toISOString() : null,
      episodeFacts: episodeFactsWindow(from, to, factsSetting[0]?.value) },
    sessions: { ...sessions[0], ...(noMeasurement ? { measuredCompleters: null, repeatStarts: null, repeatCompletions: null, repeatingCompleters: null, repeatByAccessSource: null, clubStarts: null } : {}) },
    accounts: accounts[0], commerce: { ...commerce[0], ...(noMeasurement ? { paidUsersUsedClub: null } : {}) }, events: [...events], registrationBonusByMode: [...registrationBonusByMode] }
}
