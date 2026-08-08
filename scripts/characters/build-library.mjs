import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const BASE_SOURCE = path.join(ROOT, 'data', 'characters', 'seeds', 'characters.v1.json')
const EXPANSION_SOURCES = [
  { file: path.join(ROOT, 'data', 'characters', 'seeds', 'characters.expansion50.json'), batchId: 'character-expansion-50', count: 50 },
  { file: path.join(ROOT, 'data', 'characters', 'seeds', 'characters.expansion330.json'), batchId: 'character-expansion-330', count: 330 },
]
const GENERATED = path.join(ROOT, 'data', 'characters', 'generated', 'items.json')
const REPORT = path.join(ROOT, 'data', 'characters', 'reports', 'audit.json')
const RUNTIME = path.join(ROOT, 'public', 'data', 'libraries', 'characters', 'items.json')
const SOURCE_META = path.join(ROOT, 'public', 'data', 'source.json')
const EXPECTED = 400

const normalize = (value) => String(value ?? '')
  .normalize('NFKC')
  .toLocaleLowerCase('ru-RU')
  .replace(/ё/g, 'е')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()

const unique = (values) => [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))]
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

const loadSource = () => {
  const base = JSON.parse(fs.readFileSync(BASE_SOURCE, 'utf8'))
  if (!Array.isArray(base)) throw new Error('Base character source root must be an array')
  const expanded = EXPANSION_SOURCES.flatMap(({ file, batchId, count }) => {
    const expansion = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (expansion?.batchId !== batchId || !Array.isArray(expansion?.items) || expansion.items.length !== count) {
      throw new Error(`Character expansion source must contain the ${batchId} batch with exactly ${count} items`)
    }
    if (!expansion.sources || typeof expansion.sources !== 'object' || Array.isArray(expansion.sources)) {
      throw new Error(`Character expansion source bundles are missing for ${batchId}`)
    }
    return expansion.items.map((item) => {
      const sources = expansion.sources[item.sourceKey]
      if (!Array.isArray(sources) || !sources.length) throw new Error(`${item.id ?? 'unknown'}: sourceKey ${item.sourceKey ?? 'missing'} is unresolved`)
      return { ...item, sources }
    })
  })
  return [...base, ...expanded]
}

const criteria = [
  'characterEra',
  'characterSourceTypes',
  'characterOriginCultures',
  'characterNature',
  'characterGender',
  'characterAgeGroup',
  'characterRoles',
  'characterArchetypes',
  'characterAbilities',
  'characterSettings',
]

const runtimeItem = (source, index) => {
  const aliases = unique([...(source.alternativeTitles ?? []), ...(source.aliases ?? [])])
  return {
    id: source.id,
    mode: 'character',
    titleRu: source.titleRu,
    titleOriginal: source.titleOriginal,
    alternativeTitles: aliases,
    aliases,
    acceptedAnswers: unique([source.titleRu, source.titleOriginal, ...aliases]),
    popularityScore: source.popularityScore,
    recognitionScore: source.recognitionScore,
    guessabilityScore: source.guessabilityScore,
    recognitionLevel: source.recognitionLevel,
    characterDifficulty: source.characterDifficulty,
    dailyEligible: source.dailyEligible !== false,
    posterUrl: `/images/characters/portraits/${source.slug}.webp`,
    plotHint: source.plotHint,
    description: source.plotHint,
    contentStatus: 'ready',
    allowedInGame: true,
    reviewStatus: 'verified',
    sourceFlags: ['editorial-public-domain-v1', 'original-ai-portrait'],
    characterRank: index + 1,
    characterSourceWork: source.characterSourceWork,
    characterSourceAuthor: source.characterSourceAuthor,
    characterFirstAppearanceYear: source.characterFirstAppearanceYear,
    characterEra: source.characterEra,
    characterEraOrder: source.characterEraOrder,
    characterSourceTypes: source.characterSourceTypes,
    characterOriginCultures: source.characterOriginCultures,
    characterNature: source.characterNature,
    characterGender: source.characterGender,
    characterAgeGroup: source.characterAgeGroup,
    characterRoles: source.characterRoles,
    characterArchetypes: source.characterArchetypes,
    characterAbilities: source.characterAbilities,
    characterSettings: source.characterSettings,
    iconicObjects: source.iconicObjects,
    rightsStatus: source.rightsStatus,
    characterSources: source.sources,
    mediaAttribution: {
      author: 'Сходится! / OpenAI',
      credit: 'Оригинальная иллюстрация, созданная для игры «Сходится!»',
      license: 'Собственная AI-иллюстрация',
      licenseUrl: null,
      attributionRequired: false,
    },
    dataQuality: {
      source: source.sources.map((entry) => entry.url),
      verified: true,
      missingFields: [],
      fieldSources: Object.fromEntries(criteria.map((field) => [field, source.sources.map((entry) => entry.url)])),
    },
  }
}

