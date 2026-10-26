import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { Database } from '@shoditsa/database'
import type { AppConfig } from '@shoditsa/config'
import { ApiError } from '../../lib/errors.js'
import { CAMPAIGN_ID, classifyMailingError, createMailingSender, emailHash, loadMailingContent, normalizeEmail, validEmail, type MailingContent, type MailingSender } from './content.js'

type Recipient = { id: string; email: string; email_hash: string; user_id: string | null; kind: 'campaign' | 'test'; content_hash: string }
const eligible = sql`u.is_anonymous = false and nullif(trim(u.email),'') is not null
  and coalesce(p.account_status,'active') <> 'blocked'`

export function unsubscribeToken(config: AppConfig, id: string, addressHash: string) {
  return createHmac('sha256', config.authSecret).update(`mailing-unsubscribe-v1:${id}:${addressHash}`).digest('hex')
}
export function unsubscribeUrl(config: AppConfig, id: string, addressHash: string) {
  return `${new URL(config.authUrl).origin}/api/v1/mailings/unsubscribe/${id}/${unsubscribeToken(config, id, addressHash)}`
}

export async function mailingOverview(db: Database) {
  const campaign = await db.execute(sql`select id, subject, content_hash, status, consent_source, prepared_at, created_at, last_error from mailing_campaigns where id=${CAMPAIGN_ID}`)
  const counts = await db.execute(sql`select kind, status, count(*)::int as count from mailing_recipients where campaign_id=${CAMPAIGN_ID} group by kind,status order by kind,status`)
  const audience = await db.execute(sql`select u.email from "user" u left join player_profiles p on p.user_id=u.id
    where ${eligible} and not exists(select 1 from mailing_suppressions s where s.email_hash=encode(sha256(convert_to(lower(trim(u.email)),'UTF8')),'hex'))`)
  return { campaign: campaign[0] ?? null, counts: Array.from(counts), eligible: new Set(audience.map(r => normalizeEmail(String(r.email))).filter(validEmail)).size }
}

async function ensureCampaign(db: Database, content: MailingContent, actorId: string) {
  await db.execute(sql`insert into mailing_campaigns(id,subject,content_hash,created_by) values(${CAMPAIGN_ID},${content.subject},${content.hash},${actorId}::uuid) on conflict do nothing`)
  const rows = await db.execute(sql`select content_hash from mailing_campaigns where id=${CAMPAIGN_ID}`)
  if (rows[0]?.content_hash !== content.hash) throw new ApiError(409, 'MAILING_CONTENT_CHANGED', 'Содержание выпуска изменилось после подготовки')
}

export async function queueMailing(db: Database, config: AppConfig, actor: { id: string; email: string }, action: 'start' | 'test' | 'pause', consentSource = '') {
  if (action === 'pause') {
    await db.execute(sql`update mailing_campaigns set status='paused' where id=${CAMPAIGN_ID} and status='sending'`)
    return mailingOverview(db)
  }
  if (!config.smtp.host || !config.smtp.from) throw new ApiError(503, 'MAILING_SMTP_UNAVAILABLE', 'SMTP не настроен')
  const content = await loadMailingContent()
  await db.transaction(async tx => {
    await ensureCampaign(tx as unknown as Database, content, actor.id)
    const [campaign] = await tx.execute(sql`select * from mailing_campaigns where id=${CAMPAIGN_ID} for update`)
    if (action === 'test') {
      if (!validEmail(actor.email)) throw new ApiError(400, 'MAILING_EMAIL_INVALID', 'В аккаунте администратора некорректный email')
      await tx.execute(sql`insert into mailing_recipients(id,campaign_id,user_id,email,email_hash,kind)
        values(${randomUUID()}::uuid,${CAMPAIGN_ID},${actor.id}::uuid,${normalizeEmail(actor.email)},${emailHash(actor.email)},'test') on conflict do nothing`)
      return
    }
    if (campaign!.status === 'completed') return
    const tested = await tx.execute(sql`select 1 from mailing_recipients where campaign_id=${CAMPAIGN_ID} and kind='test' and status='accepted' limit 1`)
    if (!tested.length) throw new ApiError(409, 'MAILING_TEST_REQUIRED', 'Сначала отправьте тест себе и дождитесь приёма SMTP')
    // The first launch seals the audience. A repeated request cannot add new users.
    if (!campaign!.prepared_at) {
      if (consentSource.trim().length < 15 || consentSource.length > 1000) throw new ApiError(400, 'MAILING_CONSENT_REQUIRED', 'Укажите источник согласий всей базы')
      const users = await tx.execute(sql`select u.id,u.email from "user" u left join player_profiles p on p.user_id=u.id where ${eligible} order by u."createdAt",u.id`)
      for (const user of users) {
        const email = normalizeEmail(String(user.email))
        if (!validEmail(email)) continue
        await tx.execute(sql`insert into mailing_recipients(id,campaign_id,user_id,email,email_hash,kind,status)
          values(${randomUUID()}::uuid,${CAMPAIGN_ID},${user.id}::uuid,${email},${emailHash(email)},'campaign',
          case when exists(select 1 from mailing_suppressions where email_hash=${emailHash(email)}) then 'suppressed' else 'queued' end) on conflict do nothing`)
      }
      await tx.execute(sql`update mailing_campaigns set prepared_at=now(),consent_source=${consentSource.trim()},consent_by=${actor.id}::uuid where id=${CAMPAIGN_ID}`)
    }
    const unresolved = await tx.execute(sql`select 1 from mailing_recipients where campaign_id=${CAMPAIGN_ID} and status='unknown' limit 1`)
    if (unresolved.length) throw new ApiError(409, 'MAILING_RESULT_UNKNOWN', 'Есть письма с неопределённым результатом SMTP. Нужна проверка журнала сервера')
    await tx.execute(sql`update mailing_campaigns set status='sending',last_error=null where id=${CAMPAIGN_ID}`)
  })
  return mailingOverview(db)
}

