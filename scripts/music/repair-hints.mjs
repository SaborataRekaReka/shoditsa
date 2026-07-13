import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { openAiFetch } from '../shared/openai-fetch.mjs'

const ROOT = process.cwd()

const DEFAULT_MANIFEST = 'docs/music-hints-payload.manifest.json'
const DEFAULT_PAYLOAD_PREFIX = 'docs/music-hints-payload'
const DEFAULT_OUTPUT_PREFIX = 'docs/music-hints-output'
const DEFAULT_VALIDATED_PREFIX = 'docs/music-hints-output'
const DEFAULT_MODEL = 'gpt-5-mini'
const DEFAULT_API_KEY_ENV = 'OPENAI_API_KEY'
const DEFAULT_API_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_DELAY_MS = 900
const DEFAULT_MAX_RETRIES = 3
const DEFAULT_TIMEOUT_MS = 90000
const DEFAULT_MAX_OUTPUT_TOKENS = 8000

const parseArgs = () => {
  const options = {
    manifest: DEFAULT_MANIFEST,
    payloadPrefix: DEFAULT_PAYLOAD_PREFIX,
    outputPrefix: DEFAULT_OUTPUT_PREFIX,
    validatedPrefix: DEFAULT_VALIDATED_PREFIX,
    model: DEFAULT_MODEL,
    apiKeyEnv: DEFAULT_API_KEY_ENV,
    apiBaseUrl: DEFAULT_API_BASE_URL,
    delayMs: DEFAULT_DELAY_MS,
    maxRetries: DEFAULT_MAX_RETRIES,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    maxRepairRecords: null,
    part: null,
    maxParts: null,
    dryRun: false,
  }

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--manifest=')) {
      const value = arg.slice('--manifest='.length).trim()
      if (value) options.manifest = value
      continue
    }

    if (arg.startsWith('--payload-prefix=')) {
      const value = arg.slice('--payload-prefix='.length).trim()
      if (value) options.payloadPrefix = value
      continue
    }

    if (arg.startsWith('--output-prefix=')) {
      const value = arg.slice('--output-prefix='.length).trim()
      if (value) options.outputPrefix = value
      continue
    }

    if (arg.startsWith('--validated-prefix=')) {
      const value = arg.slice('--validated-prefix='.length).trim()
      if (value) options.validatedPrefix = value
      continue
    }

    if (arg.startsWith('--model=')) {
      const value = arg.slice('--model='.length).trim()
      if (value) options.model = value
      continue
    }

    if (arg.startsWith('--api-key-env=')) {
      const value = arg.slice('--api-key-env='.length).trim()
      if (value) options.apiKeyEnv = value
      continue
    }

    if (arg.startsWith('--api-base-url=')) {
      const value = arg.slice('--api-base-url='.length).trim()
      if (value) options.apiBaseUrl = value.replace(/\/+$/, '')
      continue
    }

    if (arg.startsWith('--delay-ms=')) {
      const value = Number.parseInt(arg.slice('--delay-ms='.length), 10)
      if (Number.isFinite(value) && value >= 0) options.delayMs = value
      continue
    }

    if (arg.startsWith('--max-retries=')) {
      const value = Number.parseInt(arg.slice('--max-retries='.length), 10)
      if (Number.isFinite(value) && value >= 1) options.maxRetries = value
      continue
    }

    if (arg.startsWith('--timeout-ms=')) {
      const value = Number.parseInt(arg.slice('--timeout-ms='.length), 10)
      if (Number.isFinite(value) && value >= 5000) options.timeoutMs = value
      continue
    }

    if (arg.startsWith('--max-output-tokens=')) {
      const value = Number.parseInt(arg.slice('--max-output-tokens='.length), 10)
      if (Number.isFinite(value) && value >= 500) options.maxOutputTokens = value
      continue
    }

    if (arg.startsWith('--max-repair-records=')) {
      const value = Number.parseInt(arg.slice('--max-repair-records='.length), 10)
      if (Number.isFinite(value) && value > 0) options.maxRepairRecords = value
      continue
    }

    if (arg.startsWith('--part=')) {
      const value = Number.parseInt(arg.slice('--part='.length), 10)
      if (Number.isFinite(value) && value > 0) options.part = value
      continue
    }

    if (arg.startsWith('--max-parts=')) {
      const value = Number.parseInt(arg.slice('--max-parts='.length), 10)
      if (Number.isFinite(value) && value > 0) options.maxParts = value
      continue
    }

    if (arg === '--dry-run') {
      options.dryRun = true
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

const compact = (value) => String(value ?? '').replace(/\s+/g, ' ').trim()

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const toRel = (filePath) => path.relative(ROOT, filePath).replace(/\\/g, '/')

const uniqueStrings = (values) => {
  const seen = new Set()
  const out = []
  for (const value of values) {
    const text = asString(value)
    if (!text) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(text)
  }
  return out
}

const parsePartNumber = (fileName, fallbackIndex) => {
  const match = String(fileName).match(/\.part-(\d+)\.json$/)
  if (match) return match[1]
  return String(fallbackIndex + 1).padStart(2, '0')
}

const buildPartPath = (prefixPath, partNo, suffix = '.json') => `${prefixPath}.part-${partNo}${suffix}`

const extractResponseText = (payload) => {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim()
  }

  const chunks = []
  for (const item of asArray(payload?.output)) {
    if (item?.type !== 'message') continue
    for (const content of asArray(item?.content)) {
      if (typeof content?.text === 'string' && content.text.trim()) {
        chunks.push(content.text.trim())
        continue
      }
      if (typeof content?.output_text === 'string' && content.output_text.trim()) {
        chunks.push(content.output_text.trim())
        continue
      }
      if (typeof content?.value === 'string' && content.value.trim()) {
        chunks.push(content.value.trim())
      }
    }
  }

  if (!chunks.length && typeof payload?.choices?.[0]?.message?.content === 'string') {
    return payload.choices[0].message.content.trim()
  }

  return chunks.join('\n').trim()
}

