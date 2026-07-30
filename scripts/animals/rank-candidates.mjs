import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeGameTaxonomy } from './model.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const [key, ...rest] = argument.replace(/^--/, '').split('=')
  return [key, rest.length ? rest.join('=') : true]
}))
const inputPath = path.resolve(root, String(args.input || process.env.npm_config_input || 'data/animals/candidates/discovered.json'))
const outputPath = path.resolve(root, String(args.out || process.env.npm_config_out || 'data/animals/candidates/ranked.json'))
const cachePath = path.resolve(root, String(args.cache || process.env.npm_config_ranking_cache || '.tmp/animal-pipeline/candidate-ranking-cache.json'))
const candidateLimit = Number(args.limit || process.env.npm_config_limit || 2_000)
const concurrency = Math.max(1, Number(args.concurrency || process.env.npm_config_concurrency || 6))
const USER_AGENT = 'shoditsa-animal-pipeline/0.1 (+https://shoditsa.ru)'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value))
const round = (value, digits = 2) => Number(value.toFixed(digits))
const logNorm = (value, highWatermark) => {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return 0
  return clamp(Math.log1p(number) / Math.log1p(highWatermark))
}
const dateStamp = (date) => `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}01`

const fetchJson = async (url, label) => {
  let lastError
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)
    try {
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
      if (attempt < 5) await sleep(Math.max(Number(error?.retryAfterMs ?? 0), attempt * 750))
    } finally {
      clearTimeout(timeout)
    }
  }
  throw new Error(`${label} failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

const input = JSON.parse(await readFile(inputPath, 'utf8'))
let cache = {}
try {
  cache = JSON.parse(await readFile(cachePath, 'utf8'))
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}
const candidates = input.candidates.slice(0, candidateLimit)
let completed = 0
let cacheDirty = false

const persistCache = async () => {
  if (!cacheDirty) return
  await mkdir(path.dirname(cachePath), { recursive: true })
  await writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8')
  cacheDirty = false
}

const enrich = async (candidate) => {
  const cached = cache[candidate.wikidataId]
  if (cached?.scientificName === candidate.scientificName) return { ...candidate, ...cached }

  const gbifUrl = `https://api.gbif.org/v1/species/match?name=${encodeURIComponent(candidate.scientificName)}`
  const gbif = await fetchJson(gbifUrl, `GBIF ${candidate.scientificName}`)
  let pageviews365d = null
  let pageviewsUrl = null
  if (candidate.ruWikipediaTitle) {
    const end = new Date()
    end.setUTCDate(1)
    end.setUTCMonth(end.getUTCMonth() - 1)
    const start = new Date(end)
    start.setUTCMonth(start.getUTCMonth() - 11)
    pageviewsUrl = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/ru.wikipedia.org/all-access/user/${encodeURIComponent(candidate.ruWikipediaTitle.replaceAll(' ', '_'))}/monthly/${dateStamp(start)}/${dateStamp(end)}`
    try {
      const pageviews = await fetchJson(pageviewsUrl, `pageviews ${candidate.ruWikipediaTitle}`)
      pageviews365d = (pageviews.items ?? []).reduce((sum, entry) => sum + Number(entry.views ?? 0), 0)
    } catch {
      pageviews365d = null
    }
  }
  let extinct = null
  if (gbif.usageKey) {
    try {
      const profiles = await fetchJson(
        `https://api.gbif.org/v1/species/${gbif.usageKey}/speciesProfiles?limit=100`,
        `GBIF profiles ${candidate.scientificName}`,
      )
      const extinctValues = (profiles.results ?? [])
        .map((profile) => profile.extinct)
        .filter((value) => typeof value === 'boolean')
      if (extinctValues.length) extinct = extinctValues.includes(false) ? false : true
    } catch {
      extinct = null
    }
  }

  const ranking = {
    scientificName: candidate.scientificName,
    acceptedScientificName: String(gbif.canonicalName || gbif.scientificName || ''),
    gbifKey: gbif.usageKey ?? null,
    gbifMatchType: gbif.matchType ?? 'NONE',
    gbifConfidence: Number(gbif.confidence ?? 0),
    kingdom: gbif.kingdom ?? '',
    phylum: gbif.phylum ?? '',
    taxonomicClass: gbif.class ?? '',
    order: gbif.order ?? '',
    family: gbif.family ?? '',
    genus: gbif.genus ?? '',
    rank: gbif.rank ?? '',
    status: gbif.status ?? '',
    extinct,
    ruWikipediaPageviews365d: pageviews365d,
    sources: { gbifUrl, pageviewsUrl },
    rankedAt: new Date().toISOString(),
  }
  cache[candidate.wikidataId] = ranking
  cacheDirty = true
  return { ...candidate, ...ranking }
}

