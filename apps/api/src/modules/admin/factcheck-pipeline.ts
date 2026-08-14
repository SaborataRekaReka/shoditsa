type Json = Record<string, unknown>

export type FactcheckFinding = {
  ruleId?: string
  cardId?: string | null
  fields?: string[]
  status?: string
  severity?: string
  confidence?: number
  message?: string
  evidence?: Array<{ url?: string }>
  origin?: string
}

export type FactcheckFieldResult = {
  field?: string
  verdict?: string
  confidence?: number
  reason?: string
  proposedValue?: unknown
  sourceUrls?: string[]
}

export type FactcheckResearchResult = {
  overallVerdict?: string
  confidence?: number
  summary?: string
  fieldResults?: FactcheckFieldResult[]
  crossFieldFindings?: Array<{
    fields?: string[]
    verdict?: string
    severity?: string
    confidence?: number
    reason?: string
    sourceUrls?: string[]
  }>
  responseId?: string | null
  model?: string
  usage?: unknown
  webSearchCalls?: number
  researchError?: { code?: string; message?: string }
}

export type FactcheckPreview = {
  status: 'verified' | 'review_required' | 'unresolved' | 'failed'
  proposed: Json | null
  changedFields: string[]
  warnings: string[]
  sources: Array<{ url: string; fields: string[]; verdict: string }>
  releaseGate: { blocking: boolean; reason: string | null }
}

const isRecord = (value: unknown): value is Json => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const jsonEqual = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
const valueType = (value: unknown) => value == null ? 'null' : Array.isArray(value) ? 'array' : typeof value
const validUrl = (value: unknown): value is string => typeof value === 'string' && /^https:\/\//i.test(value)

const setPath = (target: Json, field: string, value: unknown) => {
  const parts = field.split('.').filter(Boolean)
  if (!parts.length) return false
  let cursor = target
  for (const part of parts.slice(0, -1)) {
    const child = cursor[part]
    if (!isRecord(child)) return false
    cursor = child
  }
  cursor[parts.at(-1)!] = value
  return true
}

const getPath = (target: Json, field: string): unknown => field.split('.').reduce<unknown>(
  (value, part) => isRecord(value) ? value[part] : undefined,
  target,
)

const warningForFinding = (finding: FactcheckFinding) => {
  const prefix = [finding.severity, finding.status].filter(Boolean).join(' · ')
  return `${prefix ? `${prefix}: ` : ''}${finding.message ?? finding.ruleId ?? 'Требуется проверка'}`
}

export const buildFactcheckPreview = (
  before: Json,
  result: FactcheckResearchResult,
  findings: FactcheckFinding[],
  minimumCorrectionConfidence = 0.75,
): FactcheckPreview => {
  if (result.researchError) {
    return {
      status: 'failed', proposed: null, changedFields: [],
      warnings: [result.researchError.message ?? 'AI research failed'], sources: [],
      releaseGate: { blocking: true, reason: 'AI research did not complete.' },
    }
  }

  const proposed = structuredClone(before)
  const changedFields: string[] = []
  const sources: FactcheckPreview['sources'] = []
  for (const fieldResult of result.fieldResults ?? []) {
    const field = String(fieldResult.field ?? '').trim()
    const sourceUrls = (fieldResult.sourceUrls ?? []).filter(validUrl)
    for (const url of sourceUrls) sources.push({ url, fields: field ? [field] : [], verdict: String(fieldResult.verdict ?? 'uncertain') })
    if (!field || fieldResult.verdict !== 'contradiction' || Number(fieldResult.confidence ?? 0) < minimumCorrectionConfidence || !sourceUrls.length) continue
    const currentValue = getPath(before, field)
    if (currentValue != null && valueType(currentValue) !== valueType(fieldResult.proposedValue)) continue
    if (jsonEqual(currentValue, fieldResult.proposedValue)) continue
    if (setPath(proposed, field, fieldResult.proposedValue)) changedFields.push(field)
  }
  for (const cross of result.crossFieldFindings ?? []) {
    for (const url of (cross.sourceUrls ?? []).filter(validUrl)) {
      sources.push({ url, fields: (cross.fields ?? []).map(String), verdict: String(cross.verdict ?? 'uncertain') })
    }
  }

  const uniqueSources = [...new Map(sources.map((entry) => [`${entry.url}\u0000${entry.fields.join(',')}\u0000${entry.verdict}`, entry])).values()]
  const blockingFinding = findings.find((finding) => ['critical', 'high'].includes(String(finding.severity))
    && !['pass', 'not_applicable'].includes(String(finding.status)))
  const overallUnresolved = !['pass', 'not_applicable'].includes(String(result.overallVerdict))
  const releaseBlocking = Boolean(blockingFinding || overallUnresolved || changedFields.length)
  const status: FactcheckPreview['status'] = changedFields.length
    ? 'review_required'
    : releaseBlocking
      ? 'unresolved'
      : 'verified'
  const warningCandidates = findings.filter((finding) => !['pass', 'not_applicable'].includes(String(finding.status))).map(warningForFinding)
  if (result.summary && status !== 'verified') warningCandidates.unshift(result.summary)

  return {
    status,
    proposed,
    changedFields: [...new Set(changedFields)],
    warnings: [...new Set(warningCandidates)].slice(0, 30),
    sources: uniqueSources,
    releaseGate: {
      blocking: releaseBlocking,
      reason: blockingFinding?.message ?? (changedFields.length ? 'Evidence-backed corrections require human review.' : overallUnresolved ? result.summary ?? 'Evidence is unresolved.' : null),
    },
  }
}
