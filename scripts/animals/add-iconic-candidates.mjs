import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const [key, ...rest] = argument.replace(/^--/, '').split('=')
  return [key, rest.length ? rest.join('=') : true]
}))
const inputPath = path.resolve(root, String(args.input || process.env.npm_config_input || 'data/animals/candidates/discovered.json'))
const outputPath = path.resolve(root, String(args.out || process.env.npm_config_out || inputPath))
const namesPath = path.resolve(root, String(args.names || process.env.npm_config_names || 'data/animals/iconic-names-ru.json'))
const cachePath = path.resolve(root, String(args.cache || process.env.npm_config_iconic_cache || '.tmp/animal-pipeline/iconic-search-cache.json'))
const USER_AGENT = 'shoditsa-animal-pipeline/0.1 (+https://shoditsa.ru)'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const chunks = (values, size) => Array.from(
  { length: Math.ceil(values.length / size) },
  (_, index) => values.slice(index * size, index * size + size),
)
const fetchJson = async (url, label) => {
  let lastError
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      })
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`)
        error.retryAfterMs = Number(response.headers.get('retry-after') ?? 0) * 1000
        throw error
      }
      return response.json()
    } catch (error) {
      lastError = error
      if (attempt < 5) await sleep(Math.max(Number(error?.retryAfterMs ?? 0), attempt * 750))
    }
  }
  throw new Error(`${label} failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}
const claimValues = (entity, property) => (entity.claims?.[property] ?? [])
  .map((claim) => claim.mainsnak?.datavalue?.value)
  .filter((value) => value !== undefined)

const discovered = JSON.parse(await readFile(inputPath, 'utf8'))
const names = JSON.parse(await readFile(namesPath, 'utf8'))
let cache = {}
try {
  cache = JSON.parse(await readFile(cachePath, 'utf8'))
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

const unresolvedTitleNames = names.filter((name) => !cache[name])
for (const titleChunk of chunks(unresolvedTitleNames, 20)) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    prop: 'pageprops',
    titles: titleChunk.join('|'),
    ppprop: 'wikibase_item',
    redirects: '1',
    origin: '*',
  })
  const payload = await fetchJson(`https://ru.wikipedia.org/w/api.php?${params}`, 'Wikipedia iconic article IDs')
  const normalized = new Map((payload.query?.normalized ?? []).map((entry) => [entry.from, entry.to]))
  const redirects = new Map((payload.query?.redirects ?? []).map((entry) => [entry.from, entry.to]))
  const pageByTitle = new Map(Object.values(payload.query?.pages ?? {}).map((page) => [page.title, page]))
  for (const name of titleChunk) {
    const normalizedTitle = normalized.get(name) ?? name
    const resolvedTitle = redirects.get(normalizedTitle) ?? normalizedTitle
    const qid = pageByTitle.get(resolvedTitle)?.pageprops?.wikibase_item
    if (qid) cache[name] = [qid]
  }
  await mkdir(path.dirname(cachePath), { recursive: true })
  await writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8')
  await sleep(220)
}

for (let index = 0; index < names.length; index += 1) {
  const name = names[index]
  if (!cache[name]) {
    const params = new URLSearchParams({
      action: 'wbsearchentities',
      format: 'json',
      search: name,
      language: 'ru',
      uselang: 'ru',
      type: 'item',
      limit: '10',
      origin: '*',
    })
    const result = await fetchJson(`https://www.wikidata.org/w/api.php?${params}`, `Wikidata search ${name}`)
    cache[name] = (result.search ?? []).map((entry) => entry.id)
    await sleep(180)
  }
  if ((index + 1) % 25 === 0) {
    await mkdir(path.dirname(cachePath), { recursive: true })
    await writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8')
    console.log(`Resolved iconic searches ${index + 1}/${names.length}`)
  }
}
await mkdir(path.dirname(cachePath), { recursive: true })
await writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8')

const qids = [...new Set(Object.values(cache).flat())]
const entities = new Map()
for (const qidChunk of chunks(qids, 50)) {
  const params = new URLSearchParams({
    action: 'wbgetentities',
    format: 'json',
    ids: qidChunk.join('|'),
    props: 'labels|aliases|claims|sitelinks',
    languages: 'ru|en',
    languagefallback: '1',
    origin: '*',
  })
  const payload = await fetchJson(`https://www.wikidata.org/w/api.php?${params}`, 'Wikidata iconic entities')
  for (const [qid, entity] of Object.entries(payload.entities ?? {})) entities.set(qid, entity)
  await sleep(180)
}

