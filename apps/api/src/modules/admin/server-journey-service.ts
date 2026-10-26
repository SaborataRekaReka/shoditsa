import { sql } from 'drizzle-orm'
import type { AdminServerJourneyPeriod, AdminServerJourneyReport } from '@shoditsa/contracts'
import type { Database } from '@shoditsa/database'

const DAY_MS = 86_400_000
const limitations = [
  'Методика server-journeys-v1 добавлена 26 октября 2026. Старые клиентские nextStarts не пересчитаны и не являются доказательством перехода между разными играми.',
  'Периоды состоят из завершённых дней UTC. Межигровые старты требуют того же владельца, source session, transition_id и новой серверной партии после клика, не позднее 15 минут. Рекомендации ограничены animal, character, book после Диагнозов.',
  'Строгий порядок server start ≥ client click чувствителен к разнице часов. Сессии, начатые до клика, исключаются; отрицательная разница не исправляется догадкой.',
  'Сотрудники и спецпаки исключены. Профили могут объединяться при регистрации и не равны физическим людям. Органика — только связанные события с согласием и acquisition_id; unknown не считается direct.',
  'Клиентские события ограничены 38 днями хранения. Полнота означает доступность окна, а не учёт посетителей без согласия. Предыдущие 31 день могут быть частичными; пропуски не восстанавливаются.',
  'Первая партия Персонажей определяется по сохранившейся истории профиля. Детали удалённых партий неизвестны; они не считаются нулевыми попытками. Это телеметрия, не наблюдение за интерфейсом или объяснение ухода.',
  'D1/D7 относятся к новым зарегистрированным аккаунтам и точному календарному дню +1/+7 UTC. Недозревшие аккаунты исключены. При нулевом знаменателе доля неизвестна.',
]

export const unavailableServerJourneyReport = (now: Date): AdminServerJourneyReport => ({
  method: 'server-journeys-v1', status: 'unavailable', generatedAt: now.toISOString(),
  factsFullDaysFrom: null, rawObservedFrom: null, rawRetainedFrom: null,
  current: null, previous: null, limitations,
})