const parseJsonText = (rawText) => {
  let text = String(rawText ?? '').trim()
  if (!text) throw new Error('Model returned empty response')

  text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim()

  if (!text.startsWith('{')) {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start >= 0 && end > start) {
      text = text.slice(start, end + 1)
    }
  }

  return JSON.parse(text)
}

const normalizeDecision = (value) => {
  const statusRaw = asString(value?.status)?.toLowerCase()
  const status = statusRaw === 'ok' || statusRaw === 'uncertain' || statusRaw === 'not_found'
    ? statusRaw
    : 'uncertain'

  const confidenceValue = Number(value?.confidence)
  const confidence = Number.isFinite(confidenceValue)
    ? Math.max(0, Math.min(1, confidenceValue))
    : null

  return {
    artistKey: asString(value?.artistKey),
    status,
    hint: compact(asString(value?.hint) || ''),
    confidence,
    sourceUrls: uniqueStrings(asArray(value?.sourceUrls).map((url) => asString(url))).slice(0, 8),
    comment: asString(value?.comment) || '',
  }
}

const buildSystemPrompt = () => [
  'You repair failed spoiler-safe hints for a music guessing game.',
  'Return ONLY a JSON object with top-level key decisions (array).',
  'Each decision must include: artistKey, status, hint, confidence, sourceUrls, comment.',
  'Use Russian for hint text.',
  'Keep hint 1-2 short sentences, no line breaks.',
  'Target hint length between minHintChars and recommendedMaxHintChars.',
  'Hard limit: never exceed maxHintChars.',
  'Strictly avoid antiSpoiler banned phrases and banned tokens.',
  'If safe rewrite is impossible, set status="uncertain" and hint="".',
  'Never output markdown or code fences.',
].join(' ')