const validate = (source, items) => {
  const issues = []
  if (!Array.isArray(source)) return ['Source root must be an array']
  if (source.length !== EXPECTED) issues.push(`Expected ${EXPECTED} source cards, found ${source.length}`)
  const ids = new Set()
  const aliases = new Map()

  for (const [index, item] of items.entries()) {
    const label = item.id || `row:${index + 1}`
    if (!/^character:[a-z0-9-]+$/.test(item.id)) issues.push(`${label}: invalid stable id`)
    if (ids.has(item.id)) issues.push(`${label}: duplicate id`)
    ids.add(item.id)
    if (!item.titleRu || !item.titleOriginal) issues.push(`${label}: missing title`)
    if (!Number.isFinite(item.popularityScore)) issues.push(`${label}: popularityScore must be finite`)
    if (!Number.isFinite(item.characterEraOrder)) issues.push(`${label}: characterEraOrder must be finite`)
    if (!item.plotHint || item.plotHint.length < 80) issues.push(`${label}: plotHint is too short`)
    if (!item.characterSources?.length) issues.push(`${label}: provenance is missing`)
    for (const field of criteria) {
      const value = item[field]
      if (Array.isArray(value) ? !value.length : !String(value ?? '').trim()) issues.push(`${label}: ${field} is missing`)
    }
    const normalizedHint = normalize(item.plotHint)
    for (const title of item.acceptedAnswers) {
      const normalizedTitle = normalize(title)
      if (normalizedTitle.length >= 4 && normalizedHint.includes(normalizedTitle)) issues.push(`${label}: answer leaks into plotHint (${title})`)
      if (!normalizedTitle) continue
      const previous = aliases.get(normalizedTitle)
      if (previous && previous !== item.id) issues.push(`${label}: alias collision with ${previous} (${title})`)
      aliases.set(normalizedTitle, item.id)
    }
    const asset = path.join(ROOT, 'public', item.posterUrl.replace(/^\/+/, ''))
    if (!fs.existsSync(asset)) issues.push(`${label}: portrait is missing (${item.posterUrl})`)
  }
  return issues
}

const main = () => {
  const source = loadSource()
  const items = source.map(runtimeItem)
  const issues = validate(source, items)
  if (issues.length) throw new Error(`Character library validation failed:\n${issues.join('\n')}`)
  const generatedAt = new Date().toISOString()
  writeJson(GENERATED, items)
  writeJson(RUNTIME, items)
  writeJson(REPORT, {
    generatedAt,
    expected: EXPECTED,
    total: items.length,
    playable: items.filter((item) => item.allowedInGame && item.contentStatus === 'ready').length,
    dailyEligible: items.filter((item) => item.dailyEligible).length,
    criteriaCoverage: Object.fromEntries(criteria.map((field) => [field, items.filter((item) => Array.isArray(item[field]) ? item[field].length : item[field] != null).length])),
    difficulty: Object.fromEntries(['easy', 'medium', 'hard'].map((level) => [level, items.filter((item) => item.characterDifficulty === level).length])),
    rights: Object.fromEntries([...new Set(items.map((item) => item.rightsStatus))].map((status) => [status, items.filter((item) => item.rightsStatus === status).length])),
    issues: [],
  })
  const sourceMeta = JSON.parse(fs.readFileSync(SOURCE_META, 'utf8'))
  sourceMeta.characterCount = items.length
  sourceMeta.characterSource = 'data/characters/seeds/characters.v1.json + data/characters/seeds/characters.expansion50.json + data/characters/seeds/characters.expansion330.json'
  sourceMeta.characterGeneratedAt = generatedAt
  writeJson(SOURCE_META, sourceMeta)
  console.log(`characters: ${items.length} playable cards written to ${path.relative(ROOT, RUNTIME)}`)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main()
