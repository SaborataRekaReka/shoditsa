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
const modes = new Map((meta.modes ?? []).map((entry) => [entry.mode, entry.count]))
for (const mode of ['movie', 'series', 'anime', 'game', 'music', 'diagnosis']) {
  if (!Number.isInteger(modes.get(mode)) || modes.get(mode) <= 0) throw new Error(`API content mode ${mode} is empty or invalid`)
}

const leakedData = await fetchResponse(`/data/libraries/movies/items.json?smoke=${Date.now()}`)
if (leakedData.status !== 404) throw new Error(`Legacy answer dataset is publicly reachable (HTTP ${leakedData.status})`)

console.log(`Production smoke passed for ${baseUrl} at ${expectedSha}`)
