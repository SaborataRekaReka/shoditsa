import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  claimItemIds,
  chooseCandidate,
  countryDescriptor,
  developerCountryIds,
  developmentCountryIds,
  entityNames,
  referencedEntityIds,
  relevantEntity,
} from './development-country-lib.mjs'
import { normalizeTitle } from './enrichment-lib.mjs'

const root = process.cwd()
const libraryPath = resolve(root, 'public/data/libraries/games/items.json')
const sourceCatalogPath = resolve(root, 'data/games/enriched/games-catalog.enriched.json')
const displayCachePath = resolve(root, 'data/games/cache/game-displayed-fields-enrichment.json')
const legacyCachePath = resolve(root, 'data/games/cache/wikidata-game-enrichment.json')
const cachePath = resolve(root, 'data/games/cache/game-development-countries.json')
const reportPath = resolve(root, 'data/games/logs/game-development-countries.json')
const manualOverridesPath = resolve(root, 'data/games/manual/game-development-country-overrides.json')

const args = new Set(process.argv.slice(2))
const fetchSources = args.has('--fetch')
const apply = args.has('--apply')
const force = args.has('--force')
const limitArg = process.argv.find((entry) => entry.startsWith('--limit='))
const limit = limitArg ? Math.max(1, Number(limitArg.split('=')[1])) : null
const now = new Date().toISOString()
const userAgent = 'Shoditsa/1.0 game-development-country-enrichment (https://shoditsa.ru)'
const wait = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds))

const mapWithConcurrency = async (values, concurrency, mapper) => {
  const results = new Array(values.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor
      cursor += 1
      results[index] = await mapper(values[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

const readJson = async (path, fallback) => {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback
    throw error
  }
}

const writeJson = async (path, value) => {
  const payload = `${JSON.stringify(value, null, 2)}\n`
  let lastError
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await writeFile(path, payload, 'utf8')
      return
    } catch (error) {
      lastError = error
      await wait(250 * (attempt + 1))
    }
  }
  throw lastError
}

const fetchJson = async (url) => {
  let lastError
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: 'application/json',
          'user-agent': userAgent,
        },
      })
      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Math.min(30, Number(response.headers.get('retry-after')) || 2 ** attempt)
        await wait(retryAfter * 1000)
        continue
      }
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
      return await response.json()
    } catch (error) {
      lastError = error
      await wait(Math.min(10_000, 500 * (2 ** attempt)))
    }
  }
  throw lastError
}

const emptyCache = {
  schemaVersion: 1,
  updatedAt: null,
  policy: {
    source: 'wikidata',
    kinopoiskRequests: 0,
    exactTitleAndYearRequired: true,
    publisherCountryFallback: false,
  },
  searches: {},
  developers: {},
  entities: {},
  byItemId: {},
}

const [library, sourceCatalog, displayCache, legacyCache, storedCache, manualOverrides] = await Promise.all([
  readJson(libraryPath, []),
  readJson(sourceCatalogPath, []),
  readJson(displayCachePath, { wikidataEntities: {}, byItemId: {} }),
  readJson(legacyCachePath, { byName: {} }),
  readJson(cachePath, emptyCache),
  readJson(manualOverridesPath, { items: {} }),
])

const cache = {
  ...emptyCache,
  ...storedCache,
  policy: { ...emptyCache.policy, ...(storedCache.policy ?? {}) },
  searches: storedCache.searches ?? {},
  developers: storedCache.developers ?? {},
  entities: storedCache.entities ?? {},
  byItemId: storedCache.byItemId ?? {},
}

const baseEntities = displayCache.wikidataEntities ?? {}
const entityFor = (qid) => cache.entities[qid] ?? baseEntities[qid] ?? null

const saveCheckpoint = async () => {
  cache.updatedAt = new Date().toISOString()
  await writeJson(cachePath, cache)
}

const searchWikidata = async (query, language) => {
  const key = `${language}:${normalizeTitle(query)}`
  if (!force && cache.searches[key]) return cache.searches[key]
  if (!fetchSources) return []
  const params = new URLSearchParams({
    action: 'wbsearchentities',
    search: query,
    language,
    uselang: language,
    type: 'item',
    limit: '8',
    format: 'json',
  })
  const payload = await fetchJson(`https://www.wikidata.org/w/api.php?${params}`)
  const results = (payload.search ?? []).map((entry) => ({
    id: entry.id,
    label: entry.label ?? null,
    description: entry.description ?? null,
  }))
  cache.searches[key] = results
  await wait(80)
  return results
}

