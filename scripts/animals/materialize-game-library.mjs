import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const generatedDir = path.join(root, 'data', 'animals', 'generated')
const rosterPath = path.join(generatedDir, 'roster.json')
const libraryDir = path.join(root, 'public', 'data', 'libraries', 'animals')
const itemsPath = path.join(libraryDir, 'items.json')
const searchIndexPath = path.join(libraryDir, 'search-index.json')
const librarySourcePath = path.join(libraryDir, 'source.json')
const generatedPath = path.join(root, 'public', 'data', 'animals.generated.json')
const appSourcePath = path.join(root, 'public', 'data', 'source.json')
const libraryIndexPath = path.join(root, 'public', 'data', 'libraries', 'index.json')

const text = (value) => String(value ?? '').replace(/\s+/g, ' ').trim()
const unique = (values) => [...new Set(values.map(text).filter(Boolean))]
const capitalize = (value) => {
  const normalized = text(value)
  return normalized ? normalized[0].toLocaleUpperCase('ru-RU') + normalized.slice(1) : ''
}
const rounded = (value, digits = 1) => {
  if (value == null || text(value) === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Number(numeric.toFixed(digits)) : null
}
const positiveRounded = (value, digits = 1) => {
  const numeric = rounded(value, digits)
  return numeric != null && numeric > 0 ? numeric : null
}

const VALUE_LABELS = {
  Mammalia: 'Млекопитающие',
  Aves: 'Птицы',
  Actinopterygii: 'Лучепёрые рыбы',
  Reptilia: 'Пресмыкающиеся',
  Amphibia: 'Земноводные',
  Insecta: 'Насекомые',
  Arachnida: 'Паукообразные',
  Cephalopoda: 'Головоногие',
  Gastropoda: 'Брюхоногие',
  Malacostraca: 'Высшие раки',
  Chondrichthyes: 'Хрящевые рыбы',
  Carnivora: 'Хищные',
  Primates: 'Приматы',
  Rodentia: 'Грызуны',
  Artiodactyla: 'Парнокопытные',
  Cetartiodactyla: 'Китопарнокопытные',
  Perissodactyla: 'Непарнокопытные',
  Proboscidea: 'Хоботные',
  Lagomorpha: 'Зайцеобразные',
  Chiroptera: 'Рукокрылые',
  Diprotodontia: 'Двурезцовые сумчатые',
  Accipitriformes: 'Ястребообразные',
  Anseriformes: 'Гусеобразные',
  Charadriiformes: 'Ржанкообразные',
  Columbiformes: 'Голубеобразные',
  Falconiformes: 'Соколообразные',
  Galliformes: 'Курообразные',
  Passeriformes: 'Воробьинообразные',
  Pelecaniformes: 'Пеликанообразные',
  Piciformes: 'Дятлообразные',
  Psittaciformes: 'Попугаеобразные',
  Sphenisciformes: 'Пингвинообразные',
  Strigiformes: 'Совообразные',
  Testudines: 'Черепахи',
  Squamata: 'Чешуйчатые',
  Crocodylia: 'Крокодилы',
  Anura: 'Бесхвостые земноводные',
  Caudata: 'Хвостатые земноводные',
  Coleoptera: 'Жесткокрылые',
  Diptera: 'Двукрылые',
  Hymenoptera: 'Перепончатокрылые',
  Lepidoptera: 'Чешуекрылые',
  Octopoda: 'Осьминоги',
  Felidae: 'Кошачьи',
  Canidae: 'Псовые',
  Ursidae: 'Медвежьи',
  Bovidae: 'Полорогие',
  Cervidae: 'Оленевые',
  Equidae: 'Лошадиные',
  Hominidae: 'Гоминиды',
  Delphinidae: 'Дельфиновые',
  fur: 'Шерсть',
  feathers: 'Перья',
  scales: 'Чешуя',
  'moist-skin': 'Влажная кожа',
  exoskeleton: 'Экзоскелет',
  shell: 'Раковина',
  terrestrial: 'Наземная',
  aquatic: 'Водная',
  arboreal: 'Древесная',
  aerial: 'Воздушная',
  fossorial: 'Подземная',
  marine: 'Морская',
  freshwater: 'Пресноводная',
  brackish: 'Солоноватая вода',
  savanna: 'Саванна',
  grassland: 'Степь и луга',
  forest: 'Лес',
  rainforest: 'Тропический лес',
  desert: 'Пустыня',
  tundra: 'Тундра',
  wetland: 'Водно-болотные угодья',
  mountain: 'Горы',
  coastal: 'Побережье',
  'open-woodland': 'Редколесье',
  africa: 'Африка',
  asia: 'Азия',
  europe: 'Европа',
  'north-america': 'Северная Америка',
  'south-america': 'Южная Америка',
  oceania: 'Австралия и Океания',
  antarctica: 'Антарктида',
  carnivore: 'Хищник',
  herbivore: 'Травоядное',
  omnivore: 'Всеядное',
  insectivore: 'Насекомоядное',
  piscivore: 'Рыбоядное',
  frugivore: 'Плодоядное',
  nectarivore: 'Нектароядное',
  scavenger: 'Падальщик',
  diurnal: 'Дневная активность',
  nocturnal: 'Ночная активность',
  crepuscular: 'Сумеречная активность',
  cathemeral: 'Активность в разное время суток',
  walk: 'Ходьба',
  run: 'Бег',
  swim: 'Плавание',
  fly: 'Полёт',
  climb: 'Лазание',
  crawl: 'Ползание',
  burrow: 'Рытьё нор',
  jump: 'Прыжки',
  slither: 'Змеевидное движение',
  tiny: 'Очень маленький',
  small: 'Маленький',
  medium: 'Средний',
  large: 'Крупный',
  huge: 'Очень крупный',
  'live-birth': 'Живорождение',
  'egg-laying': 'Яйцекладущее',
  ovoviviparous: 'Яйцеживорождение',
  endothermic: 'Теплокровное',
  ectothermic: 'Холоднокровное',
  migratory: 'Перелётное или мигрирующее',
  'non-migratory': 'Не мигрирует',
  wild: 'Дикое',
  domestic: 'Домашнее',
  domesticated: 'Одомашненное',
  solitary: 'Одиночное',
  pair: 'Пары',
  group: 'Группы',
  herd: 'Стадо',
  pack: 'Стая',
  flock: 'Стая',
  colony: 'Колония',
  pride: 'Прайд',
}

const label = (value) => VALUE_LABELS[text(value)] ?? text(value)
const labels = (values) => unique((Array.isArray(values) ? values : []).map(label))

const plotHint = (animal) => {
  const authored = unique([
    ...(animal.hints?.distinctiveTraitsRu ?? []),
    ...(animal.hints?.defensesRu ?? []),
    ...(animal.hints?.sensesRu ?? []),
  ]).filter((value) => !value.toLocaleLowerCase('ru-RU').includes(text(animal.identity?.commonNameRu).toLocaleLowerCase('ru-RU')))
  if (authored.join(' ').length >= 30) return authored.slice(0, 2).join(' ')

  const fragments = [
    labels(animal.criteria?.habitats).length ? `встречается в таких местах, как ${labels(animal.criteria.habitats).slice(0, 2).join(' и ').toLocaleLowerCase('ru-RU')}` : '',
    labels(animal.criteria?.continents).length ? `обитает на территории: ${labels(animal.criteria.continents).slice(0, 3).join(', ')}` : '',
    labels(animal.criteria?.locomotion).length ? `передвигается, используя ${labels(animal.criteria.locomotion).slice(0, 2).join(' и ').toLocaleLowerCase('ru-RU')}` : '',
    labels(animal.criteria?.diets).length ? `тип питания: ${labels(animal.criteria.diets).slice(0, 2).join(', ').toLocaleLowerCase('ru-RU')}` : '',
  ].filter(Boolean)
  return `Это животное ${fragments.slice(0, 3).join('; ')}.`.replace(/\s+/g, ' ')
}

const mediaAttribution = (media) => media ? {
  sourcePageUrl: text(media.sourcePageUrl),
  author: text(media.author),
  credit: text(media.credit),
  license: text(media.license),
  licenseUrl: text(media.licenseUrl) || null,
  attributionRequired: Boolean(media.attributionRequired),
} : null

const animalToTitleItem = (animal, rosterEntry) => {
  const primaryImage = animal.media?.primaryImage ?? null
  const sound = animal.hints?.sounds?.[0] ?? null
  const rangeMap = animal.hints?.rangeMaps?.[0] ?? null
  const silhouette = animal.hints?.silhouettes?.[0] ?? null
  const commonNameRu = capitalize(animal.identity?.commonNameRu)
  const aliases = unique([
    animal.identity?.commonNameRu,
    ...(animal.identity?.aliasesRu ?? []),
    animal.identity?.commonNameEn,
    animal.identity?.scientificName,
    animal.identity?.acceptedScientificName,
  ]).filter((value) => value.toLocaleLowerCase('ru-RU') !== commonNameRu.toLocaleLowerCase('ru-RU'))

  return {
    id: text(animal.id),
    mode: 'animal',
    titleRu: commonNameRu,
    titleOriginal: text(animal.identity?.acceptedScientificName || animal.identity?.scientificName),
    alternativeTitles: aliases,
    aliases,
    acceptedAnswers: unique([commonNameRu, ...aliases]),
    popularityScore: rounded(Number(animal.selection?.totalScore ?? rosterEntry.score ?? 0) / 100, 4) ?? 0,
    posterUrl: text(primaryImage?.fileUrl) || null,
    backdropUrl: text(animal.media?.gallery?.[0]?.fileUrl) || null,
    description: plotHint(animal),
    shortDescription: unique(animal.hints?.distinctiveTraitsRu ?? []).join(' ') || null,
    plotHint: plotHint(animal),
    facts: unique([
      ...(animal.hints?.comparisonsRu ?? []),
      ...(animal.hints?.defensesRu ?? []),
      ...(animal.hints?.sensesRu ?? []),
    ]),
    contentStatus: 'ready',
    allowedInGame: true,
    reviewStatus: 'machine_verified',
    animalDifficulty: text(rosterEntry.difficulty || animal.selection?.difficulty),
    animalRank: Number(rosterEntry.rank),
    scientificName: text(animal.identity?.acceptedScientificName || animal.identity?.scientificName),
    taxonomicClass: label(animal.taxonomy?.taxonomicClass),
    animalOrder: label(animal.taxonomy?.order),
    animalFamily: label(animal.taxonomy?.family),
    animalGenus: text(animal.taxonomy?.genus),
    bodyCoverings: labels(animal.criteria?.bodyCoverings),
    habitats: labels(animal.criteria?.habitats),
    lifestyles: labels(animal.criteria?.lifestyles),
    animalContinents: labels(animal.criteria?.continents),
    climateZones: labels(animal.criteria?.climateZones),
    diets: labels(animal.criteria?.diets),
    activityPatterns: labels(animal.criteria?.activity),
    locomotion: labels(animal.criteria?.locomotion),
    sizeCategory: label(animal.criteria?.sizeCategory) || null,
    reproduction: label(animal.criteria?.reproduction) || null,
    sociality: labels(animal.criteria?.sociality),
    legCount: Number.isFinite(Number(animal.criteria?.legCount)) ? Number(animal.criteria.legCount) : null,
    thermoregulation: label(animal.criteria?.thermoregulation) || null,
    migration: label(animal.criteria?.migration) || null,
    relationToHumans: labels(animal.criteria?.relationToHumans),
    bodyMassKg: positiveRounded(animal.measurements?.bodyMassKg, 2),
    lifespanCategory: text(animal.measurements?.lifespanCategory) || null,
    lifespanMaximumYears: positiveRounded(animal.measurements?.lifespanYears?.maximumObserved, 1),
    conservationStatus: text(animal.ecology?.conservation?.statusLabelRu) || null,
    preyNames: unique((animal.ecology?.prey ?? []).map((entry) => entry.commonNameRu || entry.scientificName)),
    predatorNames: unique((animal.ecology?.predators ?? []).map((entry) => entry.commonNameRu || entry.scientificName)),
    distinctiveTraits: unique(animal.hints?.distinctiveTraitsRu ?? []),
    defenses: unique(animal.hints?.defensesRu ?? []),
    senses: unique(animal.hints?.sensesRu ?? []),
    soundUrl: text(sound?.fileUrl) || null,
    soundType: text(sound?.soundType) || null,
    silhouetteUrl: text(silhouette?.sourceFileUrl) || null,
    rangeMapUrl: text(rangeMap?.fileUrl) || null,
    mediaAttribution: mediaAttribution(primaryImage),
    soundAttribution: mediaAttribution(sound),
    rangeMapAttribution: mediaAttribution(rangeMap),
    sourceFlags: ['animal-pipeline', 'wikidata', 'gbif', primaryImage ? 'wikimedia-commons' : ''],
    dataQuality: {
      source: unique((animal.provenance ?? []).map((entry) => entry.source)),
      verified: Boolean(animal.selection?.eligible),
      missingFields: Array.isArray(animal.quality?.warnings) ? animal.quality.warnings : [],
    },
  }
}

const normalizeToken = (value) => text(value)
  .normalize('NFKD')
  .toLocaleLowerCase('ru-RU')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/ё/g, 'е')
  .split(/[^a-zа-я0-9]+/i)
  .filter((token) => token.length >= 2)

