import { ProxyAgent, fetch as undiciFetch } from 'undici'
import type { ContentMode } from '@shoditsa/contracts'
import { calculateResponseCost, type OpenAiUsageEntry } from './pipeline-cost.js'

type Json = Record<string, unknown>

const COMMON_FIELDS = ['titleRu', 'titleOriginal', 'alternativeTitles', 'year', 'endYear', 'plotHint', 'slogan', 'facts', 'genres', 'allowedInGame', 'posterUrl', 'headerUrl', 'backdropUrl', 'screenshots']
const MODE_FIELDS: Record<ContentMode, string[]> = {
  movie: ['runtimeMinutes', 'ageRating', 'budget', 'directors', 'writers', 'cast', 'countries', 'kinopoiskId', 'imdbId', 'ratings', 'awards'],
  series: ['episodes', 'seasonsCount', 'seriesStatus', 'showrunners', 'writers', 'cast', 'countries', 'kinopoiskId', 'imdbId'],
  anime: ['animeKind', 'animeStatus', 'episodes', 'animeEpisodesAired', 'animeSource', 'studios', 'countries', 'shikimoriId', 'shikimoriScore', 'shikimoriUrl'],
  game: ['developers', 'publishers', 'platforms', 'steamCategories', 'steamTags', 'steamAppId', 'steamUrl', 'price', 'metacritic', 'countries'],
  music: ['activityStartYear', 'endYear', 'countries', 'aliases', 'gameTier', 'contentStatus', 'musicIsActive', 'musicOrigin', 'musicType', 'topTracks', 'topAlbums', 'similarArtists', 'members', 'associatedActs', 'musicLinks', 'dataQuality'],
  diagnosis: ['icd10', 'icdGroup', 'bodySystems', 'diseaseTypes', 'course', 'contagiousness', 'symptoms', 'diagnostics', 'risks', 'severity', 'urgency', 'safetyDisclaimer', 'caseVignettes'],
  city: ['country', 'continent', 'languages', 'population', 'timezone', 'capital', 'popular', 'countryFlagUrl', 'cityFlagUrl', 'coatOfArmsUrl', 'ranks'],
}

const NORMALIZATION_CONTEXT_FIELDS: Record<ContentMode, string[]> = {
  movie: ['year', 'countries', 'directors', 'kinopoiskId', 'imdbId'],
  series: ['year', 'endYear', 'countries', 'showrunners', 'kinopoiskId', 'imdbId'],
  anime: ['year', 'countries', 'studios', 'shikimoriId', 'shikimoriUrl'],
  game: ['year', 'countries', 'developers', 'publishers', 'steamAppId', 'steamUrl'],
  music: ['year', 'activityStartYear', 'endYear', 'countries', 'musicType', 'musicOrigin', 'members', 'associatedActs', 'musicLinks'],
  diagnosis: ['icd10', 'icdGroup', 'bodySystems', 'diseaseTypes'],
  city: ['country', 'continent', 'languages', 'population', 'timezone', 'capital', 'popular', 'ranks'],
}

const TEMPLATE_SPECIAL_VARIABLES = [
  { name: 'title', label: 'Название карточки' },
  { name: 'originalTitle', label: 'Оригинальное название' },
  { name: 'cardId', label: 'ID карточки' },
  { name: 'currentValue', label: 'Текущее значение поля' },
  { name: 'field', label: 'Название поля' },
  { name: 'mode', label: 'Категория' },
  { name: 'card', label: 'Выбранный контекст карточки (JSON)' },
] as const

const compactTemplateValue = (value: unknown, depth = 0): unknown => {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'string') return value.length > 2_000 ? `${value.slice(0, 2_000)}…` : value
  if (depth >= 3) return '[вложенные данные сокращены]'
  if (Array.isArray(value)) return value.slice(0, 30).map((entry) => compactTemplateValue(entry, depth + 1))
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value as Json).slice(0, 40).map(([key, entry]) => [key, compactTemplateValue(entry, depth + 1)]))
  return String(value)
}

