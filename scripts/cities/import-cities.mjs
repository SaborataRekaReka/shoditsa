import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const defaultSource = 'C:\\Users\\brene\\Downloads\\Telegram Desktop\\v2_final.json'
const sourcePath = path.resolve(process.argv[2] || defaultSource)
const rawTarget = path.join(root, 'data', 'cities', 'raw', 'v2_final.json')
const generatedTarget = path.join(root, 'public', 'data', 'cities.generated.json')
const clientTarget = path.join(root, 'public', 'city-content', 'cities.json')
const libraryDir = path.join(root, 'public', 'data', 'libraries', 'cities')
const itemsTarget = path.join(libraryDir, 'items.json')
const searchIndexTarget = path.join(libraryDir, 'search-index.json')
const sourceTarget = path.join(libraryDir, 'source.json')
const libraryIndexTarget = path.join(root, 'public', 'data', 'libraries', 'index.json')
const appSourceTarget = path.join(root, 'public', 'data', 'source.json')
const countryCodesTarget = path.join(root, 'scripts', 'cities', 'country-codes.json')

const text = (value) => String(value ?? '').trim()
const splitList = (value) => [...new Set(text(value).split(',').map((entry) => entry.trim()).filter(Boolean))]
const integer = (value) => {
  const parsed = Number.parseInt(text(value).replace(/\s+/g, ''), 10)
  return Number.isFinite(parsed) ? parsed : null
}
const yes = (value) => text(value).toLocaleLowerCase('ru-RU') === 'да'
const invalidCapitalPairs = new Set([
  'San Jose|США',
  'Georgetown|Малайзия',
])
// Eight source rows combine the Russian identity/country of one city with
// English-source fields from another. Preserve their stable IDs, but repair
// the corrupted identity fields at the normalization boundary.
const sourceCorrections = new Map([
  ['city:san-jose-2', { titleOriginal: 'San José', population: 342188, timezone: 'GMT-06:00', alternativeTitles: ['Chepe', 'San Jose'] }],
  ['city:portland-2', { titleOriginal: 'Bridgetown', population: 110000, timezone: 'GMT-04:00', alternativeTitles: [], cityFlagUrl: null, coatOfArmsUrl: null }],
  ['city:bordeaux-2', { titleOriginal: 'Porto', population: 231800, timezone: 'GMT+00:00', alternativeTitles: ['Oporto'] }],
  ['city:jerusalem-2', { titleOriginal: 'Salem', population: 917414, timezone: 'GMT+05:30', alternativeTitles: [] }],
  ['city:tijuana', { titleOriginal: 'Zaragoza', population: 682513, timezone: 'GMT+01:00', alternativeTitles: ['Saragossa', 'Saragosa'] }],
  ['city:dayton-2', { titleOriginal: 'Venice', population: 249466, timezone: 'GMT+01:00', alternativeTitles: ['Venezia', 'Venise'] }],
  ['city:changchun', { titleOriginal: 'Cancún', population: 888797, timezone: 'GMT-05:00', alternativeTitles: ['Cancun'] }],
  ['city:chattogram', { titleOriginal: 'Islamabad–Rawalpindi', population: 3113056, timezone: 'GMT+05:00', alternativeTitles: ['Islamabad-Rawalpindi', 'Twin Cities'] }],
])
const continentByCountry = new Map([
  ['Тайвань', 'Азия'],
  ['САР Гонконг, Китай', 'Азия'],
  ['Макао, САР, Китай', 'Азия'],
  ['Лаосская НДР', 'Азия'],
  ['Фиджи', 'Океания'],
  ['Берег Слоновой Кости', 'Африка'],
  ['Демократическая Республика Конго', 'Африка'],
])
const secureUrl = (value) => text(value).replace(/^http:\/\//i, 'https://') || null
const slug = (value) => text(value)
  .normalize('NFKD')
  .toLocaleLowerCase('en-US')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'city'

const raw = await readFile(sourcePath, 'utf8')
const parsed = JSON.parse(raw)
if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('City source must be a non-empty JSON array')
const countryCodes = JSON.parse(await readFile(countryCodesTarget, 'utf8'))

const seenIds = new Set()
const items = parsed.map((entry, index) => {
  const titleOriginal = text(entry['Название (EN)'])
  const titleRu = text(entry['Название (RU)'])
  const country = text(entry['Страна (RU)'])
  const countryCode = countryCodes[country]
  if (!titleOriginal || !titleRu) throw new Error(`Row ${index + 1}: city names are required`)
  if (!countryCode) throw new Error(`Row ${index + 1}: ISO code is missing for ${country || 'unknown country'}`)

  const baseId = `city:${slug(titleOriginal)}`
  let id = baseId
  let suffix = 2
  while (seenIds.has(id)) id = `${baseId}-${suffix++}`
  seenIds.add(id)

  const item = {
    id,
    titleRu,
    titleOriginal,
    country,
    countryFlagUrl: `./images/cities/flags/${countryCode}.svg`,
    continent: text(entry['Континент']) || continentByCountry.get(country) || '',
    languages: splitList(entry['Языки']),
    population: integer(entry['Население']),
    cityFlagUrl: secureUrl(entry['Флаг города']),
    coatOfArmsUrl: secureUrl(entry['Герб города']),
    alternativeTitles: splitList(entry['Альтернативные названия']),
    ranks: {
      economy: integer(entry['Экономика']),
      humanCapital: integer(entry['Человеческий капитал']),
      qualityOfLife: integer(entry['Качество жизни']),
      ecology: integer(entry['Экология']),
      governance: integer(entry['Работа властей']),
    },
    timezone: text(entry['Часовой пояс']),
    popular: yes(entry['Популярный']),
    // The source contains two duplicate-name false positives: San Jose in
    // California and Georgetown in Penang. Keep the source untouched and
    // correct the normalized game data here.
    capital: yes(entry['Столица']) && !invalidCapitalPairs.has(`${titleOriginal}|${country}`),
    plotHint: '',
    facts: [],
  }
  return Object.assign(item, sourceCorrections.get(id))
})

try {
  const previousItems = JSON.parse(await readFile(clientTarget, 'utf8'))
  const previousContentById = new Map(previousItems.map((item) => [item.id, {
    plotHint: text(item.plotHint),
    facts: Array.isArray(item.facts) ? item.facts.map(text).filter(Boolean) : [],
  }]))
  for (const item of items) {
    const previous = previousContentById.get(item.id)
    item.plotHint = previous?.plotHint ?? ''
    item.facts = previous?.facts ?? []
  }
} catch {}

const libraryItems = items.map((item) => ({
  ...item,
  mode: 'city',
  year: null,
  endYear: null,
  genres: [],
  facts: item.facts,
  countries: [item.country],
  posterUrl: item.coatOfArmsUrl ?? item.cityFlagUrl ?? item.countryFlagUrl,
  headerUrl: null,
  backdropUrl: null,
  screenshots: [],
  allowedInGame: true,
  popularityScore: item.popular ? 1 : item.capital ? 0.75 : 0.25,
}))

const generatedAt = new Date().toISOString()
const tokenToIds = new Map()
const searchDocs = items.map((item) => {
  const tokens = new Set([item.titleRu, item.titleOriginal, ...item.alternativeTitles]
    .flatMap((value) => text(value).normalize('NFKD').toLocaleLowerCase('ru-RU').replace(/[\u0300-\u036f]/g, '').replace(/ё/g, 'е').split(/[^a-zа-я0-9]+/i))
    .filter((token) => token.length >= 2))
  for (const token of tokens) {
    const ids = tokenToIds.get(token) ?? []
    ids.push(item.id)
    tokenToIds.set(token, ids)
  }
  return { id: item.id, titleRu: item.titleRu, titleOriginal: item.titleOriginal, alternativeTitles: item.alternativeTitles, country: item.country }
})
const searchIndex = {
  version: 1,
  library: 'cities',
  generatedAt,
  totalItems: searchDocs.length,
  tokensCount: tokenToIds.size,
  docs: searchDocs,
  tokenToIds: Object.fromEntries([...tokenToIds.entries()].sort((left, right) => left[0].localeCompare(right[0], 'ru-RU'))),
}
const source = {
  generatedAt,
  importedFrom: sourcePath,
  sourceFile: 'v2_final.json',
  total: items.length,
  capitals: items.filter((item) => item.capital).length,
  popular: items.filter((item) => item.popular).length,
  capitalsAndPopular: items.filter((item) => item.capital || item.popular).length,
  withCountryFlag: items.filter((item) => item.countryFlagUrl).length,
  withCityFlag: items.filter((item) => item.cityFlagUrl).length,
  withCoatOfArms: items.filter((item) => item.coatOfArmsUrl).length,
  withHint: items.filter((item) => item.plotHint).length,
  withFacts: items.filter((item) => item.facts.length).length,
}

await mkdir(path.dirname(rawTarget), { recursive: true })
await mkdir(libraryDir, { recursive: true })
await mkdir(path.dirname(clientTarget), { recursive: true })
await writeFile(rawTarget, raw.endsWith('\n') ? raw : `${raw}\n`, 'utf8')
await writeFile(generatedTarget, `${JSON.stringify(items, null, 2)}\n`, 'utf8')
await writeFile(clientTarget, `${JSON.stringify(items)}\n`, 'utf8')
await writeFile(itemsTarget, `${JSON.stringify(libraryItems, null, 2)}\n`, 'utf8')
await writeFile(searchIndexTarget, `${JSON.stringify(searchIndex, null, 2)}\n`, 'utf8')
await writeFile(sourceTarget, `${JSON.stringify(source, null, 2)}\n`, 'utf8')

try {
  const appSource = JSON.parse(await readFile(appSourceTarget, 'utf8'))
  appSource.cityCount = items.length
  appSource.citySource = 'data/cities/raw/v2_final.json'
  appSource.cityGeneratedAt = generatedAt
  appSource.cityModes = {
    capitals: source.capitals,
    capitalsAndPopular: source.capitalsAndPopular,
    all: source.total,
  }
  await writeFile(appSourceTarget, `${JSON.stringify(appSource, null, 2)}\n`, 'utf8')
} catch (error) {
  console.warn(`App source metadata was not updated: ${error instanceof Error ? error.message : String(error)}`)
}

try {
  const libraryIndex = JSON.parse(await readFile(libraryIndexTarget, 'utf8'))
  const cityEntry = {
    key: 'cities',
    source: 'data/cities/raw/v2_final.json',
    itemsFile: 'public/data/libraries/cities/items.json',
    searchIndexFile: 'public/data/libraries/cities/search-index.json',
    count: items.length,
  }
  libraryIndex.generatedAt = generatedAt
  libraryIndex.libraries = [
    ...(Array.isArray(libraryIndex.libraries) ? libraryIndex.libraries.filter((entry) => entry?.key !== 'cities') : []),
    cityEntry,
  ]
  await writeFile(libraryIndexTarget, `${JSON.stringify(libraryIndex, null, 2)}\n`, 'utf8')
} catch (error) {
  console.warn(`Library index was not updated: ${error instanceof Error ? error.message : String(error)}`)
}

console.log(JSON.stringify(source, null, 2))
