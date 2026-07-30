import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const [key, ...rest] = argument.replace(/^--/, '').split('=')
  return [key, rest.length ? rest.join('=') : true]
}))
const inputPath = path.resolve(root, String(args.input || process.env.npm_config_input || 'data/animals/candidates/ranked.json'))
const outputPath = path.resolve(root, String(args.out || process.env.npm_config_out || 'data/animals/candidates/shortlist.json'))
const seedManifestPath = path.resolve(root, String(args.seeds || process.env.npm_config_seeds || 'data/animals/candidates/shortlist-seeds.json'))
const configPath = path.resolve(root, String(args.config || process.env.npm_config_config || 'data/animals/discovery-categories.json'))
const target = Number(args.target || process.env.npm_config_target || 500)

const ranked = JSON.parse(await readFile(inputPath, 'utf8'))
const config = JSON.parse(await readFile(configPath, 'utf8'))
const pool = ranked.candidates.filter((candidate) => candidate.rankingEligible)
const mustIncludeQids = new Set([
  ...(config.mustInclude ?? []).map((entry) => entry.wikidataId),
  ...(config.mustIncludeQids ?? []),
])
const classTargets = {
  Mammalia: 160,
  Aves: 100,
  Actinopterygii: 55,
  Reptilia: 45,
  Amphibia: 25,
  Insecta: 55,
  Arachnida: 20,
  Cephalopoda: 10,
  Other: 30,
}
const classBucket = (candidate) => Object.hasOwn(classTargets, candidate.taxonomicClass)
  ? candidate.taxonomicClass
  : 'Other'
const selected = []
const selectedIds = new Set()
const genusCounts = {}
const classCounts = {}
const add = (candidate, reason) => {
  if (!candidate || selectedIds.has(candidate.id)) return false
  selected.push({ ...candidate, shortlistReason: reason })
  selectedIds.add(candidate.id)
  genusCounts[candidate.genus] = (genusCounts[candidate.genus] ?? 0) + 1
  const bucket = classBucket(candidate)
  classCounts[bucket] = (classCounts[bucket] ?? 0) + 1
  return true
}

for (const candidate of pool.filter((entry) => mustIncludeQids.has(entry.wikidataId))) {
  add(candidate, 'must-include')
}
for (const [bucket, classTarget] of Object.entries(classTargets)) {
  for (const candidate of pool) {
    if (selected.length >= target || (classCounts[bucket] ?? 0) >= classTarget) break
    if (classBucket(candidate) !== bucket || (genusCounts[candidate.genus] ?? 0) >= 5) continue
    add(candidate, `class-target:${bucket}`)
  }
}
for (const candidate of pool) {
  if (selected.length >= target) break
  if ((genusCounts[candidate.genus] ?? 0) >= 5) continue
  add(candidate, 'recognition-fill')
}
for (const candidate of pool) {
  if (selected.length >= target) break
  add(candidate, 'relaxed-genus-fill')
}

const seeds = selected.map((candidate) => ({
  id: candidate.id,
  wikidataId: candidate.wikidataId,
  scientificName: candidate.scientificName,
  ruWikipediaPageviews365d: candidate.ruWikipediaPageviews365d,
  wordstatMonthlySearches: candidate.wordstatMonthlySearches ?? null,
  rankingRecognitionScore: candidate.recognitionScore,
  rankingSources: candidate.sources,
  discoverySourceCategories: candidate.sourceCategories,
}))
const report = {
  generatedAt: new Date().toISOString(),
  target,
  complete: selected.length === target,
  selectedCount: selected.length,
  classTargets,
  classCounts,
  warnings: Object.entries(classTargets)
    .filter(([bucket, classTarget]) => (classCounts[bucket] ?? 0) < classTarget)
    .map(([bucket, classTarget]) => `${bucket}: ${classCounts[bucket] ?? 0}/${classTarget}`),
  candidates: selected.map((candidate, index) => ({
    shortlistRank: index + 1,
    ...candidate,
  })),
}
await mkdir(path.dirname(outputPath), { recursive: true })
await mkdir(path.dirname(seedManifestPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
await writeFile(seedManifestPath, `${JSON.stringify({ generatedAt: report.generatedAt, seeds }, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({
  outputPath: path.relative(root, outputPath),
  seedManifestPath: path.relative(root, seedManifestPath),
  selectedCount: report.selectedCount,
  complete: report.complete,
  classCounts: report.classCounts,
  warnings: report.warnings,
}, null, 2))
