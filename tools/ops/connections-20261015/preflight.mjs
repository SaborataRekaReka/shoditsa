import postgres from 'postgres';
const db = postgres(process.env.DATABASE_URL, {max:1});
try {
  const data = await db.begin('read only', async tx => ({
    active: await tx`select id,version from content_revisions where status='active'`,
    workspaces: await tx`select w.id,w.status,w.base_revision_id,w.built_revision_id,count(c.id)::int as changes from content_workspaces w left join content_workspace_changes c on c.workspace_id=w.id where w.status in ('open','ready','building','failed') group by w.id`,
    counts: await tx`select mode,count(*)::int as count from content_item_versions where revision_id=(select id from content_revisions where status='active') group by mode order by mode`,
    future: await tx`select puzzle_date,item_version_id,cancelled_at from connections_schedule where puzzle_date >= (now() at time zone 'Europe/Moscow')::date order by puzzle_date`,
    clock: await tx`select now() as utc,(now() at time zone 'Europe/Moscow')::date as moscow_date`,
    actorAvailable: await tx`select exists(select 1 from audit_log a join player_profiles p on p.user_id=a.actor_user_id where a.action='growth.stage_changed' and p.role='admin') as available`
  }));
  console.log(JSON.stringify(data));
} finally { await db.end(); }
