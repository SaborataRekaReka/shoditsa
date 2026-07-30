import { readdir, readFile, stat, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_SELECTION_POLICY, scoreAnimal, validateAnimal } from './model.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const [key, ...rest] = argument.replace(/^--/, '').split('=')
  return [key, rest.length ? rest.join('=') : true]
}))
const inputPath = path.resolve(root, String(args.input || process.env.npm_config_input || 'data/animals/generated'))
const outputPath = path.resolve(root, String(args.out || process.env.npm_config_out || 'data/animals/generated/roster.json'))
const configuredPolicyPath = args.policy || process.env.npm_config_policy
const policyPath = configuredPolicyPath ? path.resolve(root, String(configuredPolicyPath)) : null

const loadCandidates = async (sourcePath) => {
  const details = await stat(sourcePath)
  const paths = details.isDirectory()
    ? (await readdir(sourcePath))
      .filter((name) => name.endsWith('.json'))
      .filter((name) => !name.startsWith('roster') && !name.endsWith('-report.json') && name !== 'review-queue.json')
      .map((name) => path.join(sourcePath, name))
    : [sourcePath]
  const candidates = []
  for (const candidatePath of paths) {
    const parsed = JSON.parse(await readFile(candidatePath, 'utf8'))
    candidates.push(...(Array.isArray(parsed) ? parsed : [parsed]))
  }
  const byTaxon = new Map()
  for (const candidate of candidates) {
    const key = candidate.identity?.acceptedScientificName || candidate.id
    const existing = byTaxon.get(key)
    if (!existing || Number(candidate.selection?.totalScore ?? 0) > Number(existing.selection?.totalScore ?? 0)) {
      byTaxon.set(key, candidate)
    }
  }
  return [...byTaxon.values()]
}

const policyOverride = policyPath ? JSON.parse(await readFile(policyPath, 'utf8')) : {}
const policy = {
  ...DEFAULT_SELECTION_POLICY,
  ...policyOverride,
  classQuotas: { ...DEFAULT_SELECTION_POLICY.classQuotas, ...(policyOverride.classQuotas ?? {}) },
  difficultyQuotas: { ...DEFAULT_SELECTION_POLICY.difficultyQuotas, ...(policyOverride.difficultyQuotas ?? {}) },
}
const candidates = await loadCandidates(inputPath)
const invalid = []
for (const candidate of candidates) {
  const errors = validateAnimal(candidate)
  if (errors.length) invalid.push({ id: candidate?.id ?? '(missing)', errors })
  else scoreAnimal(candidate)
}
if (invalid.length) {
  throw new Error(`Invalid animal candidates:\n${invalid.map((entry) => `${entry.id}: ${entry.errors.join('; ')}`).join('\n')}`)
}

const classBucket = (candidate) => policy.classQuotas[candidate.taxonomy.taxonomicClass]
  ? candidate.taxonomy.taxonomicClass
  : 'Other'
const countBy = (items, keyFn) => items.reduce((result, item) => {
  const key = keyFn(item) || 'Unknown'
  result[key] = (result[key] ?? 0) + 1
  return result
}, {})
const eligibilityRejected = candidates.filter((candidate) => !candidate.selection.eligible || candidate.selection.totalScore < policy.minimumTotalScore)
const pool = candidates
  .filter((candidate) => candidate.selection.eligible && candidate.selection.totalScore >= policy.minimumTotalScore)
  .sort((left, right) => right.selection.totalScore - left.selection.totalScore || left.id.localeCompare(right.id))

const selected = []
const selectedIds = new Set()
const classCounts = {}
const difficultyCounts = {}
const genusCounts = {}
const familyCounts = {}
const signatureCounts = {}
const warnings = []

const signature = (candidate) => [
  classBucket(candidate),
  candidate.criteria.diets.slice().sort().join('+'),
  candidate.criteria.habitats.slice().sort().join('+'),
  candidate.criteria.activity.slice().sort().join('+'),
  candidate.criteria.sizeCategory,
].join('|')