export async function findUnsubscribeRecipient(db: Database, config: AppConfig, id: string, token: string) {
  if (!/^[0-9a-f-]{36}$/.test(id) || !/^[0-9a-f]{64}$/.test(token)) return null
  const [row] = await db.execute(sql`select id,email_hash from mailing_recipients where id=${id}::uuid`)
  if (!row) return null
  const expected = unsubscribeToken(config, id, String(row.email_hash))
  return timingSafeEqual(Buffer.from(expected), Buffer.from(token)) ? String(row.email_hash) : null
}

export async function suppressMailingAddress(db: Database, addressHash: string) {
  await db.transaction(async tx => {
    await tx.execute(sql`insert into mailing_suppressions(email_hash) values(${addressHash}) on conflict do nothing`)
    await tx.execute(sql`update mailing_recipients set status='suppressed',finished_at=now(),error_code='UNSUBSCRIBED' where email_hash=${addressHash} and status='queued'`)
  })
}

export async function claimMailingRecipient(db: Database): Promise<Recipient | null> {
  return db.transaction(async tx => {
    // A lost SMTP result is never retried, even after a process restart.
    const stale = await tx.execute(sql`update mailing_recipients set status='unknown',error_code='PROCESS_LOST_SMTP_RESULT',finished_at=now()
      where status='sending' and claimed_at < now()-interval '2 minutes' returning campaign_id`)
    for (const row of stale) await tx.execute(sql`update mailing_campaigns set status='paused',last_error='PROCESS_LOST_SMTP_RESULT' where id=${row.campaign_id}`)
    const [campaign] = await tx.execute(sql`select c.* from mailing_campaigns c where c.next_send_at<=now()
      and (c.status='sending' or exists(select 1 from mailing_recipients r where r.campaign_id=c.id and r.kind='test' and r.status='queued'))
      order by c.created_at for update skip locked limit 1`)
    if (!campaign) return null
    const active = await tx.execute(sql`select 1 from mailing_recipients where campaign_id=${campaign.id} and status='sending' limit 1`)
    if (active.length) return null
    const [recipient] = await tx.execute(sql`select r.* from mailing_recipients r where r.campaign_id=${campaign.id} and r.status='queued'
      and (r.kind='test' or ${campaign.status}='sending') order by r.kind desc,r.created_at,r.id limit 1 for update`)
    if (!recipient) {
      if (campaign.status === 'sending') await tx.execute(sql`update mailing_campaigns set status='completed' where id=${campaign.id}`)
      return null
    }
    await tx.execute(sql`update mailing_recipients set status='sending',claimed_at=now() where id=${recipient.id}::uuid`)
    await tx.execute(sql`update mailing_campaigns set next_send_at=now()+interval '10 seconds' where id=${campaign.id}`)
    return { ...recipient, content_hash: campaign.content_hash } as unknown as Recipient
  })
}

export async function deliverMailingRecipient(db: Database, config: AppConfig, recipient: Recipient, content: MailingContent, sender: Pick<MailingSender, 'send'>) {
  if (recipient.content_hash !== content.hash) {
    await db.execute(sql`update mailing_recipients set status='failed',error_code='CONTENT_CHANGED',finished_at=now() where id=${recipient.id}::uuid`)
    await db.execute(sql`update mailing_campaigns set status='paused',last_error='CONTENT_CHANGED' where id=${CAMPAIGN_ID}`)
    return
  }
  const allowed = await db.execute(sql`select 1 from "user" u left join player_profiles p on p.user_id=u.id
    where u.id=${recipient.user_id}::uuid and lower(trim(u.email))=${recipient.email} and ${eligible}
    and not exists(select 1 from mailing_suppressions where email_hash=${recipient.email_hash})`)
  if (!allowed.length) {
    await db.execute(sql`update mailing_recipients set status='suppressed',error_code='NO_LONGER_ELIGIBLE',finished_at=now() where id=${recipient.id}::uuid`)
    return
  }
  let outcome: { status: string; code: string | null; pause: boolean } = { status: 'accepted', code: null, pause: false }
  try { await sender.send(content, recipient, unsubscribeUrl(config, recipient.id, recipient.email_hash)) }
  catch (error) { outcome = classifyMailingError(error) }
  // If persistence fails after acceptance, the row stays 'sending', later becomes 'unknown', and is never resent.
  await db.transaction(async tx => {
    await tx.execute(sql`update mailing_recipients set status=${outcome.status},error_code=${outcome.code},finished_at=now() where id=${recipient.id}::uuid and status='sending'`)
    if (outcome.pause) await tx.execute(sql`update mailing_campaigns set status='paused',last_error=${outcome.code} where id=${CAMPAIGN_ID}`)
  })
}

export async function runMailingWorker(db: Database, config: AppConfig, signal: AbortSignal) {
  if (!config.smtp.host || !config.smtp.from) return
  let sender: MailingSender | undefined
  let content: MailingContent | undefined
  try {
    while (!signal.aborted) {
      try {
        // Content and transport must be ready before any row is claimed.
        content ??= await loadMailingContent()
        sender ??= createMailingSender(config)
        const recipient = await claimMailingRecipient(db)
        if (recipient) await deliverMailingRecipient(db, config, recipient, content, sender)
      } catch { console.error('[mailings] Worker iteration failed; no automatic recipient retry') }
      await new Promise<void>(resolve => {
        const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve() }
        const timer = setTimeout(finish, 2_000)
        signal.addEventListener('abort', finish, { once: true })
        if (signal.aborted) finish()
      })
    }
  } finally { sender?.close() }
}
