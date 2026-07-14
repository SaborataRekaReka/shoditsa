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
}

const LABELS: Record<string, string> = {
  activityStartYear: 'Начало деятельности', year: 'Год', endYear: 'Окончание деятельности', titleRu: 'Русское название',
  titleOriginal: 'Оригинальное название', plotHint: 'Подсказка', facts: 'Факты', genres: 'Жанры', countries: 'Страны',
}

export const normalizationFields = (mode: ContentMode) => [...new Set([
  ...COMMON_FIELDS.filter((field) => !(mode === 'music' && field === 'year')),
  ...MODE_FIELDS[mode],
])].map((field) => ({ field, label: LABELS[field] ?? field }))

export const assertNormalizationField = (mode: ContentMode, field: string) => {
  if (!normalizationFields(mode).some((entry) => entry.field === field)) throw new Error(`Поле ${field} нельзя нормализовать для категории ${mode}`)
}

export const normalizationStartIndex = (itemIds: string[], offset: unknown) => {
  const parsed = Number(offset)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.min(itemIds.length, Math.trunc(parsed)))
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

export const requestNormalization = async (options: {
  apiKey: string; proxyUrl?: string; model: 'gpt-5-mini'; webSearch: boolean; mode: ContentMode; field: string; prompt: string; payload: Json
}): Promise<NormalizationResult> => {
  assertNormalizationField(options.mode, options.field)
  const specialRule = options.field === 'activityStartYear'
    ? 'Для сольного артиста это первый подтвержденный год профессиональной публичной музыкальной деятельности или дебюта; для группы — год основания/начала деятельности. Никогда не используй год рождения. Если надежного подтверждения нет, верни clear и null.'
    : ''
  const input = [
    'Ты проверяешь одну карточку контента. Изменяй только указанное поле и не выдумывай данные.',
    `Категория: ${options.mode}. Поле: ${options.field}.`,
    `Текущее значение выбранного поля: ${JSON.stringify(options.payload[options.field] ?? null)}. Решение keep относится только к этому значению, а не к похожим legacy-полям карточки.`,
    options.field === 'activityStartYear' ? `Legacy year=${JSON.stringify(options.payload.year ?? null)} — это только непроверенный кандидат и часто год рождения; если он подтвержден как начало деятельности, верни update с этим годом, а не keep.` : '',
    specialRule,
    `Инструкция администратора: ${options.prompt}`,
    'Верни только JSON: {"decision":"update|keep|clear|review","value":...,"confidence":0..1,"reason":"...","sourceUrls":["https://..."]}.',
    'update — новое подтвержденное значение; keep — текущее значение уже верно; clear — значение ошибочно или не подтверждается; review — неоднозначность требует человека.',
    `Карточка: ${JSON.stringify(options.payload)}`,
  ].filter(Boolean).join('\n\n')
  const body = {
    model: options.model,
    input,
    reasoning: { effort: 'low' },
    max_output_tokens: 1200,
    ...(options.webSearch ? { tools: [{ type: 'web_search' }] } : {}),
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
