import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { fileURLToPath } from 'node:url'
import { loadConfig } from '@shoditsa/config'
import { createDatabase } from './client.js'

const config = loadConfig()
const { db, client } = createDatabase(config)
try {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) })
  console.log('Database migrations applied')
} finally {
  await client.end()
}
