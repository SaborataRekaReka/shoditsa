import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const arg = (name) => {
  const inline = process.argv.find((value) => value.startsWith(name + '='))
  if (inline) return inline.slice(name.length + 1)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const integerArg = (name, fallback) => {
  const raw = arg(name)
  if (raw == null) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0) throw new Error(name + ' must be a non-negative integer')
  return value
}

const present = (value) => Array.isArray(value) ? value.length > 0 : value != null && String(value).trim() !== ''
const normalize = (value) => String(value ?? '')
  .toLocaleLowerCase('ru-RU')
  .replace(/ё/g, 'е')
  .normalize('NFKD')
  .replace(/\p{M}+/gu, '')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()

const mode = String(arg('--mode') ?? process.argv[2] ?? '').trim()
const dataDir = String(arg('--data-dir') ?? process.argv[3] ?? '').trim()
if (!mode || !dataDir) {
  throw new Error('Usage: --mode=<id> --data-dir=<directory> [--expected=N] [--min-playable=N] [--criteria=a,b] [--min-criteria=N] [--require-poster] [--strict-aliases]')
}

const sourceRoot = resolve(arg('--source') ?? './public/data/libraries')
const file = join(sourceRoot, dataDir, 'items.json')
const expected = integerArg('--expected', null)
const minPlayable = integerArg('--min-playable', expected ?? 1)
const criteria = String(arg('--criteria') ?? '').split(',').map((value) => value.trim()).filter(Boolean)
const minCriteria = integerArg('--min-criteria', criteria.length ? Math.min(4, criteria.length) : 0)
const requirePoster = process.argv.includes('--require-poster')
const strictAliases = process.argv.includes('--strict-aliases')

const parsed = JSON.parse(await readFile(file, 'utf8'))
if (!Array.isArray(parsed) || parsed.length === 0) throw new Error(file + ': expected a non-empty JSON array')
if (expected != null && parsed.length !== expected) throw new Error(mode + ': expected ' + expected + ' cards, found ' + parsed.length)

const ids = new Set()
const aliases = new Map()
const playable = []
const failures = []
const aliasCollisions = []
const aliasCollisionKeys = new Set()
const blockedStatuses = new Set(['blocked', 'review', 'duplicate', 'promo_pack'])

for (const [index, item] of parsed.entries()) {
  const label = item && typeof item === 'object' ? String(item.id ?? (file + '[' + index + ']')) : file + '[' + index + ']'
  if (!item || typeof item !== 'object' || Array.isArray(item)) { failures.push(label + ': card must be an object'); continue }
  if (!item.id || typeof item.id !== 'string') failures.push(label + ': id is required')
  else if (ids.has(item.id)) failures.push(label + ': duplicate id')
  else ids.add(item.id)
  if (item.mode !== mode) failures.push(label + ': expected mode ' + mode + ', got ' + String(item.mode))
  if (typeof item.titleRu !== 'string' || !item.titleRu.trim()) failures.push(label + ': titleRu is required')
  if (typeof item.titleOriginal !== 'string') failures.push(label + ': titleOriginal must be a string')
  if (!Array.isArray(item.alternativeTitles)) failures.push(label + ': alternativeTitles must be an array')
  if (!Number.isFinite(item.popularityScore)) failures.push(label + ': popularityScore must be finite')
  if (requirePoster && !present(item.posterUrl)) failures.push(label + ': posterUrl is required')

  const isPlayable = item.allowedInGame !== false && !blockedStatuses.has(String(item.contentStatus ?? ''))
  if (isPlayable) {
    playable.push(item)
    const criterionCount = criteria.filter((field) => present(item[field])).length
    if (criterionCount < minCriteria) failures.push(label + ': only ' + criterionCount + '/' + criteria.length + ' comparison criteria are present; minimum is ' + minCriteria)
  }

  for (const alias of [item.titleRu, item.titleOriginal, ...(Array.isArray(item.alternativeTitles) ? item.alternativeTitles : []), ...(Array.isArray(item.aliases) ? item.aliases : [])]) {
    const key = normalize(alias)
    if (!key) continue
    const previous = aliases.get(key)
    if (previous && previous !== item.id) {
      const collisionKey = [key, item.id, previous].sort().join('|')
      if (!aliasCollisionKeys.has(collisionKey)) {
        aliasCollisionKeys.add(collisionKey)
        aliasCollisions.push({ alias: String(alias), itemId: item.id, collidesWith: previous })
      }
      if (strictAliases) failures.push(label + ': answer alias “' + alias + '” collides with ' + previous)
    }
    else aliases.set(key, item.id)
  }
}

if (playable.length < minPlayable) failures.push(mode + ': only ' + playable.length + ' playable cards; minimum is ' + minPlayable)
if (failures.length) throw new Error('Game mode release preflight failed:\n- ' + [...new Set(failures)].join('\n- '))

const coverage = Object.fromEntries(criteria.map((field) => [
  field,
  Number((playable.filter((item) => present(item[field])).length / Math.max(playable.length, 1) * 100).toFixed(1)),
]))

console.log(JSON.stringify({
  status: 'ready',
  mode,
  dataDir,
  file,
  cards: parsed.length,
  playable: playable.length,
  aliases: aliases.size,
  aliasCollisions,
  minimumCriteriaPerCard: minCriteria,
  criteriaCoveragePercent: coverage,
}, null, 2))
