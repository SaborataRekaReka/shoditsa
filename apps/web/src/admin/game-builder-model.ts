import type { ContentMode } from '@shoditsa/contracts'

export type JsonRecord = Record<string, unknown>
export type DetectedFieldKind = 'text' | 'number' | 'boolean' | 'list' | 'object-list' | 'object' | 'mixed' | 'empty'

export type DetectedField = {
  id: string
  path: string[]
  label: string
  kind: DetectedFieldKind
  coverage: number
  sampleValues: unknown[]
}

export type AnalysedJson = {
  records: JsonRecord[]
  rootPath: string[]
  fields: DetectedField[]
  schemaKey: string
}

export type TargetValueType = 'string' | 'number' | 'boolean' | 'array' | 'people' | 'media' | 'unknown'
export type TargetGroup = 'identity' | 'title' | 'attempt' | 'media' | 'extra'

export type TargetDefinition = {
  key: string
  payloadKey: string
  label: string
  hint: string
  group: TargetGroup
  valueType: TargetValueType
  aliases: string[]
  required?: boolean
  visual?: boolean
}

export type FieldMapping = Record<string, string | null>
export type MappedExchangeItem = { id: string; mode: ContentMode; data: JsonRecord }

type ArrayCandidate = { path: string[]; records: JsonRecord[]; score: number }

const isRecord = (value: unknown): value is JsonRecord => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const pointer = (path: string[]) => `/${path.map((part) => part.replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}`
const pathLabel = (path: string[]) => path.length ? path.map((part) => /[.\s]/.test(part) ? `[${JSON.stringify(part)}]` : part).join('.') : '$'

const collectArrayCandidates = (value: unknown, path: string[] = [], depth = 0): ArrayCandidate[] => {
  if (depth > 5) return []
  if (Array.isArray(value)) {
    const records = value.filter(isRecord)
    const ratio = value.length ? records.length / value.length : 0
    const keyBreadth = records.slice(0, 20).reduce((sum, record) => sum + Object.keys(record).length, 0) / Math.max(1, Math.min(records.length, 20))
    const current = records.length && ratio >= .6 ? [{ path, records, score: records.length * 12 + ratio * 80 + Math.min(40, keyBreadth * 3) - path.length * 3 }] : []
    return current.concat(value.slice(0, 12).flatMap((entry, index) => collectArrayCandidates(entry, [...path, String(index)], depth + 1)))
  }
  if (!isRecord(value)) return []
  return Object.entries(value).flatMap(([key, entry]) => collectArrayCandidates(entry, [...path, key], depth + 1))
}

const valueKind = (value: unknown): DetectedFieldKind => {
  if (value == null || value === '') return 'empty'
  if (typeof value === 'string') return 'text'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  if (Array.isArray(value)) return value.some(isRecord) ? 'object-list' : 'list'
  if (isRecord(value)) return 'object'
  return 'mixed'
}

const mergedKind = (values: unknown[]): DetectedFieldKind => {
  const kinds = new Set(values.map(valueKind).filter((kind) => kind !== 'empty'))
  return kinds.size === 0 ? 'empty' : kinds.size === 1 ? [...kinds][0] : 'mixed'
}

const getAtPath = (record: JsonRecord, path: string[]) => path.reduce<unknown>((value, part) => isRecord(value) ? value[part] : undefined, record)

const collectLeafPaths = (record: JsonRecord, prefix: string[] = [], depth = 0): string[][] => {
  if (depth > 5) return prefix.length ? [prefix] : []
  return Object.entries(record).flatMap(([key, value]) => {
    const path = [...prefix, key]
    if (isRecord(value) && Object.keys(value).length) return collectLeafPaths(value, path, depth + 1)
    return [path]
  })
}

const fieldSamples = (values: unknown[]) => {
  const unique = new Map<string, unknown>()
  for (const value of values) {
    if (value == null || value === '') continue
    const key = JSON.stringify(value)
    if (!unique.has(key)) unique.set(key, value)
    if (unique.size === 3) break
  }
  return [...unique.values()]
}

