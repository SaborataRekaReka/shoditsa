import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const [key, ...rest] = argument.replace(/^--/, '').split('=')
  return [key, rest.length ? rest.join('=') : true]
}))
const configPath = path.resolve(root, String(args.config || process.env.npm_config_config || 'data/animals/discovery-categories.json'))
const outputPath = path.resolve(root, String(args.out || process.env.npm_config_out || 'data/animals/candidates/discovered.json'))
const maximumPages = Number(args.limit || process.env.npm_config_limit || 5_000)
const maximumDepth = Number(args.depth || process.env.npm_config_depth || 3)
const config = JSON.parse(await readFile(configPath, 'utf8'))
const USER_AGENT = 'shoditsa-animal-pipeline/0.1 (+https://shoditsa.ru)'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const unique = (values) => [...new Set(values.filter(Boolean))]
let lastRequestAt = 0
const minimumRequestIntervalMs = Number(args.interval || process.env.npm_config_interval || 180)
const chunks = (values, size) => Array.from(
  { length: Math.ceil(values.length / size) },
  (_, index) => values.slice(index * size, index * size + size),
)

const fetchJson = async (url, label) => {
  let lastError
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const waitForSlot = minimumRequestIntervalMs - (Date.now() - lastRequestAt)
    if (waitForSlot > 0) await sleep(waitForSlot)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)
    try {
      lastRequestAt = Date.now()
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: controller.signal,
      })
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`)
        error.retryAfterMs = Number(response.headers.get('retry-after') ?? 0) * 1000
        throw error
      }
      return response.json()
    } catch (error) {
      lastError = error
      if (attempt < 6) await sleep(Math.max(Number(error?.retryAfterMs ?? 0), attempt * 1_000))
    } finally {
      clearTimeout(timeout)
    }
  }
  throw new Error(`${label} failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

const pages = new Map()
const visitedCategories = new Set()
const queue = config.rootCategories.map((title) => ({ title, depth: 0, root: title }))
const rootPageCounts = Object.fromEntries(config.rootCategories.map((title) => [title, 0]))
const perRootPageLimit = Math.ceil(maximumPages / config.rootCategories.length)

while (queue.length && pages.size < maximumPages) {
  const current = queue.shift()
  if (visitedCategories.has(current.title)) continue
  if ((rootPageCounts[current.root] ?? 0) >= perRootPageLimit) continue
  visitedCategories.add(current.title)
  if (visitedCategories.size % 100 === 0) {
    console.log(`Discovery progress: ${pages.size}/${maximumPages} pages, ${visitedCategories.size} categories`)
  }
  let continuation = null
  do {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      list: 'categorymembers',
      cmtitle: current.title,
      cmnamespace: '0|14',
      cmlimit: '500',
      cmtype: 'page|subcat',
      origin: '*',
    })
    if (continuation) params.set('cmcontinue', continuation)
    const payload = await fetchJson(`https://ru.wikipedia.org/w/api.php?${params}`, `category ${current.title}`)
    for (const member of payload.query?.categorymembers ?? []) {
      if (member.ns === 14 && current.depth < maximumDepth) {
        queue.push({ title: member.title, depth: current.depth + 1, root: current.root })
      } else if (member.ns === 0) {
        if ((rootPageCounts[current.root] ?? 0) >= perRootPageLimit && !pages.has(member.title)) continue
        const existing = pages.get(member.title) ?? { title: member.title, pageId: member.pageid, sourceCategories: [] }
        if (!pages.has(member.title)) rootPageCounts[current.root] = (rootPageCounts[current.root] ?? 0) + 1
        existing.sourceCategories = unique([...existing.sourceCategories, current.root])
        pages.set(member.title, existing)
        if (pages.size >= maximumPages) break
      }
    }
    continuation = payload.continue?.cmcontinue ?? null
  } while (continuation && pages.size < maximumPages && (rootPageCounts[current.root] ?? 0) < perRootPageLimit)
}

const titles = [...pages.keys()]
// Long Russian article titles can exceed proxy URL limits when 50 are packed together.
for (const titleChunk of chunks(titles, 20)) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    prop: 'pageprops',
    titles: titleChunk.join('|'),
    ppprop: 'wikibase_item',
    redirects: '1',
    origin: '*',
  })
  const payload = await fetchJson(`https://ru.wikipedia.org/w/api.php?${params}`, 'Wikipedia page QIDs')
  for (const page of Object.values(payload.query?.pages ?? {})) {
    const resolved = pages.get(page.title)
      ?? titleChunk.map((title) => pages.get(title)).find((entry) => entry?.pageId === page.pageid)
    if (resolved) resolved.wikidataId = page.pageprops?.wikibase_item ?? null
  }
}

