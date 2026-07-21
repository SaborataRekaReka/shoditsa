import { readFile, readdir, stat } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const root = process.cwd()
const requiredFiles = [
  'apps/web/src/App.tsx',
  'apps/web/src/app/router.tsx',
  'apps/web/src/app/routes.ts',
  'apps/web/src/app/mode-presentation.ts',
  'apps/web/src/app/public-asset.ts',
  'apps/web/src/app/seo-content.ts',
  'apps/web/src/app/seo.ts',
  'apps/web/src/components/seo-content/SeoContent.tsx',
  'scripts/seo/generate-static-pages.ts',
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
    path: 'apps/web/src/App.tsx',
    required: [
      ['committed screen scroll reset', /useLayoutEffect\(\(\) => \{[^]*window\.scrollTo\(\{ top: 0, left: 0 \}\)[^]*\}, \[routeLocation\.pathname, screen\]\)/],
      ['admission-ticket guide integration', /<GameArtifactSeoDetails\s+mode=\{mode\}\s*\/>/],
      ['concert-ticket guide integration', /<GameArtifactSeoDetails\s+mode="music"\s*\/>/],
      ['medical-chart guide integration', /<GameArtifactSeoDetails\s+mode="diagnosis"\s*\/>/],
      ['home guide integrated with hero ticket', /hub-hero-ticket[^]*<DailyProgressStub[^]*<HomeSeoContent/],
    ],
  },
  {
    path: 'apps/web/index.html',
    required: [
      ['route-stable document base', /<base\s+href="%BASE_URL%"\s*\/>/],
      ['Yandex site verification', /<meta\s+name="yandex-verification"\s+content="ed7c785c08886924"\s*\/>/],
      ['Google site verification', /<meta\s+name="google-site-verification"\s+content="GGoM_1EOCbLZl1NAn86xUKod7pSnZJGzgmXFLGjJ2Xo"\s*\/>/],
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
      ['SEO updates after SPA navigation', /useEffect\(\(\)\s*=>\s*applyRuntimeSeo\(pathname\)/],
    ],
  },
  {
    path: 'apps/web/src/app/seo-content.ts',
    required: [
      ['exhaustive game SEO registry', /satisfies\s+Record<SeoGameMode,\s*GameSeoContent>/],
      ['exhaustive game guide presentation', /satisfies\s+Record<SeoGameMode,\s*GameGuidePresentation>/],
      ['manifest-derived indexable games', /DAILY_MODE_IDS\.map\(\(mode\)\s*=>\s*GAME_SEO\[mode\]\)/],
    ],
  },
  {
    path: 'apps/web/src/components/seo-content/SeoContent.tsx',
    required: [
      ['native SEO disclosure', /<details\s+className="hub-guide">/],
      ['HTML-resident game copy', /content\.paragraphs\.map/],
      ['useful nested FAQ disclosure', /ticket-dossier__faq[^]*content\.faq\.map/],
      ['manifest-driven game guide icons', /satisfies\s+Record<PlayableModeId,\s*LucideIcon>/],
      ['shared native artifact disclosure', /function GameArtifactSeoDetails[^]*artifact-dossier ticket-dossier/],
      ['compact nested long-form disclosure', /ticket-dossier__more[^]*content\.paragraphs\.map/],
      ['presentation-driven artifact language', /GAME_GUIDE_PRESENTATION\[mode\]/],
    ],
  },
  {
    path: 'apps/web/src/app/seo.ts',
    required: [
      ['indexable game route resolver', /gameSeoFromPathname\(normalized\)/],
      ['breadcrumb structured data', /'@type':\s*'BreadcrumbList'/],
      ['free web application structured data', /isAccessibleForFree:\s*true/],
    ],
  },
  {
    path: 'apps/web/src/components/category-ticket/CategoryTicket.tsx',
    required: [
      ['crawlable game link', /<a\s+href=\{href\}/],
    ],
  },
  {
    path: 'apps/web/src/components/game-launch-controls/GameLaunchControls.tsx',
    required: [
      ['shared upper launch controls', /function GameLaunchControls[^]*game-launch-controls__action[^]*game-launch-controls__option/],
      ['shared accessible option selector', /function GameOptionSelect[^]*role="listbox"/],
      ['shared accessible option item', /function GameOption[^]*role="option"/],
    ],
  },
  {
    path: 'apps/web/src/components/game-launch-controls/GameLaunchControls.css',
    required: [
      ['wrapping launch controls', /game-launch-controls[^}]*flex-wrap:\s*wrap/],
      ['minimum action width before wrapping', /game-launch-controls__action[^}]*min-width:\s*min\(220px,\s*100%\)/],
      ['viewport-safe mobile option menu', /game-launch-controls__option \.game-option-menu[^}]*width:\s*min\(280px,\s*100%\)/],
    ],
  },
  {
    path: 'apps/web/src/components/mode-variant/ModeVariantControl.tsx',
    required: [
      ['manifest-driven mode variants', /GAME_MODE_MANIFEST\[mode\]\.variants/],
      ['compact variant trigger', /triggerClassName="mode-variant-trigger"/],
      ['shared variant selector', /<GameOptionSelect/],
    ],
  },
  {
    path: 'scripts/seo/generate-static-pages.ts',
    required: [
      ['static game HTML generation', /'seo',\s*'games',\s*`\$\{game\.mode\}\.html`/],
      ['registry-driven sitemap generation', /INDEXABLE_GAME_SEO/],
      ['server-rendered shared artifact disclosure', /renderArtifactDossier[^]*artifact-dossier ticket-dossier/],
      ['server-rendered upper launch controls', /renderLaunchControls[^]*game-launch-controls/],
      ['server-rendered home hero guide', /renderHomeFallback[^]*hub-hero-ticket[^]*hub-guide/],
      ['server-rendered thematic artifact shells', /renderGameArtifactFallback[^]*renderAdmissionTicketFallback/],
    ],
  },
  {
    path: 'packages/contracts/src/game-modes.ts',
    required: [
      ['canonical content modes', /CONTENT_MODE_IDS\s*=\s*\[[^\]]*'danetki'[^\]]*\]\s*as const/],
      ['canonical playable modes', /PLAYABLE_MODE_IDS\s*=\s*\[[^\]]*'movie'[^\]]*'series'[^\]]*'anime'[^\]]*'game'[^\]]*'music'[^\]]*'diagnosis'[^\]]*'city'[^\]]*\]\s*as const/],
      ['city manifest entry', /city:\s*\{/],
      ['separate danetki engine', /danetki:\s*\{[^}]*engine:\s*'danetki_chat'/],
      ['manifest-derived daily order', /DAILY_MODE_IDS\s*=\s*PLAYABLE_MODE_IDS/],
    ],
  },
  {
    path: 'apps/web/src/components/app-shell/AppShell.tsx',
    required: [
      ['profile header control', /className=\{`header-profile/],
      ['footer component', /function AppFooter\s*\(/],
      ['current economy view', /<EconomyView\s*\/>/],
      ['shared back and Escape control', /function ScreenBack[^]*event\.key !== 'Escape'[^]*screen-back-row/],
    ],
  },
  {
    path: 'apps/web/src/features/danetki/DanetkiEntryPages.tsx',
    required: [
      ['shared invite shell', /function DanetkiJoinPage[^]*<AppHeader[^]*<ScreenBack/],
      ['shared invite action', /danetki-join-card[^]*<ActionButton[^]*type="submit"/],
    ],
  },
  {
    path: 'apps/web/src/features/commerce/SpecialsScreen.tsx',
    required: [
      ['shared specials back control', /function SpecialsScreen[^]*<ScreenBack/],
    ],
  },
  {
    path: 'apps/web/src/features/private-games/CreateGameScreen.tsx',
    required: [
      ['shared corporate back control', /function CreateGameScreen[^]*<ScreenBack/],
      ['shared corporate actions', /ui-button ui-button--primary corporate-hero__action[^]*<ActionButton[^]*type="submit"/],
    ],
  },
  {
    path: 'infra/nginx/shoditsa.conf.template',
    required: [
      ['route-specific game HTML', /try_files\s+\/seo\$uri\.html\s+=404/],
      ['danetki refresh route', /location\s+~\s+\^\/games\/\([^)]*danetki[^)]*\)\$/],
      ['private route noindex header', /X-Robots-Tag\s+"noindex, follow, noarchive"/],
      ['invalid game route 404', /location\s+\/games\/\s*\{[^}]*return\s+404/s],
      ['legacy city dataset 404', /location\s+\^~\s+\/city-content\/\s*\{[^}]*return\s+404/s],
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
      ['isolated incoming release uploads', /REMOTE_UPLOAD_DIR="\$\{DEPLOY_ROOT\}\/incoming"/],
      ['failed upload cleanup', /trap cleanup_uploads EXIT/],
      ['staged atomic activation', /releases\/\.stage-\$\{GITHUB_SHA\}/],
      ['atomic current symlink', /current\.next["']?\s+"?\$\{DEPLOY_ROOT\}\/current/],
      ['automated database backup retention', /name 'pre-deploy-\*\.dump'[^]*tail -n \+11/],
      ['production SHA smoke', /smoke:production/],
      ['API smoke check', /\/api\/v1\/meta/],
      ['three API image consumers', /Expected exactly three Shoditsa API image declarations \(API, worker, migrate\)/],
      ['worker recreated with API', /--force-recreate "\$API_COMPOSE_SERVICE" "\$API_WORKER_SERVICE"/],
      ['Docker proxy refreshed after API recreation', /refresh_docker_nginx\(\)[^]*docker restart[^]*if ! refresh_docker_nginx/],
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
  resolve(root, 'apps/web/src/app/seo-content.ts'),
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
