import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scoreAnimal, validateAnimal } from './model.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const [key, ...rest] = argument.replace(/^--/, '').split('=')
  return [key, rest.length ? rest.join('=') : true]
}))
const inputDirectory = path.resolve(root, String(args.input || process.env.npm_config_input || 'data/animals/generated'))
const rosterPath = path.resolve(root, String(args.roster || process.env.npm_config_roster || 'data/animals/generated/roster.json'))
const outputPath = path.resolve(root, String(args.out || process.env.npm_config_out || 'data/animals/generated/audit-report.json'))
const roster = JSON.parse(await readFile(rosterPath, 'utf8'))
const files = (await readdir(inputDirectory))
  .filter((name) => name.endsWith('.json'))
  .filter((name) => !name.endsWith('-report.json') && !['roster.json', 'review-queue.json'].includes(name))
const records = await Promise.all(files.map(async (name) => JSON.parse(await readFile(path.join(inputDirectory, name), 'utf8'))))
const byId = new Map()
for (const record of records) {
  if (!record.id) continue
  const existing = byId.get(record.id)
  if (!existing || Number(record.selection?.totalScore ?? 0) > Number(existing.selection?.totalScore ?? 0)) {
    byId.set(record.id, record)
  }
}

const rosterEntries = [
  ...roster.animals.map((entry) => ({ ...entry, rosterKind: 'main' })),
  ...roster.reserveAnimals.map((entry) => ({ ...entry, rosterKind: 'reserve' })),
]
const errors = []
const warnings = []
const audited = []
for (const entry of rosterEntries) {
  const record = byId.get(entry.id)
  if (!record) {
    errors.push(`${entry.rosterKind}:${entry.id}:missing-generated-record`)
    continue
  }
  scoreAnimal(record)
  for (const error of validateAnimal(record)) errors.push(`${entry.rosterKind}:${entry.id}:${error}`)
  if (!record.selection.eligible) errors.push(`${entry.rosterKind}:${entry.id}:not-eligible:${record.selection.rejectionReasons.join(',')}`)
  if (record.taxonomy.extinct === true) errors.push(`${entry.rosterKind}:${entry.id}:extinct`)
  if (!record.media.primaryImage?.commercialUseAllowed) errors.push(`${entry.rosterKind}:${entry.id}:image-license-not-approved`)
  if (record.quality.coreCriteriaCoverage < 70) errors.push(`${entry.rosterKind}:${entry.id}:core-coverage-below-70`)
  if (!/[А-Яа-яЁё]/.test(record.identity.commonNameRu)) errors.push(`${entry.rosterKind}:${entry.id}:missing-russian-display-name`)
  audited.push({ entry, record })
}

const duplicateValues = (values) => Object.entries(
  values.reduce((result, value) => {
    result[value] = (result[value] ?? 0) + 1
    return result
  }, {}),
).filter(([, count]) => count > 1).map(([value]) => value)
for (const scientificName of duplicateValues(audited.map(({ record }) => record.identity.acceptedScientificName))) {
  errors.push(`duplicate-scientific-name:${scientificName}`)
}
for (const wikidataId of duplicateValues(audited.map(({ record }) => record.identity.wikidataId))) {
  errors.push(`duplicate-wikidata-id:${wikidataId}`)
}

const main = audited.filter(({ entry }) => entry.rosterKind === 'main').map(({ record }) => record)
const countBy = (items, keyFn) => items.reduce((result, item) => {
  const key = keyFn(item) || 'Unknown'
  result[key] = (result[key] ?? 0) + 1
  return result
}, {})
const genusCounts = countBy(main, (record) => record.taxonomy.genus)
const familyCounts = countBy(main, (record) => record.taxonomy.family)
for (const [genus, count] of Object.entries(genusCounts)) {
  if (count > roster.policy.maxPerGenus) errors.push(`genus-cap:${genus}:${count}/${roster.policy.maxPerGenus}`)
}
for (const [family, count] of Object.entries(familyCounts)) {
  if (count > roster.policy.maxPerFamily) errors.push(`family-cap:${family}:${count}/${roster.policy.maxPerFamily}`)
}
if (roster.selectedCount !== roster.policy.target) errors.push(`main-count:${roster.selectedCount}/${roster.policy.target}`)
if (roster.reserveCount !== roster.policy.reserveTarget) errors.push(`reserve-count:${roster.reserveCount}/${roster.policy.reserveTarget}`)
if (roster.warnings.length) warnings.push(...roster.warnings)

const mean = (values) => values.length
  ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2))
  : 0
const report = {
  generatedAt: new Date().toISOString(),
  pass: errors.length === 0,
  mainCount: roster.animals.length,
  reserveCount: roster.reserveAnimals.length,
  errors,
  warnings,
  main: {
    classCounts: roster.classCounts,
    difficultyCounts: roster.difficultyCounts,
    maximumPerGenus: Math.max(...Object.values(genusCounts)),
    maximumPerFamily: Math.max(...Object.values(familyCounts)),
    meanTotalScore: mean(main.map((record) => record.selection.totalScore)),
    meanCoreCriteriaCoverage: mean(main.map((record) => record.quality.coreCriteriaCoverage)),
    meanProvenanceCoverage: mean(main.map((record) => record.quality.provenanceCoverage)),
    soundClueCount: main.filter((record) => record.hints.sounds.length).length,
    silhouetteClueCount: main.filter((record) => record.hints.silhouettes.length).length,
    rangeMapClueCount: main.filter((record) => record.hints.rangeMaps.length).length,
    originalDistinctiveCopyCount: main.filter((record) => record.hints.distinctiveTraitsRu.length).length,
    imageLicenseCounts: countBy(main, (record) => record.media.primaryImage.license),
  },
}
await mkdir(path.dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ outputPath: path.relative(root, outputPath), ...report }, null, 2))
if (!report.pass) process.exitCode = 1
