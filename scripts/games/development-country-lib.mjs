import { answerVariants, normalizeTitle } from './enrichment-lib.mjs'

const compact = (values) => [...new Set((Array.isArray(values) ? values : [])
  .map((value) => String(value ?? '').trim())
  .filter(Boolean))]

export const claimValues = (entity, property) => (entity?.claims?.[property] ?? [])
  .filter((statement) => statement.rank !== 'deprecated' && statement.mainsnak?.snaktype === 'value')
  .map((statement) => statement.mainsnak.datavalue?.value)
  .filter((value) => value != null)

export const claimItemIds = (entity, property) => compact(
  claimValues(entity, property).map((value) => value?.id),
)

export const claimStrings = (entity, property) => compact(
  claimValues(entity, property).map((value) => typeof value === 'string' ? value : null),
)

export const releaseYears = (entity) => compact(claimValues(entity, 'P577')
  .map((value) => String(value?.time ?? '').match(/^\+(-?\d{4,})-/u)?.[1]))
  .map(Number)
  .filter(Number.isInteger)

export const entityNames = (entity) => compact([
  ...Object.values(entity?.labels ?? {}).map((entry) => entry?.value),
  ...Object.values(entity?.aliases ?? {}).flatMap((entries) => (
    Array.isArray(entries) ? entries.map((entry) => entry?.value) : []
  )),
])

const descriptions = (entity) => compact(
  Object.values(entity?.descriptions ?? {}).map((entry) => entry?.value),
)

const normalizedNames = (values) => new Set(compact(values).map(normalizeTitle).filter(Boolean))

const itemNameSet = (item) => normalizedNames(answerVariants(
  item.titleRu,
  item.titleOriginal,
  item.localizedTitles?.ru,
  item.localizedTitles?.en,
  item.alternativeTitles,
  item.aliases,
  item.acceptedAnswers,
))

const entityIsGame = (entity) => {
  const instances = claimItemIds(entity, 'P31')
  if (instances.includes('Q7889')) return true
  return descriptions(entity).some((value) => (
    /video game|computer game|videojuego|videospiel|jeu vidéo|видеоигр|компьютерн\w* игр/iu.test(value)
  ))
}

const platformKey = (value) => {
  const normalized = normalizeTitle(value)
  if (!normalized) return ''
  if (/^(?:pc|windows|mac|macos|linux|dos|ms dos)$/u.test(normalized)) return 'pc'
  if (/playstation 1|sony playstation$|^playstation$/u.test(normalized)) return 'playstation'
  if (/playstation 2/u.test(normalized)) return 'playstation 2'
  if (/playstation 3/u.test(normalized)) return 'playstation 3'
  if (/playstation 4/u.test(normalized)) return 'playstation 4'
  if (/playstation 5/u.test(normalized)) return 'playstation 5'
  if (/xbox 360/u.test(normalized)) return 'xbox 360'
  if (/xbox one/u.test(normalized)) return 'xbox one'
  if (/xbox series/u.test(normalized)) return 'xbox series'
  if (/^microsoft xbox$|^xbox$/u.test(normalized)) return 'xbox'
  if (/nintendo entertainment system|^nes$/u.test(normalized)) return 'nes'
  if (/super nintendo|^snes$/u.test(normalized)) return 'snes'
  if (/nintendo 64/u.test(normalized)) return 'nintendo 64'
  if (/game boy advance/u.test(normalized)) return 'game boy advance'
  if (/game boy color/u.test(normalized)) return 'game boy color'
  if (/^game boy$/u.test(normalized)) return 'game boy'
  if (/nintendo gamecube|^gamecube$/u.test(normalized)) return 'gamecube'
  if (/nintendo switch/u.test(normalized)) return 'nintendo switch'
  if (/nintendo 3ds/u.test(normalized)) return 'nintendo 3ds'
  if (/nintendo ds/u.test(normalized)) return 'nintendo ds'
  if (/nintendo wii u/u.test(normalized)) return 'wii u'
  if (/nintendo wii|^wii$/u.test(normalized)) return 'wii'
  if (/sega mega drive|sega genesis/u.test(normalized)) return 'sega genesis'
  if (/dreamcast/u.test(normalized)) return 'dreamcast'
  if (/arcade/u.test(normalized)) return 'arcade'
  return normalized
}

