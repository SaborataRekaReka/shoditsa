import { sql } from 'drizzle-orm'
import type { Database } from '@shoditsa/database'

const DAY_MS = 86_400_000
export const ANALYTICS_ROLLUP_LAG_DAYS = 30 as const
export const RAW_ANALYTICS_RETENTION_DAYS = 38 as const
export const ORGANIC_SIGN_UP_ATTRIBUTION_DAYS = 7 as const

export const completedUtcDay = (value: Date) => new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))

export const analyticsRollupBoundary = (now = new Date()) => {
  const today = completedUtcDay(now)
  const rollupCutoff = new Date(today.getTime() - ANALYTICS_ROLLUP_LAG_DAYS * DAY_MS)
  const rawCutoff = new Date(today.getTime() - RAW_ANALYTICS_RETENTION_DAYS * DAY_MS)
  return { today, rollupCutoff, rawCutoff }
}

/**
 * Archives complete UTC days after 30 days while retaining 38 raw days. The
 * overlap keeps a full seven-day attribution lookback for the exact 31-day
 * funnel. Daily rows are activity totals only and never enter cohort rates.
 */
export const rollupClientEventRetention = async (db: Database, now = new Date()) => {
  const { today, rollupCutoff, rawCutoff } = analyticsRollupBoundary(now)
  const todayIso = today.toISOString()
  const rollupCutoffIso = rollupCutoff.toISOString()
  const rawCutoffIso = rawCutoff.toISOString()

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('shoditsa.analytics_event_daily'))`)
    await tx.execute(sql`
      insert into analytics_event_daily (
        activity_date, event_name, entry_source, search_engine, entry_path, mode,
        events_count, users_count, acquisitions_count, "updatedAt"
      )
      select
        (${todayIso}::timestamptz at time zone 'UTC')::date,
        '__raw_retention_38_started__', 'system', '', '', '', 0, 0, 0, now()
      where not exists (
        select 1 from analytics_event_daily marker
        where marker.event_name = '__raw_retention_38_started__'
      )
      on conflict (activity_date, event_name, entry_source, search_engine, entry_path, mode) do nothing
    `)

    await tx.execute(sql`
      insert into analytics_event_daily (
        activity_date, event_name, entry_source, search_engine, entry_path, mode,
        events_count, users_count, acquisitions_count, "updatedAt"
      )
      with raw as (
        select
          event.event_id, event.event_name, event.occurred_at, event.user_id,
          event.game_session_id, event.route, event.properties,
          coalesce(nullif(event.properties->>'entry_path', ''), event.route, '') raw_entry_path,
          lower(coalesce(nullif(event.properties->>'entry_source', ''), 'unknown')) raw_entry_source,
          lower(coalesce(nullif(event.properties->>'entry_search_engine', ''), '')) raw_search_engine,
          lower(case
            when event.event_name in ('game_next_clicked', 'game_next_start', 'danetki_cross_game_clicked')
              then coalesce(nullif(event.properties->>'to_mode', ''), nullif(event.properties->>'toMode', ''), nullif(event.properties->>'mode', ''), '')
            else coalesce(nullif(event.properties->>'mode', ''), nullif(event.properties->>'to_mode', ''), nullif(event.properties->>'toMode', ''), '')
          end) raw_mode,
          nullif(event.properties->>'acquisition_id', '') acquisition_id
        from client_events event
        where event.occurred_at < ${rollupCutoffIso}::timestamptz
          and not exists (
            select 1 from analytics_event_daily marker
            where marker.event_name = '__rollup_complete__'
              and marker.activity_date = (event.occurred_at at time zone 'UTC')::date
          )
      ), normalized as (
        select
          raw.*,
          case raw.event_name
            when 'danetki_room_started' then 'game_session_start'
            when 'danetki_room_completed' then 'game_session_complete'
            when 'danetki_cross_game_clicked' then 'game_next_clicked'
            else raw.event_name
          end canonical_event_name,
          (raw.occurred_at at time zone 'UTC')::date activity_date,
          case
            when raw.raw_entry_source in ('organic_search', 'organic') then 'organic_search'
            when raw.raw_entry_source in ('direct', 'referral') then raw.raw_entry_source
            else 'unknown'
          end entry_source,
          case
            when raw.raw_search_engine in ('yandex', 'яндекс') then 'yandex'
            when raw.raw_search_engine in ('google', 'гугл') then 'google'
            when raw.raw_search_engine in ('bing', 'duckduckgo', 'mailru') then raw.raw_search_engine
            when raw.raw_search_engine = '' then ''
            else 'other'
          end search_engine,
          case
            when raw.raw_entry_path = '/' then '/'
            when raw.raw_entry_path in ('/danetki', '/danetki/dlya-detey', '/danetki/slozhnye', '/danetki/legkie', '/danetki/novye', '/danetki/albatros') then raw.raw_entry_path
            when raw.raw_entry_path like '/danetki/%' then '/danetki/story'
            when raw.raw_entry_path like '/games/%'
              and split_part(raw.raw_entry_path, '/', 3) in ('movie','series','anime','game','music','diagnosis','city','animal','book','character','danetki','connections')
              then '/games/' || split_part(raw.raw_entry_path, '/', 3)
            else '/other'
          end entry_path,
          case
            when raw.raw_mode in ('movie','series','anime','game','music','diagnosis','city','animal','book','character','danetki','connections') then raw.raw_mode
            when raw.route like '/danetki%' then 'danetki'
            when raw.route like '/games/%'
              and split_part(raw.route, '/', 3) in ('movie','series','anime','game','music','diagnosis','city','animal','book','character','danetki','connections')
              then split_part(raw.route, '/', 3)
            else 'unknown'
          end activity_mode
        from raw
      ), ranked as (
        select normalized.*,
          row_number() over (
            partition by normalized.user_id, normalized.canonical_event_name,
              case
                when normalized.canonical_event_name in ('game_session_start', 'game_session_complete')
                  then coalesce(normalized.game_session_id::text, normalized.event_id::text)
                when normalized.canonical_event_name = 'game_next_clicked'
                  then coalesce(nullif(normalized.properties->>'transition_id', ''), normalized.event_id::text)
                when normalized.canonical_event_name = 'game_next_start'
                  then coalesce(nullif(normalized.properties->>'transition_id', ''), normalized.game_session_id::text, normalized.event_id::text)
                else normalized.event_id::text
              end
            order by
              case when normalized.event_name = normalized.canonical_event_name then 0 else 1 end,
              normalized.occurred_at,
              normalized.event_id
          ) lifecycle_rank
        from normalized
      ), event_rows as (
        select activity_date, canonical_event_name event_name, entry_source,
          search_engine, entry_path, activity_mode mode, user_id, acquisition_id
        from ranked
        where lifecycle_rank = 1
      )
      select
        activity_date, event_name, entry_source, search_engine, entry_path, mode,
        count(*)::int,
        count(distinct user_id)::int,
        count(distinct (user_id, acquisition_id)) filter (where acquisition_id is not null)::int,
        now()
      from event_rows
      group by 1, 2, 3, 4, 5, 6
      on conflict (activity_date, event_name, entry_source, search_engine, entry_path, mode)
      do update set
        events_count = excluded.events_count,
        users_count = excluded.users_count,
        acquisitions_count = excluded.acquisitions_count,
        "updatedAt" = excluded."updatedAt"
    `)

    await tx.execute(sql`
      insert into analytics_event_daily (
        activity_date, event_name, entry_source, search_engine, entry_path, mode,
        events_count, users_count, acquisitions_count, "updatedAt"
      )
      with bounds as (
        select coalesce(
          (select max(activity_date) + 1 from analytics_event_daily where event_name = '__rollup_complete__'),
          (select min((occurred_at at time zone 'UTC')::date) from client_events where occurred_at < ${rollupCutoffIso}::timestamptz)
        ) first_date
      )
      select day::date, '__rollup_complete__', 'system', '', '', '', 0, 0, 0, now()
      from bounds
      cross join lateral generate_series(bounds.first_date, (${rollupCutoffIso}::timestamptz at time zone 'UTC')::date - 1, interval '1 day') day
      where bounds.first_date is not null
      on conflict (activity_date, event_name, entry_source, search_engine, entry_path, mode)
      do update set "updatedAt" = excluded."updatedAt"
    `)

    const removal = await tx.execute(sql`delete from client_events where occurred_at < ${rawCutoffIso}::timestamptz`)
    const commandResult = removal as unknown as { count?: number; rowCount?: number }
    const removed = Number(commandResult.count ?? commandResult.rowCount ?? 0)
    return {
      removed,
      rolledUpThroughExclusive: rollupCutoffIso,
      rawRetainedFromInclusive: rawCutoffIso,
    }
  })
}
