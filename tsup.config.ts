import { defineConfig } from 'tsup'
export default defineConfig({
  entry: {
    server: 'apps/api/src/server.ts',
    worker: 'apps/api/src/worker.ts',
    migrate: 'packages/database/src/migrate.ts',
    'admin-bootstrap': 'scripts/admin/bootstrap.ts',
  },
  format: ['esm'], platform: 'node', target: 'node24', outDir: 'apps/api/dist', clean: true,
})
