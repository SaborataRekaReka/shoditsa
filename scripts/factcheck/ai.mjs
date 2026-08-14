import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createOpenAiProxyTransport, openAiFetch } from '../shared/openai-fetch.mjs'
import { isOpenAiWebSearchRegionalError, isTransientOpenAiError } from '../shared/openai-web-search.mjs'
import { fingerprint, isRecord, text, valueType, VERDICTS } from './core.mjs'

const extractResponseText = (payload) => typeof payload.output_text === 'string'
  ? payload.output_text
  : (Array.isArray(payload.output) ? payload.output : []).flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    .map((content) => text(content?.text ?? content?.output_text)).filter(Boolean).join('\n')

const parseJson = (value) => {
  const normalized = text(value).replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim()
  try { return JSON.parse(normalized) } catch {}
  const start = normalized.indexOf('{'); const end = normalized.lastIndexOf('}')
  if (start >= 0 && end > start) return JSON.parse(normalized.slice(start, end + 1))
  throw new Error('AI fact-checker did not return JSON')
}

const responseSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    overallVerdict: { type: 'string', enum: VERDICTS }, confidence: { type: 'number' }, summary: { type: 'string' },
    fieldResults: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
      field: { type: 'string' }, verdict: { type: 'string', enum: VERDICTS }, confidence: { type: 'number' },
      reason: { type: 'string' }, proposedValue: {}, sourceUrls: { type: 'array', items: { type: 'string' } },
    }, required: ['field', 'verdict', 'confidence', 'reason', 'proposedValue', 'sourceUrls'] } },
    crossFieldFindings: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
      fields: { type: 'array', items: { type: 'string' } }, verdict: { type: 'string', enum: VERDICTS },
      severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] }, confidence: { type: 'number' },
      reason: { type: 'string' }, sourceUrls: { type: 'array', items: { type: 'string' } },
    }, required: ['fields', 'verdict', 'severity', 'confidence', 'reason', 'sourceUrls'] } },
  }, required: ['overallVerdict', 'confidence', 'summary', 'fieldResults', 'crossFieldFindings'],
}

