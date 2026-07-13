import { sql } from 'drizzle-orm'
import type { Database } from '@shoditsa/database'

export const mergeAnonymousAccount = async (db: Database, anonymousUserId: string, targetUserId: string) => {
  if (anonymousUserId === targetUserId) return
  await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('shoditsa.account_merge', 'on', true)`)
    // Keep the more advanced session for each challenge before moving ownership.
    // Reports belong to the surviving session too; otherwise the session/user
    // cascade would silently erase guest feedback during account linking.
    await tx.execute(sql`
      update content_reports report set user_id = ${targetUserId}::uuid, session_id = target.id
      from game_sessions old, game_sessions target
      where report.user_id = ${anonymousUserId}::uuid and report.session_id = old.id
        and old.user_id = ${anonymousUserId}::uuid and target.user_id = ${targetUserId}::uuid
        and old.challenge_id is not null and old.challenge_id = target.challenge_id
        and ((case target.status when 'won' then 3 when 'lost' then 2 else 1 end) > (case old.status when 'won' then 3 when 'lost' then 2 else 1 end)
          or ((case target.status when 'won' then 3 when 'lost' then 2 else 1 end) = (case old.status when 'won' then 3 when 'lost' then 2 else 1 end)
            and case when target.status = 'won' then target.attempts_count <= old.attempts_count else target.attempts_count >= old.attempts_count end))`)
    await tx.execute(sql`
      delete from game_sessions old
      using game_sessions target
      where old.user_id = ${anonymousUserId}::uuid and target.user_id = ${targetUserId}::uuid
        and old.challenge_id is not null and old.challenge_id = target.challenge_id
        and ((case target.status when 'won' then 3 when 'lost' then 2 else 1 end) > (case old.status when 'won' then 3 when 'lost' then 2 else 1 end)
          or ((case target.status when 'won' then 3 when 'lost' then 2 else 1 end) = (case old.status when 'won' then 3 when 'lost' then 2 else 1 end)
            and case when target.status = 'won' then target.attempts_count <= old.attempts_count else target.attempts_count >= old.attempts_count end))`)
    await tx.execute(sql`
      update content_reports report set session_id = old.id
      from game_sessions old, game_sessions target
      where report.session_id = target.id
        and old.user_id = ${anonymousUserId}::uuid and target.user_id = ${targetUserId}::uuid
        and old.challenge_id is not null and old.challenge_id = target.challenge_id`)
    await tx.execute(sql`
      delete from game_sessions target
      using game_sessions old
      where old.user_id = ${anonymousUserId}::uuid and target.user_id = ${targetUserId}::uuid
        and old.challenge_id is not null and old.challenge_id = target.challenge_id`)
    await tx.execute(sql`update game_sessions set user_id = ${targetUserId}::uuid where user_id = ${anonymousUserId}::uuid`)
    await tx.execute(sql`update content_reports set user_id = ${targetUserId}::uuid where user_id = ${anonymousUserId}::uuid`)

    await tx.execute(sql`insert into wallet_accounts (user_id) values (${targetUserId}::uuid) on conflict do nothing`)
    await tx.execute(sql`
      update wallet_accounts target set
        balance = target.balance + source.balance,
        lifetime_earned = target.lifetime_earned + source.lifetime_earned,
        version = target.version + 1,
        "updatedAt" = now()
      from wallet_accounts source
      where target.user_id = ${targetUserId}::uuid and source.user_id = ${anonymousUserId}::uuid`)
    await tx.execute(sql`update wallet_ledger set user_id = ${targetUserId}::uuid where user_id = ${anonymousUserId}::uuid`)
    await tx.execute(sql`delete from wallet_accounts where user_id = ${anonymousUserId}::uuid`)

    await tx.execute(sql`insert into period_entitlements (user_id, mode, period, source, ledger_id, "unlockedAt")
      select ${targetUserId}::uuid, mode, period, source, ledger_id, "unlockedAt" from period_entitlements where user_id = ${anonymousUserId}::uuid
      on conflict (user_id, mode, period) do nothing`)
    await tx.execute(sql`delete from period_entitlements where user_id = ${anonymousUserId}::uuid`)
    await tx.execute(sql`insert into free_play_usage (user_id, activity_date, launches)
      select ${targetUserId}::uuid, activity_date, launches from free_play_usage where user_id = ${anonymousUserId}::uuid
      on conflict (user_id, activity_date) do update set launches = free_play_usage.launches + excluded.launches`)
    await tx.execute(sql`delete from free_play_usage where user_id = ${anonymousUserId}::uuid`)

    await tx.execute(sql`insert into daily_attendance (user_id, activity_date, completed_modes, won_modes, first_completed_at, full_house)
      select ${targetUserId}::uuid, activity_date, completed_modes, won_modes, first_completed_at, full_house from daily_attendance where user_id = ${anonymousUserId}::uuid
      on conflict (user_id, activity_date) do update set
        completed_modes = (select array_agg(distinct x) from unnest(daily_attendance.completed_modes || excluded.completed_modes) x),
        won_modes = (select array_agg(distinct x) from unnest(daily_attendance.won_modes || excluded.won_modes) x),
        first_completed_at = least(daily_attendance.first_completed_at, excluded.first_completed_at),
        full_house = daily_attendance.full_house or excluded.full_house`)
    await tx.execute(sql`delete from daily_attendance where user_id = ${anonymousUserId}::uuid`)
    await tx.execute(sql`insert into attendance_stats (user_id, current_daily_streak, best_daily_streak, last_completed_date, grace_passes, total_active_days, full_house_days, "updatedAt")
      select ${targetUserId}::uuid, current_daily_streak, best_daily_streak, last_completed_date, grace_passes, total_active_days, full_house_days, now() from attendance_stats where user_id = ${anonymousUserId}::uuid
      on conflict (user_id) do update set
        current_daily_streak = greatest(attendance_stats.current_daily_streak, excluded.current_daily_streak),
        best_daily_streak = greatest(attendance_stats.best_daily_streak, excluded.best_daily_streak),
        last_completed_date = greatest(attendance_stats.last_completed_date, excluded.last_completed_date),
        grace_passes = least(2, attendance_stats.grace_passes + excluded.grace_passes),
        total_active_days = (select count(*) from daily_attendance where user_id = ${targetUserId}::uuid),
        full_house_days = (select count(*) from daily_attendance where user_id = ${targetUserId}::uuid and full_house), "updatedAt" = now()`)
    await tx.execute(sql`delete from attendance_stats where user_id = ${anonymousUserId}::uuid`)

    // Rebuild counters from authoritative terminal sessions while preserving the
    // strongest known streak values. A full historical streak reconstruction is
    // impossible when older imports do not contain completion ordering.
    await tx.execute(sql`with prior_stats as (
        select mode, difficulty_key, max(current_streak)::int as current_streak, max(best_streak)::int as best_streak
        from user_mode_stats where user_id in (${anonymousUserId}::uuid, ${targetUserId}::uuid)
        group by mode, difficulty_key
      )
      insert into user_mode_stats (user_id, mode, difficulty_key, played, won, current_streak, best_streak, distribution, "updatedAt")
      select ${targetUserId}::uuid, gs.mode, case when gs.mode = 'music' then coalesce(gs.difficulty::text, '-') else '-' end,
        count(*)::int, count(*) filter (where gs.status = 'won')::int,
        coalesce(max(ps.current_streak), 0), coalesce(max(ps.best_streak), 0),
        ARRAY[
          count(*) filter (where gs.status = 'won' and gs.attempts_count = 1)::int, count(*) filter (where gs.status = 'won' and gs.attempts_count = 2)::int,
          count(*) filter (where gs.status = 'won' and gs.attempts_count = 3)::int, count(*) filter (where gs.status = 'won' and gs.attempts_count = 4)::int,
          count(*) filter (where gs.status = 'won' and gs.attempts_count = 5)::int, count(*) filter (where gs.status = 'won' and gs.attempts_count = 6)::int,
          count(*) filter (where gs.status = 'won' and gs.attempts_count = 7)::int, count(*) filter (where gs.status = 'won' and gs.attempts_count = 8)::int,
          count(*) filter (where gs.status = 'won' and gs.attempts_count = 9)::int, count(*) filter (where gs.status = 'won' and gs.attempts_count = 10)::int
        ], now()
      from game_sessions gs
      left join prior_stats ps on ps.mode = gs.mode and ps.difficulty_key = case when gs.mode = 'music' then coalesce(gs.difficulty::text, '-') else '-' end
      where gs.user_id = ${targetUserId}::uuid and gs.kind in ('daily','archive') and gs.status in ('won','lost')
      group by gs.mode, case when gs.mode = 'music' then coalesce(gs.difficulty::text, '-') else '-' end
      on conflict (user_id, mode, difficulty_key) do update set
        played = excluded.played,
        won = excluded.won,
        current_streak = excluded.current_streak,
        best_streak = excluded.best_streak,
        distribution = excluded.distribution,
        "updatedAt" = excluded."updatedAt"`)
    await tx.execute(sql`delete from user_mode_stats where user_id = ${anonymousUserId}::uuid`)

    await tx.execute(sql`delete from promo_redemptions old using promo_redemptions target
      where old.user_id = ${anonymousUserId}::uuid and target.user_id = ${targetUserId}::uuid and old.promo_id = target.promo_id and old.redemption_number = target.redemption_number`)
    await tx.execute(sql`update promo_redemptions set user_id = ${targetUserId}::uuid where user_id = ${anonymousUserId}::uuid`)
    await tx.execute(sql`delete from legacy_imports old using legacy_imports target
      where old.user_id = ${anonymousUserId}::uuid and target.user_id = ${targetUserId}::uuid and old.device_id = target.device_id and old.schema_version = target.schema_version`)
    await tx.execute(sql`update legacy_imports set user_id = ${targetUserId}::uuid where user_id = ${anonymousUserId}::uuid`)
    await tx.execute(sql`insert into audit_log (actor_user_id, action, entity_type, entity_id, before, after, request_id)
      values (${targetUserId}::uuid, 'account.merge', 'user', ${anonymousUserId}::text, jsonb_build_object('anonymousUserId', ${anonymousUserId}::text), jsonb_build_object('targetUserId', ${targetUserId}::text), 'better-auth-link')`)
  })
}