const fetchEntities = async (qids) => {
  const missing = [...new Set(qids)]
    .filter((qid) => /^Q\d+$/u.test(qid) && !entityFor(qid))
  if (!missing.length || !fetchSources) return

  for (let offset = 0; offset < missing.length; offset += 50) {
    const batch = missing.slice(offset, offset + 50)
    const params = new URLSearchParams({
      action: 'wbgetentities',
      ids: batch.join('|'),
      props: 'labels|aliases|descriptions|claims',
      languages: 'ru|en|mul',
      languagefallback: '1',
      format: 'json',
    })
    const payload = await fetchJson(`https://www.wikidata.org/w/api.php?${params}`)
    for (const [qid, entity] of Object.entries(payload.entities ?? {})) {
      cache.entities[qid] = relevantEntity(entity)
    }
    await wait(100)
  }
}

const readyItems = library
  .filter((item) => item.mode === 'game'
    && item.allowedInGame === true
    && item.dailyEligible === true
    && item.contentStatus === 'ready')
  .sort((left, right) => (left.topRank ?? 9999) - (right.topRank ?? 9999))
  .slice(0, limit ?? undefined)

if (!readyItems.length) throw new Error('No ready game items found')
if (!limit && readyItems.length !== 1000) {
  throw new Error(`Expected exactly 1000 ready games, found ${readyItems.length}`)
}

const existingCandidateIds = (item) => {
  const result = new Set()
  const previousIdentity = cache.byItemId[item.id]?.identity
  if (/^Q\d+$/u.test(previousIdentity?.qid ?? '')) result.add(previousIdentity.qid)
  for (const candidate of previousIdentity?.candidates ?? []) {
    if (/^Q\d+$/u.test(candidate?.qid ?? '')) result.add(candidate.qid)
  }
  if (/^Q\d+$/u.test(item.wikidataId ?? '')) result.add(item.wikidataId)
  const displayed = displayCache.byItemId?.[item.id]?.wikidata
  if (/^Q\d+$/u.test(displayed?.qid ?? '')) result.add(displayed.qid)
  for (const candidate of displayed?.candidates ?? []) {
    if (/^Q\d+$/u.test(candidate?.qid ?? '')) result.add(candidate.qid)
  }
  for (const title of [item.titleOriginal, item.titleRu]) {
    const qid = legacyCache.byName?.[normalizeTitle(title)]?.wikidataId
    if (/^Q\d+$/u.test(qid ?? '')) result.add(qid)
  }
  return [...result]
}

const chunkSize = 50
for (let offset = 0; offset < readyItems.length; offset += chunkSize) {
  const chunk = readyItems.slice(offset, offset + chunkSize)
  const candidatesById = new Map()

  const candidateRows = await mapWithConcurrency(chunk, 8, async (item) => {
    const previous = cache.byItemId[item.id]
    if (!force && previous?.identity?.status === 'resolved') {
      return [item.id, [previous.identity.qid]]
    }

    const candidates = new Set(existingCandidateIds(item))
    if (!candidates.size && fetchSources) {
      const queries = [...new Set([
        [item.titleOriginal, 'en'],
        [item.titleRu, 'ru'],
      ].filter(([title]) => String(title ?? '').trim()).map(([title, language]) => `${language}\u0000${title}`))]
      const queryResults = await Promise.all(queries.map(async (encoded) => {
        const [language, title] = encoded.split('\u0000')
        return searchWikidata(title, language)
      }))
      for (const result of queryResults.flat()) candidates.add(result.id)
    }
    return [item.id, [...candidates]]
  })
  for (const [itemId, candidates] of candidateRows) candidatesById.set(itemId, candidates)

  await fetchEntities([...candidatesById.values()].flat())
  await fetchEntities([...candidatesById.values()].flatMap((qids) => (
    qids.flatMap((qid) => referencedEntityIds(entityFor(qid)))
  )))

  for (const item of chunk) {
    const previous = cache.byItemId[item.id]
    if (!force && previous?.identity?.status === 'resolved') continue
    const trustedQid = /^Q\d+$/u.test(item.wikidataId ?? '') ? item.wikidataId : null
    const result = chooseCandidate(item, candidatesById.get(item.id) ?? [], entityFor, trustedQid)
    cache.byItemId[item.id] = {
      itemId: item.id,
      titleRu: item.titleRu,
      titleOriginal: item.titleOriginal,
      year: item.year ?? null,
      identity: result,
      countries: null,
      auditedAt: now,
    }
  }

  if ((offset + chunk.length) % 250 === 0 || offset + chunk.length === readyItems.length) {
    await saveCheckpoint()
  }
  console.log(`identity ${Math.min(offset + chunk.length, readyItems.length)}/${readyItems.length}`)
}

