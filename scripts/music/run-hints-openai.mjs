import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = process.cwd()

const DEFAULT_MANIFEST = 'docs/music-hints-payload.manifest.json'
const DEFAULT_OUTPUT_PREFIX = 'docs/music-hints-output'
const DEFAULT_MODEL = 'gpt-5-mini'
const DEFAULT_FALLBACK_MODEL = 'gpt-5'
const DEFAULT_API_KEY_ENV = 'OPENAI_API_KEY'
const DEFAULT_API_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_DELAY_MS = 1200
const DEFAULT_MAX_RETRIES = 3
const DEFAULT_TIMEOUT_MS = 90000
const DEFAULT_MAX_OUTPUT_TOKENS = 12000
const DEFAULT_CONFIDENCE_THRESHOLD = 0.75

const parseArgs = () => {
  const options = {
    manifest: DEFAULT_MANIFEST,
    outputPrefix: DEFAULT_OUTPUT_PREFIX,
    model: DEFAULT_MODEL,
    fallbackModel: DEFAULT_FALLBACK_MODEL,
    apiKeyEnv: DEFAULT_API_KEY_ENV,
    apiBaseUrl: DEFAULT_API_BASE_URL,
    delayMs: DEFAULT_DELAY_MS,
    maxRetries: DEFAULT_MAX_RETRIES,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    confidenceThreshold: DEFAULT_CONFIDENCE_THRESHOLD,
    part: null,
    maxParts: null,
    skipValidate: false,
    skipFallback: false,
    dryRun: false,
  }

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--manifest=')) {
      const value = arg.slice('--manifest='.length).trim()
      if (value) options.manifest = value
      continue
    }

    if (arg.startsWith('--output-prefix=')) {
      const value = arg.slice('--output-prefix='.length).trim()
      if (value) options.outputPrefix = value
      continue
    }

    if (arg.startsWith('--model=')) {
      const value = arg.slice('--model='.length).trim()
      if (value) options.model = value
      continue
    }

    if (arg.startsWith('--fallback-model=')) {
      const value = arg.slice('--fallback-model='.length).trim()
      options.fallbackModel = value || null
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

    if (arg.startsWith('--confidence-threshold=')) {
      const value = Number.parseFloat(arg.slice('--confidence-threshold='.length))
      if (Number.isFinite(value) && value >= 0 && value <= 1) options.confidenceThreshold = value
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

    if (arg === '--skip-validate') {
      options.skipValidate = true
      continue
    }

    if (arg === '--skip-fallback') {
      options.skipFallback = true
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

const toRel = (filePath) => path.relative(ROOT, filePath).replace(/\\/g, '/')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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
  if (!text) {
    throw new Error('Model returned empty response')
  }

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

const ensureCoverage = (decisions, records) => {
  const byKey = new Map()

  for (const decision of decisions) {
    const normalized = normalizeDecision(decision)
    if (!normalized.artistKey) continue
    byKey.set(normalized.artistKey, normalized)
  }

  const out = []
  for (const record of records) {
    const artistKey = asString(record?.artistKey)
    if (!artistKey) continue
    if (byKey.has(artistKey)) {
      out.push(byKey.get(artistKey))
      continue
    }
    out.push({
      artistKey,
      status: 'uncertain',
      hint: '',
      confidence: 0,
      sourceUrls: [],
      comment: 'missing_model_decision',
    })
  }

  return out
}

const buildSystemPrompt = () => [
  'You generate concise spoiler-safe hints for a music guessing game.',
  'Return ONLY a JSON object with the top-level key decisions (array).',
  'Each decisions item must include: artistKey, status, hint, confidence, sourceUrls, comment.',
  'Use Russian language for hint text.',
  'Respect antiSpoiler restrictions from each record strictly.',
  'If you are not confident, set status="uncertain" and keep hint empty.',
  'Never output markdown or code fences.',
].join(' ')

const requestDecisionsFromModel = async ({
  model,
  payload,
  apiKey,
  apiBaseUrl,
  timeoutMs,
  maxOutputTokens,
  maxRetries,
  delayMs,
  dryRun,
}) => {
  if (dryRun) {
    return asArray(payload?.records).map((record) => ({
      artistKey: asString(record?.artistKey),
      status: 'uncertain',
      hint: '',
      confidence: 0,
      sourceUrls: [],
      comment: 'dry_run',
    }))
  }

  let lastError = null

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)

      const response = await fetch(`${apiBaseUrl}/responses`, {
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
                instructionsForModel: payload?.instructionsForModel,
                records: payload?.records,
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

const mergeDecisionsByKey = (base, updates) => {
  const byKey = new Map(base.map((item) => [item.artistKey, item]))
  for (const update of updates) {
    const artistKey = asString(update?.artistKey)
    if (!artistKey) continue
    byKey.set(artistKey, update)
  }
  return [...byKey.values()]
}

const collectFallbackKeys = ({ validated, confidenceThreshold }) => {
  const fallbackKeys = new Set()

  for (const failed of asArray(validated?.failed)) {
    const artistKey = asString(failed?.artistKey)
    if (artistKey) fallbackKeys.add(artistKey)
  }

  for (const decision of asArray(validated?.decisions)) {
    const artistKey = asString(decision?.artistKey)
    if (!artistKey) continue

    const status = asString(decision?.status)
    const confidence = Number(decision?.confidence)

    if (status !== 'ok') fallbackKeys.add(artistKey)
    if (Number.isFinite(confidence) && confidence < confidenceThreshold) fallbackKeys.add(artistKey)
  }

  return fallbackKeys
}

const processPart = async ({
  options,
  partIndex,
  partFile,
  apiKey,
  outputPrefixPath,
}) => {
  const partPath = path.isAbsolute(partFile) ? partFile : path.join(ROOT, partFile)
  const payload = readJson(partPath)
  const records = asArray(payload?.records)

  const partNo = parsePartNumber(partFile, partIndex)
  const outputPath = `${outputPrefixPath}.part-${partNo}.json`
  const validatedPath = `${outputPrefixPath}.part-${partNo}.validated.json`

  console.log(`\n[part ${partNo}] records=${records.length}`)
  console.log(`[part ${partNo}] source=${toRel(partPath)}`)
  console.log(`[part ${partNo}] model=${options.model}`)

  const primaryRaw = await requestDecisionsFromModel({
    model: options.model,
    payload,
    apiKey,
    apiBaseUrl: options.apiBaseUrl,
    timeoutMs: options.timeoutMs,
    maxOutputTokens: options.maxOutputTokens,
    maxRetries: options.maxRetries,
    delayMs: options.delayMs,
    dryRun: options.dryRun,
  })

  let decisions = ensureCoverage(primaryRaw, records)
  let usedFallback = false

  writeJson(outputPath, {
    meta: {
      generatedAt: new Date().toISOString(),
      sourcePayload: toRel(partPath),
      model: options.model,
      fallbackModel: options.fallbackModel,
      records: records.length,
      decisions: decisions.length,
      usedFallback,
      dryRun: options.dryRun,
    },
    decisions,
  })

  let validated = null
  if (!options.skipValidate) {
    validated = runValidator({
      inputPath: outputPath,
      payloadPath: partPath,
      outputPath: validatedPath,
    })

    const fallbackModelEnabled = Boolean(options.fallbackModel && !options.skipFallback && !options.dryRun)
    if (fallbackModelEnabled) {
      const fallbackKeys = collectFallbackKeys({
        validated,
        confidenceThreshold: options.confidenceThreshold,
      })

      if (fallbackKeys.size > 0) {
        const fallbackRecords = records.filter((record) => fallbackKeys.has(asString(record?.artistKey)))

        if (fallbackRecords.length > 0) {
          console.log(`[part ${partNo}] fallback=${options.fallbackModel} records=${fallbackRecords.length}`)

          const fallbackRaw = await requestDecisionsFromModel({
            model: options.fallbackModel,
            payload: {
              instructionsForModel: payload?.instructionsForModel,
              records: fallbackRecords,
            },
            apiKey,
            apiBaseUrl: options.apiBaseUrl,
            timeoutMs: options.timeoutMs,
            maxOutputTokens: options.maxOutputTokens,
            maxRetries: options.maxRetries,
            delayMs: options.delayMs,
            dryRun: options.dryRun,
          })

          const fallbackDecisions = ensureCoverage(fallbackRaw, fallbackRecords)
          decisions = mergeDecisionsByKey(decisions, fallbackDecisions)
          decisions = ensureCoverage(decisions, records)
          usedFallback = true

          writeJson(outputPath, {
            meta: {
              generatedAt: new Date().toISOString(),
              sourcePayload: toRel(partPath),
              model: options.model,
              fallbackModel: options.fallbackModel,
              records: records.length,
              decisions: decisions.length,
              usedFallback,
              dryRun: options.dryRun,
            },
            decisions,
          })

          validated = runValidator({
            inputPath: outputPath,
            payloadPath: partPath,
            outputPath: validatedPath,
          })
        }
      }
    }
  }

  return {
    part: partNo,
    source: toRel(partPath),
    output: toRel(outputPath),
    validated: options.skipValidate ? null : toRel(validatedPath),
    records: records.length,
    decisions: decisions.length,
    failed: Number(validated?.meta?.failed ?? 0),
    warnings: Number(validated?.meta?.warnings ?? 0),
    usedFallback,
  }
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
    throw new Error('No parts selected for processing')
  }

  return selected
}

const main = async () => {
  const options = parseArgs()

  const manifestPath = path.isAbsolute(options.manifest)
    ? options.manifest
    : path.join(ROOT, options.manifest)

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${toRel(manifestPath)}`)
  }

  const manifest = readJson(manifestPath)
  const partFiles = selectParts(manifest, options)
  const outputPrefixPath = path.isAbsolute(options.outputPrefix)
    ? options.outputPrefix
    : path.join(ROOT, options.outputPrefix)

  const apiKey = process.env[options.apiKeyEnv]
  if (!options.dryRun && !apiKey) {
    throw new Error(`Environment variable ${options.apiKeyEnv} is not set`)
  }

  console.log(`Manifest: ${toRel(manifestPath)}`)
  console.log(`Selected parts: ${partFiles.length}`)
  console.log(`Output prefix: ${toRel(outputPrefixPath)}`)
  console.log(`Dry run: ${options.dryRun ? 'yes' : 'no'}`)

  const summary = []

  for (let index = 0; index < partFiles.length; index += 1) {
    const partFile = partFiles[index]
    const item = await processPart({
      options,
      partIndex: index,
      partFile,
      apiKey,
      outputPrefixPath,
    })

    summary.push(item)

    if (index < partFiles.length - 1 && options.delayMs > 0) {
      await wait(options.delayMs)
    }
  }

  const summaryPath = `${outputPrefixPath}.run-summary.json`
  const totals = summary.reduce((acc, row) => {
    acc.parts += 1
    acc.records += row.records
    acc.failed += row.failed
    acc.warnings += row.warnings
    if (row.usedFallback) acc.partsWithFallback += 1
    return acc
  }, { parts: 0, records: 0, failed: 0, warnings: 0, partsWithFallback: 0 })

  writeJson(summaryPath, {
    generatedAt: new Date().toISOString(),
    manifest: toRel(manifestPath),
    outputPrefix: toRel(outputPrefixPath),
    model: options.model,
    fallbackModel: options.fallbackModel,
    dryRun: options.dryRun,
    totals,
    parts: summary,
  })

  console.log('\nRun completed')
  console.log(`Summary: ${toRel(summaryPath)}`)
  console.log(`Totals: parts=${totals.parts} records=${totals.records} failed=${totals.failed} warnings=${totals.warnings}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
