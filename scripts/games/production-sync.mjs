import {
  answerVariants,
  cleanText,
  editionType,
  franchiseKeyFor,
  normalizeTitle,
  uniqueStrings,
} from './enrichment-lib.mjs'
import { isPlayablePlotHint } from '../shared/plot-hint.mjs'

export const GAME_CANONICAL_REDIRECTS = Object.freeze({
  steam_49520: 'tgdb_5647',
  steam_730: 'tgdb_10771',
  steam_240: 'tgdb_3372',
  steam_221100: 'tgdb_10900',
  steam_588650: 'tgdb_46810',
  steam_1085660: 'tgdb_50624',
  steam_1293830: 'tgdb_56011',
  steam_70: 'tgdb_647',
  steam_550: 'tgdb_855',
  steam_252950: 'tgdb_29478',
  steam_264710: 'tgdb_114513',
  steam_440: 'tgdb_643',
  steam_203160: 'tgdb_2756',
  steam_391540: 'tgdb_31602',
  tgdb_4845: 'tgdb_75030',
})

export const MANUAL_GAME_TEXT_REPAIRS = Object.freeze({
  tgdb_120376: {
    plotHint: 'Героиня становится директором секретного федерального бюро и исследует постоянно меняющееся здание, используя телекинез и превращающееся служебное оружие.',
  },
  tgdb_362: {
    plotHint: 'Роботизированный герой впервые получает скольжение по земле и механического пса-помощника, сражаясь с восемью новыми противниками и таинственными копиями прежних врагов.',
  },
  tgdb_678: {
    plotHint: 'На далёкой планете климатический суперкомпьютер превращает пустыню в цветущий мир, но его сбой вызывает нашествие мутантов и постепенно разрушает привычный порядок.',
  },
  tgdb_428: {
    plotHint: 'Героиня ищет пропавшего брата на тюремном острове и антарктической базе; это первая часть серии с полностью трёхмерными локациями в реальном времени.',
  },
  tgdb_11458: {
    plotHint: 'Сноубордисты выполняют зрелищные трюки, накапливают ускорение и временно переходят в усиленное состояние под запоминающийся хип-хоп-рифф.',
  },
  tgdb_121826: {
    description: 'Аркадная игра для Atari 2600, в которой постоянно растущая цепочка движется по экрану, собирает предметы и должна избегать столкновений со стенами и собственным хвостом.',
  },
  steam_1623730: {
    description: 'Приключенческая игра с открытым миром, выживанием, строительством базы и коллекционированием фантастических существ, которых можно привлекать к боям и работе.',
    plotHint: 'В открытом мире игрок ловит фантастических существ, использует их в сражениях, строительстве и автоматизации базы, совмещая выживание с коллекционированием.',
    promote: true,
  },
  steam_1903340: {
    description: 'Сюжетная ролевая игра с пошаговыми боями в фэнтезийном мире, вдохновлённом Прекрасной эпохой, где экспедиция пытается остановить ежегодный смертельный ритуал.',
    plotHint: 'Каждый год загадочная Художница пишет на монолите уменьшающееся число, и участники очередной экспедиции отправляются прервать смертельный цикл в мире, вдохновлённом Прекрасной эпохой.',
    promote: true,
  },
  steam_1794680: {
    description: 'Динамичная аркадная игра с автоматическими атаками, короткими забегами и множеством сочетаний оружия, в которой герой противостоит постоянно растущим толпам врагов.',
    plotHint: 'Герой автоматически атакует бесконечные орды ночных существ, собирая оружие и улучшения до тех пор, пока экран не превращается в плотный узор снарядов и врагов.',
    promote: true,
  },
  steam_553850: {
    description: 'Кооперативный научно-фантастический экшен для отряда до четырёх бойцов, где задания на враждебных планетах требуют координации, а дружественный огонь всегда остаётся включённым.',
    plotHint: 'Отряд десантников высаживается на планеты, вызывает с орбиты оружие и оборудование комбинациями команд и рискует попасть под огонь собственных союзников.',
    promote: true,
  },
  steam_1091500: {
    description: 'Сюжетная ролевая игра с открытым миром о наёмнике из мегаполиса будущего, где развитие имплантов, отношения с персонажами и принятые решения меняют прохождение.',
    plotHint: 'Наёмник получает экспериментальный имплант с цифровой личностью погибшего рокера и ищет способ выжить в городе корпораций, банд и модифицированных людей.',
    promote: true,
  },
  steam_1086940: {
    description: 'Масштабная ролевая игра по правилам настольного фэнтези с пошаговыми боями, свободным исследованием, сложными отношениями со спутниками и последствиями почти каждого выбора.',
    plotHint: 'Герои заражены личинками пожирателей разума, но вместо немедленного превращения получают необычные способности и отправляются искать причину задержавшейся трансформации.',
    promote: true,
  },
  steam_1245620: {
    description: 'Ролевая игра с открытым фэнтезийным миром, сложными сражениями, исследованием подземелий и свободной сборкой персонажа из оружия, магии и особых навыков.',
    plotHint: 'Изгнанный воин возвращается в расколотые земли, собирает фрагменты великой руны и сражается с полубогами, чтобы определить судьбу древнего порядка.',
    promote: true,
  },
  steam_668580: {
    description: 'Приключенческий боевик от первого лица в альтернативной советской ретрофутуристической реальности, сочетающий исследование научного комплекса, стрельбу и способности перчатки.',
    plotHint: 'Спецагент прибывает в научный комплекс, где массовый запуск новой технологии оборачивается восстанием роботов и биомеханических экспериментов.',
    promote: true,
  },
  steam_1716740: {
    description: 'Космическая ролевая игра с исследованием планет, созданием кораблей и баз, развитием персонажа и сюжетными линиями нескольких организаций будущего.',
    plotHint: 'Шахтёр находит загадочный артефакт, переживает необъяснимое видение и присоединяется к группе исследователей, разыскивающих связанные с ним реликвии по всей галактике.',
    promote: true,
  },
  steam_2124490: {
    description: 'Психологический хоррор с исследованием туманного города, головоломками и напряжёнными боями, заново созданный на современной технологии с видом от третьего лица.',
    plotHint: 'Мужчина получает письмо от умершей жены и приезжает в окутанный туманом город, где чудовища и странные жители отражают его вытесненные воспоминания.',
    promote: true,
  },
  steam_1151340: {
    description: 'Многопользовательская ролевая игра в открытом мире после ядерной катастрофы, где участники исследуют Аппалачи, строят убежища и проходят сюжетные задания.',
    plotHint: 'Жители убежища выходят наружу спустя двадцать пять лет после войны, чтобы заново заселить Аппалачи, исследуя руины и запуская собственные поселения.',
    promote: true,
  },
  tgdb_98948: {
    description: 'Хоррор от первого лица о поисках пропавшей женщины в заброшенном доме на американском Юге, где исследование, головоломки и нехватка ресурсов усиливают чувство опасности.',
    plotHint: 'Мужчина приезжает в полуразрушенный дом на американском Юге по следу пропавшей жены и сталкивается с враждебной семьёй, исследуя комнаты от первого лица.',
    promote: true,
  },
})

