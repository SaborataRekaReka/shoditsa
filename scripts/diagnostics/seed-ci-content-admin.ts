import { loadConfig } from '@shoditsa/config'
import { createDatabase, playerProfiles, user } from '@shoditsa/database'

const CI_CONTENT_ADMIN_ID = '00000000-0000-4000-8000-000000000001'

if (process.env.CI !== 'true') {
  throw new Error('This helper may only run in CI')
}

const { db, client } = createDatabase(loadConfig())
try {
  await db.insert(user).values({
    id: CI_CONTENT_ADMIN_ID,
    name: 'CI Content Admin',
    email: 'content-admin@ci.invalid',
    emailVerified: true,
  }).onConflictDoNothing()
  await db.insert(playerProfiles).values({
    userId: CI_CONTENT_ADMIN_ID,
    role: 'admin',
  }).onConflictDoUpdate({
    target: playerProfiles.userId,
    set: { role: 'admin', updatedAt: new Date() },
  })
  console.log(`CI_CONTENT_ADMIN_ID=${CI_CONTENT_ADMIN_ID}`)
} finally {
  await client.end()
}
