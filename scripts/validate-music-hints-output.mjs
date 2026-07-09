import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()

const DEFAULT_INPUT = 'docs/music-hints-output.part-01.json'
const DEFAULT_PAYLOAD = 'docs/music-hints-payload.part-01.json'
const DEFAULT_OUTPUT = 'docs/music-hints-output.part-01.validated.json'

const parseArgs = () => {
  const options = {
    input: DEFAULT_INPUT,
    payload: DEFAULT_PAYLOAD,
    output: DEFAULT_OUTPUT,
    failOnError: false,
  }

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--input=')) {
      const value = arg.slice('--input='.length).trim()
      if (value) options.input = value
      continue
    }

    if (arg.startsWith('--payload=')) {
      const value = arg.slice('--payload='.length).trim()
      if (value) options.payload = value
      continue
    }

    if (arg.startsWith('--output=')) {
      const value = arg.slice('--output='.length).trim()
      if (value) options.output = value
      continue
    }

    if (arg === '--fail-on-error') {
      options.failOnError = true
      continue
    }
  }

  return options
}

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'))

const writeJson = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

const asArray = (value) => (Array.isArray(value) ? value : [])

const asString = (value) => {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text || null
}

const normalize = (value) => String(value ?? '')
  .normalize('NFKC')
  .toLocaleLowerCase('ru-RU')
  .replace(/ё/g, 'е')
  .replace(/[\u2019']/g, '')
  .replace(/\s+/g, ' ')
  .trim()

const countSentences = (text) => {
  const chunks = String(text ?? '')
    .split(/[.!?]+/g)
    .map((part) => part.trim())
    .filter(Boolean)
  return chunks.length
}

const compact = (text) => String(text ?? '').replace(/\s+/g, ' ').trim()

const hasBannedToken = (hintNormalized, bannedTokens) => {
  for (const token of bannedTokens) {
    const t = normalize(token)
    if (!t) continue
    if (hintNormalized.includes(t)) return token
  }
  return null
}

const hasBannedPhrase = (hintNormalized, bannedPhrases) => {
  for (const phrase of bannedPhrases) {
    const p = normalize(phrase)
    if (!p) continue
    if (hintNormalized.includes(p)) return phrase
  }
  return null
}

const validateDecision = ({ decision, record }) => {
  const errors = []
  const warnings = []

  const hint = compact(asString(decision?.hint) || '')
  const status = asString(decision?.status) || 'uncertain'

  if (!hint && status === 'ok') {
    errors.push('hint_empty')
  }

  const anti = record?.antiSpoiler ?? {}
  const minChars = Number.isFinite(Number(anti?.minHintChars)) ? Number(anti.minHintChars) : 95
  const maxChars = Number.isFinite(Number(anti?.maxHintChars)) ? Number(anti.maxHintChars) : 170
  const maxSentences = Number.isFinite(Number(anti?.maxSentences)) ? Number(anti.maxSentences) : 2

  if (hint && hint.length < minChars) warnings.push(`hint_too_short:${hint.length}<${minChars}`)
  if (hint.length > maxChars) errors.push(`hint_too_long:${hint.length}>${maxChars}`)

  const sentenceCount = countSentences(hint)
  if (hint && sentenceCount > maxSentences) errors.push(`too_many_sentences:${sentenceCount}>${maxSentences}`)

  const hintNormalized = normalize(hint)

  if (hint) {
    const bannedPhrase = hasBannedPhrase(hintNormalized, asArray(anti?.bannedPhrases))
    if (bannedPhrase) {
      errors.push(`contains_banned_phrase:${bannedPhrase}`)
    }

    const bannedToken = hasBannedToken(hintNormalized, asArray(anti?.bannedTokens))
    if (bannedToken) {
      errors.push(`contains_banned_token:${bannedToken}`)
    }
  }

  const sourceUrls = asArray(decision?.sourceUrls).map((url) => asString(url)).filter(Boolean)
  if (!sourceUrls.length && status === 'ok') {
    warnings.push('missing_source_urls_for_ok')
  }

  return {
    artistKey: asString(decision?.artistKey) || asString(record?.artistKey) || null,
    status,
    hint,
    confidence: Number.isFinite(Number(decision?.confidence)) ? Number(decision.confidence) : null,
    sourceUrls,
    errors,
    warnings,
    ok: errors.length === 0,
  }
}

const mapRecords = (payload) => {
  const map = new Map()
  for (const record of asArray(payload?.records)) {
    const artistKey = asString(record?.artistKey)
    if (!artistKey) continue
    map.set(artistKey, record)
  }
  return map
}

const main = () => {
  const options = parseArgs()

  const inputPath = path.isAbsolute(options.input) ? options.input : path.join(ROOT, options.input)
  const payloadPath = path.isAbsolute(options.payload) ? options.payload : path.join(ROOT, options.payload)
  const outputPath = path.isAbsolute(options.output) ? options.output : path.join(ROOT, options.output)

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input not found: ${path.relative(ROOT, inputPath).replace(/\\/g, '/')}`)
  }

  if (!fs.existsSync(payloadPath)) {
    throw new Error(`Payload not found: ${path.relative(ROOT, payloadPath).replace(/\\/g, '/')}`)
  }

  const input = readJson(inputPath)
  const payload = readJson(payloadPath)

  const recordByArtistKey = mapRecords(payload)
  const decisions = asArray(input?.decisions)

  const validated = []
  const missing = []

  for (const decision of decisions) {
    const artistKey = asString(decision?.artistKey)
    const record = artistKey ? recordByArtistKey.get(artistKey) : null

    if (!record) {
      missing.push({ artistKey: artistKey || null, reason: 'record_not_found_in_payload' })
      continue
    }

    validated.push(validateDecision({ decision, record }))
  }

  const failed = validated.filter((item) => !item.ok)
  const ok = validated.filter((item) => item.ok)
  const warnings = validated.filter((item) => item.warnings.length > 0)

  const result = {
    meta: {
      generatedAt: new Date().toISOString(),
      input: path.relative(ROOT, inputPath).replace(/\\/g, '/'),
      payload: path.relative(ROOT, payloadPath).replace(/\\/g, '/'),
      totalDecisions: decisions.length,
      validated: validated.length,
      ok: ok.length,
      failed: failed.length,
      warnings: warnings.length,
      missingRecords: missing.length,
    },
    failed,
    warnings: warnings
      .filter((item) => item.ok)
      .map((item) => ({ artistKey: item.artistKey, warnings: item.warnings })),
    missing,
    decisions: validated,
  }

  writeJson(outputPath, result)

  console.log(`Validated decisions: ${validated.length}`)
  console.log(`OK: ${ok.length}`)
  console.log(`Failed: ${failed.length}`)
  console.log(`Warnings: ${warnings.length}`)
  console.log(`Missing records: ${missing.length}`)
  console.log(`Output: ${path.relative(ROOT, outputPath).replace(/\\/g, '/')}`)

  if (options.failOnError && (failed.length > 0 || missing.length > 0)) {
    process.exitCode = 1
  }
}

main()
