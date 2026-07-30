import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  calculateProvenanceCoverage,
  deriveTaxonomyCriteria,
  scoreAnimal,
  validateAnimal,
} from './model.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const [key, ...rest] = argument.replace(/^--/, '').split('=')
  return [key, rest.length ? rest.join('=') : true]
}))
const inputDirectory = path.resolve(root, String(args.input || process.env.npm_config_input || 'data/animals/generated'))
const files = (await readdir(inputDirectory))
  .filter((name) => name.endsWith('.json'))
  .filter((name) => !name.endsWith('-report.json') && !['roster.json', 'review-queue.json'].includes(name))
let changed = 0
const appliedFieldCounts = {}

for (const name of files) {
  const filePath = path.join(inputDirectory, name)
  const animal = JSON.parse(await readFile(filePath, 'utf8'))
  if (!animal.id || !animal.taxonomy) continue
  const derived = deriveTaxonomyCriteria(animal.taxonomy)
  const appliedPaths = []
  for (const [field, value] of Object.entries(derived)) {
    if (Array.isArray(value) && value.length && animal.criteria[field].length === 0) {
      animal.criteria[field] = value
      appliedPaths.push(`criteria.${field}`)
    } else if (!Array.isArray(value) && value !== '' && value !== null && (animal.criteria[field] === '' || animal.criteria[field] === null)) {
      animal.criteria[field] = value
      appliedPaths.push(`criteria.${field}`)
    }
  }
  if (!animal.criteria.lifestyles.length) {
    const inferredLifestyle = animal.criteria.habitats.some((habitat) => ['marine', 'freshwater', 'brackish', 'aquatic'].includes(habitat))
      ? ['aquatic']
      : animal.criteria.habitats.includes('terrestrial')
        ? ['terrestrial']
        : []
    if (inferredLifestyle.length) {
      animal.criteria.lifestyles = inferredLifestyle
      appliedPaths.push('criteria.lifestyles')
    }
  }
  if (!appliedPaths.length) continue
  animal.provenance.push({
    fieldPaths: appliedPaths,
    source: 'Existing sourced taxonomy/habitat + project normalization rules',
    sourceId: String(animal.identity.gbifKey),
    url: `https://www.gbif.org/species/${animal.identity.gbifKey}`,
    license: 'GBIF data-user agreement; derived factual classification',
    retrievedAt: new Date().toISOString(),
    method: 'deterministic class/order/family and habitat-to-lifestyle rule backfill',
    confidence: 0.7,
    raw: null,
  })
  calculateProvenanceCoverage(animal)
  scoreAnimal(animal)
  const errors = validateAnimal(animal)
  if (errors.length) throw new Error(`${name}: ${errors.join('; ')}`)
  await writeFile(filePath, `${JSON.stringify(animal, null, 2)}\n`, 'utf8')
  changed += 1
  for (const fieldPath of appliedPaths) {
    appliedFieldCounts[fieldPath] = (appliedFieldCounts[fieldPath] ?? 0) + 1
  }
}
console.log(JSON.stringify({ changed, appliedFieldCounts }, null, 2))