/** Read-only aggregate. No raw profile, session, event IDs or user input leave SQL. */
export async function loadAdminServerJourneys(db: Database, days: number, now = new Date()): Promise<AdminServerJourneyReport> {
  const to = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`)
  const from = new Date(to.getTime() - days * DAY_MS)
  const previousFrom = new Date(from.getTime() - days * DAY_MS)
  const retentionFrom = new Date(to.getTime() - 38 * DAY_MS)
  const result = await db.execute(sql`
    with windows(label,f,t) as (values
      ('current',${from.toISOString()}::timestamptz,${to.toISOString()}::timestamptz),
      ('previous',${previousFrom.toISOString()}::timestamptz,${from.toISOString()}::timestamptz)
    ), facts as (
      select g.* from game_session_facts g
      where g.kind in ('daily','archive','free_play')
        and not exists(select 1 from player_profiles p where p.user_id=g.user_id and p.role='admin')
    ), sources as (
      select w.*,g.*,
        exists(select 1 from client_events e where e.game_session_id=g.id and e.user_id=g.user_id
          and e.occurred_at>=g."startedAt" and e.occurred_at<w.t
          and e.properties->>'entry_source' in ('organic','organic_search')
          and e.properties->>'analytics_consent'='accepted'
          and nullif(e.properties->>'acquisition_id','') is not null) organic
      from windows w join facts g on g.completed_at>=w.f and g.completed_at<w.t
      where g.mode='diagnosis' and g.completion_status in ('won','lost')
        and g.completed_at>=g."startedAt"
    ), clicks as (
      select distinct on (s.label,s.user_id,coalesce(nullif(c.properties->>'transition_id',''),c.event_id::text))
        s.*,c.occurred_at click_at,c.properties->>'to_mode' target_mode,nullif(c.properties->>'transition_id','') transition_id
      from sources s join client_events c on c.game_session_id=s.id and c.user_id=s.user_id
        and c.occurred_at>=s.completed_at and c.occurred_at<s.t
        and c.event_name='game_next_clicked' and c.properties->>'from_mode'='diagnosis'
        and c.properties->>'to_mode' in ('animal','character','book')
        and coalesce(c.properties->>'placement','diagnosis-result-recommendations')='diagnosis-result-recommendations'
      order by s.label,s.user_id,coalesce(nullif(c.properties->>'transition_id',''),c.event_id::text),c.occurred_at,c.event_id
    ), linked as (
      select c.*,target.id target_id,target."startedAt" target_started_at,
        target.completed_at target_completed_at,target.completion_status target_status
      from clicks c join client_events n on n.event_name='game_next_start' and n.user_id=c.user_id
        and n.properties->>'transition_id'=c.transition_id and n.properties->>'to_mode'=c.target_mode
        and n.occurred_at>=c.click_at and n.occurred_at<=c.click_at+interval '15 minutes' and n.occurred_at<c.t
      join facts target on target.id=n.game_session_id and target.user_id=c.user_id
        and target.mode::text=c.target_mode and target.mode<>c.mode
    ), fresh as (
      select * from linked where target_started_at>=click_at and target_started_at<=click_at+interval '15 minutes'
        and target_started_at<t and target_id<>id
    ), repeats as (
      select s.*,target.id target_id from sources s join facts target
        on target.source_session_id=s.id and target.user_id=s.user_id and target.mode=s.mode
        and target.id<>s.id and target."startedAt">=s.completed_at and target."startedAt"<s.t
    ), scopes(scope) as (values('all'),('organic')), targets(mode) as (values('animal'),('character'),('book')),
    diagnosis as (
      select w.label,z.scope,jsonb_build_object(
        'completedSessions',(select count(*) from sources s where s.label=w.label and (z.scope='all' or s.organic)),
        'sameGameStarts',(select count(distinct target_id) from repeats s where s.label=w.label and (z.scope='all' or s.organic)),
        'sameGameSources',(select count(distinct id) from repeats s where s.label=w.label and (z.scope='all' or s.organic)),
        'recommendationClicks',(select count(*) from clicks s where s.label=w.label and (z.scope='all' or s.organic)),
        'crossGameStarts',(select count(distinct target_id) from fresh s where s.label=w.label and (z.scope='all' or s.organic)),
        'crossGameSources',(select count(distinct id) from fresh s where s.label=w.label and (z.scope='all' or s.organic)),
        'crossGameCompletions',(select count(distinct target_id) from fresh s where s.label=w.label and (z.scope='all' or s.organic)
          and target_status in ('won','lost') and target_completed_at>=target_started_at and target_completed_at<s.t),
        'crossGameRate',round(100.0*(select count(distinct id) from fresh s where s.label=w.label and (z.scope='all' or s.organic))
          /nullif((select count(*) from sources s where s.label=w.label and (z.scope='all' or s.organic)),0),2),
        'linkedExistingTargets',(select count(distinct target_id) from linked s where s.label=w.label and (z.scope='all' or s.organic) and target_started_at<s.click_at),
        'byMode',(select jsonb_agg(jsonb_build_object('mode',m.mode,
          'starts',(select count(distinct target_id) from fresh s where s.label=w.label and s.target_mode=m.mode and (z.scope='all' or s.organic)),
          'completions',(select count(distinct target_id) from fresh s where s.label=w.label and s.target_mode=m.mode and (z.scope='all' or s.organic)
            and target_status in ('won','lost') and target_completed_at>=target_started_at and target_completed_at<s.t)
        ) order by m.mode) from targets m)
      ) data from windows w cross join scopes z
    ), character as (
      select w.label,w.t,g.id,g.user_id,g."startedAt",
        case when exists(select 1 from facts old where old.mode='character' and old.user_id=g.user_id
          and (old."startedAt",old.id)<(g."startedAt",g.id)) then 'repeat' else 'first' end cohort,
        g.completion_status in ('won','lost') and g.completed_at>=g."startedAt" and g.completed_at<=g."startedAt"+interval '48 hours' completed,
        g."startedAt"<w.t-interval '48 hours' mature,
        case when s.id is not null then a.attempts end attempts,
        case when s.id is not null then extract(epoch from (a.first_attempt-g."startedAt")) end first_delay
      from windows w join facts g on g.mode='character' and g."startedAt">=w.f and g."startedAt"<w.t
      left join game_sessions s on s.id=g.id
      left join lateral(select count(*) attempts,min(a."createdAt") first_attempt from game_attempts a
        where a.session_id=g.id and a."createdAt">=g."startedAt" and a."createdAt"<=g."startedAt"+interval '48 hours') a on true
    ), cohort_names(cohort) as (values('first'),('repeat')), character_cohorts as (
      select w.label,n.cohort,jsonb_build_object(
        'cohort',n.cohort,'starts',count(c.id),'completions48h',count(c.id) filter(where c.completed),
        'zeroAttempts48h',count(c.id) filter(where c.attempts=0),'unknownAttempts',count(c.id) filter(where c.attempts is null),
        'observedFirstAttempts',count(c.first_delay),
        'medianFirstAttemptSeconds',round((percentile_cont(0.5) within group(order by c.first_delay))::numeric,1),
        'completionRate',round(100.0*count(c.id) filter(where c.completed)/nullif(count(c.id),0),2)
      ) data from windows w cross join cohort_names n
      left join character c on c.label=w.label and c.cohort=n.cohort and c.mature group by w.label,n.cohort
    ), accounts as (
      select w.label,w.t,u.id,u."createdAt" created from windows w join "user" u on u."createdAt">=w.f and u."createdAt"<w.t
      where not u.is_anonymous and not exists(select 1 from player_profiles p where p.user_id=u.id and p.role='admin')
    ), retention as (
      select w.label,count(a.id) accounts,
        count(a.id) filter(where (a.created at time zone 'UTC')::date<(a.t at time zone 'UTC')::date-1) d1_eligible,
        count(a.id) filter(where (a.created at time zone 'UTC')::date<(a.t at time zone 'UTC')::date-7) d7_eligible,
        count(a.id) filter(where (a.created at time zone 'UTC')::date<(a.t at time zone 'UTC')::date-1 and exists(
          select 1 from facts g where g.user_id=a.id and (g."startedAt" at time zone 'UTC')::date=(a.created at time zone 'UTC')::date+1)) d1_returned,
        count(a.id) filter(where (a.created at time zone 'UTC')::date<(a.t at time zone 'UTC')::date-7 and exists(
          select 1 from facts g where g.user_id=a.id and (g."startedAt" at time zone 'UTC')::date=(a.created at time zone 'UTC')::date+7)) d7_returned
      from windows w left join accounts a on a.label=w.label group by w.label
    ), metadata as (
      select (select value->>'recordingStartedAt' from app_settings where key='analytics.gameSessionFacts') facts_started,
        (select min(occurred_at) from client_events) raw_observed
    )
    select jsonb_build_object('factsStarted',metadata.facts_started,'rawObserved',metadata.raw_observed,
      'periods',(select jsonb_object_agg(w.label,jsonb_build_object(
        'window',jsonb_build_object('from',w.f,'toExclusive',w.t),
        'diagnosis',(select jsonb_object_agg(scope,data) from diagnosis d where d.label=w.label),
        'character',jsonb_build_object('matureBefore',w.t-interval '48 hours',
          'notYetMature',(select count(*) from character c where c.label=w.label and not c.mature),
          'cohorts',(select jsonb_agg(data order by cohort) from character_cohorts c where c.label=w.label)),
        'retention',(select jsonb_build_object('accounts',r.accounts,'d1Eligible',r.d1_eligible,'d1Returned',r.d1_returned,
          'd1Rate',round(100.0*r.d1_returned/nullif(r.d1_eligible,0),2),'d7Eligible',r.d7_eligible,'d7Returned',r.d7_returned,
          'd7Rate',round(100.0*r.d7_returned/nullif(r.d7_eligible,0),2)) from retention r where r.label=w.label)
      )) from windows w)) report from metadata
  `)
  const data = result[0]?.report as {
    factsStarted: string | null; rawObserved: string | null
    periods: { current: AdminServerJourneyPeriod; previous: AdminServerJourneyPeriod }
  } | undefined
  if (!data?.periods?.current || !data.periods.previous) return unavailableServerJourneyReport(now)
  const factsStarted = data.factsStarted ? Date.parse(data.factsStarted) : NaN
  const factsFullDaysFrom = Number.isFinite(factsStarted)
    ? new Date(Date.parse(new Date(factsStarted).toISOString().slice(0, 10)) + DAY_MS).toISOString() : null
  const rawObservedFrom = data.rawObserved && Number.isFinite(Date.parse(data.rawObserved)) ? new Date(data.rawObserved).toISOString() : null
  const rawRetainedFrom = rawObservedFrom ? new Date(Math.max(Date.parse(rawObservedFrom), retentionFrom.getTime())).toISOString() : null
  for (const period of Object.values(data.periods)) {
    period.factsCoverage = !factsFullDaysFrom ? 'unavailable' : Date.parse(period.window.from) >= Date.parse(factsFullDaysFrom) ? 'complete' : 'partial'
    period.rawCoverage = !rawRetainedFrom ? 'unavailable' : Date.parse(period.window.from) >= Date.parse(rawRetainedFrom) ? 'complete' : 'partial'
    if (period.factsCoverage !== 'complete' || period.rawCoverage !== 'complete') {
      period.diagnosis.all.crossGameRate = null
      period.diagnosis.organic.crossGameRate = null
    }
    if (period.factsCoverage !== 'complete') {
      period.retention.d1Rate = null
      period.retention.d7Rate = null
      period.character.cohorts.forEach(cohort => { cohort.completionRate = null })
    }
  }
  return { method: 'server-journeys-v1', status: 'available', generatedAt: now.toISOString(),
    factsFullDaysFrom, rawObservedFrom, rawRetainedFrom, ...data.periods, limitations }
}
