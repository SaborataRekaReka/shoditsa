import { readFile, readdir, stat } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const root = process.cwd()
const requiredFiles = [
  'apps/web/src/App.tsx',
  'apps/web/src/app/router.tsx',
  'apps/web/src/app/routes.ts',
  'apps/web/src/app/mode-presentation.ts',
  'apps/web/src/app/public-asset.ts',
  'packages/contracts/src/game-modes.ts',
  'apps/web/src/components/app-shell/AppShell.tsx',
  'apps/web/src/features/economy/EconomyView.tsx',
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
    path: 'apps/web/index.html',
    required: [
      ['route-stable document base', /<base\s+href="%BASE_URL%"\s*\/>/],
    ],
  },
  {
    path: 'apps/web/src/app/public-asset.ts',
    required: [
      ['deployment-aware public asset URL', /import\.meta\.env\.BASE_URL/],
    ],
  },
  {
    path: 'apps/web/src/app/router.tsx',
    required: [
      ['typed game route', /path:\s*'games\/\$mode'/],
      ['typed session route', /path:\s*'sessions\/\$sessionId'/],
      ['autonomous hash history', /createHashHistory\(\)/],
    ],
  },
  {
    path: 'packages/contracts/src/game-modes.ts',
    required: [
      ['canonical playable modes', /PLAYABLE_MODE_IDS\s*=\s*CONTENT_MODE_IDS/],
      ['city manifest entry', /city:\s*\{/],
      ['manifest-derived daily order', /DAILY_MODE_IDS\s*=\s*PLAYABLE_MODE_IDS/],
    ],
  },
  {
    path: 'apps/web/src/components/app-shell/AppShell.tsx',
    required: [
      ['profile header control', /className=\{`header-profile/],
      ['footer component', /function AppFooter\s*\(/],
      ['current economy view', /<EconomyView\s*\/>/],
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
      ['immutable release root', /DEPLOY_ROOT:\s*\/opt\/shoditsa/],
      ['release archive upload', /release-web\.tar\.gz/],
      ['staged atomic activation', /releases\/\.stage-\$\{GITHUB_SHA\}/],
      ['atomic current symlink', /current\.next["']?\s+"?\$\{DEPLOY_ROOT\}\/current/],
      ['production SHA smoke', /smoke:production/],
      ['API smoke check', /\/api\/v1\/meta/],
      ['three API image consumers', /Expected exactly three Shoditsa API image declarations \(API, worker, migrate\)/],
      ['worker recreated with API', /--force-recreate "\$API_COMPOSE_SERVICE" "\$API_WORKER_SERVICE"/],
      ['worker SHA verification', /API_WORKER_IMAGE[^]*shoditsa-api:\$\{GITHUB_SHA\}/],
    ],
  },
  {
    path: 'scripts/diagnostics/smoke-production-main.mjs',
    required: [
      ['manifest-driven production API modes', /for \(const mode of manifest\.playableModes\)/],
      ['legacy answer data blocked', /Legacy answer dataset is publicly reachable/],
      ['legacy city answer data blocked', /Legacy city answer dataset is publicly reachable/],
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

async function collectSourceFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...await collectSourceFiles(path))
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(path)
  }
  return files
}

const allowedStaticAssetFiles = new Set([
  resolve(root, 'apps/web/src/app/public-asset.ts'),
  resolve(root, 'apps/web/src/app/seo.ts'),
])
for (const path of await collectSourceFiles(resolve(root, 'apps/web/src'))) {
  if (allowedStaticAssetFiles.has(path)) continue
  const source = await readFile(path, 'utf8')
  if (/['"](?:\.\/|\/)images\//.test(source)) {
    failedChecks.push(`${relative(root, path)}: public assets must use publicAssetUrl()`)
  }
}

if (missingFiles.length || failedChecks.length) {
  console.error('[app-shell] Critical production capabilities are missing.')
  for (const path of missingFiles) console.error(`  missing file: ${path}`)
  for (const check of failedChecks) console.error(`  missing invariant: ${check}`)
  console.error('[app-shell] Refuse to build or deploy an incomplete frontend snapshot.')
  process.exit(1)
}

console.log('[app-shell] routes, assets, UI shell, API and production deployment invariants: ok')
