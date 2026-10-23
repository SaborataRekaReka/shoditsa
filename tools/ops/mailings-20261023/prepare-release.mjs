import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const source = resolve(process.cwd())
const target = resolve(process.argv[2] ?? '')
const base = 'e17223ff13db7ce22719030c3aae517066471742'
if (target === source || !target.includes('site-mailings')) throw new Error('Pass the isolated managed release worktree')
const git = (...args) => execFileSync('git', ['-C', target, ...args], { encoding: 'utf8' }).trim()
if (git('rev-parse', 'HEAD') !== base || git('status', '--porcelain')) throw new Error('Expected a clean checkout of current production')
const copy = path => { mkdirSync(join(target, path, '..'), { recursive: true }); cpSync(join(source, path), join(target, path), { recursive: true }) }
for (const path of ['apps/api/src/modules/mailings', 'apps/api/test/mailings.test.ts', 'scripts/communications/mailing.ts', 'docs/communications/autumn-2026', 'packages/database/migrations/0057_mailings.sql', 'packages/database/migrations/meta/0057_snapshot.json', '.dockerignore', 'infra/docker/Dockerfile.api']) copy(path)
const edit = (path, before, after) => {
  const file = join(target, path), text = readFileSync(file, 'utf8')
  if (!text.includes(before)) throw new Error(`Base context changed: ${path}`)
  writeFileSync(file, text.replace(before, after))
}
edit('apps/api/src/app.ts', "import { registerSupportRoutes } from './modules/support/routes.js'", "import { registerSupportRoutes } from './modules/support/routes.js'\nimport { registerMailingRoutes } from './modules/mailings/routes.js'")
edit('apps/api/src/app.ts', '  registerSupportRoutes(app, config)', '  registerSupportRoutes(app, config)\n  registerMailingRoutes(app, { db, config, auth })')
edit('apps/api/src/worker.ts', "import { runContentRetention, runGameLifecycleCleanup } from './modules/maintenance/service.js'", "import { runContentRetention, runGameLifecycleCleanup } from './modules/maintenance/service.js'\nimport { runMailingWorker } from './modules/mailings/service.js'")
const currentWorker = readFileSync(join(source, 'apps/api/src/worker.ts'), 'utf8')
const workerPath = join(target, 'apps/api/src/worker.ts'), worker = readFileSync(workerPath, 'utf8')
const offset = worker.indexOf("for (const signal of ['SIGINT', 'SIGTERM']")
if (offset < 0) throw new Error('Worker shutdown context not found')
writeFileSync(workerPath, worker.slice(0, offset) + currentWorker.slice(currentWorker.indexOf('const mailingAbort = new AbortController()')))
edit('tsup.config.ts', "    'admin-bootstrap': 'scripts/admin/bootstrap.ts',", "    'admin-bootstrap': 'scripts/admin/bootstrap.ts',\n    'mailing': 'scripts/communications/mailing.ts',")
const sourceSchema = readFileSync(join(source, 'packages/database/src/schema.ts'), 'utf8')
const schemaPath = join(target, 'packages/database/src/schema.ts')
writeFileSync(schemaPath, readFileSync(schemaPath, 'utf8') + '\n' + sourceSchema.slice(sourceSchema.indexOf('export const mailingCampaigns =')))
const journalPath = 'packages/database/migrations/meta/_journal.json'
const journal = JSON.parse(readFileSync(join(target, journalPath), 'utf8'))
const newEntry = JSON.parse(readFileSync(join(source, journalPath), 'utf8')).entries.at(-1)
if (journal.entries.at(-1).idx !== 56 || newEntry.idx !== 57) throw new Error('Migration chain changed')
journal.entries.push(newEntry)
writeFileSync(join(target, journalPath), JSON.stringify(journal, null, 2) + '\n')
console.log(git('diff', '--stat'))