const qids = unique([
  ...[...pages.values()].map((entry) => entry.wikidataId),
  ...(config.mustInclude ?? []).map((entry) => entry.wikidataId),
  ...(config.mustIncludeQids ?? []),
])
const manualIncludeByQid = new Map((config.mustInclude ?? []).map((entry) => [entry.wikidataId, entry]))
const entities = new Map()
for (const qidChunk of chunks(qids, 50)) {
  const params = new URLSearchParams({
    action: 'wbgetentities',
    format: 'json',
    ids: qidChunk.join('|'),
    props: 'labels|claims|sitelinks',
    languages: 'ru|en',
    languagefallback: '1',
    origin: '*',
  })
  const payload = await fetchJson(`https://www.wikidata.org/w/api.php?${params}`, 'Wikidata candidate entities')
  for (const [qid, entity] of Object.entries(payload.entities ?? {})) entities.set(qid, entity)
}

const claimValues = (entity, property) => (entity.claims?.[property] ?? [])
  .map((claim) => claim.mainsnak?.datavalue?.value)
  .filter((value) => value !== undefined)
const rankIds = new Set(config.allowedTaxonRankQids ?? ['Q7432', 'Q68947'])
const pageByQid = new Map([...pages.values()].filter((entry) => entry.wikidataId).map((entry) => [entry.wikidataId, entry]))
const candidates = []
for (const [wikidataId, entity] of entities) {
  const manualInclude = manualIncludeByQid.get(wikidataId)
  const scientificName = String(claimValues(entity, 'P225')[0] ?? manualInclude?.scientificName ?? '').trim()
  const rankId = claimValues(entity, 'P105')[0]?.id ?? null
  if (!scientificName) continue
  if (!/^[A-Z][a-z-]+ [a-z][a-z-]+(?:\s+[a-z][a-z-]+)?$/.test(scientificName)) continue
  if (rankId && !rankIds.has(rankId) && !manualInclude && !(config.mustIncludeQids ?? []).includes(wikidataId)) continue
  const page = pageByQid.get(wikidataId)
  candidates.push({
    id: `animal:${scientificName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
    wikidataId,
    commonNameRu: manualInclude?.commonNameRu ?? entity.labels?.ru?.value ?? page?.title ?? '',
    commonNameEn: manualInclude?.commonNameEn ?? entity.labels?.en?.value ?? '',
    scientificName,
    taxonRankQid: rankId,
    ruWikipediaTitle: entity.sitelinks?.ruwiki?.title ?? page?.title ?? '',
    wikidataSitelinks: Object.keys(entity.sitelinks ?? {}).length,
    hasImagePointer: claimValues(entity, 'P18').length > 0,
    hasSoundPointer: claimValues(entity, 'P51').length > 0,
    hasRangeMapPointer: claimValues(entity, 'P181').length > 0,
    conservationStatusQids: claimValues(entity, 'P141').map((value) => value?.id).filter(Boolean),
    sourceCategories: page?.sourceCategories ?? ['must-include'],
    discoveryStatus: 'needs-gbif-validation-and-enrichment',
  })
}
candidates.sort((left, right) => right.wikidataSitelinks - left.wikidataSitelinks || left.commonNameRu.localeCompare(right.commonNameRu, 'ru'))

const report = {
  generatedAt: new Date().toISOString(),
  method: 'Recursive Russian Wikipedia category traversal -> page Wikidata IDs -> species/subspecies taxon filter',
  config: {
    rootCategories: config.rootCategories,
    maximumDepth,
    maximumPages,
    allowedTaxonRankQids: [...rankIds],
  },
  visitedCategoryCount: visitedCategories.size,
  discoveredPageCount: pages.size,
  candidateCount: candidates.length,
  candidates,
}
await mkdir(path.dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({
  outputPath: path.relative(root, outputPath),
  visitedCategoryCount: report.visitedCategoryCount,
  discoveredPageCount: report.discoveredPageCount,
  candidateCount: report.candidateCount,
  topCandidates: candidates.slice(0, 10).map((entry) => ({
    name: entry.commonNameRu,
    scientificName: entry.scientificName,
    sitelinks: entry.wikidataSitelinks,
  })),
}, null, 2))
