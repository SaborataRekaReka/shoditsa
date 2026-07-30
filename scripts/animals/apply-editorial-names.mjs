import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scoreAnimal } from './model.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const [key, ...rest] = argument.replace(/^--/, '').split('=')
  return [key, rest.length ? rest.join('=') : true]
}))
const inputDirectory = path.resolve(root, String(args.input || process.env.npm_config_input || 'data/animals/generated'))
const namesPath = path.resolve(root, String(args.names || process.env.npm_config_names || 'data/animals/editorial-names-ru.json'))
const names = JSON.parse(await readFile(namesPath, 'utf8'))
const files = (await readdir(inputDirectory))
  .filter((name) => name.endsWith('.json'))
  .filter((name) => !name.endsWith('-report.json') && !['roster.json', 'review-queue.json'].includes(name))
let changed = 0

for (const name of files) {
  const filePath = path.join(inputDirectory, name)
  const animal = JSON.parse(await readFile(filePath, 'utf8'))
  const override = names[animal.identity?.acceptedScientificName] ?? names[animal.identity?.scientificName]
  if (!override?.commonNameRu || animal.identity.commonNameRu === override.commonNameRu) continue
  animal.identity.aliasesRu = [...new Set([
    animal.identity.commonNameRu,
    ...animal.identity.aliasesRu,
  ].filter(Boolean))]
  animal.identity.commonNameRu = override.commonNameRu
  animal.provenance.push({
    fieldPaths: ['identity.commonNameRu', 'identity.aliasesRu'],
    source: 'Project editorial Russian terminology',
    sourceId: override.sourceId ?? animal.identity.wikidataId,
    url: override.url ?? `https://www.wikidata.org/wiki/${animal.identity.wikidataId}`,
    license: 'factual vernacular terminology',
    retrievedAt: new Date().toISOString(),
    method: 'human-reviewed Russian display name for a taxon whose Wikidata Russian label is scientific-only',
    confidence: 0.9,
    raw: null,
  })
  scoreAnimal(animal)
  await writeFile(filePath, `${JSON.stringify(animal, null, 2)}\n`, 'utf8')
  changed += 1
}
console.log(JSON.stringify({ changed }, null, 2))