const matchedQids = readyItems
  .map((item) => cache.byItemId[item.id]?.identity?.qid)
  .filter(Boolean)

await fetchEntities(matchedQids)

let frontier = [...new Set(matchedQids)]
const seen = new Set(frontier)
for (let depth = 0; depth < 5 && frontier.length; depth += 1) {
  const references = [...new Set(frontier.flatMap((qid) => referencedEntityIds(entityFor(qid))))]
    .filter((qid) => !seen.has(qid))
  await fetchEntities(references)
  for (const qid of references) seen.add(qid)
  frontier = references
}

const developerKey = (value) => normalizeTitle(value)
const simplifiedDeveloperName = (value) => String(value ?? '')
  .replace(/\s*\([^)]*\)\s*/gu, ' ')
  .replace(/\b(?:incorporated|corporation|company|limited|studios?|software|entertainment)\b\.?/giu, ' ')
  .replace(/\b(?:inc|ltd|llc|gmbh|s\.?a\.?|a\.?b\.?)\b\.?/giu, ' ')
  .replace(/\s+/gu, ' ')
  .trim()

const developerEntityIsRelevant = (entity) => Object.values(entity?.descriptions ?? {})
  .some((entry) => (
    /video game|computer game|software (?:company|developer)|game (?:company|developer|designer|programmer|studio)|разработчик|видеоигр|игровая компания|игровой дизайнер/iu
      .test(entry?.value ?? '')
  ))

const developerEntityCanRepresentCreator = (entity) => (
  !claimItemIds(entity, 'P31').includes('Q7889')
  && !(entity?.claims?.P297?.length)
)

const entityIdsByName = () => {
  const index = new Map()
  for (const [qid, entity] of Object.entries({ ...baseEntities, ...cache.entities })) {
    for (const name of entityNames(entity)) {
      const key = developerKey(name)
      if (!key) continue
      if (!index.has(key)) index.set(key, new Set())
      index.get(key).add(qid)
    }
  }
  return index
}

