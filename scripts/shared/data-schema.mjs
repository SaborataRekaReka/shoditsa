import fs from 'node:fs/promises'
import path from 'node:path'

const REQUIRED_MODES = ['movie', 'series', 'anime', 'game', 'diagnosis', 'city']
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
  const numericKeys = ['movieCount', 'seriesCount', 'animeCount', 'gameCount', 'diagnosisCount']
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
  }

  for (const [datasetName, locations] of Object.entries(datasetLocations)) {
    const { json, sourcePath } = await readFirstExistingJson(locations)
    const fileLabel = path.relative(dataDir, sourcePath)
    errors.push(...validateTitleDataset(json, fileLabel || datasetName))
  }

  errors.push(...validateVignetteMap(await readJson(path.join(dataDir, files.vignettes)), files.vignettes))
  errors.push(...validateSource(await readJson(path.join(dataDir, files.source)), files.source))

  return errors
}
