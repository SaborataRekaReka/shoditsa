import { createHash } from 'node:crypto'
import { expandDependencies, packForMode, severityForField } from './packs.mjs'

export const FACTCHECK_PROTOCOL_VERSION = 1
export const SEVERITIES = ['critical', 'high', 'medium', 'low']
export const VERDICTS = ['pass', 'contradiction', 'uncertain', 'stale', 'not_applicable', 'source_conflict']

export const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
export const text = (value) => String(value ?? '').trim()
export const normalizeText = (value) => text(value).normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ')
export const valueType = (value) => value == null ? 'null' : Array.isArray(value) ? 'array' : typeof value

export const getPath = (record, field) => field.split('.').reduce((value, key) => isRecord(value) ? value[key] : undefined, record)
export const hasPath = (record, field) => {
  const parts = field.split('.')
  let value = record
  for (const key of parts) {
    if (!isRecord(value) || !Object.hasOwn(value, key)) return false
    value = value[key]
  }
  return true
}

export const stableJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

export const fingerprint = (value) => createHash('sha256').update(stableJson(value)).digest('hex')

const compactValue = (value, depth = 0) => {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'string') return value.length > 2_000 ? `${value.slice(0, 2_000)}…` : value
  if (depth >= 4) return '[nested value omitted]'
  if (Array.isArray(value)) return value.slice(0, 40).map((entry) => compactValue(entry, depth + 1))
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).slice(0, 60).map(([key, entry]) => [key, compactValue(entry, depth + 1)]))
  return text(value)
}

const internalFields = new Set([
  'id', 'mode', 'allowedInGame', 'contentStatus', 'reviewStatus', 'sourceFlags', 'dataQuality',
  'popularityScore', 'topRank', 'animalRank', 'bookRank', 'characterRank', 'dailyEligible',
  'posterUrl', 'silhouetteUrl', 'soundUrl', 'mediaAttribution',
  'recognitionScore', 'guessabilityScore', 'recognitionLevel', 'characterDifficulty', 'characterEraOrder',
])

export const factualFields = (item) => Object.keys(item).filter((field) => !internalFields.has(field))

export const contextForTask = (item, mode, targetFields) => {
  const pack = packForMode(mode)
  const all = targetFields.includes('*')
  const assessed = all ? factualFields(item) : targetFields
  const contextFields = all ? Object.keys(item) : [...new Set([...pack.identityFields, ...expandDependencies(mode, assessed)])]
  return {
    targetFields: assessed,
    contextFields,
    card: Object.fromEntries(contextFields.filter((field) => hasPath(item, field)).map((field) => [field, compactValue(getPath(item, field))])),
  }
}

const baseFinding = (item, mode, definition) => ({
  ruleId: definition.ruleId,
  mode,
  cardId: text(item.id) || null,
  title: text(item.titleRu || item.titleOriginal) || null,
  fields: definition.fields,
  status: definition.status ?? 'contradiction',
  severity: definition.severity,
  confidence: definition.confidence ?? 1,
  message: definition.message,
  current: definition.current ?? Object.fromEntries(definition.fields.map((field) => [field, getPath(item, field) ?? null])),
  evidence: definition.evidence ?? [],
  likelyCause: definition.likelyCause ?? null,
  suggestedRemediation: definition.suggestedRemediation ?? null,
  origin: 'deterministic',
})

const selectedForRule = (requestedFields, fields) => requestedFields.includes('*') || fields.some((field) => requestedFields.includes(field))

const walkNumericRanges = (value, path = '', results = []) => {
  if (Array.isArray(value)) return results
  if (!isRecord(value)) return results
  if (Number.isFinite(Number(value.min)) && Number.isFinite(Number(value.max)) && Number(value.min) > Number(value.max)) {
    results.push({ path, min: value.min, max: value.max })
  }
  for (const [key, entry] of Object.entries(value)) walkNumericRanges(entry, path ? `${path}.${key}` : key, results)
  return results
}

