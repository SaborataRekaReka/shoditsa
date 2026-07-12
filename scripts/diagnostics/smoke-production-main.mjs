const baseUrl = (process.argv[2] || process.env.PRODUCTION_URL || 'https://shoditsa.ru').replace(/\/$/, '')
const expectedSha = process.env.EXPECTED_SHA
if (!expectedSha) throw new Error('EXPECTED_SHA is required to prove production matches main')

const fetchText = async (path) => {
  const response = await fetch(`${baseUrl}${path}`, { headers: { 'cache-control': 'no-cache' } })
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`)
  return response.text()
}

const html = await fetchText(`/?smoke=${Date.now()}`)
if (!html.includes('<script src="/sdk.js"></script>')) throw new Error('Production HTML does not include /sdk.js')
const manifest = JSON.parse(await fetchText(`/build-manifest.json?smoke=${Date.now()}`))
if (manifest.commitSha !== expectedSha) throw new Error(`Production SHA ${manifest.commitSha} does not match expected main SHA ${expectedSha}`)
for (const marker of ['profile', 'footer', 'yandexSdk']) {
  if (manifest.shell?.[marker] !== true) throw new Error(`Build manifest is missing shell marker: ${marker}`)
}

for (const library of ['movies', 'series', 'animes', 'games', 'music', 'diagnoses']) {
  const items = JSON.parse(await fetchText(`/data/libraries/${library}/items.json?smoke=${Date.now()}`))
  if (!Array.isArray(items) || items.length === 0) throw new Error(`Production library ${library} is empty or invalid`)

  const searchIndex = JSON.parse(await fetchText(`/data/libraries/${library}/search-index.json?smoke=${Date.now()}`))
  if (!searchIndex || typeof searchIndex.tokenToIds !== 'object') throw new Error(`Production search index ${library} is invalid`)
}

console.log(`Production smoke passed for ${baseUrl} at ${expectedSha}`)
