import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const gamesPath = resolve(root, 'public', 'data', 'games.generated.json')
const cachePath = resolve(root, 'docs', 'game-translation-cache.json')
const reportPath = resolve(root, 'archive', 'reports', 'game-translation-report.json')

const FIELDS = ['description', 'shortDescription', 'plotHint']
const TARGET = 'ru'
const SOURCE = 'en'
const BATCH_MAX_ITEMS = 80
const BATCH_MAX_CHARS = 25000

const cleanText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim()

const hasLatin = (value) => /[A-Za-z]/.test(value)
const hasCyrillic = (value) => /[А-Яа-яЁё]/.test(value)

const shouldTranslate = (value) => {
  const text = cleanText(value)
  if (!text) return false
  if (!hasLatin(text)) return false
  if (hasCyrillic(text) && !hasLatin(text)) return false
  return true
}

const readJsonIfExists = async (filePath, fallback) => {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'))
  } catch {
    return fallback
  }
}

const decodeHtmlEntities = (value) => String(value ?? '')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, code) => {
    const num = Number(code)
    return Number.isFinite(num) ? String.fromCharCode(num) : _
  })

const protectTokens = (text) => {
  const protectedParts = []
  let protectedText = text

  protectedText = protectedText.replace(/\[+\s*REDACTED\s*\]+/gi, (match) => {
    const token = `__KEEP_${protectedParts.length}__`
    protectedParts.push(match)
    return token
  })

  return {
    protectedText,
    protectedParts,
  }
}

const restoreTokens = (text, protectedParts) => {
  let result = text
  for (let i = 0; i < protectedParts.length; i += 1) {
    const token = `__KEEP_${i}__`
    result = result.split(token).join(protectedParts[i])
  }
  return result
}

const translateBatch = async ({ key, texts }) => {
  const response = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      q: texts,
      source: SOURCE,
      target: TARGET,
      format: 'text',
    }),
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = payload?.error?.message || `HTTP ${response.status}`
    throw new Error(`Google Translate API error: ${message}`)
  }

  const translations = payload?.data?.translations ?? []
  if (!Array.isArray(translations) || translations.length !== texts.length) {
    throw new Error('Google Translate API returned unexpected translations payload.')
  }

  return translations.map((entry) => decodeHtmlEntities(entry?.translatedText || ''))
}

const chunkTexts = (items) => {
  const chunks = []
  let current = []
  let currentChars = 0

  for (const item of items) {
    const len = item.length
    const exceedsCount = current.length >= BATCH_MAX_ITEMS
    const exceedsChars = currentChars + len > BATCH_MAX_CHARS
    if (current.length && (exceedsCount || exceedsChars)) {
      chunks.push(current)
      current = []
      currentChars = 0
    }
    current.push(item)
    currentChars += len
  }

  if (current.length) chunks.push(current)
  return chunks
}

const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY || process.env.GOOGLE_API_KEY || ''
if (!apiKey) {
  throw new Error('Missing GOOGLE_TRANSLATE_API_KEY (or GOOGLE_API_KEY) in environment.')
}

const games = JSON.parse(await readFile(gamesPath, 'utf8'))
const cache = await readJsonIfExists(cachePath, { source: SOURCE, target: TARGET, items: {} })
const cacheItems = cache?.items && typeof cache.items === 'object' ? cache.items : {}

const jobs = []
for (let gameIndex = 0; gameIndex < games.length; gameIndex += 1) {
  const game = games[gameIndex]
  for (const field of FIELDS) {
    const original = cleanText(game[field])
    if (!shouldTranslate(original)) continue
    jobs.push({ gameIndex, field, original })
  }
}

const uniqueTexts = [...new Set(jobs.map((job) => job.original))]
const toTranslate = uniqueTexts.filter((text) => !cacheItems[text])

const chunks = chunkTexts(toTranslate)
for (const chunk of chunks) {
  const prepared = chunk.map((text) => protectTokens(text))
  const translated = await translateBatch({
    key: apiKey,
    texts: prepared.map((entry) => entry.protectedText),
  })

  for (let i = 0; i < chunk.length; i += 1) {
    const restored = restoreTokens(translated[i], prepared[i].protectedParts)
    cacheItems[chunk[i]] = cleanText(restored)
  }
}

let changedRecords = 0
let changedFields = 0
const touchedIds = new Set()

for (const job of jobs) {
  const translated = cacheItems[job.original]
  if (!translated) continue
  if (games[job.gameIndex][job.field] !== translated) {
    games[job.gameIndex][job.field] = translated
    changedFields += 1
    touchedIds.add(games[job.gameIndex].id)
  }
}

changedRecords = touchedIds.size

const report = {
  source: SOURCE,
  target: TARGET,
  totalGames: games.length,
  scannedFields: jobs.length,
  uniqueTexts: uniqueTexts.length,
  translatedNow: toTranslate.length,
  cacheHits: uniqueTexts.length - toTranslate.length,
  changedRecords,
  changedFields,
}

await writeFile(gamesPath, JSON.stringify(games, null, 2), 'utf8')
await writeFile(cachePath, JSON.stringify({ source: SOURCE, target: TARGET, items: cacheItems }, null, 2), 'utf8')
await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')

console.log(JSON.stringify(report, null, 2))