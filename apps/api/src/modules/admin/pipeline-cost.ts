type Json = Record<string, unknown>

export type OpenAiUsageEntry = {
  responseId: string
  model: string
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  webSearchCalls: number
  costUsd: number
}

const record = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
const number = (value: unknown) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0

export const OPENAI_PRICING_USD = Object.freeze({
  'gpt-5-mini': { inputPerMillion: 0.25, cachedInputPerMillion: 0.025, outputPerMillion: 2, webSearchPerCall: 0.01 },
})

export const calculateResponseCost = (value: { model?: unknown; usage?: unknown; webSearchCalls?: unknown; responseId?: unknown }): OpenAiUsageEntry | null => {
  const usage = record(value.usage)
  if (!Object.keys(usage).length) return null
  const model = String(value.model ?? 'gpt-5-mini')
  const pricing = OPENAI_PRICING_USD[model as keyof typeof OPENAI_PRICING_USD]
  if (!pricing) return null
  const inputTokens = number(usage.input_tokens ?? usage.inputTokens)
  const cachedDetails = record(usage.input_tokens_details ?? usage.inputTokensDetails)
  const cachedInputTokens = Math.min(inputTokens, number(cachedDetails.cached_tokens ?? cachedDetails.cachedTokens))
  const outputTokens = number(usage.output_tokens ?? usage.outputTokens)
  const webSearchCalls = number(value.webSearchCalls)
  const costUsd = ((inputTokens - cachedInputTokens) * pricing.inputPerMillion
    + cachedInputTokens * pricing.cachedInputPerMillion
    + outputTokens * pricing.outputPerMillion) / 1_000_000
    + webSearchCalls * pricing.webSearchPerCall
  return {
    responseId: String(value.responseId ?? ''), model, inputTokens, cachedInputTokens, outputTokens, webSearchCalls,
    costUsd: Number(costUsd.toFixed(8)),
  }
}

export const collectMusicRecordUsage = (records: Json[]) => {
  const responses = new Map<string, OpenAiUsageEntry>()
  for (const raw of records) {
    const aiReview = record(raw.aiReview)
    const input = record(record(raw.record).input)
    const provenance = record(input.provenance)
    for (const candidate of [aiReview, provenance]) {
      const entry = calculateResponseCost(candidate)
      if (!entry) continue
      const identity = entry.responseId || `${entry.model}:${entry.inputTokens}:${entry.outputTokens}:${responses.size}`
      if (!responses.has(identity)) responses.set(identity, entry)
    }
  }
  const entries = [...responses.values()]
  return {
    responses: entries,
    inputTokens: entries.reduce((sum, entry) => sum + entry.inputTokens, 0),
    cachedInputTokens: entries.reduce((sum, entry) => sum + entry.cachedInputTokens, 0),
    outputTokens: entries.reduce((sum, entry) => sum + entry.outputTokens, 0),
    webSearchCalls: entries.reduce((sum, entry) => sum + entry.webSearchCalls, 0),
    costUsd: Number(entries.reduce((sum, entry) => sum + entry.costUsd, 0).toFixed(8)),
    pricingVersion: 'openai-2026-07-13',
  }
}
