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
      if (/^[ivxlcdm]+$/.test(token)) return true
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
  .replace(/\[{2,}REDACTED\]{2,}/g, REDACTION)
  .replace(/(?:\[REDACTED\][\s,;:]*){2,}/g, `${REDACTION} `)
  .replace(/^[\s,;:!?-]+/, '')
  .replace(/[\s,;:!?-]+$/, '')
  .trim()

const redactNamedSequences = (text, replacement = REDACTION) => text.replace(
  /\b(?:[A-ZА-ЯЁ][a-zа-яё0-9']{2,}|[A-ZА-ЯЁ]{2,}|[0-9]{1,3})(?:[-\s](?:[A-ZА-ЯЁ][a-zа-яё0-9']{2,}|[A-ZА-ЯЁ]{2,}|[0-9]{1,3}|of|the|and|de|da|van|von)){1,3}\b/g,
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

  if (hint.length > maxLength) {
    hint = `${hint.slice(0, maxLength).trimEnd()}...`
  }

  return hint
}

export const redactSpoilers = ({ title, titles = [], text, maxLength = 420, replacement = REDACTION }) => {
  const source = cleanText(text)
  if (!source) return ''

  let result = source
  const sourceTitles = unique([title, ...titles].map(cleanText))

  for (const titleText of sourceTitles) {
    if (!titleText) continue
    result = replacePhrases(result, titleVariants(titleText), replacement)
    result = replaceTokens(result, titleTokens(titleText), replacement)
  }

  result = redactNamedSequences(result, replacement)
  result = normalizePunctuation(result)

  if (result.length > maxLength) {
    result = `${result.slice(0, maxLength).trimEnd()}...`
  }

  return result
}