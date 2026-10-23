import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { createDatabase } from '@shoditsa/database'
import { loadConfig } from '@shoditsa/config'
import { RATING_ACTIVITY_SQL, type RatingActivity } from '../src/modules/leaderboard/activity.js'

/** CTEs shadow the real tables: this test never inserts, updates or deletes data.
 * Optional read-only production engine check:
 * LEADERBOARD_TEST_SSH=user@host npx vitest run --config vitest.integration.config.ts apps/api/test/leaderboard.integration.test.ts
 */
const fixture = `with
 game_sessions as (
   select id, user_id, mode, kind, status, completion_type, attempts_count,
     (now() at time zone 'Europe/Moscow')::date + day_offset as puzzle_date,
     now() - delay_seconds * interval '1 second' as completed_at, challenge_id
   from (values
     ('1','a','movie','daily','won','direct_win',3,0,60,null),
     ('2','a','movie','daily','won','direct_win',1,0,50,null),
     ('3','a','anime','daily','lost','attempts_exhausted',10,0,60,null),
     ('4','a','book','daily','lost','answer_revealed',2,0,60,null),
     ('5','a','book','daily','won','direct_win',1,0,50,null),
     ('6','a','animal','daily','won','final_choice_win',10,0,60,null),
     ('7','a','city','archive','won','direct_win',1,0,60,null),
     ('8','a','character','free_play','won','direct_win',1,0,60,null),
     ('9','a','game','daily','won','direct_win',1,-1,60,null),
     ('10','a','series','daily','expired','expired',1,0,60,null),
     ('11','a','connections','daily','won','direct_win',4,0,60,null),
     ('12','a','danetki','daily','won','direct_win',1,0,60,null),
     ('13','a','danetki','daily','won','direct_win',1,0,50,null),
     ('14','a','music','daily','won','direct_win',1,0,60,'special'),
     ('15','a','diagnosis','daily','won','direct_win',10,0,60,null),
     ('16','b','movie','daily','won','direct_win',1,0,60,null),
     ('17','anonymous','movie','daily','won','direct_win',1,0,60,null),
     ('18','blocked','movie','daily','won','direct_win',1,0,60,null)
   ) v(id,user_id,mode,kind,status,completion_type,attempts_count,day_offset,delay_seconds,challenge_id)
 ),
 "user" as (select id, name, null::text as image, id='anonymous' as is_anonymous from (values
   ('a','Alpha'), ('b','Beta'), ('anonymous','Guest'), ('blocked','Blocked')
 ) u(id,name)),
 player_profiles as (select id as user_id, null::text as display_name,
   case when id='blocked' then 'blocked' else 'active' end as account_status,
   null::timestamptz as blocked_until from "user"),
 user_entitlements as (select 'b'::text as user_id, 'club'::text as entitlement_key, 'active'::text as status,
   now()-interval '1 day' as starts_at, now()+interval '1 day' as ends_at
   union all select 'a','club','active',now()-interval '2 days',now()-interval '1 day'
   union all select 'a','club','revoked',now()-interval '1 day',null
   union all select 'a','club','active',now()+interval '1 day',null),
 danetki_session_state as (select '12'::text as session_id, 'group'::text as room_mode),
 daily_challenges as (select 'special'::text as id, 'some-pack'::text as variant_key),
 content_packs as (select 'some-pack'::text as id),
`

describe('rating PostgreSQL calculation', () => {
  it('scores terminal daily results once, excludes ineligible games, and resolves current club access', async () => {
    const query = RATING_ACTIVITY_SQL.replace(/^\s*with\s+/i, fixture)
    let players: RatingActivity[]
    const remote = process.env.LEADERBOARD_TEST_SSH
    if (remote) {
      if (!/^[a-zA-Z0-9_.@-]+$/.test(remote)) throw new Error('Invalid test SSH host')
      const response = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', remote,
        `docker exec -i shoditsa-api-shoditsa-postgres-1 sh -c 'exec psql -XAtq -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'`,
      ], { input: `BEGIN READ ONLY;\n${query};\nROLLBACK;\n`, encoding: 'utf8', windowsHide: true, timeout: 30_000 })
      if (response.status !== 0) throw new Error(`Read-only SQL test failed: ${response.stderr}`)
      players = JSON.parse(response.stdout)
    } else {
      const database = createDatabase(loadConfig())
      try { players = (await database.db.execute(sql.raw(query)))[0].players as RatingActivity[] }
      finally { await database.client.end() }
    }
    expect(players.map(player => player.user_id).sort()).toEqual(['a', 'b'])
    expect(players.find(player => player.user_id === 'a')).toMatchObject({
      is_club_member: false, weeks: [{ score: 174, games: 6, wins: 5 }],
    })
    expect(players.find(player => player.user_id === 'b')).toMatchObject({
      is_club_member: true, weeks: [{ score: 48, games: 1, wins: 1 }],
    })
  })
})