const labelsForIds = (ids, entityFor) => compact(ids.flatMap((id) => entityNames(entityFor(id))))

export const candidateMatch = (item, entity, entityFor = () => null) => {
  const names = itemNameSet(item)
  const nameMatch = entityNames(entity).some((value) => names.has(normalizeTitle(value)))
  const years = releaseYears(entity)
  const year = Number(item.year)
  const yearDistance = Number.isInteger(year) && years.length
    ? Math.min(...years.map((entry) => Math.abs(entry - year)))
    : null
  const yearMatch = yearDistance != null && yearDistance <= 1
  const isGame = entityIsGame(entity)

  const itemPlatforms = new Set(compact(item.platforms).map(platformKey).filter(Boolean))
  const entityPlatforms = new Set(
    labelsForIds(claimItemIds(entity, 'P400'), entityFor).map(platformKey).filter(Boolean),
  )
  const platformOverlap = [...itemPlatforms].some((value) => entityPlatforms.has(value))

  const itemDevelopers = itemNameSet({
    titleRu: '',
    titleOriginal: '',
    alternativeTitles: item.developers ?? [],
  })
  const entityDevelopers = normalizedNames(
    labelsForIds(claimItemIds(entity, 'P178'), entityFor),
  )
  const developerOverlap = [...itemDevelopers].some((value) => entityDevelopers.has(value))

  const valid = nameMatch && isGame && yearMatch
  const score = (nameMatch ? 55 : 0)
    + (yearDistance === 0 ? 30 : yearDistance === 1 ? 22 : 0)
    + (isGame ? 10 : 0)
    + (platformOverlap ? 4 : 0)
    + (developerOverlap ? 6 : 0)

  return {
    valid,
    score,
    nameMatch,
    isGame,
    years,
    yearDistance,
    yearMatch,
    platformOverlap,
    developerOverlap,
  }
}

export const chooseCandidate = (item, candidates, entityFor, trustedQid = null) => {
  const ranked = compact(candidates)
    .map((qid) => ({ qid, match: candidateMatch(item, entityFor(qid), entityFor) }))
    .filter((entry) => entry.match.valid)
    .sort((left, right) => right.match.score - left.match.score || left.qid.localeCompare(right.qid))

  const trusted = trustedQid && ranked.find((entry) => entry.qid === trustedQid)
  if (trusted) return { status: 'resolved', ...trusted, resolution: 'trusted_existing_id' }
  if (!ranked.length) return { status: 'unresolved', candidates: [] }
  if (ranked.length > 1 && ranked[0].match.score === ranked[1].match.score) {
    return { status: 'ambiguous', candidates: ranked.slice(0, 5) }
  }
  return { status: 'resolved', ...ranked[0], resolution: 'title_year_verified' }
}

const locationCountries = (entity, entityFor, depth = 0, seen = new Set()) => {
  if (!entity || depth > 3 || seen.has(entity.id)) return []
  seen.add(entity.id)
  const direct = compact([
    ...claimItemIds(entity, 'P17'),
    ...claimItemIds(entity, 'P495'),
  ])
  if (direct.length) return direct
  return compact(claimItemIds(entity, 'P131')
    .flatMap((id) => locationCountries(entityFor(id), entityFor, depth + 1, seen)))
}

const qualifierYear = (statement, property) => {
  const value = statement?.qualifiers?.[property]?.[0]?.datavalue?.value
  const match = String(value?.time ?? '').match(/^\+(-?\d{4,})-/u)
  return match ? Number(match[1]) : null
}

const itemIdsAtYear = (entity, property, year) => compact(
  (entity?.claims?.[property] ?? [])
    .filter((statement) => {
      if (statement.rank === 'deprecated' || statement.mainsnak?.snaktype !== 'value') return false
      if (!Number.isInteger(year)) return true
      const start = qualifierYear(statement, 'P580')
      const end = qualifierYear(statement, 'P582')
      return (start == null || year >= start) && (end == null || year <= end)
    })
    .map((statement) => statement.mainsnak.datavalue?.value?.id),
)

