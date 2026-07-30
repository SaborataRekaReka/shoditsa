import { inflateRawSync } from 'node:zlib'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  calculateProvenanceCoverage,
  createEmptyAnimal,
  deriveLifespanCategory,
  deriveSizeCategory,
  deriveTaxonomyCriteria,
  normalizeGameTaxonomy,
  normalizeEltonDiet,
  scoreAnimal,
  validateAnimal,
} from './model.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const [key, ...rest] = argument.replace(/^--/, '').split('=')
  return [key, rest.length ? rest.join('=') : true]
}))
const seedPath = path.resolve(root, String(args.seed || process.env.npm_config_seed || 'data/animals/seeds/lion.json'))
const outputPath = path.resolve(root, String(args.out || process.env.npm_config_out || 'data/animals/generated/lion.json'))
const configuredAnagePath = args.anage || process.env.npm_config_anage
const explicitAnagePath = configuredAnagePath ? path.resolve(root, String(configuredAnagePath)) : null
const includeInteractions = !['0', 'false', 'no'].includes(
  String(args.interactions ?? process.env.npm_config_interactions ?? 'true').toLowerCase(),
)

const USER_AGENT = 'shoditsa-animal-pipeline/0.1 (+https://shoditsa.ru)'
const WIKIDATA_LICENSE = 'CC0 1.0'
const ELTON_LICENSE = 'CC BY 4.0'
const ANAGE_LICENSE = 'CC BY 3.0'
const RETRIES = 3
const DEFAULT_TIMEOUT_MS = 30_000

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const text = (value) => String(value ?? '').trim()
const numberOrNull = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
const unique = (values) => [...new Set(values.map(text).filter(Boolean))]
const stripHtml = (value) => text(value)
  .replace(/<br\s*\/?>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/\s+/g, ' ')
  .trim()

const fetchResponse = async (url, label, options = {}) => {
  let lastError
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: options.accept ?? '*/*',
          ...(options.headers ?? {}),
        },
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`)
      return response
    } catch (error) {
      lastError = error
      if (attempt < RETRIES) await sleep(300 * attempt)
    } finally {
      clearTimeout(timeout)
    }
  }
  throw new Error(`${label} failed after ${RETRIES} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

