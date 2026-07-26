import { createHash } from 'node:crypto'
import { access, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { answerVariants, normalizeTitle } from './enrichment-lib.mjs'

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const direct = args.find((value) => value.startsWith(`${name}=`))
  if (direct) return direct.slice(name.length + 1)
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : fallback
}

const checkOnly = args.includes('--check')
const planPath = resolve(arg('--plan', './var/game-production-sync-plan.json'))
const libraryPath = resolve(arg('--library', './public/data/libraries/games/items.json'))
const searchIndexPath = resolve(arg('--search-index', './public/data/libraries/games/search-index.json'))
const canonicalJson = (value) => {
  if (Array.isArray(value)) return value.map(canonicalJson)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right, 'en-US'))
      .map(([key, entry]) => [key, canonicalJson(entry)]))
  }
  return value
}
const digest = (value) => createHash('sha256')
  .update(JSON.stringify(canonicalJson(value)))
  .digest('hex')
const localizeMedia = (value) => {
  if (typeof value === 'string') {
    if (value.startsWith('/media/content/game/')) {
      return `./data/libraries/games/img/${value.slice('/media/content/game/'.length)}`
    }
    if (value.startsWith('/media/libraries/games/img/')) {
      return `./data/libraries/games/img/${value.slice('/media/libraries/games/img/'.length)}`
    }
    return value
  }
  if (Array.isArray(value)) return value.map(localizeMedia)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, localizeMedia(entry)]))
  }
  return value
}

const plan = JSON.parse(await readFile(planPath, 'utf8'))
const library = JSON.parse(await readFile(libraryPath, 'utf8'))
if (
  plan?.schemaVersion !== 1
  || plan?.apiRequests !== 0
  || !Array.isArray(plan?.target?.localItems)
  || !Array.isArray(library)
) {
  throw new Error('Invalid game production sync plan or local library')
}

const currentChecksum = digest(library)
if (digest(plan.target.localItems) !== plan.target.localChecksum) {
  throw new Error('Planned local game library checksum is invalid')
}
const localizedPlanOutput = localizeMedia(plan.target.localItems)
const output = localizedPlanOutput.filter((item) => !['tgdb_10221_1', 'tgdb_4845'].includes(item.id))
const outputChecksum = digest(output)
const intermediateChecksum = digest(localizedPlanOutput)
const priorFilteredChecksum = digest(localizedPlanOutput.filter((item) => item.id !== 'tgdb_10221_1'))
if (![plan.localSource?.checksum, intermediateChecksum, priorFilteredChecksum, outputChecksum].includes(currentChecksum)) {
  throw new Error('Local game library differs from the plan source, intermediate output and localized target')
}
if (output.length !== 2272) {
  throw new Error(`Expected 2272 synchronized local game cards, found ${output.length}`)
}
if (new Set(output.map((item) => item.id)).size !== output.length) {
  throw new Error('Synchronized local game library contains duplicate IDs')
}
const allowed = output.filter((item) => item.allowedInGame === true)
if (allowed.length !== 1000) {
  throw new Error(`Expected exactly 1000 playable local games, found ${allowed.length}`)
}
if (
  new Set(allowed.map((item) => item.topRank)).size !== 1000
  || Math.min(...allowed.map((item) => item.topRank)) !== 1
  || Math.max(...allowed.map((item) => item.topRank)) !== 1000
) {
  throw new Error('Synchronized local game ranks are not exactly 1..1000')
}

const mediaUrls = new Set()
const collectMedia = (value) => {
  if (typeof value === 'string' && (value.startsWith('./data/') || value.startsWith('/media/'))) {
    mediaUrls.add(value)
  } else if (Array.isArray(value)) {
    value.forEach(collectMedia)
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach(collectMedia)
  }
}
output.forEach(collectMedia)

const missingMedia = []
for (const url of mediaUrls) {
  const filePath = url.startsWith('./data/')
    ? resolve('./public', url.slice(2))
    : resolve(`./public${url}`)
  try {
    await access(filePath)
  } catch {
    missingMedia.push(url)
  }
}
if (missingMedia.length) {
  throw new Error(`Synchronized local game library references missing media: ${JSON.stringify(missingMedia.slice(0, 30))}`)
}

const buildSearchIndex = (items) => {
  const tokenMap = new Map()
  const docs = [...items]
    .sort((left, right) => (
      String(left.titleRu).localeCompare(String(right.titleRu), 'ru-RU')
      || String(left.id).localeCompare(String(right.id), 'en-US')
    ))
    .map((item) => {
      const tokens = new Set(answerVariants(
        item.titleRu,
        item.titleOriginal,
        item.localizedTitles?.ru,
        item.localizedTitles?.en,
        item.alternativeTitles,
        item.aliases,
        item.acceptedAnswers,
        item.normalizedAnswers,
      )
        .flatMap((value) => normalizeTitle(value).split(' '))
        .filter((value) => value.length >= 2))
      for (const token of tokens) {
        const ids = tokenMap.get(token) ?? []
        ids.push(item.id)
        tokenMap.set(token, ids)
      }
      return {
        id: item.id,
        titleRu: item.titleRu,
        titleOriginal: item.titleOriginal,
        alternativeTitles: item.alternativeTitles ?? [],
        year: Number.isFinite(item.year) ? item.year : null,
        topRank: Number.isFinite(item.topRank) ? item.topRank : null,
        steamAppId: item.steamAppId ?? null,
        icd10: [],
      }
    })
  const entries = [...tokenMap.entries()]
    .sort((left, right) => left[0].localeCompare(right[0], 'ru-RU'))
    .map(([token, ids]) => [token, [...new Set(ids)]])
  return {
    version: 2,
    library: 'games',
    generatedAt: plan.generatedAt,
    totalItems: docs.length,
    tokensCount: entries.length,
    docs,
    tokenToIds: Object.fromEntries(entries),
  }
}

const searchIndex = buildSearchIndex(output)
if (searchIndex.totalItems !== output.length || searchIndex.tokensCount === 0) {
  throw new Error('Synchronized game search index is incomplete')
}

if (!checkOnly) {
  await writeFile(libraryPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
  await writeFile(searchIndexPath, `${JSON.stringify(searchIndex, null, 2)}\n`, 'utf8')
}

console.log(JSON.stringify({
  planPath,
  libraryPath,
  searchIndexPath,
  checkOnly,
  itemsBefore: library.length,
  itemsAfter: output.length,
  allowed: allowed.length,
  mediaChecked: mediaUrls.size,
  missingMedia: missingMedia.length,
  searchTokens: searchIndex.tokensCount,
  productionChecksum: plan.target.localChecksum,
  localizedChecksum: outputChecksum,
}, null, 2))
