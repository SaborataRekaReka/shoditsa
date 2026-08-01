import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const DEFAULT_SOURCE = path.join(ROOT, 'data', 'books', 'source', 'books_enriched_full.json')
const DEFAULT_HINTS = path.join(ROOT, 'data', 'books', 'manual', 'book-plot-hints-2026-07-31.json')
const DEFAULT_REPORT = path.join(ROOT, 'data', 'books', 'book-plot-hints-audit.json')

const argValue = (name, fallback) => {
  const prefix = `--${name}=`
  return process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? fallback
}

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'))
const normalize = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/\p{M}+/gu, '')
  .toLocaleLowerCase('ru-RU')
  .replace(/ё/g, 'е')
  .replace(/[^a-zа-я0-9]+/giu, ' ')
  .trim()
const words = (value) => normalize(value).split(/\s+/).filter(Boolean)
const wordNgrams = (value, size) => {
  const tokens = words(value)
  return Array.from({ length: Math.max(0, tokens.length - size + 1) }, (_, index) => tokens.slice(index, index + size).join(' '))
}
const trigrams = (value) => new Set(wordNgrams(value, 3))
const jaccard = (left, right) => {
  if (!left.size || !right.size) return 0
  let intersection = 0
  for (const value of left) if (right.has(value)) intersection += 1
  return intersection / (left.size + right.size - intersection)
}

const HARD_PATTERNS = [
  ['meta', /\b(?:книга|роман|произведение|повесть|рассказ|поэма)\b/iu],
  ['adaptation', /\b(?:фильм|сериал|акт[её]р|режисс[её]р|экранизац\w*)\b/iu],
  ['publishing', /\b(?:издательств\w*|преми\w*|рейтинг\w*|отзыв\w*|продаж\w*|википеди\w*)\b/iu],
  ['template', /в центре истории/iu],
  ['direct-address', /\b(?:угадайте|представьте|попробуйте|читатель|игрок)\b/iu],
  ['spoiler-language', /\b(?:в конце|в финале|оказывается|выясняется|развязк\w*|убийц\w*|тайн(?:ая|ую|ой) личност\w*|на самом деле|погибает|умирает|преда[её]т)\b/iu],
]
const ABSTRACT_WORDS = new Set(['судьба', 'свобода', 'любовь', 'тайна', 'взросление', 'выбор', 'добро', 'зло'])

export const auditBookPlotHints = ({ source, hints }) => {
  const sourceById = new Map(source.map((book) => [String(book?.['ID книги'] ?? ''), book]))
  const issues = []
  const seenIds = new Set()
  const exactHints = new Map()
  const hintTrigrams = []

  for (const entry of hints) {
    const id = String(entry?.id ?? '').trim()
    const hint = String(entry?.plotHint ?? '').trim()
    const book = sourceById.get(id)
    const entryIssues = []

    if (!id || !book) entryIssues.push({ code: 'unknown-id', detail: id || '(empty)' })
    if (seenIds.has(id)) entryIssues.push({ code: 'duplicate-id' })
    seenIds.add(id)
    if (!hint) entryIssues.push({ code: 'empty' })

    if (hint.length < 150 || hint.length > 230) entryIssues.push({ code: 'length', detail: hint.length })
    if (/\r|\n/u.test(hint)) entryIssues.push({ code: 'multiline' })
    const sentences = (hint.match(/[.!?](?=\s|$)/gu) ?? []).length
    if (sentences < 1 || sentences > 2) entryIssues.push({ code: 'sentence-count', detail: sentences })
    if (!/[.!]$/u.test(hint)) entryIssues.push({ code: 'unfinished' })
    if (/[?…]|\.\.\.|[()«»„“”"]|\[|\]/u.test(hint)) entryIssues.push({ code: 'forbidden-punctuation' })

    for (const [code, pattern] of HARD_PATTERNS) {
      if (pattern.test(hint)) entryIssues.push({ code })
    }
    const abstract = words(hint).filter((word) => ABSTRACT_WORDS.has(word))
    if (abstract.length >= 2) entryIssues.push({ code: 'abstract-language', detail: [...new Set(abstract)] })

    if (book) {
      const names = book?.['Название'] ?? {}
      const titles = [names?.['На русском'], names?.['На языке оригинала']]
        .map(normalize).filter((title) => title.length >= 3)
      const normalizedHint = normalize(hint)
      for (const title of titles) {
        if (normalizedHint.includes(title)) entryIssues.push({ code: 'title-leak', detail: title })
      }

      const author = normalize(book?.['Автор'])
      if (author.length >= 4 && normalizedHint.includes(author)) entryIssues.push({ code: 'author-leak', detail: author })
      const characters = Array.isArray(book?.['Главные персонажи']) ? book['Главные персонажи'] : []
      for (const character of characters.map(normalize).filter((value) => value.length >= 4)) {
        if (normalizedHint.includes(character)) entryIssues.push({ code: 'character-leak', detail: character })
      }

      const annotationNgrams = new Set(wordNgrams(book?.['Аннотация'], 6))
      const copied = wordNgrams(hint, 6).find((gram) => annotationNgrams.has(gram))
      if (copied) entryIssues.push({ code: 'annotation-copy', detail: copied })
    }

    const normalizedExact = normalize(hint)
    if (exactHints.has(normalizedExact)) entryIssues.push({ code: 'duplicate-hint', detail: exactHints.get(normalizedExact) })
    else exactHints.set(normalizedExact, id)
    hintTrigrams.push({ id, grams: trigrams(hint) })

    if (entryIssues.length) issues.push({ id, title: book?.['Название']?.['На русском'] ?? null, hint, issues: entryIssues })
  }

  const nearDuplicates = []
  for (let left = 0; left < hintTrigrams.length; left += 1) {
    for (let right = left + 1; right < hintTrigrams.length; right += 1) {
      const similarity = jaccard(hintTrigrams[left].grams, hintTrigrams[right].grams)
      if (similarity >= 0.72) nearDuplicates.push({ left: hintTrigrams[left].id, right: hintTrigrams[right].id, similarity: Number(similarity.toFixed(3)) })
    }
  }

  const byCode = {}
  for (const issue of issues.flatMap((entry) => entry.issues)) byCode[issue.code] = (byCode[issue.code] ?? 0) + 1
  return {
    generatedAt: new Date().toISOString(),
    counts: {
      source: source.length,
      hints: hints.length,
      clean: hints.length - issues.length,
      flagged: issues.length,
      missing: source.length - seenIds.size,
      nearDuplicates: nearDuplicates.length,
    },
    byCode,
    nearDuplicates,
    issues,
  }
}

const main = () => {
  const sourcePath = path.resolve(argValue('source', DEFAULT_SOURCE))
  const hintsPath = path.resolve(argValue('hints', DEFAULT_HINTS))
  const reportPath = path.resolve(argValue('report', DEFAULT_REPORT))
  const source = readJson(sourcePath)
  const document = readJson(hintsPath)
  const hints = Array.isArray(document) ? document : document.items
  if (!Array.isArray(source) || !Array.isArray(hints)) throw new Error('Source and hints must contain arrays')
  const report = auditBookPlotHints({ source, hints })
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ reportPath, counts: report.counts, byCode: report.byCode }, null, 2))
  if (report.counts.flagged || report.counts.missing || report.counts.nearDuplicates) process.exitCode = 1
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main()
