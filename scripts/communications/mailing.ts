import { loadConfig } from '@shoditsa/config'
import { createDatabase } from '@shoditsa/database'
import { sql } from 'drizzle-orm'
import { mailingOverview, queueMailing } from '../../apps/api/src/modules/mailings/service.js'
import { createMailingSender, loadMailingContent } from '../../apps/api/src/modules/mailings/content.js'

// Operational entry point for the same service used by the protected website console.
const config = loadConfig()
const database = createDatabase(config)
try {
  const action = process.argv[2] ?? 'status'
  if (action === 'verify') {
    await loadMailingContent()
    const sender = createMailingSender(config)
    try { await sender.verify(); console.log(JSON.stringify({ contentValid: true, smtpReady: true })) } finally { sender.close() }
  } else if (action === 'status') console.log(JSON.stringify(await mailingOverview(database.db)))
  else {
    if (!['start', 'pause', 'test'].includes(action)) throw new Error('Expected status, verify, test, start or pause')
    const [actor] = await database.db.execute(sql`select u.id,u.email from "user" u join player_profiles p on p.user_id=u.id where p.role='admin' and lower(u.email)='breneize@yandex.ru'`)
    if (!actor || !config.adminUserIds.includes(String(actor.id))) throw new Error('Configured administrator not found')
    console.log(JSON.stringify(await queueMailing(database.db, config, { id: String(actor.id), email: String(actor.email) }, action as 'start' | 'pause' | 'test', process.env.MAILING_CONSENT_SOURCE ?? '')))
  }
} finally { await database.client.end() }