const validateResult = (task, result) => {
  if (!isRecord(result) || !VERDICTS.includes(result.overallVerdict)) throw new Error('AI result has an invalid overall verdict')
  if (!Array.isArray(result.fieldResults) || !Array.isArray(result.crossFieldFindings)) throw new Error('AI result arrays are missing')
  const targetFields = new Set(task.targetFields)
  const returnedFields = new Set()
  const validFieldResults = []
  for (const fieldResult of result.fieldResults) {
    if (!isRecord(fieldResult)) continue
    fieldResult.field = text(fieldResult.field)
    if (!targetFields.has(fieldResult.field) || returnedFields.has(fieldResult.field)) continue
    if (!VERDICTS.includes(fieldResult.verdict)) {
      fieldResult.verdict = 'uncertain'
      fieldResult.reason = `${text(fieldResult.reason)} The AI returned an unsupported verdict.`.trim()
    }
    returnedFields.add(fieldResult.field)
    fieldResult.confidence = Math.max(0, Math.min(1, Number(fieldResult.confidence) || 0))
    fieldResult.sourceUrls = Array.isArray(fieldResult.sourceUrls) ? fieldResult.sourceUrls.map(text).filter((url) => /^https:\/\//i.test(url)).slice(0, 10) : []
    if (task.webSearch && ['pass', 'contradiction', 'stale'].includes(fieldResult.verdict) && !fieldResult.sourceUrls.length) {
      fieldResult.verdict = 'uncertain'
      fieldResult.reason = `${text(fieldResult.reason)} No authoritative source URL was returned.`.trim()
    }
    const currentValue = Object.hasOwn(task.card, fieldResult.field) ? task.card[fieldResult.field] : null
    if (fieldResult.verdict === 'contradiction' && currentValue != null && valueType(currentValue) !== valueType(fieldResult.proposedValue)) {
      fieldResult.verdict = 'uncertain'
      fieldResult.proposedValue = currentValue
      fieldResult.reason = `${text(fieldResult.reason)} Proposed value changed the field data type.`.trim()
    }
    validFieldResults.push(fieldResult)
  }
  result.fieldResults = validFieldResults
  for (const field of targetFields) {
    if (returnedFields.has(field)) continue
    const currentValue = Object.hasOwn(task.card, field) ? task.card[field] : null
    result.fieldResults.push({ field, verdict: 'uncertain', confidence: 0, reason: 'The AI response omitted this target field.', proposedValue: currentValue, sourceUrls: [] })
  }
  result.crossFieldFindings = result.crossFieldFindings.filter((cross) => isRecord(cross) && Array.isArray(cross.fields))
  for (const cross of result.crossFieldFindings) {
    cross.fields = cross.fields.map(text).filter((field) => targetFields.has(field))
    if (!cross.fields.length) continue
    if (!VERDICTS.includes(cross.verdict)) {
      cross.verdict = 'uncertain'
      cross.reason = `${text(cross.reason)} The AI returned an unsupported verdict.`.trim()
    }
    cross.confidence = Math.max(0, Math.min(1, Number(cross.confidence) || 0))
    cross.sourceUrls = Array.isArray(cross.sourceUrls) ? cross.sourceUrls.map(text).filter((url) => /^https:\/\//i.test(url)).slice(0, 10) : []
  }
  result.crossFieldFindings = result.crossFieldFindings.filter((cross) => cross.fields.length)
  result.confidence = Math.max(0, Math.min(1, Number(result.confidence) || 0))
  return result
}

const promptForTask = (task) => [
  'You are an evidence-first fact-checker for a Russian entity guessing game.',
  'Check every target field and the semantic consistency between all fields in the supplied card context.',
  'Do not assume that zero, false, null, missing, and not-applicable mean the same thing.',
  'Use exact external identifiers when present. Prefer primary or authoritative sources; search snippets and model memory are not evidence.',
  'A pass, contradiction, or stale verdict for an externally verifiable fact must include at least one direct HTTPS source URL.',
  'Use uncertain when sources are insufficient or conflict. Do not invent a replacement value.',
  'proposedValue must preserve the field data type. For pass/uncertain/stale/not_applicable return the current value as proposedValue.',
  'Assess related target fields together. Report contradictions between fields in crossFieldFindings even when each isolated value seems plausible.',
  `Mode-specific source policy: ${task.sourcePolicy}`,
  ...(task.semantics ?? []).map((rule) => `Field semantics: ${rule}`),
  `Target fields: ${JSON.stringify(task.targetFields)}`,
  `Card context: ${JSON.stringify(task.card)}`,
  `Deterministic findings to verify, not blindly accept: ${JSON.stringify(task.deterministicFindings)}`,
].join('\n\n')

const proxySessionId = (task, attempt) => fingerprint({ cardId: task.cardId, attempt, nonce: Date.now(), random: Math.random() }).slice(0, 20)

export const requestFactcheck = async ({ task, apiKey, model, maxOutputTokens, proxyUrl, proxyCountry = 'de', requestTimeoutMs = proxyUrl ? 90_000 : 240_000, createTransport = createOpenAiProxyTransport, directFetch = openAiFetch, waitForRetry = (delay) => new Promise((resolve) => setTimeout(resolve, delay)) }) => {
  const body = {
    model, input: promptForTask(task), reasoning: { effort: 'low' },
    max_output_tokens: Math.max(1_200, Math.min(12_000, Math.trunc(maxOutputTokens))),
    ...(task.webSearch ? { tools: [{ type: 'web_search', search_context_size: 'medium' }], tool_choice: 'required' } : {}),
    text: { format: { type: 'json_schema', name: 'content_factcheck_result', strict: false, schema: responseSchema } },
  }
  let lastError
  const attempts = proxyUrl ? 12 : 4
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), requestTimeoutMs)
    const transport = proxyUrl ? createTransport(proxyUrl, {
      stabilizeIproyal: { country: proxyCountry, sessionId: proxySessionId(task, attempt), lifetime: '24h' },
    }) : null
    try {
      const response = await (transport?.fetchImpl ?? directFetch)('https://api.openai.com/v1/responses', {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: controller.signal,
      })
      const payload = await response.json()
      if (!response.ok) {
        const error = new Error(text(payload?.error?.message) || `OpenAI HTTP ${response.status}`)
        const errorCode = text(payload?.error?.code)
        if (['insufficient_quota', 'billing_hard_limit_reached'].includes(errorCode)
          || /no credits remaining|billing|quota/i.test(error.message)) {
          throw Object.assign(error, { fatal: true, nonRetryable: true, code: errorCode || 'billing_unavailable' })
        }
        const regionalError = isOpenAiWebSearchRegionalError(error)
        if (regionalError && proxyUrl) error.code = 'OPENAI_PROXY_REGION_UNAVAILABLE'
        if (!regionalError && ![408, 409, 429, 500, 502, 503, 504].includes(response.status)) throw Object.assign(error, { nonRetryable: true })
        throw error
      }
      const result = validateResult(task, parseJson(extractResponseText(payload)))
      return {
        ...result, taskFingerprint: task.fingerprint, mode: task.mode, cardId: task.cardId,
        model, responseId: text(payload.id), reviewedAt: new Date().toISOString(), usage: payload.usage ?? null,
        webSearchCalls: (Array.isArray(payload.output) ? payload.output : []).filter((item) => item?.type === 'web_search_call').length,
      }
    } catch (error) {
      lastError = error
      const regionalError = isOpenAiWebSearchRegionalError(error)
      const retryable = regionalError || isTransientOpenAiError(error)
      if (error?.nonRetryable || !retryable) throw error
      if (attempt === attempts - 1) {
        if (regionalError && proxyUrl) throw Object.assign(error, { fatal: true, code: 'OPENAI_PROXY_REGION_UNAVAILABLE' })
        throw error
      }
    } finally {
      clearTimeout(timer)
      if (transport) await transport.close().catch(() => {})
    }
    await waitForRetry(Math.min(2_000, 300 * (attempt + 1)))
  }
  throw lastError ?? new Error('AI fact-check request failed')
}