export const runCardRules = (item, mode, requestedFields) => {
  const findings = []
  if (!text(item.id)) findings.push(baseFinding(item, mode, {
    ruleId: 'COMMON-IDENTITY-001', fields: ['id'], severity: 'critical', message: 'Card id is missing.',
  }))
  if (!text(item.titleRu || item.titleOriginal) && selectedForRule(requestedFields, ['titleRu', 'titleOriginal'])) findings.push(baseFinding(item, mode, {
    ruleId: 'COMMON-IDENTITY-002', fields: ['titleRu', 'titleOriginal'], severity: 'high', message: 'Card title is missing.',
  }))
  if (mode !== 'custom' && item.mode && text(item.mode) !== mode) findings.push(baseFinding(item, mode, {
    ruleId: 'COMMON-MODE-001', fields: ['mode'], severity: 'high', message: `Card mode ${item.mode} does not match source mode ${mode}.`,
  }))

  if (!requestedFields.includes('*')) {
    for (const field of requestedFields) {
      if (!hasPath(item, field) || getPath(item, field) == null || getPath(item, field) === '') findings.push(baseFinding(item, mode, {
        ruleId: 'COMMON-COMPLETENESS-001', fields: [field], severity: severityForField(mode, field), status: 'uncertain', confidence: 1,
        message: `Selected field ${field} is missing or unknown.`, suggestedRemediation: 'Research the field or mark it explicitly not applicable.',
      }))
    }
  }

  const hasYear = item.year != null && item.year !== '' && Number.isFinite(Number(item.year))
  const hasEndYear = item.endYear != null && item.endYear !== '' && Number.isFinite(Number(item.endYear))
  if (hasYear && hasEndYear && Number(item.year) > Number(item.endYear)) findings.push(baseFinding(item, mode, {
    ruleId: 'COMMON-TIME-001', fields: ['year', 'endYear'], severity: 'high', message: 'Start year is later than end year.',
  }))
  const currentYear = new Date().getUTCFullYear()
  const minimumYear = ['book', 'character'].includes(mode) ? -4_000 : 1_000
  for (const field of requestedFields.includes('*') ? Object.keys(item).filter((key) => /year$/i.test(key)) : requestedFields.filter((key) => /year$/i.test(key))) {
    const value = getPath(item, field)
    if (value != null && value !== '' && (!Number.isInteger(Number(value)) || Number(value) < minimumYear || Number(value) === 0 || Number(value) > currentYear + 2)) findings.push(baseFinding(item, mode, {
      ruleId: 'COMMON-YEAR-001', fields: [field], severity: 'medium', status: 'uncertain', message: `Field ${field} is outside the plausible year range.`,
    }))
  }
  if (item.allowedInGame === true && ['draft', 'review', 'rejected'].includes(normalizeText(item.contentStatus))) findings.push(baseFinding(item, mode, {
    ruleId: 'COMMON-RELEASE-001', fields: ['allowedInGame', 'contentStatus'], severity: 'critical',
    message: 'A card allowed in the game has a non-ready content status.',
  }))
  for (const field of requestedFields.includes('*') ? Object.keys(item) : requestedFields) {
    const value = getPath(item, field)
    if (Array.isArray(value)) {
      const normalized = value.map((entry) => normalizeText(isRecord(entry) ? stableJson(entry) : entry))
      if (new Set(normalized).size !== normalized.length) findings.push(baseFinding(item, mode, {
        ruleId: 'COMMON-ARRAY-001', fields: [field], severity: 'low', message: `Field ${field} contains duplicate values.`,
      }))
    }
    if (/url$/i.test(field) && value && typeof value === 'string' && !/^(?:https?:\/\/|\/|\.\/)/i.test(value)) findings.push(baseFinding(item, mode, {
      ruleId: 'COMMON-URL-001', fields: [field], severity: 'medium', status: 'uncertain', message: `Field ${field} is not a supported absolute or application-relative URL.`,
    }))
    if (/(?:count|population|minutes|episodes|seasons|mass|price)$/i.test(field) && Number.isFinite(Number(value)) && Number(value) < 0) findings.push(baseFinding(item, mode, {
      ruleId: 'COMMON-RANGE-001', fields: [field], severity: 'high', message: `Field ${field} cannot be negative.`,
    }))
  }
  for (const range of walkNumericRanges(item)) findings.push(baseFinding(item, mode, {
    ruleId: 'COMMON-RANGE-002', fields: [range.path], severity: 'high', message: `Minimum exceeds maximum in ${range.path}.`, current: range,
  }))
  findings.push(...packForMode(mode).rules(item))
  return findings.filter((entry) => selectedForRule(requestedFields, entry.fields))
}

export const profileItems = (items, requestedFields) => {
  const fields = requestedFields.includes('*') ? [...new Set(items.flatMap((item) => Object.keys(item)))].sort() : requestedFields
  const fieldProfiles = fields.map((field) => {
    const values = items.map((item) => getPath(item, field))
    const types = values.reduce((counts, value) => ({ ...counts, [valueType(value)]: (counts[valueType(value)] ?? 0) + 1 }), {})
    const present = values.filter((value) => value != null && value !== '').length
    const distinct = new Set(values.filter((value) => value != null).map(stableJson))
    return { field, present, missing: items.length - present, coverage: items.length ? Number((present / items.length).toFixed(4)) : 0, distinct: distinct.size, types }
  })
  return { cards: items.length, fields: fieldProfiles }
}

