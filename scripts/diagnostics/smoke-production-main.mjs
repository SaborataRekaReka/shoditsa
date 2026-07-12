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

console.log(`Production smoke passed for ${baseUrl} at ${expectedSha}`)
