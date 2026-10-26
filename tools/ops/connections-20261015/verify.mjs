import postgres from 'postgres';
const db=postgres(process.env.DATABASE_URL,{max:1});
try{
  const data=await db.begin('read only',async tx=>({
    capturedAt:new Date().toISOString(),
    active:await tx`select id,version from content_revisions where status='active'`,
    dates:await tx`select s.puzzle_date,v.item_id,v.content_status,v.allowed_in_game,s.cancelled_at from connections_schedule s join content_item_versions v on v.id=s.item_version_id where s.puzzle_date between '2026-10-15' and '2026-10-28' order by s.puzzle_date`,
    unchanged:await tx`select count(*)::int as previous_items,count(*) filter(where fresh.id is null or fresh.payload is distinct from old.payload or fresh.allowed_in_game is distinct from old.allowed_in_game or fresh.content_status is distinct from old.content_status)::int as differences from content_item_versions old left join content_item_versions fresh on fresh.item_id=old.item_id and fresh.revision_id=(select id from content_revisions where status='active') where old.revision_id='62f9f575-1b7d-4a30-b52a-eaaa51449c1a'`,
    sinceRestoreErrors:await tx`select count(*)::int as errors from client_events e where event_name='api_error' and occurred_at>='2026-10-15T08:37:21.668Z' and error_code='CONNECTIONS_PUZZLE_NOT_SCHEDULED' and not exists(select 1 from player_profiles p where p.user_id=e.user_id and p.role='admin')`
  }));
  console.log(JSON.stringify(data));
}finally{await db.end()}