const requestRepairDecisions = async ({
  model,
  records,
  apiKey,
  apiBaseUrl,
  timeoutMs,
  maxOutputTokens,
  maxRetries,
  delayMs,
  dryRun,
}) => {
  if (dryRun) {
    return records.map((record) => ({
      artistKey: record.artistKey,
      status: 'uncertain',
      hint: '',
      confidence: 0,
      sourceUrls: record.sourceUrls ?? [],
      comment: 'dry_run',
    }))
  }

  let lastError = null

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)

      const response = await openAiFetch(`${apiBaseUrl}/responses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_output_tokens: maxOutputTokens,
          input: [
            {
              role: 'system',
              content: buildSystemPrompt(),
            },
            {
              role: 'user',
              content: JSON.stringify({
                records,
              }),
            },
          ],
        }),
        signal: controller.signal,
      })

      const raw = await response.text()
      clearTimeout(timeout)

      if (!response.ok) {
        throw new Error(`OpenAI API HTTP ${response.status}: ${raw.slice(0, 600)}`)
      }

      let parsedResponse
      try {
        parsedResponse = JSON.parse(raw)
      } catch {
        throw new Error(`OpenAI API returned non-JSON response: ${raw.slice(0, 600)}`)
      }

      const responseText = extractResponseText(parsedResponse)
      const json = parseJsonText(responseText)
      const decisions = asArray(json?.decisions)
      if (!decisions.length) {
        throw new Error('Model response contains empty decisions array')
      }

      return decisions
    } catch (error) {
      lastError = error
      if (attempt >= maxRetries) break
      await wait(delayMs * attempt)
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

const runValidator = ({ inputPath, payloadPath, outputPath }) => {
  const args = [
    'scripts/music/validate-hints-output.mjs',
    `--input=${toRel(inputPath)}`,
    `--payload=${toRel(payloadPath)}`,
    `--output=${toRel(outputPath)}`,
  ]

  const run = spawnSync(process.execPath, args, {
    cwd: ROOT,
    env: process.env,
    stdio: 'inherit',
  })

  if (run.status !== 0) {
    throw new Error(`Validator failed for ${toRel(inputPath)} with exit code ${run.status}`)
  }

  return readJson(outputPath)
}

const selectParts = (manifest, options) => {
  const partFiles = asArray(manifest?.partFiles)
  if (!partFiles.length) {
    throw new Error('Manifest has no partFiles')
  }

  let selected = [...partFiles]

  if (options.part != null) {
    const partPattern = new RegExp(`\\.part-${String(options.part).padStart(2, '0')}\\.json$`)
    selected = selected.filter((fileName) => partPattern.test(fileName))
  }

  if (options.maxParts != null) {
    selected = selected.slice(0, options.maxParts)
  }

  if (!selected.length) {
    throw new Error('No parts selected for repair')
  }

  return selected
}

const buildRepairRecords = ({ failedRows, payloadByKey, outputByKey, maxRepairRecords }) => {
  const queue = []

  for (const failed of failedRows) {
    const artistKey = asString(failed?.artistKey)
    if (!artistKey) continue

    const payloadRecord = payloadByKey.get(artistKey)
    const outputDecision = outputByKey.get(artistKey)
    if (!payloadRecord || !outputDecision) continue

    const anti = payloadRecord?.antiSpoiler ?? {}
    const minHintChars = Number.isFinite(Number(anti?.minHintChars)) ? Number(anti.minHintChars) : 95
    const maxHintChars = Number.isFinite(Number(anti?.maxHintChars)) ? Number(anti.maxHintChars) : 210
    const recommendedMaxHintCharsRaw = Number.isFinite(Number(anti?.recommendedMaxHintChars))
      ? Number(anti.recommendedMaxHintChars)
      : Math.min(maxHintChars, 170)
    const recommendedMaxHintChars = Math.min(maxHintChars, Math.max(minHintChars, recommendedMaxHintCharsRaw))

    queue.push({
      artistKey,
      errors: asArray(failed?.errors),
      current: {
        status: asString(outputDecision?.status) || 'ok',
        hint: compact(asString(outputDecision?.hint) || ''),
        confidence: Number.isFinite(Number(outputDecision?.confidence)) ? Number(outputDecision.confidence) : null,
        sourceUrls: uniqueStrings(asArray(outputDecision?.sourceUrls).map((url) => asString(url))).slice(0, 8),
      },
      antiSpoiler: {
        minHintChars,
        recommendedMaxHintChars,
        maxHintChars,
        maxSentences: Number.isFinite(Number(anti?.maxSentences)) ? Number(anti.maxSentences) : 2,
        bannedPhrases: asArray(anti?.bannedPhrases).slice(0, 80),
        bannedTokens: asArray(anti?.bannedTokens).slice(0, 80),
      },
      context: {
        names: asArray(payloadRecord?.subject?.names).slice(0, 3),
        country: asString(payloadRecord?.subject?.country),
        beginYear: Number.isFinite(Number(payloadRecord?.subject?.beginYear)) ? Number(payloadRecord.subject.beginYear) : null,
        genres: asArray(payloadRecord?.subject?.genres).slice(0, 4),
        artistType: asString(payloadRecord?.subject?.artistType),
      },
    })

    if (maxRepairRecords != null && queue.length >= maxRepairRecords) break
  }

  return queue
}

const mergeRepairs = ({ existingDecisions, repairDecisions }) => {
  const repairByKey = new Map()
  for (const repair of repairDecisions) {
    const normalized = normalizeDecision(repair)
    if (!normalized.artistKey) continue
    repairByKey.set(normalized.artistKey, normalized)
  }

  const merged = []
  const seen = new Set()

  for (const decision of existingDecisions) {
    const artistKey = asString(decision?.artistKey)
    if (!artistKey) {
      merged.push(decision)
      continue
    }

    const repair = repairByKey.get(artistKey)
    if (!repair) {
      merged.push(decision)
      continue
    }

    seen.add(artistKey)

    const next = {
      ...decision,
      status: repair.status || decision.status || 'ok',
      hint: repair.hint || decision.hint || '',
      confidence: repair.confidence ?? decision.confidence ?? null,
      sourceUrls: repair.sourceUrls.length ? repair.sourceUrls : asArray(decision?.sourceUrls),
      comment: compact([asString(decision?.comment), asString(repair?.comment), 'repair_failed_pass'].filter(Boolean).join(' | ')),
    }

    merged.push(next)
  }

  for (const repair of repairByKey.values()) {
    if (seen.has(repair.artistKey)) continue
    merged.push({
      artistKey: repair.artistKey,
      status: repair.status,
      hint: repair.hint,
      confidence: repair.confidence,
      sourceUrls: repair.sourceUrls,
      comment: compact([asString(repair.comment), 'repair_failed_pass'].filter(Boolean).join(' | ')),
    })
  }

  return merged
}

const processPart = async ({ options, partIndex, partFile, apiKey, payloadPrefixPath, outputPrefixPath, validatedPrefixPath }) => {
  const partNo = parsePartNumber(partFile, partIndex)
  const payloadPath = buildPartPath(payloadPrefixPath, partNo)
  const outputPath = buildPartPath(outputPrefixPath, partNo)
  const validatedPath = buildPartPath(validatedPrefixPath, partNo, '.validated.json')

  if (!fs.existsSync(payloadPath) || !fs.existsSync(outputPath) || !fs.existsSync(validatedPath)) {
    return {
      part: partNo,
      skipped: true,
      reason: 'missing_payload_or_output_or_validated',
      payload: toRel(payloadPath),
      output: toRel(outputPath),
      validated: toRel(validatedPath),
      beforeFailed: 0,
      afterFailed: 0,
      repaired: 0,
    }
  }

  const payload = readJson(payloadPath)
  const output = readJson(outputPath)
  const validatedBefore = readJson(validatedPath)

  const beforeFailed = Number(validatedBefore?.meta?.failed ?? 0)
  if (beforeFailed <= 0) {
    return {
      part: partNo,
      skipped: true,
      reason: 'no_failed_rows',
      payload: toRel(payloadPath),
      output: toRel(outputPath),
      validated: toRel(validatedPath),
      beforeFailed,
      afterFailed: beforeFailed,
      repaired: 0,
    }
  }

  const payloadByKey = new Map(asArray(payload?.records)
    .map((record) => [asString(record?.artistKey), record])
    .filter((entry) => Boolean(entry[0])))

  const outputByKey = new Map(asArray(output?.decisions)
    .map((decision) => [asString(decision?.artistKey), decision])
    .filter((entry) => Boolean(entry[0])))

  const repairRecords = buildRepairRecords({
    failedRows: asArray(validatedBefore?.failed),
    payloadByKey,
    outputByKey,
    maxRepairRecords: options.maxRepairRecords,
  })

  if (!repairRecords.length) {
    return {
      part: partNo,
      skipped: true,
      reason: 'no_repair_records',
      payload: toRel(payloadPath),
      output: toRel(outputPath),
      validated: toRel(validatedPath),
      beforeFailed,
      afterFailed: beforeFailed,
      repaired: 0,
    }
  }

  console.log(`\n[repair part ${partNo}] failed=${beforeFailed} repairRecords=${repairRecords.length} model=${options.model}`)

  if (options.dryRun) {
    return {
      part: partNo,
      skipped: true,
      reason: 'dry_run',
      payload: toRel(payloadPath),
      output: toRel(outputPath),
      validated: toRel(validatedPath),
      beforeFailed,
      afterFailed: beforeFailed,
      repaired: repairRecords.length,
    }
  }

  const repairDecisionsRaw = await requestRepairDecisions({
    model: options.model,
    records: repairRecords,
    apiKey,
    apiBaseUrl: options.apiBaseUrl,
    timeoutMs: options.timeoutMs,
    maxOutputTokens: options.maxOutputTokens,
    maxRetries: options.maxRetries,
    delayMs: options.delayMs,
    dryRun: options.dryRun,
  })

  const mergedDecisions = mergeRepairs({
    existingDecisions: asArray(output?.decisions),
    repairDecisions: repairDecisionsRaw,
  })

  writeJson(outputPath, {
    meta: {
      ...(output?.meta ?? {}),
      repairedAt: new Date().toISOString(),
      repairModel: options.model,
      repairedFailedCount: repairRecords.length,
    },
    decisions: mergedDecisions,
  })

  const validatedAfter = runValidator({
    inputPath: outputPath,
    payloadPath,
    outputPath: validatedPath,
  })

  const afterFailed = Number(validatedAfter?.meta?.failed ?? 0)

  return {
    part: partNo,
    skipped: false,
    reason: null,
    payload: toRel(payloadPath),
    output: toRel(outputPath),
    validated: toRel(validatedPath),
    beforeFailed,
    afterFailed,
    repaired: repairRecords.length,
  }
}

const main = async () => {
  const options = parseArgs()

  const manifestPath = path.isAbsolute(options.manifest)
    ? options.manifest
    : path.join(ROOT, options.manifest)
  const payloadPrefixPath = path.isAbsolute(options.payloadPrefix)
    ? options.payloadPrefix
    : path.join(ROOT, options.payloadPrefix)
  const outputPrefixPath = path.isAbsolute(options.outputPrefix)
    ? options.outputPrefix
    : path.join(ROOT, options.outputPrefix)
  const validatedPrefixPath = path.isAbsolute(options.validatedPrefix)
    ? options.validatedPrefix
    : path.join(ROOT, options.validatedPrefix)

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${toRel(manifestPath)}`)
  }

  const manifest = readJson(manifestPath)
  const partFiles = selectParts(manifest, options)

  const apiKey = process.env[options.apiKeyEnv]
  if (!options.dryRun && !apiKey) {
    throw new Error(`Environment variable ${options.apiKeyEnv} is not set`)
  }

  console.log(`Manifest: ${toRel(manifestPath)}`)
  console.log(`Selected parts: ${partFiles.length}`)
  console.log(`Repair model: ${options.model}`)
  console.log(`Dry run: ${options.dryRun ? 'yes' : 'no'}`)

  const rows = []

  for (let index = 0; index < partFiles.length; index += 1) {
    const row = await processPart({
      options,
      partIndex: index,
      partFile: partFiles[index],
      apiKey,
      payloadPrefixPath,
      outputPrefixPath,
      validatedPrefixPath,
    })

    rows.push(row)

    if (index < partFiles.length - 1 && options.delayMs > 0) {
      await wait(options.delayMs)
    }
  }

  const totals = rows.reduce((acc, row) => {
    acc.parts += 1
    acc.beforeFailed += row.beforeFailed
    acc.afterFailed += row.afterFailed
    acc.repaired += row.repaired
    if (row.skipped) acc.skipped += 1
    return acc
  }, {
    parts: 0,
    beforeFailed: 0,
    afterFailed: 0,
    repaired: 0,
    skipped: 0,
  })

  const summaryPath = `${outputPrefixPath}.repair-summary.json`
  writeJson(summaryPath, {
    generatedAt: new Date().toISOString(),
    manifest: toRel(manifestPath),
    payloadPrefix: toRel(payloadPrefixPath),
    outputPrefix: toRel(outputPrefixPath),
    validatedPrefix: toRel(validatedPrefixPath),
    model: options.model,
    dryRun: options.dryRun,
    totals,
    parts: rows,
  })

  console.log('\nRepair completed')
  console.log(`Summary: ${toRel(summaryPath)}`)
  console.log(`Totals: beforeFailed=${totals.beforeFailed} afterFailed=${totals.afterFailed} repaired=${totals.repaired}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
