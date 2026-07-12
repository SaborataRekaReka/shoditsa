import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import type { AppConfig } from '@shoditsa/config'
import * as schema from './schema.js'

export const createDatabase = (config: Pick<AppConfig, 'databaseUrl' | 'databasePoolMax'>) => {
  const client = postgres(config.databaseUrl, {
    max: config.databasePoolMax,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  })
  return { client, db: drizzle(client, { schema }) }
}

export type Database = ReturnType<typeof createDatabase>['db']
