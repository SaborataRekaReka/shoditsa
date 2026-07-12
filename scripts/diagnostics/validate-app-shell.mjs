import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = process.cwd()
const requiredFiles = [
  'apps/web/src/App.tsx',
  'apps/web/src/api/client.ts',
  'apps/api/src/server.ts',
  'compose.production.yml',
  'infra/nginx/shoditsa.conf.template',
  '.github/workflows/deploy-timeweb.yml',
]

const missingFiles = []
for (const path of requiredFiles) {
  try {
    const entry = await stat(resolve(root, path))
    if (!entry.isFile()) missingFiles.push(path)
  } catch {
    missingFiles.push(path)
  }
}

const sourceChecks = [
  {
    path: 'apps/web/src/App.tsx',
    required: [
      ['profile route', /type AppScreen[^\n]*'profile'/],
      ['profile screen', /function ProfileScreen\s*\(/],
      ['profile header control', /className=\{`header-profile/],
      ['footer component', /function AppFooter\s*\(/],
      ['footer render', /screen !== 'game'\s*&&\s*<AppFooter/],
    ],
  },
  {
    path: 'apps/web/src/api/client.ts',
    required: [
      ['session endpoint', /me:\s*\(\)\s*=>/],
      ['email sign-in', /signIn:\s*\(/],
      ['sign-out', /signOut:\s*\(/],
    ],
  },
  {
    path: '.github/workflows/deploy-timeweb.yml',
    required: [
      ['production web target', /\/opt\/repeto\/deploy\/shoditsa/],
      ['release archive upload', /release-web\.tar\.gz/],
      ['production SHA smoke', /smoke:production/],
      ['API smoke check', /\/api\/v1\/meta/],
    ],
  },
]

const failedChecks = []
for (const check of sourceChecks) {
  let source = ''
  try {
    source = await readFile(resolve(root, check.path), 'utf8')
  } catch {
    continue
  }
  for (const [label, pattern] of check.required) {
    if (!pattern.test(source)) failedChecks.push(`${check.path}: ${label}`)
  }
}

if (missingFiles.length || failedChecks.length) {
  console.error('[app-shell] Critical production capabilities are missing.')
  for (const path of missingFiles) console.error(`  missing file: ${path}`)
  for (const check of failedChecks) console.error(`  missing invariant: ${check}`)
  console.error('[app-shell] Refuse to build or deploy an incomplete frontend snapshot.')
  process.exit(1)
}

console.log('[app-shell] profile, footer, API and production deployment invariants: ok')
