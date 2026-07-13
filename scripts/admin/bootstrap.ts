import 'dotenv/config'
import { eq, sql } from 'drizzle-orm'
import { auditLog, createDatabase, playerProfiles, user } from '@shoditsa/database'

const emailArg = process.argv.find((value) => value.startsWith('--email='))?.slice('--email='.length)
  ?? process.argv[process.argv.indexOf('--email') + 1]
const email = String(emailArg ?? '').trim().toLocaleLowerCase('en-US')
if (email !== 'breneize@yandex.ru') throw new Error('Bootstrap разрешён только для breneize@yandex.ru')

const databaseUrl = process.env.DATABASE_URL?.trim()
if (!databaseUrl) throw new Error('DATABASE_URL is required')
const database = createDatabase({ databaseUrl, databasePoolMax: Number(process.env.DATABASE_POOL_MAX || 2) })

try {
  const matches = await database.db.select({ id: user.id, email: user.email }).from(user)
    .where(sql`lower(trim(${user.email})) = ${email}`).limit(2)
  if (matches.length === 0) throw new Error(`Пользователь ${email} не найден`)
  if (matches.length > 1) throw new Error(`Найдено несколько пользователей ${email}; bootstrap остановлен`)
  const adminId = matches[0].id
  const previous = await database.db.select().from(playerProfiles).where(eq(playerProfiles.userId, adminId)).limit(1)
  await database.db.insert(playerProfiles).values({ userId: adminId, role: 'admin' })
    .onConflictDoUpdate({ target: playerProfiles.userId, set: { role: 'admin', updatedAt: new Date() } })
  await database.db.insert(auditLog).values({
    actorUserId: adminId,
    action: 'admin.bootstrap',
    entityType: 'user',
    entityId: adminId,
    before: previous[0] ?? null,
    after: { role: 'admin', email },
    reason: 'one-time bootstrap',
    requestId: `bootstrap:${crypto.randomUUID()}`,
  })
  console.log(`ADMIN_USER_ID=${adminId}`)
  console.log('Добавьте этот UUID как единственное значение ADMIN_USER_IDS.')
} finally {
  await database.client.end()
}