export const MANUAL_GAME_EXCLUSIONS = Object.freeze({
  tgdb_118717: 'unofficial_rom_hack',
  tgdb_134350: 'unofficial_rom_hack',
  tgdb_117396: 'unofficial_pc_port',
  tgdb_102182: 'low_confidence_identity',
  tgdb_115764: 'low_confidence_identity',
  tgdb_80893: 'unlicensed_bootleg',
  tgdb_121826: 'low_confidence_homebrew_identity',
})

export const MANUAL_GAME_STUDIO_REPAIRS = Object.freeze({
  tgdb_136151: { developers: ['Rare'], publishers: ['Nintendo'] },
  fallback_seed_41: { developers: ['Game Freak'], publishers: ['Nintendo'] },
  tgdb_22904: { developers: ['Atari'], publishers: ['Atari'] },
  tgdb_26597: { developers: ['Westwood Studios'], publishers: ['Virgin Games'] },
  tgdb_35233: { developers: ['David Braben', 'Ian Bell'], publishers: ['Acornsoft'] },
  tgdb_14329: { developers: ['Jordan Mechner', 'Broderbund'], publishers: ['Broderbund'] },
  tgdb_35875: {
    developers: ['Steve Russell', 'Martin Graetz', 'Wayne Wiitanen'],
    publisherNotApplicable: true,
  },
  tgdb_113195: { developers: ['ReadySoft'], publishers: ['Merit Software'] },
  tgdb_67943: { developers: ['Produce!'], publishers: ['Hudson Soft'] },
  tgdb_19709: { developers: ['The NetHack DevTeam'], publisherNotApplicable: true },
  tgdb_82746: { developers: ['Nintendo R&D1'], publishers: ['Nintendo'] },
  fallback_seed_173: { developers: ['Game Freak'], publishers: ['Nintendo'] },
  tgdb_6747: { developers: ['Doug Smith'], publishers: ['Broderbund'] },
  fallback_seed_859: { developers: ['Bethesda Softworks'], publishers: ['Bethesda Softworks'] },
  fallback_seed_902: { developers: ['Climax Entertainment'], publishers: ['Sega'] },
  fallback_seed_903: { developers: ['Blizzard Entertainment'], publishers: ['Blizzard Entertainment'] },
  fallback_seed_330: { developers: ['Nintendo R&D1'], publishers: ['Nintendo'] },
  fallback_seed_527: { developers: ['Game Freak'], publishers: ['Nintendo'] },
  tgdb_98369: { developers: ['Capcom'], publishers: ['Capcom'] },
  fallback_seed_626: { developers: ['Game Freak'], publishers: ['Nintendo'] },
  fallback_seed_651: { developers: ['Bay 12 Games'], publishers: ['Bay 12 Games'] },
  tgdb_30333: { developers: ['PopCap Games'], publishers: ['PopCap Games'] },
  fallback_seed_671: { developers: ['Game Freak'], publishers: ['Nintendo'] },
  fallback_seed_829: { developers: ['Treasure', 'Nintendo R&D1'], publishers: ['Nintendo'] },
  fallback_seed_923: { developers: ['Capcom'], publishers: ['Capcom'] },
  tgdb_7135: {
    developers: ['Eul', 'IceFrog', 'Dota community'],
    publisherNotApplicable: true,
  },
  tgdb_72842: { developers: ['BioWare'], publishers: ['Electronic Arts'] },
  tgdb_34972: { developers: ['CD Projekt Red'], publishers: ['CD Projekt'] },
  tgdb_64513: { developers: ['Blizzard Entertainment'], publishers: ['Blizzard Entertainment'] },
  tgdb_15760: { developers: ['Playdead'], publishers: ['Playdead'] },
  tgdb_32754: { developers: ['Sam Barlow'], publishers: ['Sam Barlow'] },
  tgdb_13745: { developers: ['Gameloft'], publishers: ['Gameloft'] },
  tgdb_48109: { developers: ['Drool'], publishers: ['Drool'] },
  tgdb_30049: { developers: ['inkle'], publishers: ['inkle'] },
  tgdb_30051: { developers: ['Sirvo'], publishers: ['Sirvo'] },
  fallback_seed_492: { developers: ['Game Freak'], publishers: ['Nintendo'] },
  tgdb_22946: { developers: ['ustwo games'], publishers: ['ustwo games'] },
  tgdb_30055: { developers: ['Vlambeer'], publishers: ['Devolver Digital'] },
  fallback_seed_701: {
    developers: ['Bandai Namco Studios', 'Sora Ltd.'],
    publishers: ['Nintendo'],
  },
  fallback_seed_748: { developers: ['Kojima Productions'], publishers: ['Konami'] },
  tgdb_55988: { developers: ['Fireproof Games'], publishers: ['Fireproof Games'] },
  tgdb_27805: { developers: ['Telltale Games'], publishers: ['Telltale Games'] },
  fallback_seed_807: { developers: ['Level-5'], publishers: ['Nintendo'] },
  tgdb_19213: { developers: ['Simogo'], publishers: ['Simogo'] },
  tgdb_20323: {
    developers: ['Bandai Namco Entertainment'],
    publishers: ['Bandai Namco Entertainment'],
  },
  tgdb_22632: { developers: ['King'], publishers: ['King'] },
  tgdb_27456: { developers: ['Thomas Happ Games'], publishers: ['Thomas Happ Games'] },
  tgdb_44237: { developers: ['D-Pad Studio'], publishers: ['D-Pad Studio'] },
  tgdb_75574: { developers: ['Telltale Games'], publishers: ['Skybound Games'] },
  tgdb_53585: { developers: ['Subset Games'], publishers: ['Subset Games'] },
  tgdb_61672: {
    developers: ['Monstars', 'Resonair'],
    publishers: ['Enhance Games'],
  },
  fallback_seed_568: {
    developers: ['Game Freak'],
    publishers: ['Nintendo', 'The Pokémon Company'],
  },
  tgdb_103113: {
    developers: ['Naughty Dog'],
    publishers: ['Sony Interactive Entertainment'],
  },
  tgdb_62557: { developers: ['Mountains'], publishers: ['Annapurna Interactive'] },
})

