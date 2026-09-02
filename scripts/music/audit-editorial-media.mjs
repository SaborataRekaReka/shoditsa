import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const source = JSON.parse(await readFile(resolve('data/music-editorial/music-artists-enriched.v0.2.0.json'), 'utf8'))
const overrides = JSON.parse(await readFile(resolve('data/music-editorial/overrides.json'), 'utf8'))
const target = resolve('var/music-catalog-migration/media-audit.json')
const previous = await readFile(target, 'utf8').then(JSON.parse).catch((error) => {
  if (error.code !== 'ENOENT') throw error
  return { results: [] }
})
const known = new Map(previous.results.map((entry) => [entry.url, entry]))
const allowedHosts = new Set(['i.scdn.co', 'commons.wikimedia.org', 'upload.wikimedia.org', 'cdn-images.dzcdn.net', 'r2.theaudiodb.com', 'e-cdns-images.dzcdn.net', 'e-cdn-images.dzcdn.net', 'static.tildacdn.com'])
const results = []
let next = 0
const audit = async (artist) => {
  const url = overrides[artist.id]?.posterUrl ?? artist.image_url
  const cached = known.get(url)
  if (cached?.ok) return { ...cached, id: artist.id, name: artist.name }
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || !allowedHosts.has(parsed.hostname)) throw new Error(`Unexpected media host for ${artist.id}: ${parsed.hostname}`)
  let result
  try {
    const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'Shoditsa-Catalog-Media-Check/1.0 (https://shoditsa.ru)' } })
    const contentType = response.headers.get('content-type') ?? ''
    result = { id: artist.id, name: artist.name, url, resolvedUrl: response.url, status: response.status, contentType, ok: response.ok && contentType.startsWith('image/'), checkedAt: new Date().toISOString() }
  } catch (error) {
    result = { id: artist.id, name: artist.name, url, ok: false, error: error.message, checkedAt: new Date().toISOString() }
  }
  return result
}
await mkdir(dirname(target), { recursive: true })
await Promise.all(Array.from({ length: 1 }, async () => {
  while (next < source.artists.length) {
    const artist = source.artists[next++]
    results.push(await audit(artist))
    if (!known.get(overrides[artist.id]?.posterUrl ?? artist.image_url)?.ok) await new Promise((done) => setTimeout(done, 900))
    if (results.length % 40 === 0) {
      await writeFile(target, `${JSON.stringify({ results }, null, 2)}\n`, 'utf8')
      console.log(JSON.stringify({ checked: results.length, total: source.artists.length, failed: results.filter((entry) => !entry.ok).length }))
    }
  }
}))
results.sort((left, right) => left.id.localeCompare(right.id))
await writeFile(target, `${JSON.stringify({ results }, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ checked: results.length, ok: results.filter((entry) => entry.ok).length, failed: results.filter((entry) => !entry.ok), report: target }, null, 2))