const templateValueText = (value: unknown) => {
  if (value === undefined || value === null || value === '') return 'не указано'
  const compact = compactTemplateValue(value)
  const rendered = typeof compact === 'string' ? compact : JSON.stringify(compact)
  return rendered.length > 4_000 ? `${rendered.slice(0, 4_000)}…` : rendered
}

const LABELS: Record<string, string> = {
  activityStartYear: 'Начало деятельности', year: 'Год', endYear: 'Окончание деятельности', titleRu: 'Русское название',
  titleOriginal: 'Оригинальное название', plotHint: 'Подсказка', facts: 'Факты', genres: 'Жанры', countries: 'Страны',
  country: 'Страна', continent: 'Континент', languages: 'Языки', population: 'Население', timezone: 'Часовой пояс',
}

export const normalizationFields = (mode: ContentMode) => [...new Set([
  ...COMMON_FIELDS.filter((field) => !(mode === 'music' && field === 'year')),
  ...MODE_FIELDS[mode],
])].map((field) => ({ field, label: LABELS[field] ?? field }))

export const normalizationContextOptions = (_mode?: ContentMode, extraFields: string[] = []) => [...new Set([...COMMON_FIELDS, ...Object.values(MODE_FIELDS).flat(), ...extraFields])]
  .filter((field) => /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(field))
  .map((field) => ({ field, label: LABELS[field] ?? field }))

export const normalizationDefaultContextFields = (mode: ContentMode) => [...new Set([
  ...NORMALIZATION_CONTEXT_FIELDS[mode],
  ...(mode === 'music' ? ['alternativeTitles', 'aliases'] : []),
])]

export const normalizationTemplateVariables = (mode: ContentMode, extraFields: string[] = []) => [
  ...TEMPLATE_SPECIAL_VARIABLES.map((entry) => ({ ...entry, token: `%${entry.name}%` })),
  ...normalizationContextOptions(mode, extraFields)
    .filter((entry) => !TEMPLATE_SPECIAL_VARIABLES.some((special) => special.name === entry.field))
    .map((entry) => ({ name: entry.field, label: entry.label, token: `%${entry.field}%` })),
]

export const normalizationUnknownVariables = (prompt: string, mode: ContentMode, extraFields: string[] = []) => {
  const allowed = new Set(normalizationTemplateVariables(mode, extraFields).map((entry) => entry.name))
  return [...new Set([...prompt.matchAll(/%([^%\s]{1,80})%/g)].map((match) => match[1]).filter((name) => !allowed.has(name)))]
}

export const assertNormalizationTemplate = (prompt: string, mode: ContentMode, extraFields: string[] = []) => {
  const unknown = normalizationUnknownVariables(prompt, mode, extraFields)
  if (unknown.length) throw new Error(`Неизвестные переменные: ${unknown.map((name) => `%${name}%`).join(', ')}`)
}

export const assertNormalizationField = (mode: ContentMode, field: string) => {
  if (!normalizationFields(mode).some((entry) => entry.field === field)) throw new Error(`Поле ${field} нельзя нормализовать для категории ${mode}`)
}

export const normalizationStartIndex = (itemIds: string[], offset: unknown) => {
  const parsed = Number(offset)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.min(itemIds.length, Math.trunc(parsed)))
}

export const normalizationPendingItemIds = (itemIds: string[], processedItemIds: Iterable<string>, offset: unknown) => {
  const processed = new Set(processedItemIds)
  const start = normalizationStartIndex(itemIds, offset)
  return [...itemIds.slice(0, start), ...itemIds.slice(start)].filter((itemId) => !processed.has(itemId))
}

export const buildNormalizationCardContext = (payload: Json, mode: ContentMode, field: string, contextFields?: string[], cardId?: string, availableFields: string[] = []) => {
  const allowed = new Set(normalizationContextOptions(mode, availableFields).map((entry) => entry.field))
  const optional = contextFields === undefined ? normalizationDefaultContextFields(mode) : contextFields
  const invalid = optional.filter((key) => !allowed.has(key))
  if (invalid.length) throw new Error(`Недопустимые поля контекста: ${invalid.join(', ')}`)
  const fields = new Set(['titleRu', 'titleOriginal', field, ...optional])
  return Object.fromEntries([
    ...(cardId ? [['cardId', cardId] as const] : []),
    ...[...fields].map((key) => [key, compactTemplateValue(payload[key] ?? null)] as const),
  ])
}

