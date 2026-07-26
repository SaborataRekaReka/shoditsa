import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  GAME_CANONICAL_REDIRECTS,
  MANUAL_GAME_EXCLUSIONS,
  MANUAL_GAME_TEXT_REPAIRS,
  buildGameCatalogUpgrade,
  summarizeGameCatalog,
} from './production-sync.mjs'

const source = JSON.parse(await readFile(
  new URL('../../public/data/libraries/games/items.json', import.meta.url),
  'utf8',
))
const clone = (value) => JSON.parse(JSON.stringify(value))
const productionizeMedia = (value) => {
  if (typeof value === 'string' && value.startsWith('./data/')) return `/media/${value.slice('./data/'.length)}`
  if (Array.isArray(value)) return value.map(productionizeMedia)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, productionizeMedia(entry)]))
  }
  return value
}

const promotionIds = new Set(Object.entries(MANUAL_GAME_TEXT_REPAIRS)
  .filter(([, repair]) => repair.promote)
  .map(([itemId]) => itemId))
const duplicateIds = new Set(Object.keys(GAME_CANONICAL_REDIRECTS))
const exclusionIds = new Set(Object.keys(MANUAL_GAME_EXCLUSIONS))
const baseAllowedIds = new Set(source
  .filter((item) => (
    item.dailyEligible === true
    && !duplicateIds.has(item.id)
    && !promotionIds.has(item.id)
    && !exclusionIds.has(item.id)
  ))
  .slice(0, 1000 - promotionIds.size)
  .map((item) => item.id))
const syntheticActive = source.map((item) => {
  const production = productionizeMedia(item)
  const allowed = baseAllowedIds.has(item.id)
  return {
    ...production,
    developers: item.developers?.length && !item.developers.includes('Unknown')
      ? item.developers
      : ['Fixture Studio'],
    publishers: item.publishers?.length ? item.publishers : ['Fixture Publisher'],
    allowedInGame: allowed,
    dailyEligible: allowed,
  }
})
const syntheticHeavyRain = syntheticActive.find((item) => item.id === 'tgdb_70434')
syntheticHeavyRain.description = 'Интерактивный психологический триллер о поисках серийного убийцы, где решения четырёх героев меняют дальнейшие события.'
let legacyLego = syntheticActive.find((item) => item.id === 'tgdb_4845')
const canonicalLego = syntheticActive.find((item) => item.id === 'tgdb_75030')
if (!legacyLego && canonicalLego) {
  legacyLego = {
    ...clone(canonicalLego),
    id: 'tgdb_4845',
    canonicalGameId: 'tgdb_75030',
    canonicalId: 'tgdb_75030',
    parentCanonicalGameId: 'tgdb_75030',
    dailyEligible: false,
    allowedInGame: false,
    contentStatus: 'duplicate',
  }
  syntheticActive.push(legacyLego)
}
if (!syntheticActive.some((item) => item.id === 'tgdb_75030')) {
  syntheticActive.push({
    ...clone(legacyLego),
    id: 'tgdb_75030',
    canonicalGameId: 'tgdb_75030',
    canonicalId: 'tgdb_75030',
    parentCanonicalGameId: null,
    titleRu: 'LEGO Star Wars II: The Original Trilogy',
    titleOriginal: 'LEGO Star Wars II: The Original Trilogy',
    dailyEligible: true,
    allowedInGame: true,
    contentStatus: 'ready',
  })
}

test('builds a deterministic 1000-card pool without API data or playable duplicates', () => {
  const auditedAt = '2026-07-26T00:00:00.000Z'
  const result = buildGameCatalogUpgrade({
    activeGames: syntheticActive,
    localGames: source,
    auditedAt,
  })
  const repeated = buildGameCatalogUpgrade({
    activeGames: syntheticActive,
    localGames: source,
    auditedAt,
  })

  assert.equal(result.apiRequests, 0)
  assert.equal(JSON.stringify(result), JSON.stringify(repeated))
  assert.equal(result.summary.allowed, 1000)
  assert.equal(result.summary.ranks.filled, 1000)
  assert.equal(result.summary.ranks.unique, 1000)
  assert.equal(result.summary.ranks.min, 1)
  assert.equal(result.summary.ranks.max, 1000)
  assert.equal(result.summary.defects.duplicateTitleYears.length, 0)
  assert.equal(result.summary.defects.duplicateSteamIds.length, 0)
  assert.equal(result.summary.defects.invalidAllowedMedia.length, 0)
  assert.equal(result.summary.defects.redactedDescriptions, 0)
  assert.equal(result.summary.defects.redactedShortDescriptions, 0)
  assert.equal(result.summary.defects.serviceMarkers, 0)
  assert.equal(result.summary.defects.mojibake, 0)
  assert.ok(Object.values(result.summary.required).every((coverage) => coverage.missing === 0))
})

test('keeps canonical TGDB identities and makes every confirmed duplicate non-playable', () => {
  const result = buildGameCatalogUpgrade({
    activeGames: syntheticActive,
    localGames: source,
    auditedAt: '2026-07-26T00:00:00.000Z',
  })
  const byId = new Map(result.items.map((item) => [item.id, item]))

  for (const [duplicateId, canonicalId] of Object.entries(GAME_CANONICAL_REDIRECTS)) {
    const duplicate = byId.get(duplicateId)
    const canonical = byId.get(canonicalId)
    assert.ok(duplicate, duplicateId)
    assert.ok(canonical, canonicalId)
    assert.equal(duplicate.allowedInGame, false)
    assert.equal(duplicate.dailyEligible, false)
    assert.equal(duplicate.contentStatus, 'duplicate')
    assert.equal(duplicate.canonicalGameId, canonicalId)
    assert.equal(canonical.allowedInGame, true)
    assert.equal(canonical.canonicalGameId, canonicalId)
  }
})

test('preserves stronger active copy while enriching structured metadata', () => {
  const active = syntheticActive.map(clone)
  const target = active.find((item) => item.id === 'tgdb_120376')
  target.description = 'Проверенное русское описание из активной базы.'
  target.plotHint = 'Проверенная русская подсказка о героине и необычном федеральном бюро.'
  const result = buildGameCatalogUpgrade({
    activeGames: active,
    localGames: source,
    auditedAt: '2026-07-26T00:00:00.000Z',
  })
  const card = result.items.find((item) => item.id === 'tgdb_120376')

  assert.equal(card.description, target.description)
  assert.notEqual(card.plotHint, '')
  assert.ok(card.acceptedAnswers.length >= 1)
  assert.ok(card.normalizedAnswers.length >= 1)
  assert.deepEqual(summarizeGameCatalog(result.items), result.summary)
})
