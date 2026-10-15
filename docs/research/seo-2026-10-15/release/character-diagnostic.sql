BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='25s';
SET LOCAL timezone='UTC';
WITH windows(label,from_at,to_at) AS (VALUES
 ('current14','2026-10-01'::timestamptz,'2026-10-15'::timestamptz),
 ('previous14','2026-09-17'::timestamptz,'2026-10-01'::timestamptz)
), all_character AS (
 SELECT f.*,row_number() OVER(PARTITION BY f.user_id ORDER BY f."startedAt",f.id) character_ordinal
 FROM game_session_facts f WHERE f.mode='character' AND f.kind<>'pack'
 AND NOT EXISTS(SELECT 1 FROM player_profiles p WHERE p.user_id=f.user_id AND p.role='admin')
), observed AS (
 SELECT w.label,w.to_at,f.*,s.id IS NOT NULL session_retained,s.attempts_count,s.completion_type,
 CASE WHEN f.character_ordinal=1 THEN 'first_observed_character' ELSE 'repeat_character' END cohort,
 EXISTS(SELECT 1 FROM game_session_facts prior WHERE prior.user_id=f.user_id AND prior."startedAt"<f."startedAt") had_prior_server_game,
 EXISTS(SELECT 1 FROM game_session_facts prior WHERE prior.user_id=f.user_id AND prior."startedAt"<f."startedAt"-interval '24 hours') had_server_game_more_than_24h_before,
 f."startedAt"<=w.to_at-interval '48 hours' mature_48h,
 f.completion_status IN('won','lost') AND f.completed_at>=f."startedAt" AND f.completed_at<w.to_at completed_by_period_end,
 f.completion_status IN('won','lost') AND f.completed_at>=f."startedAt" AND f.completed_at<=f."startedAt"+interval '48 hours' completed_within_48h,
 CASE WHEN s.id IS NOT NULL THEN a.attempts_48h END attempts_48h,
 a.first_attempt_at,
 CASE WHEN s.id IS NOT NULL THEN a.attempt_rows END attempt_rows,
 CASE WHEN s.id IS NOT NULL THEN h.hints_48h END hints_48h,
 e.linked_events,e.error_events,e.organic_start_events,
 CASE WHEN f.completion_status IN('won','lost') AND f.completed_at>=f."startedAt" THEN round(extract(epoch FROM (f.completed_at-f."startedAt"))::numeric,1) END played_completion_elapsed_seconds,
 CASE WHEN a.first_attempt_at IS NOT NULL THEN round(extract(epoch FROM (a.first_attempt_at-f."startedAt"))::numeric,1) END first_attempt_delay_seconds
 FROM windows w JOIN all_character f ON f."startedAt">=w.from_at AND f."startedAt"<w.to_at
 LEFT JOIN game_sessions s ON s.id=f.id
 LEFT JOIN LATERAL (SELECT count(*)::int attempt_rows,min(a."createdAt") first_attempt_at,
 count(*) FILTER(WHERE a."createdAt"<=f."startedAt"+interval '48 hours')::int attempts_48h
 FROM game_attempts a WHERE a.session_id=f.id) a ON true
 LEFT JOIN LATERAL (SELECT count(*) FILTER(WHERE h."createdAt"<=f."startedAt"+interval '48 hours')::int hints_48h FROM game_hint_choices h WHERE h.session_id=f.id) h ON true
 LEFT JOIN LATERAL (SELECT count(*)::int linked_events,count(*) FILTER(WHERE event_name IN('api_error','client_error'))::int error_events,
 count(*) FILTER(WHERE event_name IN('game_session_start','free_play_started') AND properties->>'entry_source' IN('organic','organic_search'))::int organic_start_events
 FROM client_events e WHERE e.game_session_id=f.id AND e.occurred_at>=f."startedAt" AND e.occurred_at<f."startedAt"+interval '48 hours') e ON true
), totals AS (
 SELECT label,count(*)::int starts,count(distinct user_id)::int profiles,
 count(*) FILTER(WHERE completed_by_period_end)::int completed_by_period_end,
 count(*) FILTER(WHERE completion_status='expired' AND completed_at<to_at)::int expired_by_period_end,
 count(*) FILTER(WHERE mature_48h)::int mature_starts,
 count(*) FILTER(WHERE NOT mature_48h)::int not_yet_48h_at_period_end,
 count(*) FILTER(WHERE session_retained)::int retained_session_rows,
 count(*) FILTER(WHERE NOT session_retained)::int missing_session_details,
 count(*) FILTER(WHERE attempts_count=0)::int zero_attempts_observed,
 count(*) FILTER(WHERE attempts_count IS DISTINCT FROM attempt_rows AND session_retained)::int attempt_count_disagreements
 FROM observed GROUP BY label
), cohorts AS (
 SELECT label,cohort,count(*)::int starts,count(distinct user_id)::int profiles,
 count(*) FILTER(WHERE completed_within_48h)::int completed_within_48h,
 count(*) FILTER(WHERE completion_status='won' AND completed_within_48h)::int won_within_48h,
 count(*) FILTER(WHERE completion_status='lost' AND completed_within_48h)::int lost_within_48h,
 count(*) FILTER(WHERE NOT coalesce(completed_within_48h,false))::int not_completed_within_48h,
 count(*) FILTER(WHERE completion_status='expired' AND completed_at<to_at)::int expired_by_period_end,
 count(*) FILTER(WHERE session_retained)::int retained_session_rows,
 count(*) FILTER(WHERE attempts_48h=0)::int zero_attempts_48h,
 count(*) FILTER(WHERE attempts_48h BETWEEN 1 AND 3)::int one_to_three_attempts_48h,
 count(*) FILTER(WHERE attempts_48h>=4)::int four_plus_attempts_48h,
 count(*) FILTER(WHERE attempts_48h IS NULL)::int unknown_attempts,
 count(*) FILTER(WHERE NOT had_prior_server_game)::int no_prior_observed_server_game,
 count(*) FILTER(WHERE had_prior_server_game)::int prior_observed_server_game,
 count(*) FILTER(WHERE had_server_game_more_than_24h_before)::int prior_game_over_24h_earlier,
 count(*) FILTER(WHERE hints_48h>0)::int used_hint_sessions,
 count(*) FILTER(WHERE linked_events>0)::int sessions_with_linked_events,
 count(*) FILTER(WHERE error_events>0)::int sessions_with_linked_error_events,
 count(*) FILTER(WHERE organic_start_events>0)::int sessions_with_organic_client_start,
 count(*) FILTER(WHERE first_attempt_delay_seconds IS NOT NULL)::int observed_first_attempt_delays,
 round((percentile_cont(0.5) WITHIN GROUP(ORDER BY first_attempt_delay_seconds))::numeric,1) median_first_attempt_delay_seconds,
 round((percentile_cont(0.9) WITHIN GROUP(ORDER BY first_attempt_delay_seconds))::numeric,1) p90_first_attempt_delay_seconds,
 round((percentile_cont(0.5) WITHIN GROUP(ORDER BY attempts_48h))::numeric,1) median_attempts_48h,
 round((percentile_cont(0.5) WITHIN GROUP(ORDER BY played_completion_elapsed_seconds) FILTER(WHERE completed_within_48h))::numeric,1) median_completed_elapsed_seconds
 FROM observed WHERE mature_48h GROUP BY label,cohort
), profile_segments AS (
 SELECT label,cohort,had_prior_server_game,count(*)::int starts,
 count(*) FILTER(WHERE completed_within_48h)::int completed_within_48h,
 count(*) FILTER(WHERE attempts_48h=0)::int zero_attempts_48h
 FROM observed WHERE mature_48h GROUP BY label,cohort,had_prior_server_game
), outcomes AS (
 SELECT label,cohort,coalesce(completion_type,'not_terminal_or_details_missing') current_completion_type,
 CASE WHEN attempts_48h IS NULL THEN 'unknown' WHEN attempts_48h=0 THEN 'zero' WHEN attempts_48h<=3 THEN '1-3' ELSE '4-10' END attempts_bucket,
 count(*)::int starts,count(*) FILTER(WHERE completed_within_48h)::int completed_within_48h
 FROM observed WHERE mature_48h GROUP BY 1,2,3,4
), sample_selection AS (
 SELECT *,row_number() OVER(ORDER BY "startedAt" DESC,id) example_number FROM observed
 WHERE label='current14' AND cohort='first_observed_character' AND mature_48h
), examples AS (
 SELECT example_number,"startedAt"::date start_date_utc,kind,coalesce(access_source,'unknown') access_source,
 had_prior_server_game,had_server_game_more_than_24h_before,session_retained,
 attempts_48h,first_attempt_delay_seconds,hints_48h,
 coalesce(completed_within_48h,false) completed_within_48h,
 CASE WHEN completed_at<to_at THEN completion_status ELSE 'not_terminal_by_period_end' END status_by_period_end,
 completion_type AS current_completion_type,played_completion_elapsed_seconds,
 linked_events,error_events,organic_start_events
 FROM sample_selection WHERE example_number<=5 ORDER BY example_number
)
SELECT jsonb_build_object(
 'capturedAt',now(),'site','https://shoditsa.ru','timezone','UTC',
 'definition','Non-admin public Character server episode start cohorts. Completed=won/lost only. Cohort first/repeat uses full preserved Character history and merged owner. Mature if start <= period end minus 48h; equal 48h completion horizon. Current mature calendar days Oct1-12; previous mature days Sep17-28.',
 'sampleSelection','Five most recent first-observed Character episodes in mature current cohort, ordered startedAt DESC then internal episode ID; selection independent of outcome. No IDs exported.',
 'totals',(SELECT jsonb_agg(t ORDER BY label) FROM totals t),
 'matureCohorts',(SELECT jsonb_agg(c ORDER BY label,cohort) FROM cohorts c),
 'matureProfileSegments',(SELECT jsonb_agg(p ORDER BY label,cohort,had_prior_server_game) FROM profile_segments p),
 'matureOutcomeAttemptBuckets',(SELECT jsonb_agg(o ORDER BY label,cohort,current_completion_type,attempts_bucket) FROM outcomes o),
 'fiveFirstCharacterExamples',(SELECT jsonb_agg(e ORDER BY example_number) FROM examples e),
 'limitations',jsonb_build_array('This is server telemetry, not Webvisor replay or a UX interview. It cannot reveal intent, what the player saw, search terms, or why they left.','First means first in preserved merged-owner history; guest identities are not people; deleted pre-Sep12 history and identity changes can affect firstness.','Facts do not retain attempts_count. Deleted gameplay details are null, never zero. Lifecycle expiry at 48h since updatedAt does not delete/reset attempts.','Client events are consent/retention-limited. Absence of linked errors is not proof of no errors. Organic-linked starts are a subset, not the full organic cohort.','Elapsed completion duration is wall-clock, not active playtime. Current status at extraction may be later than the fixed observation cutoff; completion rates use timestamp guards.')
);
ROLLBACK;