export const analyseUnknownJson = (input: unknown): AnalysedJson => {
  const candidates = collectArrayCandidates(input).sort((left, right) => right.score - left.score)
  const selected = candidates[0]
  const records = selected?.records ?? (isRecord(input) ? [input] : [])
  if (!records.length) throw new Error('В JSON не найден объект или массив объектов с карточками')
  if (records.length > 5_000) throw new Error('В одном импорте допускается не больше 5 000 карточек')
  const uniquePaths = new Map<string, string[]>()
  for (const record of records.slice(0, 250)) for (const path of collectLeafPaths(record)) uniquePaths.set(pointer(path), path)
  const fields = [...uniquePaths.entries()].map(([id, path]) => {
    const values = records.map((record) => getAtPath(record, path))
    const present = values.filter((value) => value != null && value !== '')
    return {
      id,
      path,
      label: pathLabel(path),
      kind: mergedKind(present),
      coverage: present.length / records.length,
      sampleValues: fieldSamples(present),
    }
  }).sort((left, right) => right.coverage - left.coverage || left.path.length - right.path.length || left.label.localeCompare(right.label, 'ru'))
  const schemaKey = fields.map((field) => `${field.id}:${field.kind}`).sort().join('|')
  return { records, rootPath: selected?.path ?? [], fields, schemaKey }
}

export const readDetectedValue = (record: JsonRecord, field: DetectedField | undefined) => field ? getAtPath(record, field.path) : undefined

const commonTargets: TargetDefinition[] = [
  { key: 'id', payloadKey: 'id', label: 'ID карточки', hint: 'Уникальный идентификатор или slug', group: 'identity', valueType: 'string', required: true, aliases: ['id', 'itemid', 'uid', 'uuid', 'slug', 'key', 'externalid', 'идентификатор'] },
  { key: 'titleRu', payloadKey: 'titleRu', label: 'Название', hint: 'Главное название ответа', group: 'title', valueType: 'string', required: true, visual: true, aliases: ['titleru', 'russiantitle', 'russianname', 'nameru', 'name', 'title', 'название', 'имя', 'заголовок'] },
  { key: 'titleOriginal', payloadKey: 'titleOriginal', label: 'Оригинальное название', hint: 'Подзаголовок титульной карточки', group: 'title', valueType: 'string', visual: true, aliases: ['titleoriginal', 'originaltitle', 'originalname', 'titleen', 'nameen', 'оригинальноеназвание'] },
  { key: 'alternativeTitles', payloadKey: 'alternativeTitles', label: 'Допустимые ответы', hint: 'Альтернативные названия или алиасы', group: 'identity', valueType: 'array', aliases: ['alternativetitles', 'aliases', 'alias', 'alsoknownas', 'synonyms', 'вариантыназвания', 'алиасы'] },
  { key: 'year', payloadKey: 'year', label: 'Год', hint: 'Год выхода', group: 'attempt', valueType: 'number', visual: true, aliases: ['year', 'releaseyear', 'startyear', 'год', 'годвыхода'] },
  { key: 'genres', payloadKey: 'genres', label: 'Жанры', hint: 'Один или несколько жанров', group: 'attempt', valueType: 'array', visual: true, aliases: ['genres', 'genre', 'tags', 'жанры', 'жанр'] },
  { key: 'plotHint', payloadKey: 'plotHint', label: 'Главная подсказка', hint: 'Основной текст карточки попытки', group: 'attempt', valueType: 'string', visual: true, aliases: ['plothint', 'hint', 'clue', 'description', 'shortdescription', 'summary', 'overview', 'описание', 'подсказка', 'сюжет'] },
  { key: 'facts', payloadKey: 'facts', label: 'Факты', hint: 'Дополнительные факты или подсказки', group: 'attempt', valueType: 'array', visual: true, aliases: ['facts', 'fact', 'interestingfacts', 'trivia', 'факты', 'факт'] },
  { key: 'posterUrl', payloadKey: 'posterUrl', label: 'Постер', hint: 'Вертикальная иллюстрация', group: 'media', valueType: 'media', visual: true, aliases: ['posterurl', 'poster', 'coverurl', 'cover', 'imageurl', 'image', 'thumbnail', 'постер', 'обложка', 'изображение'] },
  { key: 'headerUrl', payloadKey: 'headerUrl', label: 'Титульный фон', hint: 'Широкая иллюстрация титульника', group: 'media', valueType: 'media', visual: true, aliases: ['headerurl', 'header', 'hero', 'banner', 'bannerurl', 'backdrop', 'backdropurl', 'background', 'фон', 'баннер'] },
  { key: 'screenshots', payloadKey: 'screenshots', label: 'Иллюстрации', hint: 'Галерея изображений', group: 'media', valueType: 'array', aliases: ['screenshots', 'images', 'gallery', 'illustrations', 'скриншоты', 'иллюстрации', 'галерея'] },
  { key: 'countries', payloadKey: 'countries', label: 'Страна', hint: 'Страна или страны', group: 'attempt', valueType: 'array', visual: true, aliases: ['countries', 'country', 'origin', 'страны', 'страна'] },
  { key: 'allowedInGame', payloadKey: 'allowedInGame', label: 'Допуск в игру', hint: 'Можно ли использовать карточку', group: 'identity', valueType: 'boolean', aliases: ['allowedingame', 'enabled', 'active', 'published', 'isactive', 'доступно', 'активно'] },
]

