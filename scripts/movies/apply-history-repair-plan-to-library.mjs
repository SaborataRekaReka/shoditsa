import { access, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  applyMovieHistoryChanges,
  localizeProductionMedia,
  sameJsonValue,
  validPeople,
} from './history-repair.mjs'

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const direct = args.find((value) => value.startsWith(`${name}=`))
  if (direct) return direct.slice(name.length + 1)
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : fallback
}

const checkOnly = args.includes('--check')
const planPath = resolve(arg('--plan', './var/movie-history-repair-plan.json'))
const libraryPath = resolve(arg('--library', './public/data/libraries/movies/items.json'))
const plan = JSON.parse(await readFile(planPath, 'utf8'))
const library = JSON.parse(await readFile(libraryPath, 'utf8'))

if (
  plan?.schemaVersion !== 1
  || plan?.apiRequests !== 0
  || !Array.isArray(plan?.updates)
  || !Array.isArray(plan?.localSync?.productionOnlyItems)
  || !Array.isArray(plan?.localSync?.productionOrder)
  || !Array.isArray(library)
) {
  throw new Error('Invalid movie history repair plan or local library')
}

const byId = new Map(library.map((item) => [item.id, item]))
if (byId.size !== library.length) throw new Error('Local movie library contains duplicate IDs')

let added = 0
for (const planned of plan.localSync.productionOnlyItems) {
  if (byId.has(planned.itemId)) continue
  const payload = localizeProductionMedia(planned.payload)
  if (payload.id !== planned.itemId || payload.mode !== 'movie') {
    throw new Error(`Invalid production-only movie payload: ${planned.itemId}`)
  }
  byId.set(planned.itemId, payload)
  added += 1
}

let updated = 0
for (const update of plan.updates) {
  const item = byId.get(update.itemId)
  if (!item) throw new Error(`Repair target is absent from local movie library: ${update.itemId}`)
  const localizedChanges = update.changes.map((change) => ({
    ...change,
    before: localizeProductionMedia(change.before),
    after: localizeProductionMedia(change.after),
  }))

  let needsApply = false
  for (const change of localizedChanges) {
    const hasField = Object.hasOwn(item, change.field)
    const current = hasField ? item[change.field] : null
    if (change.operation === 'delete' && !hasField) continue
    if (change.operation === 'set' && sameJsonValue(current, change.after)) continue
    if (!sameJsonValue(current, change.before)) {
      throw new Error(`Local movie field differs from repair plan: ${update.itemId}.${change.field}`)
    }
    needsApply = true
  }
  if (!needsApply) continue
  byId.set(update.itemId, applyMovieHistoryChanges(item, localizedChanges))
  updated += 1
}

const order = new Map(plan.localSync.productionOrder.map((itemId, index) => [itemId, index]))
const output = [...byId.values()].sort((left, right) => {
  const leftOrder = order.get(left.id)
  const rightOrder = order.get(right.id)
  if (leftOrder == null || rightOrder == null) throw new Error('Local movie is absent from production order')
  return leftOrder - rightOrder
})

if (
  output.length !== plan.localSync.productionItems
  || output.some((item, index) => item.id !== plan.localSync.productionOrder[index])
) {
  throw new Error('Local movie library does not match the planned production order')
}
if (output.some((item) => !validPeople(item.directors) || !validPeople(item.writers))) {
  throw new Error('Local movie library still contains empty directors or writers')
}
if (output.some((item) => (
  Object.hasOwn(item, 'seriesStatus')
  || validPeople(item.showrunners)
  || item.dataQuality?.source?.includes('series_status_fallback')
))) {
  throw new Error('Local movie library still contains stale series metadata')
}

const localUrls = new Set()
const collectLocalUrls = (value) => {
  if (typeof value === 'string' && value.startsWith('./data/')) localUrls.add(value)
  else if (Array.isArray(value)) value.forEach(collectLocalUrls)
  else if (value && typeof value === 'object') Object.values(value).forEach(collectLocalUrls)
}
output.forEach(collectLocalUrls)

const missingLocalAssets = []
for (const url of localUrls) {
  const filePath = resolve('./public', url.slice(2))
  try {
    await access(filePath)
  } catch {
    missingLocalAssets.push(url)
  }
}
if (missingLocalAssets.length) {
  throw new Error(`Local movie library references missing assets: ${JSON.stringify(missingLocalAssets.slice(0, 25))}`)
}

if (!checkOnly) await writeFile(libraryPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({
  libraryPath,
  checkOnly,
  itemsBefore: library.length,
  itemsAfter: output.length,
  added,
  updated,
  localAssetsChecked: localUrls.size,
  missingLocalAssets: missingLocalAssets.length,
}, null, 2))

