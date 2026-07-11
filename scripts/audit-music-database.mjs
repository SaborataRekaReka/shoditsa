import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const INPUT = path.join(ROOT, 'public/data/libraries/music/items.json')
const RUNTIME = path.join(ROOT, 'public/data/music.generated.json')
const INDEX = path.join(ROOT, 'public/data/libraries/music/search-index.json')
const OUTPUT = path.join(ROOT, 'docs/music-database-audit.json')

const items = JSON.parse(fs.readFileSync(INPUT, 'utf8'))
const runtime = JSON.parse(fs.readFileSync(RUNTIME, 'utf8'))
const index = JSON.parse(fs.readFileSync(INDEX, 'utf8'))

const normalize = (value) => String(value ?? '')
  .normalize('NFKC')
  .toLocaleLowerCase('ru-RU')
  .replace(/ё/g, 'е')
  .replace(/[^a-zа-я0-9]+/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const isPlaceholderImage = (url) => /2a96cbd8b46e442fc41c2b86b821562f/i.test(String(url ?? ''))
const isMalformedLink = (url) => {
  const text = String(url ?? '').trim()
  if (!/^https?:\/\//i.test(text) || text === 'https://1' || text === 'http://1') return true
  try {
    const parsed = new URL(text)
    return !parsed.hostname || (!parsed.hostname.includes('.') && parsed.hostname !== 'localhost')
  } catch {
    return true
  }
}

const duplicateGroups = (keyOf) => {
  const groups = new Map()
  items.forEach((item, itemIndex) => {
    const key = keyOf(item)
    if (key === null || key === undefined || key === '') return
    const values = groups.get(key) ?? []
    values.push({ itemIndex, id: item.id, title: item.titleOriginal || item.titleRu })
    groups.set(key, values)
  })
  return [...groups.entries()]
    .filter(([, values]) => values.length > 1)
    .map(([value, cards]) => ({ value, cards }))
}

const answerLeaks = []
const placeholderImages = []
const malformedLinks = []
const readyContradictions = []
const missingFields = []
const hintLengthViolations = []
const playableMetaHints = []
const META_HINT_PATTERNS = [
  /карточк/i,
  /подсказ/i,
  /здесь поможет/i,
  /узнавать.+каталог/i,
  /биографи.+недостат/i,
  /требует уточнения/i,
  /стриминг.+смеш/i,
]

for (const item of items) {
  const rawHint = String(item.plotHint ?? '').trim()
  const hint = normalize(item.plotHint)
  const answerForms = [...new Set([
    item.titleRu,
    item.titleOriginal,
    ...(item.alternativeTitles ?? []),
    ...(item.aliases ?? []),
  ].map(normalize).filter((value) => value.length >= 3))]
  const leaked = answerForms.filter((value) => hint.includes(value))
  if (leaked.length) answerLeaks.push({ id: item.id, title: item.titleOriginal, leaked })

  if (rawHint.length < 95 || rawHint.length > 210) {
    hintLengthViolations.push({ id: item.id, length: rawHint.length })
  }
  if (item.allowedInGame === true && META_HINT_PATTERNS.some((pattern) => pattern.test(rawHint))) {
    playableMetaHints.push({ id: item.id, hint: rawHint })
  }

  for (const field of ['posterUrl', 'headerUrl', 'backdropUrl']) {
    if (isPlaceholderImage(item[field])) placeholderImages.push({ id: item.id, field, url: item[field] })
  }
  for (const url of item.screenshots ?? []) {
    if (isPlaceholderImage(url)) placeholderImages.push({ id: item.id, field: 'screenshots', url })
  }
  for (const url of item.musicLinks ?? []) {
    if (isMalformedLink(url)) malformedLinks.push({ id: item.id, url })
  }

  const unresolved = [
    ...(item.dataQuality?.missingFields ?? []),
    ...(item.verification?.issues ?? []),
  ]
  if (item.contentStatus === 'ready' && (
    item.dataQuality?.verified !== true
    || item.verification?.status !== 'verified'
    || unresolved.length > 0
  )) {
    readyContradictions.push({
      id: item.id,
      title: item.titleOriginal,
      dataVerified: item.dataQuality?.verified ?? null,
      verificationStatus: item.verification?.status ?? null,
      unresolved: [...new Set(unresolved)],
    })
  }

  const missing = []
  if (!item.id) missing.push('id')
  if (!item.titleRu && !item.titleOriginal) missing.push('title')
  if (!item.plotHint) missing.push('plotHint')
  if (!Number.isInteger(item.year)) missing.push('year')
  if (!Array.isArray(item.countries) || item.countries.length === 0) missing.push('countries')
  if (!Array.isArray(item.genres) || item.genres.length === 0) missing.push('genres')
  if (!Array.isArray(item.musicLinks) || item.musicLinks.length === 0) missing.push('musicLinks')
  if (missing.length) missingFields.push({ id: item.id, status: item.contentStatus, missing })
}

const duplicateImages = ['posterUrl', 'headerUrl', 'backdropUrl']
  .flatMap((field) => duplicateGroups((item) => item[field]).map((group) => ({ field, ...group })))
const crossTitleAliases = []
const titleOwners = new Map()
for (const item of items) {
  for (const title of [item.titleRu, item.titleOriginal]) {
    const key = normalize(title)
    if (!key) continue
    const owners = titleOwners.get(key) ?? new Set()
    owners.add(item.id)
    titleOwners.set(key, owners)
  }
}
for (const item of items) {
  for (const alias of [...new Set([...(item.alternativeTitles ?? []), ...(item.aliases ?? [])])]) {
    const owners = [...(titleOwners.get(normalize(alias)) ?? [])].filter((id) => id !== item.id)
    if (owners.length) crossTitleAliases.push({ id: item.id, alias, conflictsWith: owners })
  }
}

const errors = {
  invalidRoot: !Array.isArray(items),
  duplicateIds: duplicateGroups((item) => item.id),
  duplicateCanonicalIds: duplicateGroups((item) => item.canonicalId),
  duplicateRanks: duplicateGroups((item) => item.topRank),
  duplicateTitles: duplicateGroups((item) => normalize(item.titleOriginal || item.titleRu)),
  crossTitleAliases,
  answerLeaks,
  hintLengthViolations,
  playableMetaHints,
  placeholderImages,
  malformedLinks,
  readyContradictions,
  runtimeMismatch: JSON.stringify(items) !== JSON.stringify(runtime),
  indexCountMismatch: index.totalItems !== items.length || index.docs?.length !== items.length,
}

const errorCount = Object.values(errors).reduce((total, value) => {
  if (typeof value === 'boolean') return total + (value ? 1 : 0)
  return total + value.length
}, 0)

const warnings = {
  duplicateImages,
  incompleteCards: missingFields,
  limitedOrBlocked: items
    .filter((item) => item.contentStatus !== 'ready')
    .map((item) => ({ id: item.id, title: item.titleOriginal, status: item.contentStatus })),
}

const report = {
  generatedAt: new Date().toISOString(),
  input: path.relative(ROOT, INPUT).replace(/\\/g, '/'),
  summary: {
    totalItems: items.length,
    ready: items.filter((item) => item.contentStatus === 'ready').length,
    limited: items.filter((item) => item.contentStatus === 'limited').length,
    blocked: items.filter((item) => item.contentStatus === 'blocked').length,
    allowedInGame: items.filter((item) => item.allowedInGame === true).length,
    errors: errorCount,
    warnings: duplicateImages.length + missingFields.length,
  },
  errors,
  warnings,
  notes: [
    'Автоматический аудит проверяет целостность, коллизии, прямые текстовые спойлеры и внутренние противоречия.',
    'Он не заменяет независимый биографический фактчек каждого поля по первичным источникам.',
    'Повторные изображения и пропуски у limited/blocked карточек считаются предупреждениями, а не ошибками.',
  ],
}

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true })
fs.writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

console.log(`Music cards: ${report.summary.totalItems}`)
console.log(`Ready / limited / blocked: ${report.summary.ready} / ${report.summary.limited} / ${report.summary.blocked}`)
console.log(`Allowed in game: ${report.summary.allowedInGame}`)
console.log(`Errors: ${report.summary.errors}`)
console.log(`Warnings: ${report.summary.warnings}`)
console.log(`Report: ${path.relative(ROOT, OUTPUT).replace(/\\/g, '/')}`)

if (errorCount > 0) process.exitCode = 1