const clone = (value) => JSON.parse(JSON.stringify(value))
const object = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
const hasText = (value) => cleanText(value).length > 0
const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null
const positive = (value) => finite(value) != null && Number(value) > 0
const integer = (value) => Number.isInteger(Number(value)) ? Number(value) : null
const studioValues = (value) => uniqueStrings(value)
  .filter((entry) => !/^(?:unknown|n\/a|none|неизвестно)$/i.test(entry))
const uniqueJson = (values) => {
  const seen = new Set()
  return values.filter((value) => {
    const key = JSON.stringify(value)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const redacted = /\[{2,}\s*REDACTED\s*\]*(?:\.{3,})?/gi
const redactedMarker = /\[{2,}\s*REDACTED\s*\]*(?:\.{3,})?/i
const keepMarker = /_KEEP_\d+_+/gi
const keepMarkerTest = /_KEEP_\d+_+/i
const repairTextEncoding = (value) => String(value ?? '')
  .replace(/â€™/g, '’')
  .replace(/â€œ/g, '“')
  .replace(/â€/g, '”')
  .replace(/â€“/g, '–')
  .replace(/â€”/g, '—')
  .replace(/Â°/g, '°')
  .replace(/\uFFFD/g, '')

const repairStringTree = (value) => {
  if (typeof value === 'string') return repairTextEncoding(value)
  if (Array.isArray(value)) return value.map(repairStringTree)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, repairStringTree(entry)]))
  }
  return value
}

const repairServiceMarkers = (value) => {
  if (typeof value === 'string') {
    return value
      .replace(new RegExp(`^${redacted.source}\\s*[—-]\\s*`, 'i'), 'Эта игра — ')
      .replace(redacted, '…')
      .replace(keepMarker, '…')
      .replace(/(?:…\s*){2,}/g, '… ')
  }
  if (Array.isArray(value)) return value.map(repairServiceMarkers)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, repairServiceMarkers(entry)]))
  }
  return value
}