const fetchJson = async (url, label) => (await fetchResponse(url, label, { accept: 'application/json' })).json()
const fetchText = async (url, label) => (await fetchResponse(url, label, { accept: 'text/plain,*/*' })).text()
const fetchBuffer = async (url, label) => Buffer.from(await (await fetchResponse(url, label)).arrayBuffer())
const loadCachedText = async (cacheName, url, label) => {
  const cachePath = path.join(root, '.tmp', 'animal-pipeline', cacheName)
  try {
    return await readFile(cachePath, 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  const content = await fetchText(url, label)
  await mkdir(path.dirname(cachePath), { recursive: true })
  await writeFile(cachePath, content, 'utf8')
  return content
}

const parseTsv = (content) => {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean)
  if (!lines.length) return []
  const headers = lines[0].split('\t')
  return lines.slice(1).map((line) => Object.fromEntries(headers.map((header, index) => [header, line.split('\t')[index] ?? ''])))
}

const findZipEntry = (archive, wantedName) => {
  const eocdSignature = 0x06054b50
  let eocdOffset = -1
  for (let offset = archive.length - 22; offset >= Math.max(0, archive.length - 65_557); offset -= 1) {
    if (archive.readUInt32LE(offset) === eocdSignature) {
      eocdOffset = offset
      break
    }
  }
  if (eocdOffset < 0) throw new Error('ZIP end-of-central-directory record was not found')

  const entries = archive.readUInt16LE(eocdOffset + 10)
  let centralOffset = archive.readUInt32LE(eocdOffset + 16)
  for (let index = 0; index < entries; index += 1) {
    if (archive.readUInt32LE(centralOffset) !== 0x02014b50) throw new Error('Invalid ZIP central directory')
    const compressionMethod = archive.readUInt16LE(centralOffset + 10)
    const compressedSize = archive.readUInt32LE(centralOffset + 20)
    const fileNameLength = archive.readUInt16LE(centralOffset + 28)
    const extraLength = archive.readUInt16LE(centralOffset + 30)
    const commentLength = archive.readUInt16LE(centralOffset + 32)
    const localOffset = archive.readUInt32LE(centralOffset + 42)
    const fileName = archive.subarray(centralOffset + 46, centralOffset + 46 + fileNameLength).toString('utf8')

    if (fileName === wantedName || fileName.endsWith(`/${wantedName}`)) {
      if (archive.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('Invalid ZIP local header')
      const localNameLength = archive.readUInt16LE(localOffset + 26)
      const localExtraLength = archive.readUInt16LE(localOffset + 28)
      const dataStart = localOffset + 30 + localNameLength + localExtraLength
      const compressed = archive.subarray(dataStart, dataStart + compressedSize)
      if (compressionMethod === 0) return compressed
      if (compressionMethod === 8) return inflateRawSync(compressed)
      throw new Error(`Unsupported ZIP compression method ${compressionMethod}`)
    }
    centralOffset += 46 + fileNameLength + extraLength + commentLength
  }
  throw new Error(`${wantedName} was not found in ZIP archive`)
}

const loadAnageText = async () => {
  if (explicitAnagePath) return readFile(explicitAnagePath, 'utf8')
  const cachePath = path.join(root, '.tmp', 'animal-pipeline', 'anage_data.txt')
  try {
    return await readFile(cachePath, 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  const archive = await fetchBuffer('https://genomics.senescence.info/species/dataset.zip', 'AnAge stable dataset')
  const data = findZipEntry(archive, 'anage_data.txt')
  await mkdir(path.dirname(cachePath), { recursive: true })
  await writeFile(cachePath, data)
  return data.toString('utf8')
}

const seed = JSON.parse(await readFile(seedPath, 'utf8'))
let editorialNamesRu = {}
try {
  editorialNamesRu = JSON.parse(await readFile(path.join(root, 'data', 'animals', 'editorial-names-ru.json'), 'utf8'))
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}
if (!/^Q\d+$/.test(text(seed.wikidataId))) throw new Error('Seed must contain a valid wikidataId')
if (!text(seed.id).startsWith('animal:')) throw new Error('Seed id must start with animal:')

const animal = createEmptyAnimal(seed)
const retrievedAt = new Date().toISOString()
const warnings = animal.quality.warnings
const addProvenance = ({ fieldPaths, source, sourceId = null, url, license, method, confidence = 1, raw = null }) => {
  animal.provenance.push({
    fieldPaths: Array.isArray(fieldPaths) ? fieldPaths : [fieldPaths],
    source,
    sourceId,
    url,
    license,
    retrievedAt,
    method,
    confidence,
    raw,
  })
}

const claimValues = (entity, property) => (entity.claims?.[property] ?? [])
  .map((claim) => claim.mainsnak?.datavalue?.value)
  .filter((value) => value !== undefined)
const entityId = (value) => value && typeof value === 'object' ? value.id ?? null : null

const wikidataUrl = `https://www.wikidata.org/wiki/Special:EntityData/${seed.wikidataId}.json`
const wikidataPayload = await fetchJson(wikidataUrl, 'Wikidata entity')
const wikidataEntity = wikidataPayload.entities?.[seed.wikidataId]
if (!wikidataEntity || wikidataEntity.missing !== undefined) throw new Error(`Wikidata entity ${seed.wikidataId} was not found`)

animal.identity.commonNameRu = text(wikidataEntity.labels?.ru?.value)
animal.identity.commonNameEn = text(wikidataEntity.labels?.en?.value)
animal.identity.aliasesRu = unique((wikidataEntity.aliases?.ru ?? []).map((entry) => entry.value))
const wikidataScientificName = text(claimValues(wikidataEntity, 'P225')[0])
animal.identity.scientificName = wikidataScientificName || text(seed.scientificName)
animal.popularity.wikidataSitelinks = Object.keys(wikidataEntity.sitelinks ?? {}).length
animal.popularity.ruWikipediaTitle = text(wikidataEntity.sitelinks?.ruwiki?.title)
animal.popularity.ruWikipediaPageviews365d = numberOrNull(seed.ruWikipediaPageviews365d)
addProvenance({
  fieldPaths: [
    'identity.commonNameRu',
    'identity.commonNameEn',
    'identity.aliasesRu',
    ...(wikidataScientificName ? ['identity.scientificName'] : []),
    'popularity.wikidataSitelinks',
    'popularity.ruWikipediaTitle',
  ],
  source: 'Wikidata',
  sourceId: seed.wikidataId,
  url: `https://www.wikidata.org/wiki/${seed.wikidataId}`,
  license: WIKIDATA_LICENSE,
  method: 'Wikidata Special:EntityData JSON',
})
if (!wikidataScientificName && animal.identity.scientificName) {
  addProvenance({
    fieldPaths: 'identity.scientificName',
    source: 'Editorial candidate seed',
    sourceId: seed.wikidataId,
    url: `file://${path.relative(root, seedPath)}`,
    license: 'factual taxon identity; verify through GBIF match',
    method: 'manual scientific-name bridge for a cultural/common-animal Wikidata item',
    confidence: 0.8,
  })
}
if (animal.popularity.ruWikipediaPageviews365d !== null) {
  addProvenance({
    fieldPaths: 'popularity.ruWikipediaPageviews365d',
    source: 'Candidate pre-ranking cache',
    sourceId: animal.popularity.ruWikipediaTitle,
    url: text(seed.rankingSources?.pageviewsUrl) || 'https://wikimedia.org/api/rest_v1/',
    license: 'Wikimedia API terms',
    method: 'latest 12 complete monthly pageview buckets, collected during candidate ranking',
    confidence: 0.9,
  })
}
const editorialName = editorialNamesRu[animal.identity.scientificName]
if (editorialName?.commonNameRu) {
  animal.identity.aliasesRu = unique([animal.identity.commonNameRu, ...animal.identity.aliasesRu])
  animal.identity.commonNameRu = text(editorialName.commonNameRu)
  addProvenance({
    fieldPaths: ['identity.commonNameRu', 'identity.aliasesRu'],
    source: 'Project editorial Russian terminology',
    sourceId: editorialName.sourceId ?? seed.wikidataId,
    url: editorialName.url ?? `https://www.wikidata.org/wiki/${seed.wikidataId}`,
    license: 'factual vernacular terminology',
    method: 'human-reviewed Russian display name for a taxon whose Wikidata Russian label is scientific-only',
    confidence: 0.9,
  })
}

const conservationStatusId = entityId(claimValues(wikidataEntity, 'P141')[0])
if (conservationStatusId) {
  try {
    const statusPayload = await fetchJson(
      `https://www.wikidata.org/wiki/Special:EntityData/${conservationStatusId}.json`,
      'Wikidata conservation status',
    )
    animal.ecology.conservation = {
      statusId: conservationStatusId,
      statusLabelRu: text(statusPayload.entities?.[conservationStatusId]?.labels?.ru?.value),
      source: 'Wikidata pointer; verify against the current assessment before publication',
    }
    addProvenance({
      fieldPaths: 'ecology.conservation',
      source: 'Wikidata',
      sourceId: conservationStatusId,
      url: `https://www.wikidata.org/wiki/${conservationStatusId}`,
      license: WIKIDATA_LICENSE,
      method: 'Wikidata P141 label lookup',
      confidence: 0.7,
    })
  } catch (error) {
    warnings.push(`Conservation label was not resolved: ${error.message}`)
  }
}

const scientificName = animal.identity.scientificName || text(seed.scientificName)
if (!scientificName) throw new Error('Scientific name is missing in both Wikidata and seed')

const gbifMatchUrl = `https://api.gbif.org/v1/species/match?name=${encodeURIComponent(scientificName)}`
const gbifMatch = await fetchJson(gbifMatchUrl, 'GBIF species match')
if (!gbifMatch.usageKey || gbifMatch.matchType === 'NONE') throw new Error(`GBIF could not resolve ${scientificName}`)
animal.identity.gbifKey = gbifMatch.usageKey
animal.identity.acceptedScientificName = text(gbifMatch.canonicalName || gbifMatch.scientificName)
animal.taxonomy = {
  kingdom: text(gbifMatch.kingdom),
  phylum: text(gbifMatch.phylum),
  taxonomicClass: text(gbifMatch.class),
  order: text(gbifMatch.order),
  family: text(gbifMatch.family),
  genus: text(gbifMatch.genus),
  species: text(gbifMatch.species),
  rank: text(gbifMatch.rank),
  status: text(gbifMatch.status),
  extinct: conservationStatusId === 'Q237350' ? true : null,
}
const gbifSourceClass = animal.taxonomy.taxonomicClass
animal.taxonomy = normalizeGameTaxonomy(animal.taxonomy, seed.discoverySourceCategories ?? [])
animal.criteria.taxonomicClass = animal.taxonomy.taxonomicClass
addProvenance({
  fieldPaths: [
    'identity.acceptedScientificName',
    'identity.gbifKey',
    'taxonomy.kingdom',
    'taxonomy.phylum',
    'taxonomy.taxonomicClass',
    'taxonomy.order',
    'taxonomy.family',
    'taxonomy.genus',
    'taxonomy.species',
    'taxonomy.rank',
    'taxonomy.status',
    'criteria.taxonomicClass',
  ],
  source: 'GBIF Species API',
  sourceId: String(gbifMatch.usageKey),
  url: `https://www.gbif.org/species/${gbifMatch.usageKey}`,
  license: 'GBIF data-user agreement; source-dataset terms apply',
  method: `species/match (${gbifMatch.matchType}, confidence ${gbifMatch.confidence ?? 'unknown'})`,
  confidence: Number(gbifMatch.confidence ?? 0) / 100,
  raw: {
    matchType: gbifMatch.matchType,
    scientificName: gbifMatch.scientificName,
    gbifSourceClass,
    normalizedGameClass: animal.taxonomy.taxonomicClass,
  },
})

const derivedTaxonomyCriteria = deriveTaxonomyCriteria(animal.taxonomy)
const derivedTaxonomyPaths = []
for (const [field, value] of Object.entries(derivedTaxonomyCriteria)) {
  if (Array.isArray(value) && value.length && animal.criteria[field].length === 0) {
    animal.criteria[field] = value
    derivedTaxonomyPaths.push(`criteria.${field}`)
  } else if (!Array.isArray(value) && value !== '' && value !== null && (animal.criteria[field] === '' || animal.criteria[field] === null)) {
    animal.criteria[field] = value
    derivedTaxonomyPaths.push(`criteria.${field}`)
  }
}
if (derivedTaxonomyPaths.length) {
  addProvenance({
    fieldPaths: derivedTaxonomyPaths,
    source: 'GBIF taxonomy + project normalization rules',
    sourceId: String(gbifMatch.usageKey),
    url: `https://www.gbif.org/species/${gbifMatch.usageKey}`,
    license: 'GBIF data-user agreement; derived factual classification',
    method: 'deterministic class/order/family rule',
    confidence: 0.7,
  })
}

try {
  const occurrenceUrl = `https://api.gbif.org/v1/occurrence/search?taxon_key=${gbifMatch.usageKey}&limit=0&facet=country&facetLimit=50`
  const [occurrences, countriesText] = await Promise.all([
    fetchJson(occurrenceUrl, 'GBIF occurrence country facets'),
    loadCachedText(
      'gbif-countries.json',
      'https://api.gbif.org/v1/enumeration/country',
      'GBIF country enumeration',
    ),
  ])
  const countries = JSON.parse(countriesText)
  const regionByCountry = new Map(countries.map((country) => [text(country.iso2), text(country.gbifRegion)]))
  const regionCounts = new Map()
  for (const entry of occurrences.facets?.find((facet) => facet.field === 'COUNTRY')?.counts ?? []) {
    const region = regionByCountry.get(text(entry.name))
    if (region) regionCounts.set(region, (regionCounts.get(region) ?? 0) + Number(entry.count ?? 0))
  }
  const rankedRegions = [...regionCounts.entries()].sort((left, right) => right[1] - left[1])
  const facetedTotal = rankedRegions.reduce((sum, [, count]) => sum + count, 0)
  const regionValue = {
    AFRICA: 'africa',
    ANTARCTICA: 'antarctica',
    ASIA: 'asia',
    EUROPE: 'europe',
    LATIN_AMERICA: 'latin-america',
    NORTH_AMERICA: 'north-america',
    OCEANIA: 'oceania',
  }
  const observedContinents = rankedRegions
    .filter(([, count], index) => index === 0 || count / facetedTotal >= 0.08)
    .map(([region]) => regionValue[region])
    .filter(Boolean)
  if (observedContinents.length) {
    animal.criteria.continents = observedContinents
    addProvenance({
      fieldPaths: 'criteria.continents',
      source: 'GBIF Occurrence API',
      sourceId: String(gbifMatch.usageKey),
      url: occurrenceUrl,
      license: 'GBIF data-user agreement; occurrence dataset terms apply',
      method: 'countries in the 50 largest occurrence facets mapped to GBIF regions; dominant region plus regions with at least 8% of faceted records',
      confidence: 0.55,
      raw: {
        kind: 'observed-range-proxy-not-native-range',
        regionCounts: Object.fromEntries(rankedRegions),
      },
    })
    if (!seed.editorial?.criteria?.continents) {
      warnings.push('Continents are an occurrence-derived observed-range proxy; native, introduced and captive records require editorial separation.')
    }
  }
} catch (error) {
  warnings.push(`GBIF occurrence regions were not loaded: ${error.message}`)
}

try {
  const profilesUrl = `https://api.gbif.org/v1/species/${gbifMatch.usageKey}/speciesProfiles?limit=100`
  const profiles = await fetchJson(profilesUrl, 'GBIF species profiles')
  const extinctValues = (profiles.results ?? [])
    .map((profile) => profile.extinct)
    .filter((value) => typeof value === 'boolean')
  if (extinctValues.length && animal.taxonomy.extinct !== true) {
    animal.taxonomy.extinct = extinctValues.includes(false) ? false : true
    addProvenance({
      fieldPaths: 'taxonomy.extinct',
      source: 'GBIF Species API profiles',
      sourceId: String(gbifMatch.usageKey),
      url: profilesUrl,
      license: 'underlying checklist/dataset terms apply',
      method: 'speciesProfiles extinct flags; any extant source prevents an extinct classification',
      confidence: 0.75,
    })
  }
  const habitatValues = unique((profiles.results ?? []).flatMap((profile) => {
    const habitat = text(profile.habitat).toLowerCase()
    return [
      /freshwater|fresh water/.test(habitat) ? 'freshwater' : '',
      /marine|ocean|sea\b/.test(habitat) ? 'marine' : '',
      /brackish/.test(habitat) ? 'brackish' : '',
      /terrestrial|land\b/.test(habitat) ? 'terrestrial' : '',
      /cave|subterranean/.test(habitat) ? 'cave' : '',
    ]
  }))
  if (habitatValues.length) {
    animal.criteria.habitats = habitatValues
    const inferredLifestyle = habitatValues.some((habitat) => ['marine', 'freshwater', 'brackish', 'aquatic'].includes(habitat))
      ? ['aquatic']
      : habitatValues.includes('terrestrial')
        ? ['terrestrial']
        : []
    if (!animal.criteria.lifestyles.length && inferredLifestyle.length) {
      animal.criteria.lifestyles = inferredLifestyle
    }
    addProvenance({
      fieldPaths: [
        'criteria.habitats',
        ...(inferredLifestyle.length ? ['criteria.lifestyles'] : []),
      ],
      source: 'GBIF Species API profiles',
      sourceId: String(gbifMatch.usageKey),
      url: profilesUrl,
      license: 'underlying checklist/dataset terms apply',
      method: 'speciesProfiles habitat strings normalized to broad game habitat and lifestyle values',
      confidence: 0.65,
      raw: {
        sourceRecords: (profiles.results ?? [])
          .filter((profile) => profile.habitat)
          .map((profile) => ({ habitat: profile.habitat, source: profile.source })),
      },
    })
  }
} catch (error) {
  warnings.push(`GBIF habitat profiles were not loaded: ${error.message}`)
}

try {
  const vernacularUrl = `https://api.gbif.org/v1/species/${gbifMatch.usageKey}/vernacularNames?limit=100`
  const vernacular = await fetchJson(vernacularUrl, 'GBIF vernacular names')
  const russianNames = (vernacular.results ?? [])
    .filter((entry) => ['rus', 'ru'].includes(text(entry.language).toLowerCase()))
    .map((entry) => entry.vernacularName)
  if (russianNames.length) {
    animal.identity.aliasesRu = unique([...animal.identity.aliasesRu, ...russianNames])
    addProvenance({
      fieldPaths: 'identity.aliasesRu',
      source: 'GBIF Species API',
      sourceId: String(gbifMatch.usageKey),
      url: vernacularUrl,
      license: 'source-record-specific',
      method: 'vernacularNames filtered to Russian',
    })
  }
} catch (error) {
  warnings.push(`GBIF vernacular names were not loaded: ${error.message}`)
}

const eltonFileId = animal.taxonomy.taxonomicClass === 'Mammalia'
  ? '5631084'
  : animal.taxonomy.taxonomicClass === 'Aves'
    ? '5631081'
    : null
if (eltonFileId) {
  try {
    const eltonUrl = `https://ndownloader.figshare.com/files/${eltonFileId}`
    const eltonRows = parseTsv(await loadCachedText(`elton-${eltonFileId}.txt`, eltonUrl, 'EltonTraits'))
    const row = eltonRows.find((entry) => text(entry.Scientific) === scientificName)
      ?? eltonRows.find((entry) => text(entry.Scientific) === animal.identity.acceptedScientificName)
    if (row) {
      const composition = {
        invertebrates: numberOrNull(row['Diet-Inv']) ?? 0,
        endothermicVertebrates: numberOrNull(row['Diet-Vend']) ?? 0,
        ectothermicVertebrates: numberOrNull(row['Diet-Vect']) ?? 0,
        fish: numberOrNull(row['Diet-Vfish']) ?? 0,
        unknownVertebrates: numberOrNull(row['Diet-Vunk']) ?? 0,
        scavenging: numberOrNull(row['Diet-Scav']) ?? 0,
        fruit: numberOrNull(row['Diet-Fruit']) ?? 0,
        nectar: numberOrNull(row['Diet-Nect']) ?? 0,
        seeds: numberOrNull(row['Diet-Seed']) ?? 0,
        otherPlants: numberOrNull(row['Diet-PlantO']) ?? 0,
      }
      animal.ecology.dietCompositionPercent = composition
      animal.criteria.diets = normalizeEltonDiet(composition)
      animal.criteria.activity = unique([
        Number(row['Activity-Nocturnal']) ? 'nocturnal' : '',
        Number(row['Activity-Crepuscular']) ? 'crepuscular' : '',
        Number(row['Activity-Diurnal']) ? 'diurnal' : '',
      ])
      const foragingMap = {
        M: 'marine',
        G: 'ground',
        S: 'scansorial',
        Ar: 'arboreal',
        A: 'aerial',
      }
      animal.ecology.foragingStratum = foragingMap[text(row['ForStrat-Value'])] ?? text(row['ForStrat-Value'])
      const bodyMassGrams = numberOrNull(row['BodyMass-Value'])
      if (bodyMassGrams !== null) {
        animal.measurements.bodyMassKg = bodyMassGrams / 1000
        animal.measurements.bodyMassSourceKind = 'species-level estimate'
        animal.criteria.sizeCategory = deriveSizeCategory(animal.measurements.bodyMassKg)
      }
      addProvenance({
        fieldPaths: [
          'ecology.dietCompositionPercent',
          'criteria.diets',
          'criteria.activity',
          'ecology.foragingStratum',
          'measurements.bodyMassKg',
          'criteria.sizeCategory',
        ],
        source: 'EltonTraits 1.0',
        sourceId: scientificName,
        url: 'https://doi.org/10.6084/m9.figshare.c.3306933.v1',
        license: ELTON_LICENSE,
        method: `exact scientific-name join to Figshare file ${eltonFileId}`,
        confidence: 0.85,
        raw: {
          dietCertainty: row['Diet-Certainty'],
          activityCertainty: row['Activity-Certainty'],
          foragingCertainty: row['ForStrat-Certainty'],
        },
      })
    } else {
      warnings.push(`EltonTraits has no exact row for ${scientificName}`)
    }
  } catch (error) {
    warnings.push(`EltonTraits enrichment failed: ${error.message}`)
  }
}

try {
  const anageRows = parseTsv(await loadAnageText())
  const [genus, species] = scientificName.split(/\s+/)
  const row = anageRows.find((entry) => text(entry.Genus) === genus && text(entry.Species) === species)
  if (row) {
    animal.identity.hagrid = text(row.HAGRID)
    animal.measurements.lifespanYears.maximumObserved = numberOrNull(row['Maximum longevity (yrs)'])
    animal.measurements.lifespanYears.maximumObservedContext = text(row['Specimen origin'])
    animal.measurements.lifespanCategory = deriveLifespanCategory(animal.measurements.lifespanYears.maximumObserved)
    animal.measurements.maturityDays = {
      female: numberOrNull(row['Female maturity (days)']),
      male: numberOrNull(row['Male maturity (days)']),
    }
    animal.measurements.gestationOrIncubationDays = numberOrNull(row['Gestation/Incubation (days)'])
    animal.measurements.litterOrClutchSize = numberOrNull(row['Litter/Clutch size'])
    if (animal.measurements.bodyMassKg === null) {
      const adultWeightGrams = numberOrNull(row['Adult weight (g)'])
      if (adultWeightGrams !== null) {
        animal.measurements.bodyMassKg = adultWeightGrams / 1000
        animal.measurements.bodyMassSourceKind = 'AnAge adult weight'
        animal.criteria.sizeCategory = deriveSizeCategory(animal.measurements.bodyMassKg)
      }
    }
    addProvenance({
      fieldPaths: [
        'identity.hagrid',
        'measurements.lifespanYears.maximumObserved',
        'measurements.lifespanYears.maximumObservedContext',
        'measurements.lifespanCategory',
        'measurements.maturityDays',
        'measurements.gestationOrIncubationDays',
        'measurements.litterOrClutchSize',
      ],
      source: 'AnAge Build 15',
      sourceId: text(row.HAGRID),
      url: 'https://genomics.senescence.info/species/',
      license: ANAGE_LICENSE,
      method: 'exact genus/species join to stable tab-delimited dataset',
      confidence: text(row['Data quality']) === 'acceptable' ? 0.85 : 0.65,
      raw: {
        source: row.Source,
        specimenOrigin: row['Specimen origin'],
        sampleSize: row['Sample size'],
        dataQuality: row['Data quality'],
      },
    })
  } else {
    warnings.push(`AnAge has no exact row for ${scientificName}`)
  }
} catch (error) {
  warnings.push(`AnAge enrichment failed: ${error.message}`)
}

const rowsToObjects = (payload) => (payload.data ?? []).map((row) => Object.fromEntries(
  (payload.columns ?? []).map((column, index) => [column, row[index]]),
))
const normalizeInteraction = (row, side) => ({
  scientificName: text(row[`${side}_taxon_name`]).replaceAll('_', ' '),
  externalId: text(row[`${side}_taxon_external_id`]) || null,
  studyTitle: text(row.study_title) || null,
  interactionType: text(row.interaction_type),
  reviewStatus: 'needs-editorial-review',
})
const distinctInteractions = (rows) => {
  const seen = new Set()
  return rows.filter((entry) => {
    const key = entry.scientificName.toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

if (includeInteractions) {
  for (const interaction of [
    { field: 'prey', parameter: 'sourceTaxon', side: 'target' },
    { field: 'predators', parameter: 'targetTaxon', side: 'source' },
  ]) {
    try {
      const url = `https://api.globalbioticinteractions.org/interaction?${interaction.parameter}=${encodeURIComponent(scientificName)}&interactionType=eats&limit=200`
      const payload = await fetchJson(url, `GloBI ${interaction.field}`)
      animal.ecology.interactionCandidates[interaction.field] = distinctInteractions(
        rowsToObjects(payload)
          .map((row) => normalizeInteraction(row, interaction.side))
          .filter((entry) => ['eats', 'preysOn'].includes(entry.interactionType))
          .filter((entry) => entry.externalId && entry.externalId !== 'no:match')
          .filter((entry) => /^[A-Z][a-z-]+ [a-z][a-z-]+(?:\s+[a-z][a-z-]+)?$/.test(entry.scientificName))
          .filter((entry) => entry.scientificName !== scientificName),
      ).slice(0, 30)
      if (animal.ecology.interactionCandidates[interaction.field].length) {
        addProvenance({
          fieldPaths: `ecology.interactionCandidates.${interaction.field}`,
          source: 'Global Biotic Interactions',
          sourceId: scientificName,
          url,
          license: 'underlying-dataset-specific; preserve study attribution',
          method: 'GloBI interaction API, exact taxon query, deduplicated',
          confidence: 0.6,
        })
      }
    } catch (error) {
      warnings.push(`GloBI ${interaction.field} enrichment failed: ${error.message}`)
    }
  }
  if (animal.ecology.interactionCandidates.prey.length || animal.ecology.interactionCandidates.predators.length) {
    warnings.push('GloBI interactions are candidate facts only; every predator/prey relation requires editorial review before becoming a clue.')
  }
}

const commonsFile = async (fileName, role) => {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    prop: 'imageinfo',
    titles: `File:${fileName.replace(/^File:/i, '')}`,
    iiprop: 'url|mime|mediatype|extmetadata',
    iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|Credit|ObjectName|ImageDescription|AttributionRequired',
    iiextmetadatalanguage: 'en',
    origin: '*',
  })
  const apiUrl = `https://commons.wikimedia.org/w/api.php?${params}`
  const payload = await fetchJson(apiUrl, `Commons metadata for ${fileName}`)
  const page = Object.values(payload.query?.pages ?? {})[0]
  const info = page?.imageinfo?.[0]
  if (!info) return null
  const metadata = Object.fromEntries(Object.entries(info.extmetadata ?? {}).map(([key, value]) => [key, value?.value ?? null]))
  const license = text(metadata.LicenseShortName)
  const disallowed = /\bNC\b|\bND\b|noncommercial|no derivatives|all rights reserved/i.test(license)
  const allowedFamily = /public domain|CC0|CC BY/i.test(license)
  return {
    role,
    commonsTitle: text(page.title),
    sourcePageUrl: text(info.descriptionurl),
    fileUrl: text(info.url),
    mimeType: text(info.mime),
    mediaType: text(info.mediatype),
    author: stripHtml(metadata.Artist),
    credit: stripHtml(metadata.Credit),
    description: stripHtml(metadata.ImageDescription),
    license,
    licenseUrl: text(metadata.LicenseUrl) || null,
    attributionRequired: text(metadata.AttributionRequired).toLowerCase() === 'true',
    commercialUseAllowed: allowedFamily && !disallowed,
    retrievedAt,
  }
}

const mediaCandidates = [
  ...claimValues(wikidataEntity, 'P18').map((fileName, index) => ({ fileName, role: index === 0 ? 'primary-image' : 'gallery-image' })),
  ...claimValues(wikidataEntity, 'P51').map((fileName) => ({ fileName, role: 'sound-clue' })),
  ...claimValues(wikidataEntity, 'P181').map((fileName) => ({ fileName, role: 'range-map' })),
]
for (const candidate of mediaCandidates) {
  try {
    const media = await commonsFile(text(candidate.fileName), candidate.role)
    if (!media) continue
    if (!media.commercialUseAllowed) {
      warnings.push(`Commons file rejected by license policy: ${media.commonsTitle} (${media.license || 'unknown'})`)
      continue
    }
    if (candidate.role === 'primary-image' && !animal.media.primaryImage) animal.media.primaryImage = media
    else if (candidate.role === 'gallery-image' || candidate.role === 'primary-image') animal.media.gallery.push(media)
    else if (candidate.role === 'sound-clue') animal.hints.sounds.push({ ...media, soundType: text(seed.editorial?.soundType) || 'animal-vocalization' })
    else if (candidate.role === 'range-map') animal.hints.rangeMaps.push(media)
    addProvenance({
      fieldPaths: candidate.role === 'sound-clue'
        ? 'hints.sounds'
        : candidate.role === 'range-map'
          ? 'hints.rangeMaps'
          : candidate.role === 'primary-image'
            ? 'media.primaryImage'
            : 'media.gallery',
      source: 'Wikimedia Commons',
      sourceId: media.commonsTitle,
      url: media.sourcePageUrl,
      license: media.license,
      method: 'Wikidata file pointer + Commons imageinfo/extmetadata',
    })
  } catch (error) {
    warnings.push(`Commons media failed for ${candidate.fileName}: ${error.message}`)
  }
}

if (animal.media.primaryImage) {
  animal.hints.silhouettes.push({
    kind: 'css-image-mask',
    sourceCommonsTitle: animal.media.primaryImage.commonsTitle,
    sourceFileUrl: animal.media.primaryImage.fileUrl,
    transform: 'brightness(0) saturate(100%)',
    inheritsLicense: animal.media.primaryImage.license,
    attributionRequired: animal.media.primaryImage.attributionRequired,
  })
  addProvenance({
    fieldPaths: 'hints.silhouettes',
    source: 'Project-derived visual hint',
    sourceId: animal.media.primaryImage.commonsTitle,
    url: animal.media.primaryImage.sourcePageUrl,
    license: animal.media.primaryImage.license,
    method: 'reversible CSS black mask derived from the licensed primary image',
    confidence: 1,
  })
}

if (animal.popularity.ruWikipediaTitle && animal.popularity.ruWikipediaPageviews365d === null) {
  try {
    const end = new Date()
    end.setUTCDate(end.getUTCDate() - 1)
    const start = new Date(end)
    start.setUTCDate(start.getUTCDate() - 364)
    const dateStamp = (date) => `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}00`
    const pageviewsUrl = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/ru.wikipedia.org/all-access/user/${encodeURIComponent(animal.popularity.ruWikipediaTitle.replaceAll(' ', '_'))}/daily/${dateStamp(start)}/${dateStamp(end)}`
    const pageviews = await fetchJson(pageviewsUrl, 'Russian Wikipedia pageviews')
    animal.popularity.ruWikipediaPageviews365d = (pageviews.items ?? []).reduce((sum, entry) => sum + Number(entry.views ?? 0), 0)
    addProvenance({
      fieldPaths: 'popularity.ruWikipediaPageviews365d',
      source: 'Wikimedia Analytics API',
      sourceId: animal.popularity.ruWikipediaTitle,
      url: pageviewsUrl,
      license: 'Wikimedia API terms',
      method: 'sum of daily user pageviews over the latest complete 365 days',
      confidence: 0.9,
    })
  } catch (error) {
    warnings.push(`Wikipedia pageviews failed: ${error.message}`)
  }
}

const editorial = seed.editorial ?? {}
for (const [key, value] of Object.entries(editorial.criteria ?? {})) {
  if (!(key in animal.criteria)) {
    warnings.push(`Unknown editorial criteria field ignored: ${key}`)
    continue
  }
  animal.criteria[key] = Array.isArray(animal.criteria[key])
    ? unique(value)
    : value
}
for (const [key, value] of Object.entries(editorial.hints ?? {})) {
  if (!(key in animal.hints)) {
    warnings.push(`Unknown editorial hint field ignored: ${key}`)
    continue
  }
  animal.hints[key] = Array.isArray(animal.hints[key]) ? unique(value) : value
}
for (const [key, value] of Object.entries(editorial.measurements ?? {})) {
  if (key in animal.measurements) animal.measurements[key] = value
}
if (seed.wordstatMonthlySearches != null) {
  animal.popularity.wordstatMonthlySearches = numberOrNull(seed.wordstatMonthlySearches)
}
for (const [fieldPath, source] of Object.entries(editorial.provenance ?? {})) {
  addProvenance({
    fieldPaths: fieldPath,
    source: text(source.source || 'Editorial normalization'),
    sourceId: source.sourceId ?? null,
    url: text(source.url || `file://${path.relative(root, seedPath)}`),
    license: text(source.license || 'facts normalized into project vocabulary'),
    method: text(source.method || 'human-reviewed normalization'),
    confidence: numberOrNull(source.confidence) ?? 0.8,
  })
}

if (!animal.criteria.sizeCategory && animal.measurements.bodyMassKg !== null) {
  animal.criteria.sizeCategory = deriveSizeCategory(animal.measurements.bodyMassKg)
}
if (!animal.measurements.lifespanCategory && animal.measurements.lifespanYears.maximumObserved !== null) {
  animal.measurements.lifespanCategory = deriveLifespanCategory(animal.measurements.lifespanYears.maximumObserved)
}

animal.generatedAt = retrievedAt
calculateProvenanceCoverage(animal)
scoreAnimal(animal)
const validationErrors = validateAnimal(animal)
if (validationErrors.length) throw new Error(`Generated animal is invalid:\n- ${validationErrors.join('\n- ')}`)

await mkdir(path.dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(animal, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({
  outputPath: path.relative(root, outputPath),
  animal: animal.identity.commonNameRu,
  scientificName: animal.identity.acceptedScientificName,
  gbifKey: animal.identity.gbifKey,
  criteriaCoverage: animal.quality.coreCriteriaCoverage,
  provenanceCoverage: animal.quality.provenanceCoverage,
  soundClues: animal.hints.sounds.length,
  preyCandidates: animal.ecology.interactionCandidates.prey.length,
  predatorCandidates: animal.ecology.interactionCandidates.predators.length,
  selection: animal.selection,
  warnings: animal.quality.warnings,
}, null, 2))