const modeTargets: Partial<Record<ContentMode, TargetDefinition[]>> = {
  movie: [
    { key: 'ageRating', payloadKey: 'ageRating', label: 'Возраст', hint: 'Возрастной рейтинг', group: 'attempt', valueType: 'string', visual: true, aliases: ['agerating', 'age', 'mpaa', 'возраст', 'возрастнойрейтинг'] },
    { key: 'runtime', payloadKey: 'runtimeMinutes', label: 'Хронометраж', hint: 'Длительность в минутах', group: 'attempt', valueType: 'number', visual: true, aliases: ['runtime', 'duration', 'runtimeminutes', 'длительность', 'хронометраж'] },
    { key: 'ratingKinopoisk', payloadKey: 'ratings.kinopoisk', label: 'Кинопоиск', hint: 'Рейтинг Кинопоиска', group: 'attempt', valueType: 'number', visual: true, aliases: ['kinopoiskrating', 'kprating', 'ratingkp', 'ratingkinopoisk', 'kinopoisk', 'kp', 'рейтингкинопоиска'] },
    { key: 'ratingImdb', payloadKey: 'ratings.imdb', label: 'IMDb', hint: 'Рейтинг IMDb', group: 'attempt', valueType: 'number', visual: true, aliases: ['imdbrating', 'ratingimdb', 'imdb', 'рейтингimdb'] },
    { key: 'directors', payloadKey: 'directors', label: 'Режиссёр', hint: 'Режиссёр или режиссёры', group: 'attempt', valueType: 'people', visual: true, aliases: ['directors', 'director', 'creator', 'режиссер', 'режиссёры'] },
    { key: 'cast', payloadKey: 'cast', label: 'В ролях', hint: 'Основной актёрский состав', group: 'attempt', valueType: 'people', visual: true, aliases: ['cast', 'actors', 'stars', 'актеры', 'актёры', 'вролях'] },
  ],
  series: [
    { key: 'seasonsCount', payloadKey: 'seasonsCount', label: 'Сезоны', hint: 'Количество сезонов', group: 'attempt', valueType: 'number', visual: true, aliases: ['seasonscount', 'seasons', 'сезоны'] },
    { key: 'showrunners', payloadKey: 'showrunners', label: 'Шоураннеры', hint: 'Создатели сериала', group: 'attempt', valueType: 'people', visual: true, aliases: ['showrunners', 'creators', 'creator', 'создатели'] },
  ],
  anime: [
    { key: 'studios', payloadKey: 'studios', label: 'Студия', hint: 'Студия производства', group: 'attempt', valueType: 'array', visual: true, aliases: ['studios', 'studio', 'студия'] },
    { key: 'kind', payloadKey: 'kind', label: 'Формат', hint: 'TV, фильм, OVA и т. п.', group: 'attempt', valueType: 'string', visual: true, aliases: ['kind', 'type', 'format', 'формат', 'тип'] },
  ],
  game: [
    { key: 'developers', payloadKey: 'developers', label: 'Разработчик', hint: 'Разработчик или студия', group: 'attempt', valueType: 'array', visual: true, aliases: ['developers', 'developer', 'studio', 'разработчики', 'разработчик'] },
    { key: 'platforms', payloadKey: 'platforms', label: 'Платформы', hint: 'Игровые платформы', group: 'attempt', valueType: 'array', visual: true, aliases: ['platforms', 'platform', 'платформы', 'платформа'] },
    { key: 'publishers', payloadKey: 'publishers', label: 'Издатель', hint: 'Издатель игры', group: 'attempt', valueType: 'array', visual: true, aliases: ['publishers', 'publisher', 'издатели', 'издатель'] },
  ],
  music: [
    { key: 'activityStartYear', payloadKey: 'activityStartYear', label: 'Начало карьеры', hint: 'Год начала деятельности', group: 'attempt', valueType: 'number', visual: true, aliases: ['activitystartyear', 'formedyear', 'debutyear', 'careerstart', 'началокарьеры'] },
    { key: 'topTracks', payloadKey: 'topTracks', label: 'Популярные треки', hint: 'Список известных треков', group: 'attempt', valueType: 'array', visual: true, aliases: ['toptracks', 'tracks', 'songs', 'песни', 'треки'] },
    { key: 'members', payloadKey: 'members', label: 'Участники', hint: 'Состав исполнителя или группы', group: 'attempt', valueType: 'array', visual: true, aliases: ['members', 'bandmembers', 'участники', 'состав'] },
  ],
  diagnosis: [
    { key: 'icd10', payloadKey: 'icd10', label: 'МКБ-10', hint: 'Один или несколько кодов', group: 'attempt', valueType: 'array', visual: true, aliases: ['icd10', 'icd', 'mkb10', 'мкб10', 'кодмкб'] },
    { key: 'symptoms', payloadKey: 'symptoms', label: 'Симптомы', hint: 'Список симптомов', group: 'attempt', valueType: 'array', visual: true, aliases: ['symptoms', 'signs', 'симптомы', 'признаки'] },
  ],
  city: [
    { key: 'country', payloadKey: 'country', label: 'Страна', hint: 'Государство, в котором находится город', group: 'attempt', valueType: 'string', visual: true, aliases: ['country', 'страна'] },
    { key: 'continent', payloadKey: 'continent', label: 'Континент', hint: 'Континент или часть света', group: 'attempt', valueType: 'string', visual: true, aliases: ['continent', 'континент'] },
    { key: 'languages', payloadKey: 'languages', label: 'Языки', hint: 'Основные языки', group: 'attempt', valueType: 'array', visual: true, aliases: ['languages', 'language', 'языки', 'язык'] },
    { key: 'population', payloadKey: 'population', label: 'Население', hint: 'Численность населения', group: 'attempt', valueType: 'number', visual: true, aliases: ['population', 'население'] },
    { key: 'timezone', payloadKey: 'timezone', label: 'Часовой пояс', hint: 'Часовой пояс GMT', group: 'attempt', valueType: 'string', visual: true, aliases: ['timezone', 'часовойпояс'] },
    { key: 'capital', payloadKey: 'capital', label: 'Столица', hint: 'Является ли город столицей', group: 'identity', valueType: 'boolean', aliases: ['capital', 'столица'] },
    { key: 'popular', payloadKey: 'popular', label: 'Популярный', hint: 'Входит ли город в популярный пул', group: 'identity', valueType: 'boolean', aliases: ['popular', 'популярный'] },
    { key: 'countryFlagUrl', payloadKey: 'countryFlagUrl', label: 'Флаг страны', hint: 'Изображение флага государства', group: 'media', valueType: 'media', visual: true, aliases: ['countryflagurl', 'флагстраны'] },
    { key: 'cityFlagUrl', payloadKey: 'cityFlagUrl', label: 'Флаг города', hint: 'Изображение городского флага', group: 'media', valueType: 'media', visual: true, aliases: ['cityflagurl', 'флаггорода'] },
    { key: 'coatOfArmsUrl', payloadKey: 'coatOfArmsUrl', label: 'Герб', hint: 'Изображение герба города', group: 'media', valueType: 'media', visual: true, aliases: ['coatofarmsurl', 'герб'] },
  ],
}

