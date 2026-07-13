import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from '@shoditsa/config'
import { createDatabase } from './client.js'

const config = loadConfig()
const { db, client } = createDatabase(config)
const migrationCandidates = [
  resolve(process.cwd(), 'packages/database/migrations'),
  fileURLToPath(new URL('../migrations', import.meta.url)),
]
const migrationsFolder = migrationCandidates.find((candidate) => existsSync(resolve(candidate, 'meta/_journal.json')))
if (!migrationsFolder) throw new Error(`Database migrations not found in: ${migrationCandidates.join(', ')}`)
try {
  await migrate(db, { migrationsFolder })
  console.log('Database migrations applied')
} finally {
  await client.end()
}