const uniqueDevelopers = [...new Set(readyItems.flatMap((item) => item.developers ?? []))]
for (let offset = 0; offset < uniqueDevelopers.length; offset += chunkSize) {
  const chunk = uniqueDevelopers.slice(offset, offset + chunkSize)
  const nameIndex = entityIdsByName()
  const candidateRows = await mapWithConcurrency(chunk, 8, async (name) => {
    const key = developerKey(name)
    if (!force && cache.developers[key]?.status === 'resolved'
      && cache.developers[key]?.resolutionVersion === 7) {
      return [name, cache.developers[key].candidateIds ?? []]
    }

    const simplified = simplifiedDeveloperName(name)
    const variants = [...new Set([developerKey(name), developerKey(simplified)].filter(Boolean))]
    const candidates = new Set(variants.flatMap((variant) => [...(nameIndex.get(variant) ?? [])]))
    if (key !== 'various') {
      const queries = [...new Set([name, simplified].filter(Boolean))]
      const results = await Promise.all(queries.map((query) => searchWikidata(query, 'en')))
      for (const result of results.flat()) candidates.add(result.id)
    }
    return [name, [...candidates]]
  })

  await fetchEntities(candidateRows.flatMap(([, qids]) => qids))
  let developerFrontier = [...new Set(candidateRows.flatMap(([, qids]) => qids))]
  const developerSeen = new Set(developerFrontier)
  for (let depth = 0; depth < 4 && developerFrontier.length; depth += 1) {
    const references = [...new Set(developerFrontier.flatMap((qid) => referencedEntityIds(entityFor(qid))))]
      .filter((qid) => !developerSeen.has(qid))
    await fetchEntities(references)
    for (const qid of references) developerSeen.add(qid)
    developerFrontier = references
  }

  for (const [name, candidateIds] of candidateRows) {
    const key = developerKey(name)
    if (!force && cache.developers[key]?.status === 'resolved'
      && cache.developers[key]?.resolutionVersion === 7) continue
    const originalKey = developerKey(name)
    const simplifiedKey = developerKey(simplifiedDeveloperName(name))
    const originalNameCandidates = candidateIds.filter((qid) => (
      developerEntityCanRepresentCreator(entityFor(qid))
      && entityNames(entityFor(qid)).some((entry) => developerKey(entry) === originalKey)
    ))
    const relevantOriginal = originalNameCandidates.filter((qid) => (
      developerEntityIsRelevant(entityFor(qid))
    ))
    const looseRelevant = candidateIds.filter((qid) => (
      developerEntityCanRepresentCreator(entityFor(qid))
      && developerEntityIsRelevant(entityFor(qid))
      && entityNames(entityFor(qid)).some((entry) => (
        developerKey(simplifiedDeveloperName(entry)) === simplifiedKey
      ))
    ))
    const relevantCandidates = relevantOriginal.length
      ? relevantOriginal
      : looseRelevant.length
        ? looseRelevant
        : originalNameCandidates
    const countriesByCandidate = relevantCandidates.map((qid) => ({
      qid,
      countryIds: developerCountryIds(entityFor(qid), entityFor),
    })).filter((entry) => entry.countryIds.length)
    const signatures = [...new Set(countriesByCandidate.map((entry) => (
      [...entry.countryIds].sort().join('|')
    )))]
    const exactCandidates = signatures.length === 1
      ? countriesByCandidate.map((entry) => entry.qid)
      : []
    const countryIds = [...new Set(exactCandidates.flatMap((qid) => (
      developerCountryIds(entityFor(qid), entityFor)
    )))]
    cache.developers[key] = {
      name,
      status: countryIds.length ? 'resolved' : 'unresolved',
      candidateIds: exactCandidates,
      countryIds,
      resolutionVersion: 7,
      auditedAt: now,
    }
  }

  if ((offset + chunk.length) % 250 === 0 || offset + chunk.length === uniqueDevelopers.length) {
    await saveCheckpoint()
  }
  console.log(`developers ${Math.min(offset + chunk.length, uniqueDevelopers.length)}/${uniqueDevelopers.length}`)
}

for (const item of readyItems) {
  const row = cache.byItemId[item.id]
  const manualOverride = manualOverrides.items?.[item.id] ?? null
  const developerRows = (item.developers ?? [])
    .map((name) => cache.developers[developerKey(name)])
    .filter((entry) => entry?.status === 'resolved')
  const preferredDeveloperIds = [...new Set(developerRows.flatMap((entry) => entry.candidateIds))]
  const cardDeveloperCountryIds = [...new Set(preferredDeveloperIds.flatMap((qid) => (
    developerCountryIds(entityFor(qid), entityFor, item.year)
  )))]
  const gameResolution = row?.identity?.status === 'resolved'
    ? developmentCountryIds(entityFor(row.identity.qid), entityFor, preferredDeveloperIds, item.year)
    : null
  const countryResolution = manualOverride?.countryIds?.length
    ? {
        countries: manualOverride.countryIds,
        direct: gameResolution?.direct ?? [],
        byDeveloper: [],
        developerIds: [],
        method: 'manual_verified',
        conflict: false,
        sourceUrls: manualOverride.sourceUrls ?? [],
        note: manualOverride.reason ?? null,
      }
    : cardDeveloperCountryIds.length
    ? {
        countries: cardDeveloperCountryIds,
        direct: gameResolution?.direct ?? [],
        byDeveloper: cardDeveloperCountryIds,
        developerIds: preferredDeveloperIds,
        method: 'card_developer_wikidata',
        conflict: Boolean(gameResolution?.direct?.length)
          && !gameResolution.direct.some((id) => cardDeveloperCountryIds.includes(id)),
      }
    : gameResolution
  if (!countryResolution) {
    row.countries = {
      status: 'unresolved',
      method: 'unresolved',
      conflict: false,
      values: [],
      directCountryIds: [],
      developerCountryIds: [],
      developerIds: [],
    }
    continue
  }
  const descriptors = countryResolution.countries
    .map((qid) => countryDescriptor(qid, entityFor(qid)))
    .filter((entry) => entry.nameRu && entry.wikidataId)
  row.countries = {
    status: descriptors.length ? 'resolved' : 'unresolved',
    method: countryResolution.method,
    conflict: countryResolution.conflict,
    values: descriptors,
    directCountryIds: countryResolution.direct,
    developerCountryIds: countryResolution.byDeveloper,
    developerIds: countryResolution.developerIds,
    ...(countryResolution.sourceUrls ? { sourceUrls: countryResolution.sourceUrls } : {}),
    ...(countryResolution.note ? { note: countryResolution.note } : {}),
  }
}

