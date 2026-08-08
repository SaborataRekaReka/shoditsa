import fs from 'node:fs/promises'
import path from 'node:path'

const REQUIRED_MODES = ['movie', 'series', 'anime', 'game', 'diagnosis', 'city', 'animal', 'book', 'character']
const CITY_RANK_KEYS = ['economy', 'humanCapital', 'qualityOfLife', 'ecology', 'governance']

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

export const readJson = async (filePath) => {
  const content = await fs.readFile(filePath, 'utf8')
  return JSON.parse(content)
}

const readFirstExistingJson = async (paths) => {
  for (const filePath of paths) {
    try {
      const json = await readJson(filePath)
      return { json, sourcePath: filePath }
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') continue
      throw error
    }
  }
  throw new Error(`Could not find JSON file at any of the following paths: ${paths.join(', ')}`)
}

const validateTitleItem = (item, file) => {
  const errors = []
  if (!isObject(item)) return [`${file}: entry is not object`]
  if (typeof item.id !== 'string' || !item.id.trim()) errors.push(`${file}: item.id is missing or invalid`)
  if (!REQUIRED_MODES.includes(item.mode)) errors.push(`${file}: item.mode is missing or invalid`)
  if (typeof item.titleRu !== 'string' || !item.titleRu.trim()) errors.push(`${file}: item.titleRu is missing or invalid`)
  if (!Array.isArray(item.alternativeTitles)) errors.push(`${file}: item.alternativeTitles must be array`)
  if (typeof item.popularityScore !== 'number') errors.push(`${file}: item.popularityScore must be number`)
  if (item.mode === 'city') {
    if (!isObject(item.ranks)) errors.push(`${file}: city ${item.id ?? '(unknown)'} must have ranks`)
    else for (const key of CITY_RANK_KEYS) {
      if (!Number.isFinite(item.ranks[key])) errors.push(`${file}: city ${item.id ?? '(unknown)'} ranks.${key} must be a number`)
    }
  }
  return errors
}

const validateTitleDataset = (json, file) => {
  if (!Array.isArray(json)) return [`${file}: root must be an array`]
  const errors = json.flatMap((item) => validateTitleItem(item, file))
  const seenExternalIds = new Map()

  for (const item of json) {
    if (!isObject(item)) continue
    const externalIds = [
      ['thegamesdb', item.externalRanks?.thegamesdb],
      ['kinopoisk', item.kinopoiskId],
      ['shikimori', item.shikimoriId],
      ['steam', item.steamAppId],
    ]
    for (const [source, value] of externalIds) {
      if (!Number.isFinite(value)) continue
      const identity = `${item.mode}:${source}:${value}`
      const previous = seenExternalIds.get(identity)
      if (previous) errors.push(`${file}: items ${previous} and ${item.id} share external id ${identity}`)
      else seenExternalIds.set(identity, item.id)
    }
  }

  return errors
}

const validateAnimalMedia = async (items, rootDir, file) => {
  const errors = []
  if (items.length !== 300) errors.push(`${file}: animal runtime roster must contain exactly 300 items, found ${items.length}`)
  const silhouetteUrls = new Set()
  for (const item of items) {
    if (!isObject(item) || item.mode !== 'animal') continue
    if (typeof item.silhouetteUrl !== 'string' || !item.silhouetteUrl.startsWith('/images/animals/silhouettes/')) {
      errors.push(`${file}: animal ${item.id ?? '(unknown)'} must have a separate local silhouetteUrl`)
    } else {
      if (item.silhouetteUrl === item.posterUrl) errors.push(`${file}: animal ${item.id} silhouette must not replace or reuse posterUrl`)
      if (silhouetteUrls.has(item.silhouetteUrl)) errors.push(`${file}: duplicate animal silhouette ${item.silhouetteUrl}`)
      silhouetteUrls.add(item.silhouetteUrl)
      try {
        await fs.access(path.join(rootDir, 'public', item.silhouetteUrl.replace(/^\/+/, '')))
      } catch {
        errors.push(`${file}: animal ${item.id} silhouette asset is missing: ${item.silhouetteUrl}`)
      }
    }
    if (item.soundUrl != null) {
      if (typeof item.soundUrl !== 'string' || !item.soundUrl.startsWith('/audio/animals/')) {
        errors.push(`${file}: animal ${item.id} soundUrl must be a localized animal audio asset`)
      } else {
        try {
          await fs.access(path.join(rootDir, 'public', item.soundUrl.replace(/^\/+/, '')))
        } catch {
          errors.push(`${file}: animal ${item.id} sound asset is missing: ${item.soundUrl}`)
        }
      }
      if (!isObject(item.soundAttribution) || typeof item.soundAttribution.license !== 'string' || !item.soundAttribution.license) {
        errors.push(`${file}: animal ${item.id} sound attribution is missing`)
      }
    }
  }
  return errors
}

