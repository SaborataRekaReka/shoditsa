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
for (const marker of ['profile', 'footer', 'serverAuthoritative', 'noPublicAnswerData']) {
  if (manifest.shell?.[marker] !== true) throw new Error(`Build manifest is missing shell marker: ${marker}`)
}

const html = await fetchText(`/?smoke=${Date.now()}`)
if (html.includes('<script src="/sdk.js"></script>')) throw new Error('Server production HTML unexpectedly loads the Yandex Games SDK')

const meta = JSON.parse(await fetchText(`/api/v1/meta?smoke=${Date.now()}`))
if (meta.buildSha !== expectedSha) throw new Error(`Production API SHA ${meta.buildSha ?? 'missing'} does not match expected main SHA ${expectedSha}`)
if (meta.auth?.yandex !== true) throw new Error('Production API does not advertise Yandex OAuth')
const modes = new Map((meta.modes ?? []).map((entry) => [entry.mode, entry.count]))
for (const mode of ['movie', 'series', 'anime', 'game', 'music', 'diagnosis']) {
  if (!Number.isInteger(modes.get(mode)) || modes.get(mode) <= 0) throw new Error(`API content mode ${mode} is empty or invalid`)
}

const leakedData = await fetchResponse(`/data/libraries/movies/items.json?smoke=${Date.now()}`)
if (leakedData.status !== 404) throw new Error(`Legacy answer dataset is publicly reachable (HTTP ${leakedData.status})`)

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