const movieLayoutDataOnly = new Set(['plotHint', 'facts', 'headerUrl'])
export const targetsForMode = (mode: ContentMode) => [
  ...commonTargets.map((target) => movieLayoutDataOnly.has(target.key) ? { ...target, visual: false } : target),
  ...(modeTargets[mode] ?? []),
]

const normalizedName = (value: string) => value.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/g, '')
const compatible = (field: DetectedField, target: TargetDefinition) => {
  if (target.valueType === 'unknown') return 5
  if (target.valueType === 'array') return field.kind === 'list' || field.kind === 'object-list' ? 18 : field.kind === 'text' ? 6 : -8
  if (target.valueType === 'number') return field.kind === 'number' ? 18 : field.kind === 'text' ? 2 : -12
  if (target.valueType === 'boolean') return field.kind === 'boolean' ? 18 : field.kind === 'text' ? 2 : -12
  if (target.valueType === 'media') return field.kind === 'text' ? 12 : field.kind === 'list' ? 4 : -12
  return field.kind === 'text' ? 14 : field.kind === 'number' ? 3 : -7
}

const matchScore = (field: DetectedField, target: TargetDefinition) => {
  const leaf = normalizedName(field.path.at(-1) ?? '')
  const full = normalizedName(field.path.join(' '))
  const aliases = target.aliases.map(normalizedName)
  let score = aliases.includes(leaf) ? 110 : aliases.includes(full) ? 105 : 0
  if (!score && aliases.some((alias) => leaf.startsWith(alias) || alias.startsWith(leaf))) score = 68
  if (!score && aliases.some((alias) => full.includes(alias))) score = 52
  return score ? score + compatible(field, target) + field.coverage * 12 - field.path.length * 2 : 0
}