const buildSearchIndex = (items, generatedAt) => {
  const tokenToIds = new Map()
  const docs = items.map((item) => {
    const tokens = new Set([
      item.titleRu,
      item.titleOriginal,
      ...item.alternativeTitles,
      item.taxonomicClass,
      item.animalOrder,
      item.animalFamily,
    ].flatMap(normalizeToken))
    for (const token of tokens) {
      const ids = tokenToIds.get(token) ?? []
      ids.push(item.id)
      tokenToIds.set(token, ids)
    }
    return {
      id: item.id,
      titleRu: item.titleRu,
      titleOriginal: item.titleOriginal,
      alternativeTitles: item.alternativeTitles,
      year: null,
      topRank: item.animalRank,
      steamAppId: null,
      icd10: [],
    }
  })
  return {
    version: 1,
    library: 'animals',
    generatedAt,
    totalItems: items.length,
    tokensCount: tokenToIds.size,
    docs,
    tokenToIds: Object.fromEntries([...tokenToIds.entries()].sort((left, right) => left[0].localeCompare(right[0], 'ru-RU'))),
  }
}

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'))
const writeJson = async (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')

const main = async () => {
  const roster = await readJson(rosterPath)
  const rosterEntries = Array.isArray(roster.animals) ? roster.animals : []
  const wantedIds = new Set(rosterEntries.map((entry) => entry.id))
  const byId = new Map()

  for (const name of await readdir(generatedDir)) {
    if (!name.endsWith('.json')) continue
    const candidate = await readJson(path.join(generatedDir, name))
    if (!wantedIds.has(candidate.id)) continue
    const current = byId.get(candidate.id)
    if (!current || Number(candidate.selection?.totalScore ?? 0) > Number(current.selection?.totalScore ?? 0)) {
      byId.set(candidate.id, candidate)
    }
  }

  const missingIds = rosterEntries.map((entry) => entry.id).filter((id) => !byId.has(id))
  if (missingIds.length) throw new Error(`Roster records not found: ${missingIds.join(', ')}`)

  const items = rosterEntries.map((entry) => animalToTitleItem(byId.get(entry.id), entry))
  const duplicateTitles = items
    .map((item) => item.titleRu.toLocaleLowerCase('ru-RU'))
    .filter((title, index, all) => all.indexOf(title) !== index)
  if (duplicateTitles.length) throw new Error(`Duplicate Russian titles: ${unique(duplicateTitles).join(', ')}`)
  if (items.some((item) => !item.id || !item.titleRu || !item.titleOriginal || !item.plotHint || !item.posterUrl)) {
    throw new Error('Every runtime animal must have an ID, Russian and scientific names, a clue and an illustration')
  }

  const generatedAt = new Date().toISOString()
  const searchIndex = buildSearchIndex(items, generatedAt)
  const source = {
    generatedAt,
    sourceRoster: 'data/animals/generated/roster.json',
    rosterGeneratedAt: roster.generatedAt ?? null,
    schemaVersion: roster.schemaVersion ?? null,
    count: items.length,
    difficultyCounts: Object.fromEntries(['easy', 'medium', 'hard'].map((difficulty) => [
      difficulty,
      items.filter((item) => item.animalDifficulty === difficulty).length,
    ])),
    imageCount: items.filter((item) => item.posterUrl).length,
    soundCount: items.filter((item) => item.soundUrl).length,
    silhouetteCount: items.filter((item) => item.silhouetteUrl).length,
    rangeMapCount: items.filter((item) => item.rangeMapUrl).length,
  }

  await mkdir(libraryDir, { recursive: true })
  await Promise.all([
    writeJson(itemsPath, items),
    writeJson(generatedPath, items),
    writeJson(searchIndexPath, searchIndex),
    writeJson(librarySourcePath, source),
  ])

  const appSource = await readJson(appSourcePath)
  await writeJson(appSourcePath, {
    ...appSource,
    animalCount: items.length,
    animalSource: 'data/animals/generated/roster.json',
    animalGeneratedAt: generatedAt,
  })

  const libraryIndex = await readJson(libraryIndexPath)
  await writeJson(libraryIndexPath, {
    ...libraryIndex,
    generatedAt,
    libraries: [
      ...(Array.isArray(libraryIndex.libraries) ? libraryIndex.libraries.filter((entry) => entry?.key !== 'animals') : []),
      {
        key: 'animals',
        source: 'data/animals/generated/roster.json',
        itemsFile: 'public/data/libraries/animals/items.json',
        searchIndexFile: 'public/data/libraries/animals/search-index.json',
        count: items.length,
      },
    ],
  })

  console.log(JSON.stringify(source, null, 2))
}

await main()
