import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scoreAnimal } from './model.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const [key, ...rest] = argument.replace(/^--/, '').split('=')
  return [key, rest.length ? rest.join('=') : true]
}))
const inputDirectory = path.resolve(root, String(args.input || process.env.npm_config_input || 'data/animals/generated'))
const shortlistPath = path.resolve(root, String(args.shortlist || process.env.npm_config_shortlist || 'data/animals/candidates/shortlist.json'))
const outputPath = path.resolve(root, String(args.out || process.env.npm_config_out || 'data/animals/generated/review-queue.json'))

const shortlist = JSON.parse(await readFile(shortlistPath, 'utf8'))
const shortlistById = new Map(shortlist.candidates.map((candidate) => [candidate.id, candidate]))
const files = (await readdir(inputDirectory))
  .filter((name) => name.endsWith('.json'))
  .filter((name) => !name.endsWith('-report.json') && !['review-queue.json', 'roster.json'].includes(name))
const loadedAnimals = await Promise.all(files.map(async (name) => JSON.parse(await readFile(path.join(inputDirectory, name), 'utf8'))))
const byTaxon = new Map()
for (const animal of loadedAnimals) {
  const key = animal.identity?.acceptedScientificName || animal.id
  const existing = byTaxon.get(key)
  if (!existing || Number(animal.selection?.totalScore ?? 0) > Number(existing.selection?.totalScore ?? 0)) {
    byTaxon.set(key, animal)
  }
}
const animals = [...byTaxon.values()]

const isBroadHabitatOnly = (habitats) => habitats.length > 0
  && habitats.every((habitat) => ['terrestrial', 'marine', 'freshwater', 'brackish'].includes(habitat))
const tasksFor = (animal) => {
  const blocking = []
  const quality = []
  if (!/[А-Яа-яЁё]/.test(animal.identity.commonNameRu)) blocking.push('write-russian-display-name')
  if (!animal.media.primaryImage) blocking.push('find-commercially-usable-primary-image')
  if (animal.quality.coreCriteriaCoverage < 70) blocking.push('complete-selection-critical-criteria')
  if (!animal.hints.sounds.length && !animal.hints.silhouettes.length && !animal.hints.rangeMaps.length) {
    blocking.push('add-identity-specific-hint')
  }
  if (!animal.criteria.habitats.length || isBroadHabitatOnly(animal.criteria.habitats)) quality.push('review-and-refine-habitat')
  if (!animal.criteria.diets.length) quality.push('review-diet')
  if (!animal.criteria.activity.length) quality.push('review-activity-pattern')
  if (!animal.criteria.sizeCategory) quality.push('source-body-size')
  if (!animal.criteria.continents.length || animal.quality.warnings.some((warning) => warning.includes('observed-range proxy'))) {
    quality.push('separate-native-introduced-captive-range')
  }
  if (!animal.hints.distinctiveTraitsRu.length) quality.push('write-original-distinctive-clues')
  if (!animal.hints.sounds.length) quality.push('search-and-license-sound-clue')
  if (animal.ecology.interactionCandidates.prey.length || animal.ecology.interactionCandidates.predators.length) {
    quality.push('review-predator-prey-candidates')
  }
  return { blocking, quality }
}

const queue = animals.map((animal) => {
  scoreAnimal(animal)
  const shortlistEntry = shortlistById.get(animal.id)
  const tasks = tasksFor(animal)
  return {
    id: animal.id,
    commonNameRu: animal.identity.commonNameRu,
    scientificName: animal.identity.acceptedScientificName,
    shortlistRank: shortlistEntry?.shortlistRank ?? null,
    recognitionScore: shortlistEntry?.recognitionScore ?? null,
    generatedScore: animal.selection.totalScore,
    eligible: animal.selection.eligible,
    blockingTasks: tasks.blocking,
    qualityTasks: tasks.quality,
    warnings: animal.quality.warnings,
  }
}).sort((left, right) => (
  Number(right.blockingTasks.length > 0) - Number(left.blockingTasks.length > 0)
  || (left.shortlistRank ?? Number.MAX_SAFE_INTEGER) - (right.shortlistRank ?? Number.MAX_SAFE_INTEGER)
  || left.id.localeCompare(right.id)
))

const taskCounts = {}
for (const entry of queue) {
  for (const task of [...entry.blockingTasks, ...entry.qualityTasks]) {
    taskCounts[task] = (taskCounts[task] ?? 0) + 1
  }
}
const report = {
  generatedAt: new Date().toISOString(),
  generatedAnimalCount: animals.length,
  eligibleCount: animals.filter((animal) => animal.selection.eligible).length,
  blockingReviewCount: queue.filter((entry) => entry.blockingTasks.length).length,
  taskCounts: Object.fromEntries(Object.entries(taskCounts).sort((left, right) => right[1] - left[1])),
  queue,
}
await mkdir(path.dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({
  outputPath: path.relative(root, outputPath),
  generatedAnimalCount: report.generatedAnimalCount,
  eligibleCount: report.eligibleCount,
  blockingReviewCount: report.blockingReviewCount,
  taskCounts: report.taskCounts,
}, null, 2))