await saveCheckpoint()

const rows = readyItems.map((item) => cache.byItemId[item.id])
const resolvedIdentities = rows.filter((row) => row?.identity?.status === 'resolved')
const resolvedCountries = rows.filter((row) => row?.countries?.status === 'resolved')
const report = {
  schemaVersion: 1,
  generatedAt: now,
  fetchSources,
  apply,
  sourcePolicy: {
    source: 'wikidata',
    license: 'CC0',
    kinopoiskRequests: 0,
    publisherCountryFallback: false,
    ambiguousMatchesAreNotApplied: true,
  },
  summary: {
    total: readyItems.length,
    identityResolved: resolvedIdentities.length,
    identityUnresolved: rows.filter((row) => row?.identity?.status === 'unresolved').length,
    identityAmbiguous: rows.filter((row) => row?.identity?.status === 'ambiguous').length,
    countriesResolved: resolvedCountries.length,
    countriesDirect: resolvedCountries.filter((row) => row.countries.method === 'wikidata_game_origin').length,
    countriesFromDevelopers: resolvedCountries.filter((row) => (
      ['developer_country', 'card_developer_wikidata'].includes(row.countries.method)
    )).length,
    countriesFromCardDevelopers: resolvedCountries.filter((row) => (
      row.countries.method === 'card_developer_wikidata'
    )).length,
    countriesManualVerified: resolvedCountries.filter((row) => (
      row.countries.method === 'manual_verified'
    )).length,
    countriesMultiple: resolvedCountries.filter((row) => row.countries.values.length > 1).length,
    countriesCrossSourceConflicts: rows.filter((row) => row?.countries?.conflict).length,
    countriesUnresolved: rows.filter((row) => row?.countries?.status === 'unresolved').length,
    kinopoiskRequests: 0,
  },
  unresolved: rows
    .filter((row) => row?.identity?.status !== 'resolved' || row?.countries?.status !== 'resolved')
    .map((row) => ({
      itemId: row?.itemId,
      titleRu: row?.titleRu,
      titleOriginal: row?.titleOriginal,
      year: row?.year,
      identity: row?.identity,
      countries: row?.countries,
    })),
}

if (apply) {
  const countriesById = new Map(resolvedCountries.map((row) => [
    row.itemId,
    row.countries.values.map((country) => country.nameRu),
  ]))
  const detailsById = new Map(resolvedCountries.map((row) => [
    row.itemId,
    row.countries,
  ]))

  const patchCollection = (items) => items.map((item) => {
    const countries = countriesById.get(item.id)
    if (!countries) return item
    const details = detailsById.get(item.id)
    const identityQid = cache.byItemId[item.id]?.identity?.status === 'resolved'
      ? cache.byItemId[item.id].identity.qid
      : null
    const sources = [...new Set([
      ...(item.dataQuality?.source ?? []),
      details.method === 'manual_verified'
        ? 'manual_verified_development_country'
        : 'wikidata_development_country',
    ])]
    return {
      ...item,
      countries,
      ...(item.wikidataId || identityQid ? { wikidataId: item.wikidataId ?? identityQid } : {}),
      ...(item.wikidataUrl || identityQid
        ? { wikidataUrl: item.wikidataUrl ?? `https://www.wikidata.org/wiki/${identityQid}` }
        : {}),
      dataQuality: {
        ...(item.dataQuality ?? {}),
        source: sources,
        fieldSources: {
          ...(item.dataQuality?.fieldSources ?? {}),
          countries: {
            source: details.method === 'manual_verified' ? 'manual_review' : 'wikidata',
            method: details.method,
            countryIds: details.values.map((country) => country.wikidataId),
            countryCodes: details.values.map((country) => country.code).filter(Boolean),
            ...(details.sourceUrls ? { evidenceUrls: details.sourceUrls } : {}),
            ...(details.note ? { note: details.note } : {}),
            auditedAt: now,
          },
        },
      },
    }
  })

  await writeJson(libraryPath, patchCollection(library))
  await writeJson(sourceCatalogPath, patchCollection(sourceCatalog))
}

await writeJson(reportPath, report)
console.log(JSON.stringify(report.summary, null, 2))
