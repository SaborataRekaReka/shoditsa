import fs from 'node:fs/promises'
import path from 'node:path'

const REQUIRED_MODES = ['movie', 'series', 'anime', 'game', 'diagnosis']

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

export const readJson = async (filePath) => {
  const content = await fs.readFile(filePath, 'utf8')
  return JSON.parse(content)
}

const validateTitleItem = (item, file) => {
  const errors = []
  if (!isObject(item)) return [`${file}: entry is not object`]
  if (typeof item.id !== 'string' || !item.id.trim()) errors.push(`${file}: item.id is missing or invalid`)
  if (!REQUIRED_MODES.includes(item.mode)) errors.push(`${file}: item.mode is missing or invalid`)
  if (typeof item.titleRu !== 'string' || !item.titleRu.trim()) errors.push(`${file}: item.titleRu is missing or invalid`)
  if (!Array.isArray(item.alternativeTitles)) errors.push(`${file}: item.alternativeTitles must be array`)
  if (typeof item.popularityScore !== 'number') errors.push(`${file}: item.popularityScore must be number`)
  return errors
}

const validateTitleDataset = (json, file) => {
  if (!Array.isArray(json)) return [`${file}: root must be an array`]
  return json.flatMap((item) => validateTitleItem(item, file))
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
    vignettes: 'diagnosis-case-vignettes.by-id.json',
    source: 'source.json',
  }

  const errors = []

  for (const file of [files.movies, files.series, files.animes, files.games, files.diagnoses]) {
    const fullPath = path.join(dataDir, file)
    const json = await readJson(fullPath)
    errors.push(...validateTitleDataset(json, file))
  }

  errors.push(...validateVignetteMap(await readJson(path.join(dataDir, files.vignettes)), files.vignettes))
  errors.push(...validateSource(await readJson(path.join(dataDir, files.source)), files.source))

  return errors
}