const validateBooks = (items, file) => {
  const errors = []
  if (items.length !== 277) errors.push(`${file}: book runtime roster must contain exactly 277 items, found ${items.length}`)
  for (const item of items) {
    if (!isObject(item) || item.mode !== 'book') continue
    if (!Array.isArray(item.bookAuthors) || !item.bookAuthors.length) errors.push(`${file}: book ${item.id ?? '(unknown)'} must have an author`)
    if (!Number.isFinite(item.bookPublicationYear)) errors.push(`${file}: book ${item.id ?? '(unknown)'} must have a publication year`)
    if (!Array.isArray(item.bookGenres) || !item.bookGenres.length) errors.push(`${file}: book ${item.id ?? '(unknown)'} must have normalized genres`)
    if (typeof item.bookCountry !== 'string' || !item.bookCountry) errors.push(`${file}: book ${item.id ?? '(unknown)'} must have a country`)
    if (typeof item.bookOriginalLanguage !== 'string' || !item.bookOriginalLanguage) errors.push(`${file}: book ${item.id ?? '(unknown)'} must have an original language`)
    if (typeof item.posterUrl !== 'string' || !/^https:\/\//.test(item.posterUrl)) errors.push(`${file}: book ${item.id ?? '(unknown)'} must have an HTTPS cover URL`)
    if (typeof item.plotHint !== 'string' || !item.plotHint.trim()) errors.push(`${file}: book ${item.id ?? '(unknown)'} must have a plot hint`)
  }
  return errors
}

const validateCharacters = async (items, rootDir, file) => {
  const errors = []
  if (items.length !== 70) errors.push(`${file}: character runtime roster must contain exactly 70 items, found ${items.length}`)
  const listFields = ['characterSourceTypes', 'characterOriginCultures', 'characterRoles', 'characterArchetypes', 'characterAbilities', 'characterSettings']
  const scalarFields = ['characterEra', 'characterNature', 'characterGender', 'characterAgeGroup', 'characterSourceWork']
  for (const item of items) {
    if (!isObject(item) || item.mode !== 'character') continue
    for (const key of listFields) if (!Array.isArray(item[key]) || !item[key].length) errors.push(`${file}: character ${item.id ?? '(unknown)'} must have ${key}`)
    for (const key of scalarFields) if (typeof item[key] !== 'string' || !item[key].trim()) errors.push(`${file}: character ${item.id ?? '(unknown)'} must have ${key}`)
    if (!Number.isFinite(item.characterEraOrder)) errors.push(`${file}: character ${item.id ?? '(unknown)'} must have characterEraOrder`)
    if (typeof item.plotHint !== 'string' || !item.plotHint.trim()) errors.push(`${file}: character ${item.id ?? '(unknown)'} must have a plot hint`)
    if (typeof item.posterUrl !== 'string' || !item.posterUrl.startsWith('/images/characters/portraits/')) {
      errors.push(`${file}: character ${item.id ?? '(unknown)'} must have a local portrait`)
    } else {
      try {
        await fs.access(path.join(rootDir, 'public', item.posterUrl.replace(/^\/+/, '')))
      } catch {
        errors.push(`${file}: character ${item.id ?? '(unknown)'} portrait is missing: ${item.posterUrl}`)
      }
    }
  }
  return errors
}

const validateVignetteMap = (json, file) => {
  if (!Array.isArray(json)) return [`${file}: root must be an array`]
  return json.flatMap((entry) => {
    const errors = []
    if (!isObject(entry)) return [`${file}: entry must be object`]
    if (typeof entry.diagnosisId !== 'string' || !entry.diagnosisId.trim()) errors.push(`${file}: diagnosisId is missing`)
    if (!Array.isArray(entry.caseVignettes)) errors.push(`${file}: caseVignettes must be array`)
    return errors
  })
}

const validateSource = (json, file) => {
  if (!isObject(json)) return [`${file}: root must be object`]
  const numericKeys = ['movieCount', 'seriesCount', 'animeCount', 'gameCount', 'diagnosisCount', 'animalCount', 'bookCount', 'characterCount']
  return numericKeys
    .filter((key) => json[key] != null && typeof json[key] !== 'number')
    .map((key) => `${file}: ${key} must be number when present`)
}

export const validateGeneratedData = async (rootDir) => {
  const dataDir = path.join(rootDir, 'public', 'data')
  const files = {
    movies: 'movies.generated.json',
    series: 'series.generated.json',
    animes: 'animes.generated.json',
    games: 'games.generated.json',
    diagnoses: 'diagnoses.generated.json',
    cities: 'cities.generated.json',
    animals: 'animals.generated.json',
    books: 'books.generated.json',
    characters: 'characters.generated.json',
    vignettes: 'diagnosis-case-vignettes.by-id.json',
    source: 'source.json',
  }

  const errors = []

  const datasetLocations = {
    movies: [path.join(dataDir, files.movies), path.join(dataDir, 'libraries', 'movies', 'items.json')],
    series: [path.join(dataDir, files.series), path.join(dataDir, 'libraries', 'series', 'items.json')],
    animes: [path.join(dataDir, files.animes), path.join(dataDir, 'libraries', 'animes', 'items.json')],
    games: [path.join(dataDir, files.games), path.join(dataDir, 'libraries', 'games', 'items.json')],
    diagnoses: [path.join(dataDir, files.diagnoses), path.join(dataDir, 'libraries', 'diagnoses', 'items.json')],
    cities: [path.join(dataDir, 'libraries', 'cities', 'items.json'), path.join(dataDir, files.cities)],
    animals: [path.join(dataDir, 'libraries', 'animals', 'items.json'), path.join(dataDir, files.animals)],
    books: [path.join(dataDir, 'libraries', 'books', 'items.json'), path.join(dataDir, files.books)],
    characters: [path.join(dataDir, 'libraries', 'characters', 'items.json'), path.join(dataDir, files.characters)],
  }

  for (const [datasetName, locations] of Object.entries(datasetLocations)) {
    const { json, sourcePath } = await readFirstExistingJson(locations)
    const fileLabel = path.relative(dataDir, sourcePath)
    errors.push(...validateTitleDataset(json, fileLabel || datasetName))
    if (datasetName === 'animals' && Array.isArray(json)) {
      errors.push(...await validateAnimalMedia(json, rootDir, fileLabel || datasetName))
    }
    if (datasetName === 'books' && Array.isArray(json)) {
      errors.push(...validateBooks(json, fileLabel || datasetName))
    }
    if (datasetName === 'characters' && Array.isArray(json)) {
      errors.push(...await validateCharacters(json, rootDir, fileLabel || datasetName))
    }
  }

  errors.push(...validateVignetteMap(await readJson(path.join(dataDir, files.vignettes)), files.vignettes))
  errors.push(...validateSource(await readJson(path.join(dataDir, files.source)), files.source))

  return errors
}
