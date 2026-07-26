import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { applySeriesProfileChanges } from './profile-enrichment.mjs'

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const direct = args.find((value) => value.startsWith(`${name}=`))
  if (direct) return direct.slice(name.length + 1)
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : fallback
}

const planPath = resolve(arg('--plan', './var/series-profile-production-plan.json'))
const libraryPath = resolve(arg('--library', './public/data/libraries/series/items.json'))
const plan = JSON.parse(await readFile(planPath, 'utf8'))
const library = JSON.parse(await readFile(libraryPath, 'utf8'))
if (!Array.isArray(plan?.updates) || !Array.isArray(library)) throw new Error('Invalid plan or series library')

const updateByItem = new Map(plan.updates.map((update) => [update.itemId, update]))
let changed = 0
const output = library.map((item) => {
  const update = updateByItem.get(item.id)
  if (!update) return item
  changed += 1
  return applySeriesProfileChanges(item, update.changes)
})

if (changed !== plan.updates.length) {
  throw new Error(`Library matched ${changed} of ${plan.updates.length} planned updates`)
}
await writeFile(libraryPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ libraryPath, items: output.length, changed }, null, 2))