const results = new Array(candidates.length)
let nextIndex = 0
const worker = async () => {
  while (nextIndex < candidates.length) {
    const index = nextIndex
    nextIndex += 1
    try {
      results[index] = await enrich(candidates[index])
    } catch (error) {
      results[index] = {
        ...candidates[index],
        rankingError: error instanceof Error ? error.message : String(error),
      }
    }
    completed += 1
    if (completed % 50 === 0) {
      await persistCache()
      console.log(`Ranked ${completed}/${candidates.length}`)
    }
  }
}
await Promise.all(Array.from({ length: concurrency }, worker))
await persistCache()

const scored = results.map((candidate) => {
  const sourceTaxonomicClass = candidate.taxonomicClass
  Object.assign(candidate, normalizeGameTaxonomy(candidate, candidate.sourceCategories))
  candidate.sourceTaxonomicClass = sourceTaxonomicClass
  if (candidate.conservationStatusQids?.includes('Q237350')) {
    candidate.extinct = true
    candidate.extinctSource = 'Wikidata P141'
  }
  const resolvedTaxon = candidate.kingdom === 'Animalia'
    && candidate.gbifKey
    && candidate.gbifMatchType !== 'NONE'
    && candidate.gbifConfidence >= 80
  const validTaxon = resolvedTaxon && candidate.extinct !== true
  const pageviewSignal = logNorm(candidate.ruWikipediaPageviews365d, 2_000_000)
  const sitelinkSignal = logNorm(candidate.wikidataSitelinks, 300)
  const mediaSignal = (
    Number(Boolean(candidate.hasImagePointer)) * 0.5
    + Number(Boolean(candidate.hasSoundPointer)) * 0.3
    + Number(Boolean(candidate.hasRangeMapPointer)) * 0.2
  )
  const recognitionScore = round((pageviewSignal * 0.65 + sitelinkSignal * 0.25 + mediaSignal * 0.1) * 100)
  return {
    ...candidate,
    recognitionScore,
    preliminaryDifficulty: recognitionScore >= 70 ? 'easy' : recognitionScore >= 45 ? 'medium' : 'hard',
    rankingEligible: Boolean(validTaxon && candidate.commonNameRu && candidate.hasImagePointer),
    rankingRejectionReasons: [
      ...(!resolvedTaxon ? ['unresolved-or-low-confidence-animal-taxon'] : []),
      ...(candidate.extinct === true ? ['extinct-outside-main-mode'] : []),
      ...(!candidate.commonNameRu ? ['missing-russian-name'] : []),
      ...(!candidate.hasImagePointer ? ['missing-wikidata-image-pointer'] : []),
    ],
  }
})
scored.sort((left, right) => (
  Number(right.rankingEligible) - Number(left.rankingEligible)
  || right.recognitionScore - left.recognitionScore
  || right.wikidataSitelinks - left.wikidataSitelinks
  || left.commonNameRu.localeCompare(right.commonNameRu, 'ru')
))

const byClass = {}
for (const candidate of scored.filter((entry) => entry.rankingEligible)) {
  const key = candidate.taxonomicClass || 'Unknown'
  byClass[key] = (byClass[key] ?? 0) + 1
}
const report = {
  generatedAt: new Date().toISOString(),
  inputPath: path.relative(root, inputPath),
  method: 'GBIF taxon validation + latest 12 complete months of Russian Wikipedia pageviews + Wikidata sitelinks/media pointers',
  caveats: [
    'Recognition score is a pre-ranking signal, not the final roster score.',
    'Wordstat is intentionally absent until an authenticated Search API/Wordstat integration is configured.',
    'A Wikidata image pointer does not guarantee that the Commons license passes the publication policy.',
  ],
  processedCount: scored.length,
  eligibleCount: scored.filter((entry) => entry.rankingEligible).length,
  classCounts: Object.fromEntries(Object.entries(byClass).sort((left, right) => right[1] - left[1])),
  candidates: scored,
}
await mkdir(path.dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({
  outputPath: path.relative(root, outputPath),
  processedCount: report.processedCount,
  eligibleCount: report.eligibleCount,
  classCounts: report.classCounts,
  topCandidates: scored.filter((entry) => entry.rankingEligible).slice(0, 20).map((entry) => ({
    name: entry.commonNameRu,
    scientificName: entry.acceptedScientificName,
    class: entry.taxonomicClass,
    recognitionScore: entry.recognitionScore,
    pageviews365d: entry.ruWikipediaPageviews365d,
  })),
}, null, 2))