const sanitizeDescription = (value) => {
  const text = cleanText(value)
  if (!text) return value ?? null
  return text
    .replace(new RegExp(`^${redacted.source}\\s*[—-]\\s*`, 'i'), 'Эта игра — ')
    .replace(redacted, '…')
    .replace(keepMarker, '…')
    .replace(/(?:…\s*){2,}/g, '… ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

const mergeArrays = (primary, fallback) => uniqueStrings([
  ...(Array.isArray(primary) ? primary : []),
  ...(Array.isArray(fallback) ? fallback : []),
])

const mergeObjects = (primary, fallback) => {
  const result = { ...object(fallback), ...object(primary) }
  for (const key of new Set([...Object.keys(object(fallback)), ...Object.keys(object(primary))])) {
    const preferred = object(primary)[key]
    const previous = object(fallback)[key]
    if (
      preferred == null
      || preferred === ''
      || (typeof preferred === 'number' && preferred === 0 && positive(previous))
    ) {
      result[key] = previous
    }
  }
  return result
}

const productionMedia = (productionValue, localValue) => (
  typeof productionValue === 'string' && productionValue.startsWith('/media/')
    ? productionValue
    : localValue || productionValue || null
)

const mergeSharedCard = (productionCard, localCard) => {
  const production = object(productionCard)
  const local = object(localCard)
  const result = { ...production, ...local }
  result.dailyEligible = production.allowedInGame === true

  // The active revision is the authority for player-visible copy and stable
  // identity fields. The local catalog contributes richer structured metadata.
  for (const field of [
    'titleRu', 'titleOriginal', 'releaseDate', 'description', 'shortDescription', 'ageRating',
  ]) {
    if (hasText(production[field])) result[field] = production[field]
  }
  if (integer(production.year) != null) result.year = production.year
  if (isPlayablePlotHint({
    title: production.titleOriginal || production.titleRu,
    titles: [production.titleRu, production.titleOriginal],
    text: production.plotHint,
  })) {
    result.plotHint = production.plotHint
  }

  for (const field of ['steamAppId', 'steamUrl', 'metacritic', 'wikidataId', 'wikidataUrl']) {
    if (!hasText(local[field]) && !positive(local[field]) && hasText(production[field])) result[field] = production[field]
  }

  for (const field of [
    'alternativeTitles', 'aliases', 'acceptedAnswers', 'normalizedAnswers', 'developers', 'publishers',
    'platforms', 'genres', 'steamCategories', 'supportedLanguages', 'notes', 'sourceFlags', 'legacyIds',
    'relatedVersions',
  ]) {
    result[field] = mergeArrays(local[field], production[field])
  }

  result.posterUrl = productionMedia(production.posterUrl, local.posterUrl)
  result.headerUrl = productionMedia(production.headerUrl, local.headerUrl)
  result.backdropUrl = productionMedia(production.backdropUrl, local.backdropUrl)
  result.screenshots = Array.isArray(production.screenshots) && production.screenshots.length
    ? production.screenshots
    : mergeArrays(local.screenshots, production.screenshots)
  result.ratings = mergeObjects(local.ratings, production.ratings)
  result.votes = mergeObjects(local.votes, production.votes)
  result.price = Object.keys(object(local.price)).length ? local.price : production.price ?? null
  result.externalRanks = mergeObjects(local.externalRanks, production.externalRanks)
  result.recognitionSignals = mergeObjects(local.recognitionSignals, production.recognitionSignals)
  result.recognitionComponents = mergeObjects(local.recognitionComponents, production.recognitionComponents)
  result.dataQuality = {
    ...object(production.dataQuality),
    ...object(local.dataQuality),
    source: mergeArrays(local.dataQuality?.source, production.dataQuality?.source),
  }
  return result
}

const mergeCanonicalCard = (canonicalCard, duplicateCard, canonicalId, duplicateId) => {
  const canonical = clone(canonicalCard)
  const duplicate = clone(duplicateCard)
  const result = { ...canonical }

  for (const field of [
    'alternativeTitles', 'aliases', 'acceptedAnswers', 'normalizedAnswers', 'developers', 'publishers',
    'platforms', 'genres', 'steamCategories', 'steamTags', 'supportedLanguages', 'notes', 'sourceFlags',
    'legacyIds', 'relatedVersions',
  ]) {
    result[field] = mergeArrays(canonical[field], duplicate[field])
  }
  result.legacyIds = mergeArrays(result.legacyIds, [duplicateId])
  result.relatedVersions = mergeArrays(result.relatedVersions, [duplicateId])
  if (normalizeTitle(duplicate.titleRu) !== normalizeTitle(canonical.titleRu)) {
    result.alternativeTitles = mergeArrays(result.alternativeTitles, [duplicate.titleRu, duplicate.titleOriginal])
  }

  for (const field of [
    'steamAppId', 'steamUrl', 'priceSnapshotAt', 'metacritic', 'wikidataId', 'wikidataUrl',
  ]) {
    if (!hasText(result[field]) && !positive(result[field]) && (hasText(duplicate[field]) || positive(duplicate[field]))) {
      result[field] = duplicate[field]
    }
  }
  result.ratings = mergeObjects(duplicate.ratings, canonical.ratings)
  result.votes = mergeObjects(duplicate.votes, canonical.votes)
  if (!Object.keys(object(result.price)).length && Object.keys(object(duplicate.price)).length) result.price = duplicate.price
  result.externalRanks = mergeObjects(canonical.externalRanks, duplicate.externalRanks)
  result.recognitionSignals = mergeObjects(duplicate.recognitionSignals, canonical.recognitionSignals)
  result.recognitionComponents = mergeObjects(duplicate.recognitionComponents, canonical.recognitionComponents)
  result.screenshots = uniqueStrings([...(canonical.screenshots ?? []), ...(duplicate.screenshots ?? [])])
  result.description = hasText(canonical.description) ? canonical.description : duplicate.description
  result.shortDescription = hasText(canonical.shortDescription) ? canonical.shortDescription : duplicate.shortDescription
  result.plotHint = isPlayablePlotHint({
    title: canonical.titleOriginal || canonical.titleRu,
    titles: [canonical.titleRu, canonical.titleOriginal],
    text: canonical.plotHint,
  }) ? canonical.plotHint : duplicate.plotHint
  result.recognitionScore = Math.max(finite(canonical.recognitionScore) ?? 0, finite(duplicate.recognitionScore) ?? 0)
  result.scoreConfidence = Math.max(finite(canonical.scoreConfidence) ?? 0, finite(duplicate.scoreConfidence) ?? 0)
  result.matchConfidence = Math.max(finite(canonical.matchConfidence) ?? 0, finite(duplicate.matchConfidence) ?? 0)
  result.canonicalGameId = canonicalId
  result.parentCanonicalGameId = null
  result.dailyEligible = canonical.dailyEligible === true || duplicate.dailyEligible === true
  result.dataQuality = {
    ...object(canonical.dataQuality),
    source: mergeArrays(canonical.dataQuality?.source, duplicate.dataQuality?.source),
    verified: Boolean(canonical.dataQuality?.verified || duplicate.dataQuality?.verified),
  }
  return result
}

const markDuplicate = (duplicateCard, canonicalCard, canonicalId) => {
  const duplicate = clone(duplicateCard)
  if (integer(duplicate.year) == null && integer(canonicalCard.year) != null) duplicate.year = canonicalCard.year
  if (!hasText(duplicate.releaseDate) && hasText(canonicalCard.releaseDate)) duplicate.releaseDate = canonicalCard.releaseDate
  duplicate.releaseYear = integer(duplicate.year)
  duplicate.canonicalGameId = canonicalId
  duplicate.canonicalId = canonicalId
  duplicate.parentCanonicalGameId = canonicalId
  duplicate.relatedVersions = mergeArrays(duplicate.relatedVersions, [canonicalId])
  duplicate.dailyEligible = false
  duplicate.allowedInGame = false
  duplicate.contentStatus = 'duplicate'
  duplicate.topRank = null
  duplicate.poolIds = (duplicate.poolIds ?? []).filter((pool) => pool !== 'daily-general')
  duplicate.reviewStatus = 'rejected'
  duplicate.sourceFlags = mergeArrays(duplicate.sourceFlags, ['production_game_catalog_duplicate'])
  return duplicate
}

const studioIdentityNames = (item) => new Set([
  item.titleRu,
  item.titleOriginal,
  ...(item.localizedTitles ? [item.localizedTitles.ru, item.localizedTitles.en] : []),
  ...(item.alternativeTitles ?? []),
  ...(item.aliases ?? []),
].map(normalizeTitle).filter(Boolean))

const mergeMatchingStudioMetadata = (catalog) => {
  const items = [...catalog.values()]
  for (const item of items) {
    const needsDevelopers = studioValues(item.developers).length === 0
    const needsPublishers = (
      studioValues(item.publishers).length === 0
      && !item.dataQuality?.notApplicableFields?.includes('publishers')
    )
    if (!needsDevelopers && !needsPublishers) continue
    const names = studioIdentityNames(item)
    const year = integer(item.year)
    const candidates = items
      .filter((candidate) => {
        if (candidate.id === item.id) return false
        const candidateYear = integer(candidate.year)
        if (year != null && candidateYear != null && Math.abs(year - candidateYear) > 2) return false
        if (![...studioIdentityNames(candidate)].some((name) => names.has(name))) return false
        return studioValues(candidate.developers).length || studioValues(candidate.publishers).length
      })
      .sort((left, right) => (
        Number(String(right.id).startsWith('steam_')) - Number(String(left.id).startsWith('steam_'))
        || Math.abs((integer(left.year) ?? year ?? 0) - (year ?? 0))
          - Math.abs((integer(right.year) ?? year ?? 0) - (year ?? 0))
        || String(left.id).localeCompare(String(right.id), 'en-US')
      ))
    const source = candidates[0]
    if (!source) continue
    if (needsDevelopers && studioValues(source.developers).length) {
      item.developers = studioValues(source.developers)
    }
    if (needsPublishers && studioValues(source.publishers).length) {
      item.publishers = studioValues(source.publishers)
    }
    item.sourceFlags = mergeArrays(item.sourceFlags, ['same_identity_local_studio_metadata'])
  }
}

const publisherSatisfied = (item) => (
  studioValues(item.publishers).length > 0
  || item.dataQuality?.notApplicableFields?.includes('publishers')
)

const requiredMissingFields = (item) => {
  const missing = []
  const textFields = ['titleRu', 'titleOriginal', 'description', 'plotHint', 'posterUrl', 'headerUrl', 'backdropUrl']
  for (const field of textFields) if (!hasText(item[field])) missing.push(field)
  if (integer(item.year) == null) missing.push('year')
  for (const field of ['genres', 'platforms']) {
    if (!Array.isArray(item[field]) || !item[field].length) missing.push(field)
  }
  if (!studioValues(item.developers).length) missing.push('developers')
  if (!publisherSatisfied(item)) missing.push('publishers')
  if (!hasText(item.ageRating)) missing.push('ageRating')
  if (!Array.isArray(item.screenshots) || !item.screenshots.length) missing.push('screenshots')
  if (!positive(item.steamAppId)) missing.push('steamAppId')
  if (!Array.isArray(item.supportedLanguages) || !item.supportedLanguages.length) missing.push('supportedLanguages')
  if (!positive(item.ratings?.steamPositivePercent)) missing.push('ratings.steamPositivePercent')
  if (!positive(item.votes?.steamReviews)) missing.push('votes.steamReviews')
  if (!Object.keys(object(item.price)).length || (!item.price?.isFree && !positive(item.price?.final))) missing.push('price')
  return missing
}

const finalizeIdentity = (item, auditedAt) => {
  const result = repairServiceMarkers(repairStringTree(clone(item)))
  result.mode = 'game'
  result.titleRu = cleanText(result.titleRu)
  result.titleOriginal = cleanText(result.titleOriginal || result.titleRu)
  result.alternativeTitles = uniqueStrings(result.alternativeTitles)
  result.aliases = uniqueStrings(result.aliases)
  result.localizedTitles = {
    ru: cleanText(result.localizedTitles?.ru || result.titleRu),
    en: cleanText(result.localizedTitles?.en || result.titleOriginal || result.titleRu),
  }
  result.acceptedAnswers = answerVariants(
    result.titleRu,
    result.titleOriginal,
    result.localizedTitles.ru,
    result.localizedTitles.en,
    result.alternativeTitles,
    result.aliases,
    result.acceptedAnswers,
  )
  result.normalizedAnswers = uniqueStrings([
    ...(result.normalizedAnswers ?? []),
    ...result.acceptedAnswers.map(normalizeTitle),
  ])
  if (!hasText(result.canonicalGameId)) result.canonicalGameId = result.id
  result.releaseScope = result.releaseScope === 'release' || String(result.id).startsWith('steam_') ? 'release' : 'title'
  result.releaseLabel = result.releaseScope === 'release'
    ? cleanText(result.releaseLabel || (String(result.id).startsWith('steam_') ? 'Steam' : 'Отдельное издание'))
    : null
  result.franchiseKey = result.franchiseKey || franchiseKeyFor(result.titleOriginal || result.titleRu)
  result.editionType = result.editionType || editionType(result.titleOriginal || result.titleRu)
  result.releaseYear = integer(result.year)
  result.sourceFlags = uniqueStrings([
    ...(result.sourceFlags ?? []),
    ...(result.dataQuality?.source ?? []),
    'production_game_catalog_upgrade_2026_07',
  ])
  result.description = sanitizeDescription(result.description)
  result.shortDescription = sanitizeDescription(result.shortDescription)
  result.dataQuality = {
    ...object(result.dataQuality),
    source: result.sourceFlags,
    verified: Boolean(result.dataQuality?.verified || result.reviewStatus === 'verified' || result.reviewStatus === 'machine_verified'),
    missingFields: requiredMissingFields(result),
    auditedAt,
  }
  return result
}

const allowedStatus = (item) => (
  item.dailyEligible === true
  && item.canonicalGameId === item.id
  && !['blocked', 'review', 'duplicate', 'promo_pack'].includes(String(item.contentStatus ?? ''))
  && !String(item.id).startsWith('promo:')
  && !/\bnot for resale\b/i.test(item.titleOriginal || item.titleRu)
)

const orderAllowed = (left, right) => (
  (finite(right.recognitionScore) ?? 0) - (finite(left.recognitionScore) ?? 0)
  || (finite(right.scoreConfidence) ?? 0) - (finite(left.scoreConfidence) ?? 0)
  || (integer(left.topRank) ?? Number.MAX_SAFE_INTEGER) - (integer(right.topRank) ?? Number.MAX_SAFE_INTEGER)
  || String(left.id).localeCompare(String(right.id), 'en-US')
)

const reportCoverage = (items, predicate) => {
  const values = items.filter(predicate)
  return { filled: values.length, missing: items.length - values.length }
}

export const summarizeGameCatalog = (items) => {
  const allowed = items.filter((item) => item.allowedInGame === true)
  const statuses = Object.fromEntries([...items.reduce((map, item) => {
    const key = String(item.contentStatus ?? '<null>')
    map.set(key, (map.get(key) ?? 0) + 1)
    return map
  }, new Map()).entries()].sort())
  const duplicateTitleYears = [...allowed.reduce((map, item) => {
    const key = `${normalizeTitle(item.titleOriginal || item.titleRu)}|${item.year ?? ''}`
    map.set(key, [...(map.get(key) ?? []), item.id])
    return map
  }, new Map()).entries()].filter(([, ids]) => ids.length > 1)
  const duplicateSteamIds = [...allowed.reduce((map, item) => {
    if (!positive(item.steamAppId)) return map
    const key = String(item.steamAppId)
    map.set(key, [...(map.get(key) ?? []), item.id])
    return map
  }, new Map()).entries()].filter(([, ids]) => ids.length > 1)
  const aliasCollisions = [...allowed.reduce((map, item) => {
    for (const answer of item.normalizedAnswers ?? []) {
      const key = normalizeTitle(answer)
      if (key) map.set(key, new Set([...(map.get(key) ?? []), item.id]))
    }
    return map
  }, new Map()).entries()].filter(([, ids]) => ids.size > 1)
  const cyrillic = /[\u0400-\u04FF]/
  const validMedia = (value) => typeof value === 'string' && (/^\/media\//.test(value) || /^https?:\/\//.test(value))
  const displayedAvailabilityFields = [
    'steam', 'steamCategories', 'steamRating', 'steamReviews',
    'metacritic', 'price', 'ageRating', 'publisher',
  ]
  const displayedAvailabilityComplete = (item) => displayedAvailabilityFields.every((field) => (
    hasText(item.dataQuality?.fieldAvailability?.[field])
  ))

  return {
    total: items.length,
    allowed: allowed.length,
    excluded: items.length - allowed.length,
    statuses,
    ranks: {
      filled: allowed.filter((item) => integer(item.topRank) != null).length,
      unique: new Set(allowed.map((item) => item.topRank)).size,
      min: Math.min(...allowed.map((item) => item.topRank)),
      max: Math.max(...allowed.map((item) => item.topRank)),
    },
    required: Object.fromEntries([
      ['titleRu', (item) => hasText(item.titleRu)],
      ['titleOriginal', (item) => hasText(item.titleOriginal)],
      ['year', (item) => integer(item.year) != null],
      ['description', (item) => hasText(item.description)],
      ['plotHint', (item) => isPlayablePlotHint({
        title: item.titleOriginal || item.titleRu,
        titles: [item.titleRu, item.titleOriginal],
        text: item.plotHint,
      })],
      ['genres', (item) => item.genres?.length],
      ['developers', (item) => studioValues(item.developers).length],
      ['publishers', (item) => publisherSatisfied(item)],
      ['platforms', (item) => item.platforms?.length],
      ['posterUrl', (item) => validMedia(item.posterUrl)],
      ['headerUrl', (item) => validMedia(item.headerUrl)],
      ['backdropUrl', (item) => validMedia(item.backdropUrl)],
      ['canonicalGameId', (item) => item.canonicalGameId === item.id],
      ['poolIds', (item) => item.poolIds?.includes('daily-general')],
      ['dailyEligible', (item) => item.dailyEligible === true],
      ['recognitionScore', (item) => finite(item.recognitionScore) != null],
    ].map(([field, predicate]) => [field, reportCoverage(allowed, predicate)])),
    optional: Object.fromEntries([
      ['ageRating', (item) => hasText(item.ageRating)],
      ['screenshots', (item) => item.screenshots?.length],
      ['steamAppId', (item) => positive(item.steamAppId)],
      ['supportedLanguages', (item) => item.supportedLanguages?.length],
      ['steamRating', (item) => positive(item.ratings?.steamPositivePercent)],
      ['steamReviews', (item) => positive(item.votes?.steamReviews)],
      ['metacritic', (item) => positive(item.ratings?.metacritic) || positive(item.metacritic)],
      ['acceptedAnswersMultiple', (item) => item.acceptedAnswers?.length > 1],
    ].map(([field, predicate]) => [field, reportCoverage(allowed, predicate)])),
    displayed: {
      availability: Object.fromEntries(displayedAvailabilityFields.map((field) => [
        field,
        reportCoverage(allowed, (item) => hasText(item.dataQuality?.fieldAvailability?.[field])),
      ])),
      complete: reportCoverage(allowed, displayedAvailabilityComplete),
    },
    language: {
      russianDescriptions: allowed.filter((item) => cyrillic.test(String(item.description ?? ''))).length,
      russianHints: allowed.filter((item) => cyrillic.test(String(item.plotHint ?? ''))).length,
    },
    defects: {
      redactedDescriptions: items.filter((item) => /REDACTED/i.test(String(item.description ?? ''))).length,
      redactedShortDescriptions: items.filter((item) => /REDACTED/i.test(String(item.shortDescription ?? ''))).length,
      serviceMarkers: items.filter((item) => (
        redactedMarker.test(JSON.stringify(item)) || keepMarkerTest.test(JSON.stringify(item))
      )).length,
      mojibake: items.filter((item) => /(?:â€™|â€œ|â€|â€“|â€”|Â°|\uFFFD)/.test(JSON.stringify(item))).length,
      invalidAllowedMedia: allowed.filter((item) => ![item.posterUrl, item.headerUrl, item.backdropUrl].every(validMedia)).map((item) => item.id),
      duplicateTitleYears: duplicateTitleYears.map(([key, ids]) => ({ key, ids })),
      duplicateSteamIds: duplicateSteamIds.map(([steamAppId, ids]) => ({ steamAppId, ids })),
      aliasCollisions: aliasCollisions.length,
    },
  }
}

export const gameAliasesFor = (item, normalize) => {
  const entries = [
    [item.titleRu, 'ru'],
    [item.titleOriginal, 'original'],
    [item.localizedTitles?.ru, 'external'],
    [item.localizedTitles?.en, 'external'],
    ...(item.alternativeTitles ?? []).map((value) => [value, 'alternative']),
    ...(item.aliases ?? []).map((value) => [value, 'external']),
    ...(item.acceptedAnswers ?? []).map((value) => [value, 'external']),
    ...(item.normalizedAnswers ?? []).map((value) => [value, 'external']),
  ]
  const result = new Map()
  for (const [entry, kind] of entries) {
    const alias = cleanText(entry)
    const normalizedAlias = normalize(alias)
    if (alias && normalizedAlias && !result.has(normalizedAlias)) {
      result.set(normalizedAlias, { alias, normalizedAlias, kind })
    }
  }
  return [...result.values()]
}

export const buildGameCatalogUpgrade = ({
  activeGames,
  localGames,
  auditedAt = new Date().toISOString(),
  strict = true,
}) => {
  if (!Array.isArray(activeGames) || !Array.isArray(localGames)) throw new Error('Both activeGames and localGames must be arrays')
  const activeById = new Map(activeGames.map((item) => [String(item.id), clone(item)]))
  const localById = new Map(localGames.map((item) => [String(item.id), clone(item)]))
  if (activeById.size !== activeGames.length || localById.size !== localGames.length) throw new Error('Game catalogs contain duplicate IDs')

  const catalog = new Map()
  for (const local of localGames) {
    const production = activeById.get(String(local.id))
    catalog.set(String(local.id), production
      ? mergeSharedCard(production, local)
      : { ...clone(local), allowedInGame: false, dailyEligible: false })
  }
  for (const production of activeGames) {
    if (!catalog.has(String(production.id))) catalog.set(String(production.id), clone(production))
  }

  for (const [duplicateId, canonicalId] of Object.entries(GAME_CANONICAL_REDIRECTS)) {
    const duplicate = catalog.get(duplicateId)
    const canonical = catalog.get(canonicalId)
    if (!duplicate || !canonical) throw new Error(`Canonical redirect is incomplete: ${duplicateId} -> ${canonicalId}`)
    const merged = mergeCanonicalCard(canonical, duplicate, canonicalId, duplicateId)
    catalog.set(canonicalId, merged)
    catalog.set(duplicateId, markDuplicate(duplicate, merged, canonicalId))
  }

  for (const [itemId, repair] of Object.entries(MANUAL_GAME_TEXT_REPAIRS)) {
    const item = catalog.get(itemId)
    if (!item) throw new Error(`Manual repair target is missing: ${itemId}`)
    if (repair.plotHint) item.plotHint = repair.plotHint
    if (repair.description) item.description = repair.description
    if (repair.promote) {
      item.dailyEligible = true
      item.reviewStatus = 'machine_verified'
    }
    item.sourceFlags = mergeArrays(item.sourceFlags, ['manual_game_catalog_repair_2026_07'])
  }

  for (const [itemId, repair] of Object.entries(MANUAL_GAME_STUDIO_REPAIRS)) {
    const item = catalog.get(itemId)
    if (!item) throw new Error(`Manual studio repair target is missing: ${itemId}`)
    if (repair.developers) item.developers = studioValues(repair.developers)
    if (repair.publishers) item.publishers = studioValues(repair.publishers)
    if (repair.publisherNotApplicable) {
      item.publishers = []
      item.dataQuality = {
        ...object(item.dataQuality),
        notApplicableFields: mergeArrays(item.dataQuality?.notApplicableFields, ['publishers']),
      }
    }
    item.sourceFlags = mergeArrays(item.sourceFlags, ['manual_game_studio_repair_2026_07'])
  }

  for (const [itemId, reason] of Object.entries(MANUAL_GAME_EXCLUSIONS)) {
    const item = catalog.get(itemId)
    if (!item) throw new Error(`Manual exclusion target is missing: ${itemId}`)
    item.dailyEligible = false
    item.allowedInGame = false
    item.contentStatus = 'limited'
    item.reviewStatus = 'rejected'
    item.editionType = 'technical'
    item.exclusionReason = reason
    item.sourceFlags = mergeArrays(item.sourceFlags, ['manual_game_catalog_exclusion_2026_07'])
  }

  mergeMatchingStudioMetadata(catalog)

  for (const item of catalog.values()) {
    if (item.id === 'tgdb_49861') {
      item.publishers = (item.publishers ?? []).map((publisher) => repairTextEncoding(publisher))
    }
    if (String(item.id).startsWith('promo:')) {
      item.dailyEligible = false
      item.allowedInGame = false
      item.contentStatus = 'promo_pack'
    }
    if (/\bnot for resale\b/i.test(item.titleOriginal || item.titleRu)) {
      item.dailyEligible = false
      item.allowedInGame = false
      item.contentStatus = 'limited'
      item.reviewStatus = 'rejected'
      item.editionType = 'technical'
    }
    item.developers = studioValues(item.developers)
    item.publishers = studioValues(item.publishers)
    catalog.set(String(item.id), finalizeIdentity(item, auditedAt))
  }

  const allowed = [...catalog.values()].filter(allowedStatus).sort(orderAllowed)
  if (allowed.length !== 1000) {
    throw new Error(`Upgraded daily game pool must contain exactly 1000 cards, found ${allowed.length}`)
  }
  const allowedIds = new Set(allowed.map((item) => item.id))
  const rankById = new Map(allowed.map((item, index) => [item.id, index + 1]))

  for (const item of catalog.values()) {
    const isAllowed = allowedIds.has(item.id)
    item.allowedInGame = isAllowed
    item.dailyEligible = isAllowed
    item.topRank = rankById.get(item.id) ?? null
    item.topRankFormulaVersion = 'games-top-rank-v2'
    item.poolIds = uniqueStrings([
      ...(isAllowed ? ['daily-general'] : []),
      ...(item.poolIds ?? []).filter((pool) => pool !== 'daily-general'),
    ])
    if (isAllowed) item.contentStatus = 'ready'
    else if (!['duplicate', 'promo_pack', 'blocked'].includes(String(item.contentStatus ?? ''))) item.contentStatus = 'limited'
    if (finite(item.recognitionScore) != null) item.popularityScore = Number(item.recognitionScore)
    item.dataQuality = {
      ...object(item.dataQuality),
      source: uniqueStrings(item.sourceFlags),
      missingFields: requiredMissingFields(item),
      auditedAt,
    }
  }

  const items = [...catalog.values()].sort((left, right) => {
    const leftAllowed = allowedIds.has(left.id)
    const rightAllowed = allowedIds.has(right.id)
    if (leftAllowed !== rightAllowed) return leftAllowed ? -1 : 1
    if (leftAllowed) return Number(left.topRank) - Number(right.topRank)
    return String(left.id).localeCompare(String(right.id), 'en-US')
  })
  const localItems = items
    .filter((item) => (
      !String(item.id).startsWith('promo:')
      && item.id !== 'tgdb_10221_1'
      && item.id !== 'tgdb_4845'
    ))
    .sort((left, right) => (
      String(left.titleRu || left.titleOriginal || left.id)
        .localeCompare(String(right.titleRu || right.titleOriginal || right.id), 'ru-RU')
      || String(left.id).localeCompare(String(right.id), 'en-US')
    ))
  const summary = summarizeGameCatalog(items)

  if (strict && summary.defects.invalidAllowedMedia.length) throw new Error(`Invalid allowed media: ${summary.defects.invalidAllowedMedia.join(', ')}`)
  if (strict && summary.defects.duplicateTitleYears.length) throw new Error(`Duplicate playable title/year identities remain: ${JSON.stringify(summary.defects.duplicateTitleYears)}`)
  if (strict && summary.defects.duplicateSteamIds.length) throw new Error(`Duplicate playable Steam IDs remain: ${JSON.stringify(summary.defects.duplicateSteamIds)}`)
  if (strict && Object.values(summary.required).some((value) => value.missing > 0)) {
    throw new Error(`Required game coverage is incomplete: ${JSON.stringify(summary.required)}`)
  }
  if (strict && (
    summary.defects.redactedDescriptions
    || summary.defects.redactedShortDescriptions
    || summary.defects.serviceMarkers
    || summary.defects.mojibake
  )) {
    throw new Error(`Text cleanup is incomplete: ${JSON.stringify(summary.defects)}`)
  }

  return {
    schemaVersion: 1,
    auditedAt,
    apiRequests: 0,
    redirects: Object.entries(GAME_CANONICAL_REDIRECTS).map(([duplicateId, canonicalId]) => ({ duplicateId, canonicalId })),
    manualRepairs: Object.keys(MANUAL_GAME_TEXT_REPAIRS),
    studioRepairs: Object.keys(MANUAL_GAME_STUDIO_REPAIRS),
    exclusions: Object.entries(MANUAL_GAME_EXCLUSIONS).map(([itemId, reason]) => ({ itemId, reason })),
    items,
    localItems,
    summary,
  }
}
