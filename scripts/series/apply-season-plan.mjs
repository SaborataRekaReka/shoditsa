import { readFile, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const exact = args.find((value) => value.startsWith(`${name}=`))
  if (exact) return exact.slice(name.length + 1)
  const index = args.indexOf(name)
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback
}

const planArg = arg('--plan')
if (!planArg) throw new Error('--plan <path> is required')

const planPath = resolve(root, planArg)
const libraryPath = resolve(root, arg('--library', 'public/data/libraries/series/items.json'))
const plan = JSON.parse(await readFile(planPath, 'utf8'))
const items = JSON.parse(await readFile(libraryPath, 'utf8'))
if (plan?.schemaVersion !== 1 || !Array.isArray(plan?.updates)) throw new Error('Unsupported season plan')
if (!Array.isArray(items)) throw new Error('Series library must be an array')

const byId = new Map(items.map((item) => [item?.id, item]))
const absent = []
let changed = 0

for (const update of plan.updates) {
  const item = byId.get(update?.itemId)
  if (!item) {
    absent.push(update?.itemId ?? null)
    continue
  }
  const kinopoiskId = Number(item.kinopoiskId)
  if (!Number.isInteger(kinopoiskId) || kinopoiskId !== Number(update.kinopoiskId)) {
    throw new Error(`Kinopoisk identity mismatch for ${update.itemId}`)
  }
  const seasonsCount = Number(update.seasonsCount)
  if (!Number.isInteger(seasonsCount) || seasonsCount <= 0) {
    throw new Error(`Invalid seasonsCount for ${update.itemId}`)
  }

  const sources = Array.isArray(item?.dataQuality?.source) ? item.dataQuality.source : []
  const nextSources = [...new Set([
    ...sources.filter((source) => ![
      'series_meta_conflict',
      'series_meta_wikidata',
      'series_meta_tvmaze',
      'series_meta_wikidata_tvmaze',
    ].includes(source)),
    'series_meta_kinopoisk',
  ])]
  const hasChanged = item.seasonsCount !== seasonsCount
    || JSON.stringify(sources) !== JSON.stringify(nextSources)
  item.seasonsCount = seasonsCount
  item.dataQuality = { ...(item.dataQuality ?? {}), source: nextSources }
  if (hasChanged) changed += 1
}

const temporaryPath = `${libraryPath}.season-plan-${process.pid}.tmp`
await writeFile(temporaryPath, `${JSON.stringify(items, null, 2)}\n`, 'utf8')
await rename(temporaryPath, libraryPath)

const missingAfter = items.filter((item) => (
  item?.mode === 'series'
  && (!Number.isInteger(Number(item.seasonsCount)) || Number(item.seasonsCount) <= 0)
)).length

console.log(JSON.stringify({
  libraryPath,
  planUpdates: plan.updates.length,
  changed,
  absent: absent.length,
  absentIds: absent,
  missingAfter,
}, null, 2))
