import { KPOP_ARTISTS_PACK_ID, RATING_RULES } from '@shoditsa/contracts'

/** Shared by PostgreSQL and the development-only, read-only SSH preview.
 * No email, auth, payment, or other private profile data is selected.
 * The first terminal result in a mode/day is authoritative, including reveals.
 */
export const RATING_ACTIVITY_SQL = `
with first_results as (
  select distinct on (s.user_id, s.puzzle_date, s.mode)
    s.user_id, s.mode, s.status, s.completion_type, s.attempts_count, s.completed_at
  from game_sessions s
  where s.kind = 'daily' and s.status in ('won', 'lost')
    and s.completed_at <= now()
    and s.puzzle_date = (s.completed_at at time zone 'Europe/Moscow')::date
    and s.mode <> 'territory'
    and not exists (select 1 from danetki_session_state d
      where d.session_id = s.id and d.room_mode <> 'solo')
    and not exists (select 1 from daily_challenges c where c.id = s.challenge_id
      and (c.variant_key = '${KPOP_ARTISTS_PACK_ID}'
        or exists (select 1 from content_packs p where p.id = c.variant_key)))
  order by s.user_id, s.puzzle_date, s.mode, s.completed_at, s.id
), scored as (
  select *, case
    when completion_type in ('answer_revealed', 'expired') then 0
    else ${RATING_RULES.completion}
      + case when status = 'won' then ${RATING_RULES.victory} else 0 end
      + case when status = 'won' and completion_type = 'direct_win'
          and mode not in ('danetki', 'connections')
        then greatest(0, ${RATING_RULES.maxAttempts} - greatest(1, attempts_count)) * ${RATING_RULES.unusedAttempt}
        else 0 end
    end as points
  from first_results
), weekly as (
  select user_id,
    to_char(date_trunc('week', completed_at at time zone 'Europe/Moscow'), 'YYYY-MM-DD') as week,
    sum(points)::int as score,
    count(*)::int as games,
    count(*) filter (where status = 'won')::int as wins,
    min(completed_at) as first_at,
    max(completed_at) as last_at
  from scored where points > 0
  group by user_id, date_trunc('week', completed_at at time zone 'Europe/Moscow')
), players as (
  select u.id as user_id,
    left(coalesce(nullif(trim(p.display_name), ''), nullif(trim(u.name), ''), 'Игрок'), 60) as display_name,
    u.image as avatar_url,
    exists (select 1 from user_entitlements e where e.user_id = u.id
      and e.entitlement_key = 'club' and e.status = 'active'
      and e.starts_at <= now() and (e.ends_at is null or e.ends_at > now())) as is_club_member,
    coalesce(json_agg(json_build_object(
      'week', w.week, 'score', w.score, 'games', w.games, 'wins', w.wins,
      'firstAt', w.first_at, 'lastAt', w.last_at
    ) order by w.week) filter (where w.week is not null), '[]'::json) as weeks
  from "user" u
  left join player_profiles p on p.user_id = u.id
  left join weekly w on w.user_id = u.id
  where not u.is_anonymous
    and (p.account_status is distinct from 'blocked' or p.blocked_until <= now())
  group by u.id, u.name, u.image, p.display_name
)
select coalesce(json_agg(players), '[]'::json) as players from players
`

export type RatingActivity = {
  user_id: string
  display_name: string
  avatar_url: string | null
  is_club_member: boolean
  weeks: Array<{ week: string; score: number; games: number; wins: number; firstAt: string; lastAt: string }>
}