export const autoMapFields = (fields: DetectedField[], targets: TargetDefinition[]): FieldMapping => {
  const result: FieldMapping = Object.fromEntries(targets.map((target) => [target.key, null]))
  const used = new Set<string>()
  for (const target of [...targets].sort((left, right) => Number(Boolean(right.required)) - Number(Boolean(left.required)))) {
    const candidate = fields.map((field) => ({ field, score: matchScore(field, target) }))
      .filter(({ field, score }) => score >= 68 && !used.has(field.id))
      .sort((left, right) => right.score - left.score)[0]
    if (candidate) { result[target.key] = candidate.field.id; used.add(candidate.field.id) }
  }
  return result
}

export const inferContentMode = (fields: DetectedField[]): ContentMode => {
  const names = normalizedName(fields.map((field) => field.path.join(' ')).join(' '))
  const scores: Array<[ContentMode, number]> = [
    ['city', ['population', 'timezone', 'continent', 'население', 'столица'].filter((token) => names.includes(normalizedName(token))).length],
    ['game', ['steam', 'developer', 'platform', 'разработчик'].filter((token) => names.includes(normalizedName(token))).length],
    ['music', ['artist', 'track', 'album', 'исполнитель'].filter((token) => names.includes(normalizedName(token))).length],
    ['anime', ['shikimori', 'studio', 'episodesaired'].filter((token) => names.includes(normalizedName(token))).length],
    ['diagnosis', ['icd', 'symptom', 'диагноз'].filter((token) => names.includes(normalizedName(token))).length],
    ['series', ['seasons', 'showrunner', 'сезон'].filter((token) => names.includes(normalizedName(token))).length],
    ['movie', ['kinopoisk', 'director', 'runtime', 'режиссер'].filter((token) => names.includes(normalizedName(token))).length],
  ]
  return scores.sort((left, right) => right[1] - left[1])[0]?.[1] ? scores[0][0] : 'movie'
}

const scalarText = (value: unknown): string => {
  if (value == null) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return scalarText(value[0])
  if (isRecord(value)) return scalarText(value.name ?? value.title ?? value.label ?? value.value)
  return ''
}

const arrayValue = (value: unknown): unknown[] => {
  if (value == null || value === '') return []
  if (Array.isArray(value)) return value.map((entry) => isRecord(entry) ? scalarText(entry) || entry : entry).filter((entry) => entry !== '')
  if (typeof value === 'string') return value.split(/[,;|\n]/).map((entry) => entry.trim()).filter(Boolean)
  return [value]
}

const transformedValue = (value: unknown, type: TargetValueType) => {
  if (type === 'unknown') return value
  if (type === 'array') return arrayValue(value)
  if (type === 'people') {
    const entries = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,;|\n]/).map((entry) => entry.trim()).filter(Boolean) : value == null ? [] : [value]
    return entries.map((entry) => {
    if (isRecord(entry)) return {
      nameRu: scalarText(entry.nameRu ?? entry.name ?? entry.title ?? entry.label),
      nameOriginal: scalarText(entry.nameOriginal ?? entry.originalName),
      photoUrl: scalarText(entry.photoUrl ?? entry.image ?? entry.avatar) || null,
    }
    return { nameRu: scalarText(entry), nameOriginal: '', photoUrl: null }
    }).filter((entry) => entry.nameRu || entry.nameOriginal)
  }
  if (type === 'number') {
    const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(',', '.').match(/-?\d+(?:\.\d+)?/)?.[0])
    return Number.isFinite(parsed) ? parsed : null
  }
  if (type === 'boolean') {
    if (typeof value === 'boolean') return value
    const normalized = normalizedName(String(value ?? ''))
    return ['true', '1', 'yes', 'да', 'active', 'enabled'].includes(normalized)
  }
  return scalarText(value)
}

