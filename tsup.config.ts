import { defineConfig } from 'tsup'
export default defineConfig({
  entry: {
    server: 'apps/api/src/server.ts',
    worker: 'apps/api/src/worker.ts',
    migrate: 'packages/database/src/migrate.ts',
    'admin-bootstrap': 'scripts/admin/bootstrap.ts',
    'content-migrate-media': 'scripts/content/migrate-media.ts',
    'city-hints': 'scripts/cities/operate-city-hints.ts',
    'city-facts': 'scripts/cities/operate-city-facts.ts',
  },
  format: ['esm'], platform: 'node', target: 'node24', outDir: 'apps/api/dist', clean: true,
})