export const renderNormalizationPrompt = (options: {
  prompt: string; payload: Json; mode: ContentMode; field: string; contextFields?: string[]; cardId?: string; availableFields?: string[]
}) => {
  assertNormalizationField(options.mode, options.field)
  assertNormalizationTemplate(options.prompt, options.mode, options.availableFields)
  const context = buildNormalizationCardContext(options.payload, options.mode, options.field, options.contextFields, options.cardId, options.availableFields)
  const values: Json = {
    ...options.payload,
    title: options.payload.titleRu || options.payload.titleOriginal || options.cardId || 'не указано',
    originalTitle: options.payload.titleOriginal,
    cardId: options.cardId,
    currentValue: options.payload[options.field],
    field: options.field,
    mode: options.mode,
    card: context,
  }
  const prompt = options.prompt.replace(/%([^%\s]{1,80})%/g, (_token, name: string) => templateValueText(values[name]))
  if (prompt.length > 20_000) throw new Error('Промпт после подстановки переменных превышает 20 000 символов')
  return { prompt, context }
}

export type NormalizationPoolOutcome = 'completed' | 'rate_limited' | 'cancelled'

export const isNormalizationRateLimitError = (error: unknown) => /(?:openai http 429|rate.?limit|too many requests)/i.test(error instanceof Error ? error.message : String(error))

export const runNormalizationPool = async <T>(
  items: T[],
  requestedConcurrency: number,
  handler: (item: T, index: number, rateLimitRetry: number) => Promise<NormalizationPoolOutcome>,
  options: { rateLimitBackoffMs?: number } = {},
) => {
  const concurrency = Math.max(1, Math.min(items.length || 1, Math.trunc(requestedConcurrency) || 1))
  const backoffMs = Math.max(0, options.rateLimitBackoffMs ?? 5_000)
  let cursor = 0
  let desiredConcurrency = concurrency
  let completed = 0
  let cancelled = false
  const runners = Array.from({ length: concurrency }, (_, slot) => (async () => {
    while (!cancelled && slot < desiredConcurrency) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      let outcome = await handler(items[index], index, 0)
      if (outcome === 'cancelled') { cancelled = true; return }
      if (outcome === 'rate_limited') {
        desiredConcurrency = Math.max(1, desiredConcurrency - 1)
        if (backoffMs) await new Promise((resolve) => setTimeout(resolve, backoffMs))
        outcome = await handler(items[index], index, 1)
        if (outcome === 'cancelled') { cancelled = true; return }
        if (outcome === 'rate_limited') throw new Error('Normalization task remained rate limited after adaptive retry')
      }
      completed += 1
    }
  })())
  await Promise.all(runners)
  return { completed, cancelled, finalConcurrency: desiredConcurrency }
}

const record = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
export const mergeNormalizationUsage = (previousConfidence: unknown, nextUsage: OpenAiUsageEntry | null) => {
  const previousUsage = record(record(previousConfidence).usage)
  const previousResponses = Array.isArray(previousUsage.responses) ? previousUsage.responses : []
  const responses = new Map<string, OpenAiUsageEntry>()
  for (const raw of [...previousResponses, ...(nextUsage ? [nextUsage] : [])]) {
    const entry = record(raw)
    const normalized: OpenAiUsageEntry = {
      responseId: String(entry.responseId ?? ''), model: String(entry.model ?? 'gpt-5-mini'),
      inputTokens: Number(entry.inputTokens ?? 0), cachedInputTokens: Number(entry.cachedInputTokens ?? 0),
      outputTokens: Number(entry.outputTokens ?? 0), webSearchCalls: Number(entry.webSearchCalls ?? 0), costUsd: Number(entry.costUsd ?? 0),
    }
    const identity = normalized.responseId || JSON.stringify(normalized)
    responses.set(identity, normalized)
  }
  const entries = [...responses.values()]
  return {
    responses: entries,
    inputTokens: entries.reduce((sum, entry) => sum + entry.inputTokens, 0),
    cachedInputTokens: entries.reduce((sum, entry) => sum + entry.cachedInputTokens, 0),
    outputTokens: entries.reduce((sum, entry) => sum + entry.outputTokens, 0),
    webSearchCalls: entries.reduce((sum, entry) => sum + entry.webSearchCalls, 0),
    costUsd: Number(entries.reduce((sum, entry) => sum + entry.costUsd, 0).toFixed(8)),
  }
}
const extractResponseText = (payload: Json) => typeof payload.output_text === 'string'
  ? payload.output_text
  : (Array.isArray(payload.output) ? payload.output : []).flatMap((item) => Array.isArray(record(item).content) ? record(item).content as unknown[] : [])
    .map((content) => String(record(content).text ?? record(content).output_text ?? '')).filter(Boolean).join('\n')

