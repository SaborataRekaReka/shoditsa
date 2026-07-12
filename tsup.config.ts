import { defineConfig } from 'tsup'
export default defineConfig({
  entry: { server: 'apps/api/src/server.ts', migrate: 'packages/database/src/migrate.ts' },
  format: ['esm'], platform: 'node', target: 'node24', outDir: 'apps/api/dist', clean: true,
})
