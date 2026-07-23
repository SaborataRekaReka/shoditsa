const STOPWORDS = new Set([
  'the',
  'and',
  'of',
  'for',
  'to',
  'a',
  'an',
  'in',
  'on',
  'at',
  'is',
  'it',
  'by',
  'from',
  'with',
  'game',
  'games',
  'edition',
  'series',
  'part',
  'new',
])

const REDACTION = '[REDACTED]'
const WORD_CHAR_CLASS = 'A-Za-zА-Яа-яЁё0-9'

export const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim()

export const normalize = (value) => cleanText(value)
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9а-яё\s]/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const unique = (items) => [...new Set(items.filter(Boolean))]

export const titleVariants = (title) => unique([
  cleanText(title),
  cleanText(title).replace(/\s*\([^)]*\)/g, '').trim(),
  cleanText(title).replace(/:\s.*$/, '').trim(),
])

export const titleTokens = (title) => {
  const normalized = normalize(title)
  if (!normalized) return []

  return unique(normalized
    .split(' ')
    .filter((token) => {
      if (!token || STOPWORDS.has(token)) return false
      if (/^\d+$/.test(token)) return true
      if (/^[ivxlcdm]+$/i.test(token)) return token.length >= 2
      return token.length >= 4
    }))
}

const boundedPattern = (value) => `(^|[^${WORD_CHAR_CLASS}])${escapeRegExp(value)}(?=$|[^${WORD_CHAR_CLASS}])`

const replacePhrases = (text, phrases, replacement) => {
  let result = text
  for (const phrase of phrases) {
    if (!phrase) continue
    result = result.replace(new RegExp(boundedPattern(phrase), 'giu'), `$1${replacement}`)
  }
  return result
}

const replaceTokens = (text, tokens, replacement) => {
  let result = text
  for (const token of tokens) {
    if (!token) continue
    result = result.replace(new RegExp(boundedPattern(token), 'giu'), `$1${replacement}`)
  }
  return result
}

const normalizePunctuation = (text) => text
  .replace(/\s+/g, ' ')
  .replace(/\s+([,.;:!?])/g, '$1')
  .replace(/([,.;:!?]){2,}/g, '$1')
  .replace(/(?:\[REDACTED\][\s,;:]*){2,}/g, `${REDACTION} `)
  .replace(/^[\s,;:!?-]+/, '')
  .replace(/[\s,;:!?-]+$/, '')
  .trim()

const cropCompleteText = (text, maxLength) => {
  if (!Number.isFinite(maxLength) || maxLength <= 0 || text.length <= maxLength) return text

  const prefix = text.slice(0, maxLength + 1)
  const sentenceEnds = [...prefix.matchAll(/[.!?](?=\s|$)/g)].map((match) => match.index ?? -1)
  const sentenceEnd = sentenceEnds.at(-1) ?? -1
  if (sentenceEnd >= Math.min(80, Math.floor(maxLength * 0.45))) {
    return normalizePunctuation(prefix.slice(0, sentenceEnd + 1))
  }

  const wordSafe = prefix.slice(0, maxLength).replace(/\s+\S*$/, '').trim()
  if (!wordSafe) return ''
  return `${normalizePunctuation(wordSafe)}.`
}

const redactNamedSequences = (text, replacement = REDACTION) => text.replace(
  /\b(?:[A-ZА-ЯЁ][a-zа-яё0-9']{2,}|[A-Z]{3,}|[А-ЯЁ]{3,})(?:[-\s](?:[A-ZА-ЯЁ][a-zа-яё0-9']{2,}|[A-Z]{3,}|[А-ЯЁ]{3,}|of|the|and|de|da|van|von))*\b/g,
  (match) => {
    const tokens = normalize(match).split(' ').filter(Boolean)
    const meaningful = tokens.filter((token) => !STOPWORDS.has(token) && !/^\d+$/.test(token) && token.length >= 3)
    if (!meaningful.length) return match
    return replacement
  },
)

const stripLeadCopula = (text) => {
  return text
    .replace(/^(?:is|was|were|are)\s+(?:a|an|the)\s+/i, '')
    .replace(/^(?:is|was|were|are)\s+/i, '')
    .replace(/^[\s,;:-]+/, '')
}

const stripMetadataLead = (text) => {
  const leadMatch = text.match(/^[^.?!]*\b(?:developed by|published by|released by|developed and published by)\b[^.?!]*[.?!]\s*/i)
  if (!leadMatch) return text
  return text.slice(leadMatch[0].length).trim()
}

export const buildPlotHint = ({ title, text, maxLength = 240 }) => {
  const source = cleanText(text)
  if (!source) return ''

  let hint = source
  const titleText = cleanText(title)

  if (titleText) {
    const variants = titleVariants(titleText)

    for (const phrase of variants) {
      hint = hint.replace(new RegExp(`\\b${escapeRegExp(phrase)}\\b`, 'gi'), ' ')
    }

    for (const token of titleTokens(titleText)) {
      hint = hint.replace(new RegExp(`\\b${escapeRegExp(token)}\\b`, 'gi'), ' ')
    }
  }

  hint = hint.replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim()
  hint = stripLeadCopula(hint)
  hint = stripMetadataLead(hint)
  hint = hint.replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim()

  return redactSpoilers({
    title,
    text: hint,
    maxLength,
    replacement: '',
    maskNames: false,
  })
}

export const redactSpoilers = ({ title, titles = [], text, maxLength = 420, replacement = REDACTION, maskNames = true }) => {
  const source = cleanText(text)
  if (!source) return ''

  let result = source
  const sourceTitles = unique([title, ...titles].map(cleanText))

  for (const titleText of sourceTitles) {
    if (!titleText) continue
    result = replacePhrases(result, titleVariants(titleText), replacement)
    result = replaceTokens(result, titleTokens(titleText), replacement)
  }

  if (maskNames) {
    result = redactNamedSequences(result, replacement)
  }
  result = normalizePunctuation(result)

  return cropCompleteText(result, maxLength)
}

export const isPlayablePlotHint = ({ title = '', titles = [], text }) => {
  const hint = cleanText(text)
  if (hint.length < 30) return false
  if (/(?:\.\.\.|\u2026)\s*$/.test(hint)) return false
  if (/\[+\s*REDACTED\s*\]+|_KEEP_\d+_/i.test(hint)) return false
  if (/(?:json|undefined|null|nan|stack trace|exception|https?:\/\/|\bapi\b|\bid\s*[:=])/i.test(hint)) return false

  const normalizedHint = normalize(hint)
  return unique([title, ...titles].map(normalize))
    .every((candidate) => candidate.length < 4 || !normalizedHint.includes(candidate))
}