const descriptionCountryIds = (entity) => {
  const text = descriptions(entity).join(' ')
  const mappings = [
    [/\bJapanese\b|японск/iu, 'Q17'],
    [/\bAmerican\b|американск/iu, 'Q30'],
    [/\bBritish\b|британск/iu, 'Q145'],
    [/\bCanadian\b|канадск/iu, 'Q16'],
    [/\bGerman\b|немецк/iu, 'Q183'],
    [/\bFrench\b|французск/iu, 'Q142'],
    [/\bSwedish\b|шведск/iu, 'Q34'],
    [/\bPolish\b|польск/iu, 'Q36'],
    [/\bUkrainian\b|украинск/iu, 'Q212'],
    [/\bRussian\b|российск/iu, 'Q159'],
    [/\bDutch\b|нидерландск/iu, 'Q55'],
    [/\bAustralian\b|австралийск/iu, 'Q408'],
  ]
  return compact(mappings.filter(([pattern]) => pattern.test(text)).map(([, qid]) => qid))
}

export const developerCountryIds = (developer, entityFor, year = null) => {
  const describedCountries = descriptionCountryIds(developer)
  if (describedCountries.length === 1) return describedCountries
  const operatingCountries = itemIdsAtYear(developer, 'P17', year)
  if (operatingCountries.length) return operatingCountries
  const originCountries = claimItemIds(developer, 'P495')
  if (originCountries.length) return originCountries
  const citizenshipCountries = claimItemIds(developer, 'P27')
  if (citizenshipCountries.length) return citizenshipCountries
  return compact(claimItemIds(developer, 'P159')
    .flatMap((locationId) => locationCountries(entityFor(locationId), entityFor)))
}

export const developmentCountryIds = (gameEntity, entityFor, preferredDeveloperIds = [], year = null) => {
  const direct = claimItemIds(gameEntity, 'P495')
  const developers = claimItemIds(gameEntity, 'P178')
  const preferred = compact(preferredDeveloperIds).filter((id) => developers.includes(id))
  const developersUsed = preferred.length ? preferred : developers
  const byDeveloper = compact(developersUsed.flatMap((developerId) => (
    developerCountryIds(entityFor(developerId), entityFor, year)
  )))

  const countries = byDeveloper.length ? byDeveloper : direct
  const conflict = direct.length > 0
    && byDeveloper.length > 0
    && !direct.some((id) => byDeveloper.includes(id))

  return {
    countries,
    direct,
    byDeveloper,
    developerIds: developersUsed,
    method: byDeveloper.length ? 'developer_country' : direct.length ? 'wikidata_game_origin' : 'unresolved',
    conflict,
  }
}

export const countryDescriptor = (qid, entity) => {
  const labelRu = entity?.labels?.ru?.value ?? null
  const labelEn = entity?.labels?.en?.value ?? entity?.labels?.mul?.value ?? null
  const code = claimStrings(entity, 'P297')[0]?.toUpperCase() ?? null
  return {
    wikidataId: qid,
    code,
    nameRu: labelRu || labelEn || qid,
    nameEn: labelEn || labelRu || qid,
  }
}

export const relevantEntity = (entity) => {
  if (!entity || entity.missing) return entity
  const properties = ['P17', 'P27', 'P31', 'P131', 'P159', 'P178', 'P297', 'P400', 'P495', 'P577']
  return {
    id: entity.id,
    labels: Object.fromEntries(
      Object.entries(entity.labels ?? {}).filter(([language]) => ['ru', 'en', 'mul'].includes(language)),
    ),
    aliases: Object.fromEntries(
      Object.entries(entity.aliases ?? {}).filter(([language]) => ['ru', 'en', 'mul'].includes(language)),
    ),
    descriptions: Object.fromEntries(
      Object.entries(entity.descriptions ?? {}).filter(([language]) => ['ru', 'en', 'mul'].includes(language)),
    ),
    claims: Object.fromEntries(properties
      .filter((property) => entity.claims?.[property])
      .map((property) => [property, entity.claims[property]])),
  }
}

export const referencedEntityIds = (entity) => compact(
  ['P17', 'P27', 'P131', 'P159', 'P178', 'P400', 'P495']
    .flatMap((property) => claimItemIds(entity, property)),
)
