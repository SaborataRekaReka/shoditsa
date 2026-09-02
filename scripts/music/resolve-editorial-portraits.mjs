import { readFile, writeFile } from 'node:fs/promises'

const source = JSON.parse(await readFile('data/music-editorial/music-artists-enriched.v0.2.0.json', 'utf8'))
const results = []
for (const artist of source.artists.filter((entry) => entry.image_url.includes('ab67616d'))) {
  const apiUrl = `https://api.deezer.com/search/artist?q=${encodeURIComponent(artist.name)}&limit=5`
  try {
    const response = await fetch(apiUrl, { signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const payload = await response.json()
    results.push({ sourceId: artist.id, name: artist.name, apiUrl, candidates: (payload.data ?? []).map((candidate) => ({ id: candidate.id, name: candidate.name, link: candidate.link, portrait: candidate.picture_big, pictureXl: candidate.picture_xl })) })
  } catch (error) {
    results.push({ sourceId: artist.id, name: artist.name, apiUrl, error: error.message })
  }
}
await writeFile('var/music-catalog-migration/portrait-candidates.json', `${JSON.stringify(results, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(results, null, 2))