export const runDatasetRules = (itemsByMode, requestedFieldsByMode) => {
  const findings = []
  for (const [mode, items] of Object.entries(itemsByMode)) {
    const ids = new Map()
    for (const item of items) {
      const id = text(item.id)
      if (id) ids.set(id, [...(ids.get(id) ?? []), item])
      findings.push(...runCardRules(item, mode, requestedFieldsByMode[mode]))
    }
    for (const [id, duplicates] of ids) {
      if (duplicates.length < 2) continue
      findings.push(baseFinding(duplicates[0], mode, {
        ruleId: 'COMMON-IDENTITY-003', fields: ['id'], severity: 'critical', message: `Duplicate card id ${id} occurs ${duplicates.length} times.`,
        current: { id, occurrences: duplicates.length }, suggestedRemediation: 'Resolve duplicate identity before any fact-check corrections are applied.',
      }))
    }
  }
  return findings
}

export const buildResearchTasks = ({ itemsByMode, requestedFieldsByMode, findings, research }) => {
  if (research === 'none') return []
  const flagged = new Set(findings.map((entry) => `${entry.mode}\u0000${entry.cardId}`))
  const tasks = []
  for (const [mode, items] of Object.entries(itemsByMode)) {
    for (const item of items) {
      const cardId = text(item.id)
      if (research === 'flagged' && !flagged.has(`${mode}\u0000${cardId}`)) continue
      const context = contextForTask(item, mode, requestedFieldsByMode[mode])
      const deterministicFindings = findings.filter((entry) => entry.mode === mode && entry.cardId === cardId)
      const payload = {
        protocolVersion: FACTCHECK_PROTOCOL_VERSION,
        mode, cardId, title: text(item.titleRu || item.titleOriginal) || cardId,
        ...context,
        deterministicFindings: deterministicFindings.map(({ ruleId, fields, status, severity, message, current }) => ({ ruleId, fields, status, severity, message, current })),
        sourcePolicy: packForMode(mode).sourcePolicy,
        semantics: packForMode(mode).semantics,
        webSearch: packForMode(mode).webSearch,
      }
      tasks.push({ ...payload, fingerprint: fingerprint(payload) })
    }
  }
  return tasks
}

export const findingsFromAiResult = (task, result) => {
  const findings = []
  const taskValue = (field) => Object.hasOwn(task.card, field) ? task.card[field] : getPath(task.card, field)
  for (const fieldResult of result.fieldResults ?? []) {
    if (['pass', 'not_applicable'].includes(fieldResult.verdict)) continue
    findings.push({
      ruleId: 'AI-FIELD-FACTCHECK', mode: task.mode, cardId: task.cardId, title: task.title,
      fields: [fieldResult.field], status: fieldResult.verdict,
      severity: severityForField(task.mode, fieldResult.field), confidence: fieldResult.confidence,
      message: fieldResult.reason, current: { [fieldResult.field]: taskValue(fieldResult.field) ?? null },
      proposed: fieldResult.proposedValue, evidence: (fieldResult.sourceUrls ?? []).map((url) => ({ url })),
      likelyCause: null, suggestedRemediation: fieldResult.verdict === 'contradiction' ? 'Stage the sourced proposed value for review.' : 'Resolve evidence uncertainty before changing content.',
      origin: 'ai-research', responseId: result.responseId ?? null,
    })
  }
  for (const cross of result.crossFieldFindings ?? []) {
    if (cross.verdict === 'pass') continue
    findings.push({
      ruleId: 'AI-CROSS-FIELD-FACTCHECK', mode: task.mode, cardId: task.cardId, title: task.title,
      fields: cross.fields, status: cross.verdict, severity: cross.severity ?? 'high', confidence: cross.confidence,
      message: cross.reason, current: Object.fromEntries(cross.fields.map((field) => [field, taskValue(field) ?? null])),
      proposed: null, evidence: (cross.sourceUrls ?? []).map((url) => ({ url })), likelyCause: null,
      suggestedRemediation: 'Review and change all dependent fields as one correction.', origin: 'ai-research', responseId: result.responseId ?? null,
    })
  }
  return findings
}

export const buildPatchPlan = (findings) => findings.filter((entry) => entry.origin === 'ai-research' && entry.status === 'contradiction' && entry.proposed !== undefined
    && stableJson(entry.proposed) !== stableJson(entry.current?.[entry.fields[0]] ?? null))
  .map((entry) => ({
    mode: entry.mode, cardId: entry.cardId, field: entry.fields[0], currentValue: entry.current?.[entry.fields[0]] ?? null,
    proposedValue: entry.proposed, confidence: entry.confidence, sourceUrls: entry.evidence.map((evidence) => evidence.url).filter(Boolean),
    reason: entry.message, disposition: 'staged_proposal_only',
  }))

export const summarizeFindings = (findings) => ({
  total: findings.length,
  bySeverity: Object.fromEntries(SEVERITIES.map((severity) => [severity, findings.filter((entry) => entry.severity === severity).length])),
  byStatus: Object.fromEntries(VERDICTS.filter((status) => status !== 'pass').map((status) => [status, findings.filter((entry) => entry.status === status).length])),
  byOrigin: Object.fromEntries(['deterministic', 'ai-research'].map((origin) => [origin, findings.filter((entry) => entry.origin === origin).length])),
})
