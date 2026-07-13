import { sql } from 'drizzle-orm'
import type { AdminEventsQuery } from '@shoditsa/contracts'
import type { Database } from '@shoditsa/database'

const rows = <T>(value: unknown) => Array.from(value as Iterable<T>)

export const loadAdminTimeline = async (db: Database, query: AdminEventsQuery) => {
  const userFilter = query.userId ? sql`and e."userId" = ${query.userId}::uuid` : sql``
  const gameSessionFilter = query.gameSessionId ? sql`and e."gameSessionId" = ${query.gameSessionId}::uuid` : sql``
  const authSessionFilter = query.sessionId ? sql`and e."authSessionId" = ${query.sessionId}::uuid` : sql``
  const itemFilter = query.itemId ? sql`and e."itemId" = ${query.itemId}` : sql``
  const modeFilter = query.mode ? sql`and e.mode = ${query.mode}` : sql``
  const from = (query.from ? new Date(query.from) : new Date(Date.now() - 24 * 60 * 60 * 1000)).toISOString()
  const to = (query.to ? new Date(query.to) : new Date()).toISOString()
  const limit = Math.min(query.limit ?? 50, 10_000)
  const result = await db.execute(sql`
    select * from (
      select 'game:' || gs.id::text id, 'game_started' type, gs."startedAt" "occurredAt", gs.user_id "userId", gs.auth_session_id "authSessionId", gs.id "gameSessionId", civ.item_id "itemId", gs.answer_item_version_id "itemVersionId", gs.mode::text mode,
        'Игра начата' title, concat(gs.mode, ' · ', gs.kind) summary, jsonb_build_object('kind', gs.kind, 'period', gs.period, 'difficulty', gs.difficulty, 'status', gs.status) details, null::text "requestId", 'game_sessions' "sourceTable"
      from game_sessions gs join content_item_versions civ on civ.id = gs.answer_item_version_id
      union all
      select 'attempt:' || ga.id::text, 'attempt', ga."createdAt", gs.user_id, gs.auth_session_id, gs.id, civ.item_id, ga.guessed_item_version_id, gs.mode::text,
        'Сделана попытка', concat('Попытка ', ga.position, case when ga.is_correct then ' · верно' else ' · неверно' end), jsonb_build_object('position', ga.position, 'isCorrect', ga.is_correct, 'hints', ga.hints_snapshot), null::text, 'game_attempts'
      from game_attempts ga join game_sessions gs on gs.id = ga.session_id join content_item_versions civ on civ.id = ga.guessed_item_version_id
      union all
      select 'hint:' || gh.id::text, 'hint_opened', gh."createdAt", gs.user_id, gs.auth_session_id, gs.id, civ.item_id, gs.answer_item_version_id, gs.mode::text,
        'Открыта подсказка', concat('Раунд ', gh.checkpoint, ' · ', gh.hint_key), jsonb_build_object('checkpoint', gh.checkpoint, 'hintKey', gh.hint_key), null::text, 'game_hint_choices'
      from game_hint_choices gh join game_sessions gs on gs.id = gh.session_id join content_item_versions civ on civ.id = gs.answer_item_version_id
      union all
      select 'report:' || cr.id::text, 'content_report', cr."createdAt", cr.user_id, gs.auth_session_id, cr.session_id, cr.item_id, gs.answer_item_version_id, cr.mode::text,
        'Отправлен баг-репорт', concat(cr.reason, coalesce(' · ' || cr.comment, '')), jsonb_build_object('reason', cr.reason, 'status', cr.status), cr.request_id, 'content_reports'
      from content_reports cr join game_sessions gs on gs.id = cr.session_id
      union all
      select 'wallet:' || wl.id::text, 'wallet', wl."createdAt", wl.user_id, null::uuid, null::uuid, null::text, null::uuid, null::text,
        'Изменился баланс', concat(case when wl.amount >= 0 then '+' else '' end, wl.amount, ' · ', wl.reason), jsonb_build_object('type', wl.type, 'amount', wl.amount, 'balanceAfter', wl.balance_after), null::text, 'wallet_ledger'
      from wallet_ledger wl
      union all
      select 'client:' || ce.id::text, ce.event_name, ce.occurred_at, ce.user_id, ce.auth_session_id, ce.game_session_id, null::text, null::uuid, null::text,
        'Клиентское событие', concat_ws(' · ', ce.route, ce.error_code), ce.properties, ce.request_id, 'client_events'
      from client_events ce
      union all
      select 'auth:' || ae.id::text, ae.event_name, ae.occurred_at, ae.user_id, ae.auth_session_id, null::uuid, null::text, null::uuid, null::text,
        'Авторизация', concat(ae.event_name, ' · ', ae.result), jsonb_build_object('browser', ae.browser, 'os', ae.os, 'device', ae.device), ae.request_id, 'auth_events'
      from auth_events ae
    ) e where e."occurredAt" between ${from}::timestamptz and ${to}::timestamptz
    ${userFilter} ${gameSessionFilter} ${authSessionFilter} ${itemFilter} ${modeFilter}
    ${query.type ? sql`and e.type = ${query.type}` : sql``}
    ${query.requestId ? sql`and e."requestId" = ${query.requestId}` : sql``}
    ${query.errorsOnly ? sql`and e.type in ('client_error','api_error')` : sql``}
    ${query.cursor ? sql`and e."occurredAt" < ${new Date(query.cursor).toISOString()}::timestamptz` : sql``}
    order by e."occurredAt" desc limit ${limit + 1}
  `)
  return rows<Record<string, unknown>>(result)
}