const parseJson = (value: string) => {
  const normalized = value.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim()
  try { return record(JSON.parse(normalized)) } catch {}
  const start = normalized.indexOf('{'); const end = normalized.lastIndexOf('}')
  if (start >= 0 && end > start) return record(JSON.parse(normalized.slice(start, end + 1)))
  throw new Error('Модель не вернула JSON')
}

export const normalizeProposedValue = (field: string, value: unknown, currentValue: unknown) => {
  if (field === 'activityStartYear') {
    if (value == null || value === '') return null
    const year = Number(value)
    if (!Number.isInteger(year) || year < 1800 || year > new Date().getUTCFullYear() + 1) throw new Error('Начало деятельности должно быть годом от 1800 до текущего')
    return year
  }
  if (value == null) return null
  if (typeof currentValue === 'string' && typeof value !== 'string') throw new Error('Модель изменила тип строкового поля')
  if (typeof currentValue === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error('Модель изменила тип числового поля')
  if (typeof currentValue === 'boolean' && typeof value !== 'boolean') throw new Error('Модель изменила тип логического поля')
  if (Array.isArray(currentValue) && !Array.isArray(value)) throw new Error('Модель изменила тип массива')
  if (currentValue && typeof currentValue === 'object' && !Array.isArray(currentValue) && (!value || typeof value !== 'object' || Array.isArray(value))) throw new Error('Модель изменила тип объекта')
  if (JSON.stringify(value).length > 20_000) throw new Error('Нормализованное значение слишком большое')
  return value
}

export type NormalizationResult = {
  decision: 'update' | 'keep' | 'clear' | 'review'
  value: unknown
  confidence: number
  reason: string
  sourceUrls: string[]
  responseId: string
  usage: OpenAiUsageEntry | null
}

export type NormalizationModel = 'gpt-5-mini' | 'gpt-5-nano'

export const requestNormalization = async (options: {
  apiKey: string; proxyUrl?: string; model: NormalizationModel; webSearch: boolean; webSearchRequired?: boolean; mode: ContentMode; field: string; prompt: string; payload: Json; contextFields?: string[]; cardId?: string; availableFields?: string[]
}): Promise<NormalizationResult> => {
  assertNormalizationField(options.mode, options.field)
  const rendered = renderNormalizationPrompt(options)
  const specialRule = options.field === 'activityStartYear'
    ? 'Для сольного артиста это первый подтвержденный год профессиональной публичной музыкальной деятельности или дебюта; для группы — год основания/начала деятельности. Никогда не используй год рождения. Если надежного подтверждения нет, верни clear и null.'
    : ''
  const input = [
    'Ты проверяешь одну карточку контента. Изменяй только указанное поле и не выдумывай данные.',
    `Категория: ${options.mode}. Поле: ${options.field}.`,
    `Текущее значение выбранного поля: ${JSON.stringify(options.payload[options.field] ?? null)}. Решение keep относится только к этому значению, а не к похожим legacy-полям карточки.`,
    options.field === 'activityStartYear' ? `Legacy year=${JSON.stringify(options.payload.year ?? null)} — это только непроверенный кандидат и часто год рождения; если он подтвержден как начало деятельности, верни update с этим годом, а не keep.` : '',
    specialRule,
    `Инструкция администратора: ${rendered.prompt}`,
    'Верни только JSON: {"decision":"update|keep|clear|review","value":...,"confidence":0..1,"reason":"...","sourceUrls":["https://..."]}.',
    'update — новое подтвержденное значение; keep — текущее значение уже верно; clear — значение ошибочно или не подтверждается; review — неоднозначность требует человека.',
    `Контекст карточки: ${JSON.stringify(rendered.context)}`,
  ].filter(Boolean).join('\n\n')
  const body = {
    model: options.model,
    input,
    reasoning: { effort: 'low' },
    max_output_tokens: 1200,
    ...(options.webSearch ? { tools: [{ type: 'web_search', search_context_size: 'low' }] } : {}),
    ...(options.webSearch && options.webSearchRequired ? { tool_choice: 'required' } : {}),
    text: { format: { type: 'json_schema', name: 'normalization_result', strict: false, schema: {
      type: 'object', additionalProperties: false,
      properties: {
        decision: { type: 'string', enum: ['update', 'keep', 'clear', 'review'] }, value: {}, confidence: { type: 'number' },
        reason: { type: 'string' }, sourceUrls: { type: 'array', items: { type: 'string' } },
      }, required: ['decision', 'value', 'confidence', 'reason', 'sourceUrls'],
    } } },
  }
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 120_000)
  const dispatcher = options.proxyUrl ? new ProxyAgent(options.proxyUrl) : null
  try {
    let response: Awaited<ReturnType<typeof undiciFetch>> | null = null
    for (let attempt = 0; attempt < 3; attempt += 1) {
      response = await undiciFetch('https://api.openai.com/v1/responses', {
        method: 'POST', headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal,
        ...(dispatcher ? { dispatcher } : {}),
      })
      if (response.ok || ![429, 500, 502, 503, 504].includes(response.status)) break
      await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)))
    }
    let payload = record(await response!.json())
    if (!response!.ok) {
      const message = String(record(payload.error).message ?? `OpenAI HTTP ${response!.status}`)
      if (options.webSearch && /country,\s*region,\s*or\s*territory/i.test(message)) {
        response = await undiciFetch('https://api.openai.com/v1/responses', {
          method: 'POST', headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, tools: [{ type: 'web_search', search_context_size: 'low', external_web_access: false }] }), signal: controller.signal,
          ...(dispatcher ? { dispatcher } : {}),
        })
        payload = record(await response.json())
      }
    }
    if (!response!.ok && options.webSearch) {
      const message = String(record(payload.error).message ?? `OpenAI HTTP ${response!.status}`)
      if (/country,\s*region,\s*or\s*territory/i.test(message)) {
        response = await undiciFetch('https://api.openai.com/v1/responses', {
          method: 'POST', headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, tools: undefined, tool_choice: undefined }), signal: controller.signal,
          ...(dispatcher ? { dispatcher } : {}),
        })
        payload = record(await response.json())
      }
    }
    if (!response!.ok) throw new Error(String(record(payload.error).message ?? `OpenAI HTTP ${response!.status}`))
    const parsed = parseJson(extractResponseText(payload))
    const decision = String(parsed.decision) as NormalizationResult['decision']
    if (!['update', 'keep', 'clear', 'review'].includes(decision)) throw new Error('Модель вернула недопустимое решение')
    const webSearchCalls = (Array.isArray(payload.output) ? payload.output : []).filter((item) => record(item).type === 'web_search_call').length
    return {
      decision, value: parsed.value, confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)), reason: String(parsed.reason ?? '').slice(0, 1_000),
      sourceUrls: Array.isArray(parsed.sourceUrls) ? parsed.sourceUrls.map(String).filter((url) => /^https:\/\//i.test(url)).slice(0, 10) : [],
      responseId: String(payload.id ?? ''), usage: calculateResponseCost({ model: options.model, usage: payload.usage, webSearchCalls, responseId: payload.id }),
    }
  } finally { clearTimeout(timer); if (dispatcher) await dispatcher.close() }
}
