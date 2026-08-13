import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { openAiFetch } from '../shared/openai-fetch.mjs'
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
  for (const fieldResult of result.fieldResults) {
    if (!isRecord(fieldResult) || !targetFields.has(text(fieldResult.field)) || !VERDICTS.includes(fieldResult.verdict)) throw new Error('AI result contains an invalid field verdict')
    if (returnedFields.has(fieldResult.field)) throw new Error(`AI result contains duplicate field verdicts for ${fieldResult.field}`)
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
  }
  for (const field of targetFields) {
    if (returnedFields.has(field)) continue
    const currentValue = Object.hasOwn(task.card, field) ? task.card[field] : null
    result.fieldResults.push({ field, verdict: 'uncertain', confidence: 0, reason: 'The AI response omitted this target field.', proposedValue: currentValue, sourceUrls: [] })
  }
  for (const cross of result.crossFieldFindings) {
    if (!isRecord(cross) || !Array.isArray(cross.fields) || !VERDICTS.includes(cross.verdict)) throw new Error('AI result contains an invalid cross-field verdict')
    cross.confidence = Math.max(0, Math.min(1, Number(cross.confidence) || 0))
    cross.sourceUrls = Array.isArray(cross.sourceUrls) ? cross.sourceUrls.map(text).filter((url) => /^https:\/\//i.test(url)).slice(0, 10) : []
  }
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

const requestFactcheck = async ({ task, apiKey, model, maxOutputTokens }) => {
  const body = {
    model, input: promptForTask(task), reasoning: { effort: 'low' },
    max_output_tokens: Math.max(1_200, Math.min(12_000, Math.trunc(maxOutputTokens))),
    ...(task.webSearch ? { tools: [{ type: 'web_search', search_context_size: 'medium' }], tool_choice: 'required' } : {}),
    text: { format: { type: 'json_schema', name: 'content_factcheck_result', strict: false, schema: responseSchema } },
  }
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 180_000)
  try {
    let response
    for (let attempt = 0; attempt < 3; attempt += 1) {
      response = await openAiFetch('https://api.openai.com/v1/responses', {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: controller.signal,
      })
      if (response.ok || ![429, 500, 502, 503, 504].includes(response.status)) break
      await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)))
    }
    const payload = await response.json()
    if (!response.ok) throw new Error(text(payload?.error?.message) || `OpenAI HTTP ${response.status}`)
    const result = validateResult(task, parseJson(extractResponseText(payload)))
    return {
      ...result, taskFingerprint: task.fingerprint, mode: task.mode, cardId: task.cardId,
      model, responseId: text(payload.id), reviewedAt: new Date().toISOString(), usage: payload.usage ?? null,
      webSearchCalls: (Array.isArray(payload.output) ? payload.output : []).filter((item) => item?.type === 'web_search_call').length,
    }
  } finally { clearTimeout(timer) }
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

export const runAiResearch = async ({ tasks, apiKey, model = 'gpt-5-mini', concurrency = 3, cacheDir, refresh = false, maxOutputTokens = 5_000, onResult }) => {
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
      result = await requestFactcheck({ task, apiKey, model, maxOutputTokens })
      await writeFile(cachePath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
    }
    if (onResult) await onResult(result, index)
    return result
  })
}