const allowedRanks = new Set(['Q7432', 'Q68947'])
const resolved = []
const unresolved = []
for (const name of names) {
  const selectedQid = (cache[name] ?? []).find((qid) => {
    const entity = entities.get(qid)
    const scientificName = String(claimValues(entity, 'P225')[0] ?? '').trim()
    const rank = claimValues(entity, 'P105')[0]?.id ?? null
    return /^[A-Z][a-z-]+ [a-z][a-z-]+(?:\s+[a-z][a-z-]+)?$/.test(scientificName)
      && allowedRanks.has(rank)
  })
  if (!selectedQid) {
    unresolved.push(name)
    continue
  }
  resolved.push({ requestedNameRu: name, wikidataId: selectedQid, entity: entities.get(selectedQid) })
}

const activeNames = new Set(names)
const cleanedCandidates = discovered.candidates.flatMap((candidate) => {
  if (candidate.curationPriority !== 'iconic' || activeNames.has(candidate.requestedIconicNameRu)) return [candidate]
  const remainingCategories = candidate.sourceCategories.filter((category) => category !== 'iconic-name-list')
  if (!remainingCategories.length) return []
  const cleaned = { ...candidate, sourceCategories: remainingCategories }
  delete cleaned.curationPriority
  delete cleaned.requestedIconicNameRu
  return [cleaned]
})
const byQid = new Map(cleanedCandidates.map((candidate) => [candidate.wikidataId, candidate]))
for (const { requestedNameRu, wikidataId, entity } of resolved) {
  const scientificName = String(claimValues(entity, 'P225')[0]).trim()
  const existing = byQid.get(wikidataId)
  if (existing) {
    existing.sourceCategories = [...new Set([...existing.sourceCategories, 'iconic-name-list'])]
    existing.curationPriority = 'iconic'
    existing.requestedIconicNameRu = requestedNameRu
    continue
  }
  byQid.set(wikidataId, {
    id: `animal:${scientificName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
    wikidataId,
    commonNameRu: requestedNameRu,
    commonNameEn: entity.labels?.en?.value ?? '',
    scientificName,
    taxonRankQid: claimValues(entity, 'P105')[0]?.id ?? null,
    ruWikipediaTitle: entity.sitelinks?.ruwiki?.title ?? '',
    wikidataSitelinks: Object.keys(entity.sitelinks ?? {}).length,
    hasImagePointer: claimValues(entity, 'P18').length > 0,
    hasSoundPointer: claimValues(entity, 'P51').length > 0,
    hasRangeMapPointer: claimValues(entity, 'P181').length > 0,
    conservationStatusQids: claimValues(entity, 'P141').map((value) => value?.id).filter(Boolean),
    sourceCategories: ['iconic-name-list'],
    curationPriority: 'iconic',
    requestedIconicNameRu: requestedNameRu,
    discoveryStatus: 'needs-gbif-validation-and-enrichment',
  })
}
const candidates = [...byQid.values()]
  .sort((left, right) => (
    Number(right.curationPriority === 'iconic') - Number(left.curationPriority === 'iconic')
    || right.wikidataSitelinks - left.wikidataSitelinks
    || left.commonNameRu.localeCompare(right.commonNameRu, 'ru')
  ))
const report = {
  ...discovered,
  generatedAt: new Date().toISOString(),
  method: `${discovered.method} + curated mass-audience Russian name search resolved to species/subspecies`,
  candidateCount: candidates.length,
  iconicNameCount: names.length,
  iconicResolvedCount: resolved.length,
  iconicUnresolved: unresolved,
  candidates,
}
await mkdir(path.dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({
  outputPath: path.relative(root, outputPath),
  previousCandidateCount: discovered.candidateCount,
  candidateCount: report.candidateCount,
  iconicNameCount: report.iconicNameCount,
  iconicResolvedCount: report.iconicResolvedCount,
  iconicUnresolved: report.iconicUnresolved,
}, null, 2))