const setPayloadValue = (payload: JsonRecord, path: string, value: unknown) => {
  const parts = path.split('.')
  if (parts.length === 1) { payload[path] = value; return }
  let cursor = payload
  for (const part of parts.slice(0, -1)) {
    const existing = cursor[part]
    if (!isRecord(existing)) cursor[part] = {}
    cursor = cursor[part] as JsonRecord
  }
  cursor[parts.at(-1)!] = value
}

export const readPayloadValue = (payload: JsonRecord, path: string) => path.split('.').reduce<unknown>((value, part) => isRecord(value) ? value[part] : undefined, payload)

export const slugifyId = (value: unknown) => scalarText(value).toLocaleLowerCase('ru-RU').replace(/ё/g, 'е')
  .replace(/[^a-zа-я0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 180)

export const mapRecordToItem = (options: {
  record: JsonRecord
  index: number
  fields: DetectedField[]
  targets: TargetDefinition[]
  mapping: FieldMapping
  mode: ContentMode
  overrides?: JsonRecord
}): MappedExchangeItem => {
  const { record, index, fields, targets, mapping, mode, overrides = {} } = options
  const fieldById = new Map(fields.map((field) => [field.id, field]))
  const data: JsonRecord = {}
  for (const target of targets) {
    if (target.payloadKey === 'id') continue
    const field = fieldById.get(mapping[target.key] ?? '')
    if (!field) continue
    const value = transformedValue(readDetectedValue(record, field), target.valueType)
    if (value !== '' && value != null && (!Array.isArray(value) || value.length)) setPayloadValue(data, target.payloadKey, value)
  }
  const title = scalarText(data.titleRu)
  const mappedIdTarget = targets.find((target) => target.payloadKey === 'id')
  const mappedIdField = mappedIdTarget ? fieldById.get(mapping[mappedIdTarget.key] ?? '') : undefined
  const explicitId = scalarText(readDetectedValue(record, mappedIdField))
  const id = explicitId || `import-${slugifyId(title) || 'card'}-${index + 1}`
  if (typeof data.titleOriginal !== 'string') data.titleOriginal = ''
  if (!Array.isArray(data.alternativeTitles)) data.alternativeTitles = []
  if (mode === 'music' && typeof data.allowedInGame !== 'boolean') data.allowedInGame = true
  return { id, mode, data: { ...data, ...overrides } }
}

export const ensureUniqueItemIds = (items: MappedExchangeItem[]) => {
  const seen = new Map<string, number>()
  return items.map((item) => {
    const normalized = item.id.trim() || 'import-card'
    const count = (seen.get(normalized) ?? 0) + 1
    seen.set(normalized, count)
    return count === 1 ? { ...item, id: normalized } : { ...item, id: `${normalized}-${count}` }
  })
}

export const createExchangeDocument = (items: MappedExchangeItem[]) => {
  if (!items.length) throw new Error('Нет карточек для импорта')
  const fields = [...new Set(items.flatMap((item) => Object.keys(item.data)))]
    .filter((field) => field !== 'id' && field !== 'mode' && /^[A-Za-z][A-Za-z0-9_]*$/.test(field))
  if (!fields.length) throw new Error('Сначала сопоставьте хотя бы одно поле')
  return {
    format: 'shoditsa-content-exchange' as const,
    schemaVersion: 1 as const,
    exportId: crypto.randomUUID(),
    exportedAt: new Date().toISOString(),
    source: {},
    fields,
    items: items.map((item) => ({ id: item.id, mode: item.mode, data: item.data })),
  }
}

export const displayValue = (value: unknown, fallback = 'Перетащите поле') => {
  if (value == null || value === '') return fallback
  if (Array.isArray(value)) return value.map((entry) => scalarText(entry) || JSON.stringify(entry)).filter(Boolean).join(' · ') || fallback
  if (isRecord(value)) return scalarText(value) || JSON.stringify(value)
  return String(value)
}
