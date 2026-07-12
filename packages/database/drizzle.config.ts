import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './packages/database/src/schema.ts',
  out: './packages/database/migrations',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://shoditsa_app:shoditsa_dev@localhost:5434/shoditsa' },
  strict: true,
  verbose: true,
})
