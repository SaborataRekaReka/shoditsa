import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildPlotHint, cleanText, normalize, redactSpoilers, titleTokens, titleVariants } from './plot-hint.mjs'

const root = resolve(import.meta.dirname, '..')
const gamesPath = resolve(root, 'public', 'data', 'games.generated.json')
const reportPath = resolve(root, 'archive', 'reports', 'game-hints-redaction-report.json')

const cropText = (text, maxLength) => {
  const value = cleanText(text)
  if (!value) return ''
  return value.length > maxLength ? `${value.slice(0, maxLength).trimEnd()}...` : value
}

const unique = (items) => [...new Set(items.filter(Boolean))]
const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const boundedPattern = (value) => `(^|[^A-Za-zА-Яа-яЁё0-9])${escapeRegExp(value)}(?=$|[^A-Za-zА-Яа-яЁё0-9])`

const buildTitles = (game) => unique([
  game.titleOriginal,
  game.titleRu,
  ...(game.alternativeTitles ?? []),
].flatMap((title) => titleVariants(title)))

const buildContext = (game) => {
  const titles = buildTitles(game)
  const tokens = unique(titles.flatMap((title) => titleTokens(title)))
  return { titles, tokens }
}

const fieldHasRisk = (text, context) => {
  const value = cleanText(text)
  if (!value) return false

  const normalized = normalize(value)
  if (context.tokens.some((token) => new RegExp(`\\b${escapeRegExp(token)}\\b`, 'i').test(normalized))) {
    return true
  }

  return context.titles.some((title) => title && new RegExp(boundedPattern(title), 'iu').test(value))
}

const sanitizeField = (game, text, maxLength) => cropText(redactSpoilers({
  title: game.titleOriginal || game.titleRu,
  titles: [game.titleRu, ...(game.alternativeTitles ?? [])],
  text,
  maxLength,
}), maxLength)

const sanitizePlotHint = (game, text) => buildPlotHint({
  title: game.titleOriginal || game.titleRu,
  text,
  maxLength: 190,
}) || cropText(sanitizeField(game, game.shortDescription || game.description || '', 220), 190)

const sanitizeGameRecord = (game) => {
  const descriptionSource = cleanText(game.description)
  const shortSource = cleanText(game.shortDescription || game.description)
  const plotSource = cleanText(game.plotHint || game.shortDescription || game.description)

  const description = sanitizeField(game, descriptionSource, 420)
  const shortDescription = sanitizeField(game, shortSource, 220) || cropText(description, 220)
  const plotHint = sanitizePlotHint(game, plotSource) || cropText(shortDescription || description, 190)

  return {
    ...game,
    description,
    shortDescription,
    plotHint,
  }
}

const before = JSON.parse(await readFile(gamesPath, 'utf8'))
const changed = []
const after = before.map((game) => {
  const sanitized = sanitizeGameRecord(game)
  const fieldChanges = {}

  for (const field of ['description', 'shortDescription', 'plotHint']) {
    if ((game[field] ?? '') !== (sanitized[field] ?? '')) {
      fieldChanges[field] = {
        before: game[field] ?? '',
        after: sanitized[field] ?? '',
      }
    }
  }

  if (Object.keys(fieldChanges).length) {
    changed.push({
      id: game.id,
      titleRu: game.titleRu,
      titleOriginal: game.titleOriginal,
      fields: fieldChanges,
    })
  }

  return sanitized
})

const riskyBefore = before.filter((game) => {
  const context = buildContext(game)
  return ['description', 'shortDescription', 'plotHint'].some((field) => fieldHasRisk(game[field], context))
}).length

const riskyAfter = after.filter((game) => {
  const context = buildContext(game)
  return ['description', 'shortDescription', 'plotHint'].some((field) => fieldHasRisk(game[field], context))
}).length

const summary = {
  totalGames: before.length,
  changedGames: changed.length,
  riskyBefore,
  riskyAfter,
  changedDescriptions: changed.filter((entry) => entry.fields.description).length,
  changedShortDescriptions: changed.filter((entry) => entry.fields.shortDescription).length,
  changedPlotHints: changed.filter((entry) => entry.fields.plotHint).length,
}

await writeFile(gamesPath, JSON.stringify(after, null, 2), 'utf8')
await writeFile(reportPath, JSON.stringify({ summary, changed }, null, 2), 'utf8')

console.log(JSON.stringify(summary, null, 2))