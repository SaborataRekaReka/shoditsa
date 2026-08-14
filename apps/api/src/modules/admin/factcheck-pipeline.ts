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
const settledVerdicts = new Set(['pass', 'not_applicable'])

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

const correctionIsApplicable = (
  before: Json,
  fieldResult: FactcheckFieldResult,
  minimumCorrectionConfidence: number,
) => {
  const field = String(fieldResult.field ?? '').trim()
  const currentValue = field ? getPath(before, field) : undefined
  const sourceUrls = (fieldResult.sourceUrls ?? []).filter(validUrl)
  return Boolean(field
    && fieldResult.verdict === 'contradiction'
    && Number(fieldResult.confidence ?? 0) >= minimumCorrectionConfidence
    && sourceUrls.length
    && (currentValue == null || valueType(currentValue) === valueType(fieldResult.proposedValue))
    && !jsonEqual(currentValue, fieldResult.proposedValue))
}

export const factcheckRetryFields = (
  before: Json,
  result: FactcheckResearchResult,
  targetFields: string[],
  minimumCorrectionConfidence = 0.75,
) => {
  const byField = new Map((result.fieldResults ?? []).map((entry) => [String(entry.field ?? '').trim(), entry]))
  const retry = new Set<string>()
  for (const field of targetFields) {
    const fieldResult = byField.get(field)
    if (!fieldResult || (!settledVerdicts.has(String(fieldResult.verdict))
      && !correctionIsApplicable(before, fieldResult, minimumCorrectionConfidence))) retry.add(field)
  }
  for (const cross of result.crossFieldFindings ?? []) {
    if (settledVerdicts.has(String(cross.verdict))) continue
    for (const field of cross.fields ?? []) if (targetFields.includes(field)) retry.add(field)
  }
  return [...retry]
}

export const mergeFactcheckResearchResults = (
  previous: FactcheckResearchResult,
  fresh: FactcheckResearchResult,
  retriedFields: string[],
): FactcheckResearchResult => {
  const replaced = new Set(retriedFields)
  const freshFields = new Set((fresh.fieldResults ?? []).map((entry) => String(entry.field ?? '').trim()).filter(Boolean))
  return {
    ...previous,
    ...fresh,
    fieldResults: [
      ...(previous.fieldResults ?? []).filter((entry) => !replaced.has(String(entry.field ?? '').trim()) && !freshFields.has(String(entry.field ?? '').trim())),
      ...(fresh.fieldResults ?? []),
    ],
    crossFieldFindings: [
      ...(previous.crossFieldFindings ?? []).filter((entry) => !(entry.fields ?? []).some((field) => replaced.has(field))),
      ...(fresh.crossFieldFindings ?? []),
    ],
    summary: [previous.summary, fresh.summary].filter(Boolean).join(' Targeted follow-up: '),
  }
}

export const buildFactcheckPreview = (
  before: Json,
  result: FactcheckResearchResult,
  findings: FactcheckFinding[],
  minimumCorrectionConfidence = 0.75,
  targetFields?: string[],
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
  const selectedFields = [...new Set((targetFields?.length ? targetFields : (result.fieldResults ?? []).map((entry) => String(entry.field ?? '').trim())).filter(Boolean))]
  const selected = new Set(selectedFields)
  const fieldResults = new Map<string, FactcheckFieldResult>()
  for (const fieldResult of result.fieldResults ?? []) {
    const field = String(fieldResult.field ?? '').trim()
    if (!field || !selected.has(field)) continue
    fieldResults.set(field, fieldResult)
    const sourceUrls = (fieldResult.sourceUrls ?? []).filter(validUrl)
    for (const url of sourceUrls) sources.push({ url, fields: field ? [field] : [], verdict: String(fieldResult.verdict ?? 'uncertain') })
    if (!correctionIsApplicable(before, fieldResult, minimumCorrectionConfidence)) continue
    if (setPath(proposed, field, fieldResult.proposedValue)) changedFields.push(field)
  }
  for (const cross of result.crossFieldFindings ?? []) {
    const fields = (cross.fields ?? []).map(String).filter((field) => selected.has(field))
    if (!fields.length) continue
    for (const url of (cross.sourceUrls ?? []).filter(validUrl)) {
      sources.push({ url, fields, verdict: String(cross.verdict ?? 'uncertain') })
    }
  }

  const uniqueSources = [...new Map(sources.map((entry) => [`${entry.url}\u0000${entry.fields.join(',')}\u0000${entry.verdict}`, entry])).values()]
  const blockingFinding = findings.find((finding) => ['critical', 'high'].includes(String(finding.severity))
    && !settledVerdicts.has(String(finding.status))
    && (finding.fields ?? []).some((field) => selected.has(field)))
  const unresolvedField = selectedFields.find((field) => {
    const fieldResult = fieldResults.get(field)
    return !fieldResult || (!settledVerdicts.has(String(fieldResult.verdict)) && !changedFields.includes(field))
  })
  const unresolvedCross = (result.crossFieldFindings ?? []).find((cross) => !settledVerdicts.has(String(cross.verdict))
    && (cross.fields ?? []).some((field) => selected.has(field)))
  const evidenceUnresolved = Boolean(unresolvedField || unresolvedCross)
  const releaseBlocking = Boolean(blockingFinding || evidenceUnresolved || changedFields.length)
  const status: FactcheckPreview['status'] = evidenceUnresolved
    ? 'unresolved'
    : changedFields.length
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
      reason: blockingFinding?.message
        ?? (changedFields.length ? 'Evidence-backed corrections require human review.'
          : evidenceUnresolved ? result.summary ?? `Evidence is unresolved for ${unresolvedField ?? 'related fields'}.` : null),
    },
  }
}