const mapPool = async (items, concurrency, handler) => {
  const results = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.max(1, Math.min(items.length || 1, concurrency)) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await handler(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

const failedResearchResult = (task, error, model) => ({
  overallVerdict: 'uncertain', confidence: 0,
  summary: 'Automated evidence research did not complete after retries.',
  fieldResults: [], crossFieldFindings: [],
  taskFingerprint: task.fingerprint, mode: task.mode, cardId: task.cardId,
  model, responseId: null, reviewedAt: new Date().toISOString(), usage: null, webSearchCalls: 0,
  researchError: {
    name: text(error?.name) || 'Error',
    code: text(error?.cause?.code || error?.code) || 'unknown',
    message: text(error?.message).slice(0, 500) || 'AI research failed',
  },
})

export const runAiResearch = async ({ tasks, apiKey, model = 'gpt-5-mini', concurrency = 3, cacheDir, refresh = false, maxOutputTokens = 5_000, proxyUrl = process.env.OPENAI_OUTBOUND_PROXY_URL?.trim() || process.env.MUSIC_OUTBOUND_PROXY_URL?.trim() || '', proxyCountry = process.env.OPENAI_PROXY_COUNTRY?.trim() || 'de', onResult }) => {
  if (!text(apiKey)) throw new Error('OPENAI_API_KEY is required for --ai=web')
  await mkdir(cacheDir, { recursive: true })
  return mapPool(tasks, concurrency, async (task, index) => {
    const cacheKey = fingerprint({ taskFingerprint: task.fingerprint, model, promptVersion: 1 })
    const cachePath = path.join(cacheDir, `${cacheKey}.json`)
    let result
    if (!refresh) {
      try { result = JSON.parse(await readFile(cachePath, 'utf8')) } catch {}
    }
    if (!result) {
      try {
        result = await requestFactcheck({ task, apiKey, model, maxOutputTokens, proxyUrl, proxyCountry })
        await writeFile(cachePath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
      } catch (error) {
        if (error?.fatal) throw error
        result = failedResearchResult(task, error, model)
      }
    }
    if (onResult) await onResult(result, index)
    return result
  })
}