const adjustedScore = (candidate) => {
  const genusCount = genusCounts[candidate.taxonomy.genus] ?? 0
  const familyCount = familyCounts[candidate.taxonomy.family] ?? 0
  const sameSignature = signatureCounts[signature(candidate)] ?? 0
  const bucket = classBucket(candidate)
  const classQuota = policy.classQuotas[bucket] ?? policy.classQuotas.Other
  const classSaturation = (classCounts[bucket] ?? 0) / Math.max(1, classQuota.max)
  return candidate.selection.totalScore
    - genusCount * 9
    - familyCount * 1.5
    - sameSignature * 5
    - classSaturation * 6
}

const canSelect = (candidate, options = {}) => {
  if (selectedIds.has(candidate.id)) return false
  const bucket = classBucket(candidate)
  const classQuota = policy.classQuotas[bucket] ?? policy.classQuotas.Other
  const difficultyQuota = policy.difficultyQuotas[candidate.selection.difficulty]
  if (!options.ignoreClassMax && (classCounts[bucket] ?? 0) >= classQuota.max) return false
  if (!options.ignoreDifficultyMax && difficultyQuota && (difficultyCounts[candidate.selection.difficulty] ?? 0) >= difficultyQuota.max) return false
  if (!options.ignoreTaxonCaps && (genusCounts[candidate.taxonomy.genus] ?? 0) >= policy.maxPerGenus) return false
  if (!options.ignoreTaxonCaps && (familyCounts[candidate.taxonomy.family] ?? 0) >= policy.maxPerFamily) return false
  return true
}

const add = (candidate, reason) => {
  selected.push({ candidate, selectionReason: reason })
  selectedIds.add(candidate.id)
  const bucket = classBucket(candidate)
  classCounts[bucket] = (classCounts[bucket] ?? 0) + 1
  difficultyCounts[candidate.selection.difficulty] = (difficultyCounts[candidate.selection.difficulty] ?? 0) + 1
  genusCounts[candidate.taxonomy.genus] = (genusCounts[candidate.taxonomy.genus] ?? 0) + 1
  familyCounts[candidate.taxonomy.family] = (familyCounts[candidate.taxonomy.family] ?? 0) + 1
  signatureCounts[signature(candidate)] = (signatureCounts[signature(candidate)] ?? 0) + 1
}

const bestCandidate = (filter, options) => pool
  .filter((candidate) => filter(candidate) && canSelect(candidate, options))
  .sort((left, right) => adjustedScore(right) - adjustedScore(left) || left.id.localeCompare(right.id))[0]

for (const [bucket, quota] of Object.entries(policy.classQuotas)) {
  while ((classCounts[bucket] ?? 0) < quota.min && selected.length < policy.target) {
    const candidate = bestCandidate((entry) => classBucket(entry) === bucket)
    if (!candidate) {
      warnings.push(`Class minimum was not met for ${bucket}: ${classCounts[bucket] ?? 0}/${quota.min}`)
      break
    }
    add(candidate, `class-minimum:${bucket}`)
  }
}

for (const [difficulty, quota] of Object.entries(policy.difficultyQuotas)) {
  while ((difficultyCounts[difficulty] ?? 0) < quota.min && selected.length < policy.target) {
    const candidate = bestCandidate((entry) => entry.selection.difficulty === difficulty)
    if (!candidate) {
      warnings.push(`Difficulty minimum was not met for ${difficulty}: ${difficultyCounts[difficulty] ?? 0}/${quota.min}`)
      break
    }
    add(candidate, `difficulty-minimum:${difficulty}`)
  }
}

while (selected.length < policy.target) {
  const candidate = bestCandidate(() => true)
  if (!candidate) break
  add(candidate, 'best-adjusted-score')
}

