const baseUrl = (process.argv[2] || process.env.PRODUCTION_URL || 'https://shoditsa.ru').replace(/\/$/, '')
const expectedSha = process.env.EXPECTED_SHA
if (!expectedSha) throw new Error('EXPECTED_SHA is required to prove production matches main')

const fetchText = async (path) => {
  const response = await fetch(`${baseUrl}${path}`, { headers: { 'cache-control': 'no-cache' } })
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`)
  return response.text()
}

const fetchResponse = (path) => fetch(`${baseUrl}${path}`, { headers: { 'cache-control': 'no-cache' }, redirect: 'manual' })

const manifest = JSON.parse(await fetchText(`/build-manifest.json?smoke=${Date.now()}`))
if (manifest.commitSha !== expectedSha) throw new Error(`Production SHA ${manifest.commitSha} does not match expected main SHA ${expectedSha}`)
for (const marker of ['profile', 'footer', 'typedRoutes', 'canonicalModeManifest', 'serverAuthoritative', 'noPublicAnswerData', 'seoStaticRoutes']) {
  if (manifest.shell?.[marker] !== true) throw new Error(`Build manifest is missing shell marker: ${marker}`)
}

const html = await fetchText(`/?smoke=${Date.now()}`)
if (html.includes('<script src="/sdk.js"></script>')) throw new Error('Server production HTML unexpectedly loads the Yandex Games SDK')
if (!html.includes(`<meta name="shoditsa-build-sha" content="${expectedSha}">`)) {
  throw new Error('Production HTML build marker does not match expected main SHA')
}

const sitemap = await fetchText(`/sitemap.xml?smoke=${Date.now()}`)
if (!sitemap.includes(`<loc>${baseUrl}/</loc>`)) throw new Error('Sitemap is missing the canonical home page')
for (const mode of [...manifest.playableModes, 'danetki']) {
  const pathname = `/games/${mode}`
  if (!sitemap.includes(`<loc>${baseUrl}${pathname}</loc>`)) throw new Error(`Sitemap is missing ${pathname}`)
  const page = await fetch(`${baseUrl}${pathname}?smoke=${Date.now()}`, { headers: { 'cache-control': 'no-cache' } })
  if (!page.ok) throw new Error(`${pathname} returned HTTP ${page.status}`)
  const pageHtml = await page.text()
  if (!pageHtml.includes(`<link rel="canonical" href="${baseUrl}${pathname}"`)) throw new Error(`${pathname} has no matching canonical URL`)
  if (!pageHtml.includes('name="robots" content="index,follow')) throw new Error(`${pathname} is not indexable in server HTML`)
  if (!pageHtml.includes('type="application/ld+json"') || !pageHtml.includes('BreadcrumbList')) throw new Error(`${pathname} has no game structured data`)
  if (!pageHtml.includes('<h1')) throw new Error(`${pathname} has no server-rendered heading`)
  const hasSeoDisclosure = pageHtml.includes('artifact-dossier ticket-dossier')
    && pageHtml.includes('class="ticket-dossier__drawer"')
  if (!hasSeoDisclosure) throw new Error(`${pathname} has no server-rendered SEO disclosure content`)
  if (!pageHtml.includes(`<meta name="shoditsa-build-sha" content="${expectedSha}">`)) throw new Error(`${pathname} build marker does not match main`)
}

const invalidGame = await fetchResponse(`/games/not-a-mode?smoke=${Date.now()}`)
if (invalidGame.status !== 404) throw new Error(`Unknown game route returned HTTP ${invalidGame.status} instead of 404`)
const profileResponse = await fetchResponse(`/profile?smoke=${Date.now()}`)
if (!String(profileResponse.headers.get('x-robots-tag')).includes('noindex')) throw new Error('Private profile route is missing X-Robots-Tag: noindex')

const meta = JSON.parse(await fetchText(`/api/v1/meta?smoke=${Date.now()}`))
if (meta.buildSha !== expectedSha) throw new Error(`Production API SHA ${meta.buildSha ?? 'missing'} does not match expected main SHA ${expectedSha}`)
if (meta.auth?.yandex !== true) throw new Error('Production API does not advertise Yandex OAuth')
const modes = new Map((meta.modes ?? []).map((entry) => [entry.mode, entry.count]))
if (!Array.isArray(manifest.playableModes) || !manifest.playableModes.length) throw new Error('Build manifest does not expose canonical playable modes')
for (const mode of manifest.playableModes) {
  if (!Number.isInteger(modes.get(mode)) || modes.get(mode) <= 0) throw new Error(`API content mode ${mode} is empty or invalid`)
}
if (meta.features?.danetkiEnabled && (!Number.isInteger(modes.get('danetki')) || modes.get('danetki') <= 0)) throw new Error('API danetki content mode is empty or invalid')

const leakedData = await fetchResponse(`/data/libraries/movies/items.json?smoke=${Date.now()}`)
if (leakedData.status !== 404) throw new Error(`Legacy answer dataset is publicly reachable (HTTP ${leakedData.status})`)
const leakedCityData = await fetchResponse(`/city-content/cities.json?smoke=${Date.now()}`)
if (leakedCityData.status !== 404) throw new Error(`Legacy city answer dataset is publicly reachable (HTTP ${leakedCityData.status})`)

const oauthResponse = await fetch(`${baseUrl}/api/auth/sign-in/oauth2`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ providerId: 'yandex', callbackURL: `${baseUrl}/login`, disableRedirect: true }),
})
if (!oauthResponse.ok) throw new Error(`Yandex OAuth start returned HTTP ${oauthResponse.status}`)
const oauthPayload = await oauthResponse.json()
const oauthUrl = new URL(oauthPayload.url)
if (oauthUrl.protocol !== 'https:' || !oauthUrl.hostname.startsWith('oauth.yandex.')) throw new Error('Yandex OAuth start returned an invalid authorization URL')
if (oauthUrl.searchParams.get('redirect_uri') !== `${baseUrl}/api/auth/oauth2/callback/yandex`) throw new Error('Yandex OAuth callback URL is invalid')

console.log(`Production smoke passed for ${baseUrl} at ${expectedSha}`)
