type Json = Record<string, unknown>

export type ApiBackfillPipeline = 'anime' | 'movie'

const allowedFields: Record<ApiBackfillPipeline, ReadonlySet<string>> = {
  anime: new Set(['cast', 'genres']),
  movie: new Set(['directors']),
}

const hasValue = (value: unknown) => {
  if (value == null) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value as Json).length > 0
  return true
}

export const apiBackfillFields = (pipeline: ApiBackfillPipeline, input: Json) => {
  if (input.purpose !== 'api_metadata_backfill') return []
  const requested = Array.isArray(input.patchFields) ? input.patchFields.map(String) : []
  return [...new Set(requested.filter((field) => allowedFields[pipeline].has(field)))]
}

export const buildMissingFieldsProposal = (before: Json, source: Json, fields: string[]) => {
  const proposed = { ...before }
  const changedFields: string[] = []
  for (const field of fields) {
    if (hasValue(before[field]) || !hasValue(source[field])) continue
    proposed[field] = source[field]
    changedFields.push(field)
  }
  return { proposed, changedFields }
}