if (selected.length < policy.target) {
  warnings.push(`Strict constraints produced ${selected.length}/${policy.target}; genus/family caps were relaxed for the remaining slots.`)
  while (selected.length < policy.target) {
    const candidate = bestCandidate(() => true, { ignoreTaxonCaps: true })
    if (!candidate) break
    add(candidate, 'relaxed-taxon-caps')
  }
}
if (selected.length < policy.target) {
  warnings.push(`Roster is still ${selected.length}/${policy.target}; class and difficulty maxima were relaxed for the remaining slots.`)
  while (selected.length < policy.target) {
    const candidate = bestCandidate(() => true, {
      ignoreTaxonCaps: true,
      ignoreClassMax: true,
      ignoreDifficultyMax: true,
    })
    if (!candidate) break
    add(candidate, 'relaxed-all-maxima')
  }
}
if (selected.length < policy.target) {
  warnings.push(`Roster remains incomplete at ${selected.length}/${policy.target}; increase or enrich the candidate pool.`)
}

const selectedAnimals = selected.map(({ candidate, selectionReason }, index) => ({
  rank: index + 1,
  id: candidate.id,
  commonNameRu: candidate.identity.commonNameRu,
  scientificName: candidate.identity.acceptedScientificName,
  taxonomicClass: candidate.taxonomy.taxonomicClass,
  family: candidate.taxonomy.family,
  genus: candidate.taxonomy.genus,
  difficulty: candidate.selection.difficulty,
  score: candidate.selection.totalScore,
  selectionReason,
}))
const reserveAnimals = pool
  .filter((candidate) => !selectedIds.has(candidate.id))
  .sort((left, right) => adjustedScore(right) - adjustedScore(left) || left.id.localeCompare(right.id))
  .slice(0, policy.reserveTarget)
  .map((candidate, index) => ({
    reserveRank: index + 1,
    id: candidate.id,
    commonNameRu: candidate.identity.commonNameRu,
    scientificName: candidate.identity.acceptedScientificName,
    taxonomicClass: candidate.taxonomy.taxonomicClass,
    family: candidate.taxonomy.family,
    genus: candidate.taxonomy.genus,
    difficulty: candidate.selection.difficulty,
    score: candidate.selection.totalScore,
  }))
const report = {
  generatedAt: new Date().toISOString(),
  policy,
  candidateCount: candidates.length,
  eligiblePoolCount: pool.length,
  rejectedCount: eligibilityRejected.length,
  selectedCount: selectedAnimals.length,
  reserveCount: reserveAnimals.length,
  complete: selectedAnimals.length === policy.target && reserveAnimals.length === policy.reserveTarget,
  meanScore: selectedAnimals.length
    ? Number((selectedAnimals.reduce((sum, entry) => sum + entry.score, 0) / selectedAnimals.length).toFixed(2))
    : 0,
  classCounts,
  difficultyCounts,
  continentCoverage: countBy(selected.map((entry) => entry.candidate).flatMap((entry) => entry.criteria.continents), (entry) => entry),
  habitatCoverage: countBy(selected.map((entry) => entry.candidate).flatMap((entry) => entry.criteria.habitats), (entry) => entry),
  warnings,
  rejected: eligibilityRejected.map((candidate) => ({
    id: candidate.id,
    score: candidate.selection.totalScore,
    reasons: candidate.selection.rejectionReasons.length
      ? candidate.selection.rejectionReasons
      : [`score-below-${policy.minimumTotalScore}`],
  })),
  animals: selectedAnimals,
  reserveAnimals,
}

await mkdir(path.dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({
  outputPath: path.relative(root, outputPath),
  candidateCount: report.candidateCount,
  eligiblePoolCount: report.eligiblePoolCount,
  selectedCount: report.selectedCount,
  reserveCount: report.reserveCount,
  complete: report.complete,
  meanScore: report.meanScore,
  classCounts: report.classCounts,
  difficultyCounts: report.difficultyCounts,
  warnings: report.warnings,
}, null, 2))
