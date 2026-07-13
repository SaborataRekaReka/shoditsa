import fs from 'node:fs'
import path from 'node:path'
import { readJson, writeJsonAtomic } from '../core.mjs'
import { auditMovieRecord, cleanText, normalize, sanitizeMovieRecord } from '../../shared/movie-hint-sanitize.mjs'
import { openAiFetch } from '../../shared/openai-fetch.mjs'

const API_BASE = 'https://kinopoiskapiunofficial.tech'
const MOVIE_TYPES = new Set(['FILM', 'VIDEO', 'TV_MOVIE'])
const keySlots = Array.from({ length: 5 }, (_, index) => `KINOPOISK_UNOFFICIAL_API_KEY_${index + 1}`)
const keys = () => [...new Set([
  ...String(process.env.KINOPOISK_API_KEYS ?? '').split(/[\n,;\s]+/),
  process.env.KINOPOISK_API_KEY,
  ...keySlots.map((key) => process.env[key]),
].map((value) => String(value ?? '').trim()).filter(Boolean))]

let keyPointer = 0
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const requestKinopoisk = async (endpoint) => {
  const pool = keys()
  if (!pool.length) throw new Error('KINOPOISK_API_KEYS is required')
  let lastError = null
  for (let attempt = 0; attempt < pool.length * 4; attempt += 1) {
    const key = pool[keyPointer++ % pool.length]
    const response = await fetch(`${API_BASE}${endpoint}`, {
      headers: { 'X-API-KEY': key, Accept: 'application/json' },
    })
    if (response.ok) return response.json()
    const body = await response.text().catch(() => '')
    lastError = new Error(`Kinopoisk HTTP ${response.status}: ${body.slice(0, 180)}`)
    if (![401, 402, 403, 429].includes(response.status) && response.status < 500) throw lastError
    await wait(Math.min(2_500, 250 * (attempt + 1)))
  }
  throw lastError ?? new Error(`Kinopoisk request failed: ${endpoint}`)
}

const extractKinopoiskId = (value) => {
  if (Number.isInteger(Number(value)) && Number(value) > 0) return Number(value)
  const match = String(value ?? '').match(/(?:kinopoisk\.ru\/(?:film|series)\/|kp[_:-]?)(\d+)/i)
  return match ? Number(match[1]) : null
}

const scopeName = (sourcePath) => path.basename(sourcePath, path.extname(sourcePath))
  .toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '-').replace(/^-|-$/g, '') || 'custom'

const normalizeInput = (entry) => {
  const object = entry && typeof entry === 'object' ? entry : { kinopoiskId: entry }
  const kinopoiskId = extractKinopoiskId(object.kinopoiskId ?? object.id ?? object.url)
  return kinopoiskId ? { ...object, kinopoiskId } : null
}

const person = (entry) => ({
  nameRu: entry?.nameRu || entry?.nameEn || 'Не указано',
  nameOriginal: entry?.nameEn || entry?.nameRu || '',
  photoUrl: entry?.posterUrl || null,
})

const inferLanguage = (countries) => {
  const first = countries[0] ?? ''
  if (['Россия', 'СССР', 'Беларусь', 'Казахстан'].includes(first)) return 'ru'
  if (first === 'Франция') return 'fr'
  if (first === 'Италия') return 'it'
  if (first === 'Испания') return 'es'
  if (first === 'Германия') return 'de'
  if (first === 'Япония') return 'ja'
  if (first === 'Корея Южная') return 'ko'
  return 'en'
}

const forbiddenHintValues = (movie) => [
  movie.titleRu, movie.titleOriginal, ...(movie.alternativeTitles ?? []),
  ...(movie.directors ?? []).flatMap((entry) => [entry.nameRu, entry.nameOriginal]),
  ...(movie.cast ?? []).flatMap((entry) => [entry.nameRu, entry.nameOriginal]),
].map(normalize).filter((value) => value.length >= 4)

export const validateMovieHint = (hint, movie) => {
  const text = cleanText(hint?.text)
  const normalized = normalize(text)
  const forbiddenMatches = forbiddenHintValues(movie).filter((value) => normalized.includes(value))
  const errors = [
    text.length < 40 ? 'hint_too_short' : null,
    text.length > 280 ? 'hint_too_long' : null,
    !/[а-яё]/i.test(text) ? 'hint_not_russian' : null,
    forbiddenMatches.length ? 'hint_contains_answer_or_person' : null,
    !Array.isArray(hint?.sourceUrls) || hint.sourceUrls.length === 0 ? 'hint_has_no_sources' : null,
  ].filter(Boolean)
  return { valid: errors.length === 0, text, errors, forbiddenMatches }
}

const extractResponseText = (payload) => typeof payload?.output_text === 'string'
  ? payload.output_text
  : (payload?.output ?? []).flatMap((item) => item?.content ?? []).map((item) => item?.text ?? item?.output_text ?? '').filter(Boolean).join('\n')

const asJsonObject = (value) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  if (Array.isArray(value)) {
    const firstObject = value.find((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
    if (firstObject) return firstObject
  }
  return null
}

const parseJsonResponse = (value) => {
  const raw = String(value ?? '').trim()
  if (!raw) throw new Error('AI reviewer returned no JSON object')
  const normalized = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim()
  for (const candidate of [raw, normalized]) {
    try {
      const parsed = JSON.parse(candidate)
      const object = asJsonObject(parsed)
      if (object) return object
    } catch {}
  }
  const blocks = [[normalized.indexOf('{'), normalized.lastIndexOf('}')], [normalized.indexOf('['), normalized.lastIndexOf(']')]]
  for (const [start, end] of blocks) {
    if (start < 0 || end <= start) continue
    try {
      const parsed = JSON.parse(normalized.slice(start, end + 1))
      const object = asJsonObject(parsed)
      if (object) return object
    } catch {}
  }
  throw new Error('AI reviewer returned no JSON object')
}

const callAiReviewer = async ({ movie, evidence, options }) => {
  const apiKey = process.env[options.apiKeyEnv]
  if (!apiKey) throw new Error(`${options.apiKeyEnv} is not configured`)
  const prompt = [
    'Ты фактчекер кино-каталога и автор подсказок для русской игры-угадайки.',
    'Проверь, что данные относятся к одному полнометражному фильму. Используй веб-поиск для проверки отличительного производственного, наградного или исторического факта.',
    'Сделай одну русскую подсказку длиной 40-280 символов. Не называй фильм, варианты названия, персонажей, режиссёра или актёров. Не пересказывай ответ прямой цитатой.',
    'Верни только JSON: {"decision":"accept|review|reject","confidence":0..1,"reasons":[],"hint":{"text":"...","confidence":0..1,"sourceUrls":["https://..."]}}.',
    'Не выдумывай факты. При конфликте источников выбери review или reject.',
    JSON.stringify({ movie, evidence }),
  ].join('\n\n')
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), options.aiTimeoutMs)
  try {
    const request = {
      model: options.model,
      input: prompt,
      max_output_tokens: 1_200,
      text: {
        format: {
          type: 'json_schema',
          name: 'movie_reviewer_response',
          strict: false,
          schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              decision: { type: 'string', enum: ['accept', 'review', 'reject'] },
              confidence: { type: 'number' },
              reasons: { type: 'array', items: { type: 'string' } },
              hint: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  text: { type: 'string' },
                  confidence: { type: 'number' },
                  sourceUrls: { type: 'array', items: { type: 'string' } },
                },
                required: ['text', 'sourceUrls'],
              },
            },
            required: ['decision'],
          },
        },
      },
    }
    if (options.aiWebSearch) request.tools = [{ type: 'web_search_preview', search_context_size: 'low' }]
    const response = await openAiFetch(`${options.apiBaseUrl}/responses`, {
      method: 'POST', signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload?.error?.message || `OpenAI HTTP ${response.status}`)
    const review = parseJsonResponse(extractResponseText(payload))
    if (!['accept', 'review', 'reject'].includes(review?.decision)) throw new Error('AI reviewer returned an invalid decision')
    return {
      ...review, model: options.model, reviewedAt: new Date().toISOString(), usage: payload?.usage ?? null,
      webSearchCalls: (payload?.output ?? []).filter((item) => item?.type === 'web_search_call').length,
      responseId: payload?.id ?? null,
    }
  } finally { clearTimeout(timeout) }
}

const buildMovie = ({ kinopoiskId, details, staff, factsResponse, awardsResponse, rank }) => {
  const countries = (details.countries ?? []).map((entry) => entry?.country).filter(Boolean)
  const genres = (details.genres ?? []).map((entry) => entry?.genre).filter(Boolean).slice(0, 6)
  const directors = staff.filter((entry) => entry.professionKey === 'DIRECTOR').slice(0, 3).map(person)
  const writers = staff.filter((entry) => entry.professionKey === 'WRITER').slice(0, 3).map(person)
  const actors = staff.filter((entry) => entry.professionKey === 'ACTOR')
  const awardItems = awardsResponse?.items ?? []
  const raw = {
    id: `kp_${kinopoiskId}`, mode: 'movie',
    titleRu: details.nameRu || details.nameOriginal || details.nameEn || `Кинопоиск #${kinopoiskId}`,
    titleOriginal: details.nameOriginal || details.nameEn || '',
    alternativeTitles: [...new Set([details.nameEn, details.nameOriginal].filter(Boolean))],
    year: Number(details.year) || null, endYear: null, countries, originalLanguage: inferLanguage(countries), genres,
    ageRating: details.ratingAgeLimits ? `${String(details.ratingAgeLimits).replace('age', '')}+` : null,
    runtimeMinutes: details.filmLength ?? null, directors, showrunners: [], writers,
    cast: actors.slice(0, 5).map(person), supportingCast: actors.slice(5, 10).map(person), studios: [],
    kinopoiskId, imdbId: details.imdbId ?? null,
    ratings: { kinopoisk: details.ratingKinopoisk ?? null, imdb: details.ratingImdb ?? null },
    votes: { kinopoisk: details.ratingKinopoiskVoteCount ?? null, imdb: details.ratingImdbVoteCount ?? null },
    popularityScore: Math.max(1, Math.round(101 - (rank ?? 100) * .35)), budget: null,
    posterUrl: details.posterUrl || null, backdropUrl: details.coverUrl || null, screenshots: [],
    description: cleanText(details.description || details.shortDescription),
    plotHint: cleanText(details.shortDescription || details.description), slogan: cleanText(details.slogan) || null,
    facts: (factsResponse?.items ?? []).filter((entry) => entry?.text && !entry.spoiler).map((entry) => cleanText(entry.text)).slice(0, 8),
    awards: {
      wins: awardItems.filter((entry) => entry?.win).length,
      nominations: awardItems.filter((entry) => !entry?.win).length,
      notable: awardItems.slice(0, 4).map((entry) => cleanText(`${entry.year ? `${entry.year} · ` : ''}${entry.name || ''}${entry.nominationName ? ` — ${entry.nominationName}` : ''}`)).filter(Boolean),
    },
    topRank: rank ?? null, allowedInGame: false, contentStatus: 'review',
    dataQuality: { source: ['kinopoisk_api_unofficial', 'kinopoisk_api_staff', 'kinopoisk_api_facts', 'kinopoisk_api_awards'], verified: true, missingFields: [] },
  }
  const movie = sanitizeMovieRecord(raw)
  movie.dataQuality.missingFields = ['year', 'countries', 'genres', 'directors', 'cast'].filter((field) => !movie[field] || (Array.isArray(movie[field]) && !movie[field].length))
  return movie
}

export const movieAdapter = {
  discoveryRequiresAi: false,

  loadItems(root, source) {
    const sourcePath = source ? path.resolve(root, source) : path.join(root, 'public', 'data', 'libraries', 'movies', 'items.json')
    const parsed = readJson(sourcePath)
    const rawItems = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : []
    const items = rawItems.map(normalizeInput).filter(Boolean)
    return { items, sourcePath, scope: source ? scopeName(sourcePath) : 'production' }
  },

  entityKey(item) { return `kp-${item.kinopoiskId}` },
  fingerprintInput(item) { return { kinopoiskId: item.kinopoiskId, hint: item.hint ?? null } },

  async process({ queueItem, options, aiReviewAllowed }) {
    const kinopoiskId = queueItem.item.kinopoiskId
    const [details, staff, factsResponse, awardsResponse] = await Promise.all([
      requestKinopoisk(`/api/v2.2/films/${kinopoiskId}`),
      requestKinopoisk(`/api/v1/staff?filmId=${kinopoiskId}`),
      requestKinopoisk(`/api/v2.2/films/${kinopoiskId}/facts`).catch(() => ({ items: [] })),
      requestKinopoisk(`/api/v2.2/films/${kinopoiskId}/awards`).catch(() => ({ items: [] })),
    ])
    const type = String(details?.type ?? '').toUpperCase()
    const hardFailure = details?.serial === true || (type && !MOVIE_TYPES.has(type))
    const movie = buildMovie({ kinopoiskId, details, staff, factsResponse, awardsResponse, rank: queueItem.item.rank })
    const audit = auditMovieRecord(movie)
    const reviewReasons = [
      ...(hardFailure ? ['not_a_movie'] : []),
      ...movie.dataQuality.missingFields.map((field) => `missing_${field}`),
      ...(audit.risky ? ['hint_answer_leak_risk'] : []),
    ]
    const assessment = { accepted: !hardFailure && movie.dataQuality.missingFields.length === 0 && !audit.risky, hardFailure, reviewReasons, audit }
    let aiReview = null; let aiError = null
    if (options.ai !== 'never' && aiReviewAllowed && !hardFailure) {
      try { aiReview = await callAiReviewer({ movie, evidence: { facts: factsResponse?.items, awards: awardsResponse?.items }, options }) }
      catch (error) { aiError = error instanceof Error ? error.message : String(error) }
    }
    const fallbackHint = { text: movie.plotHint, sourceUrls: [`${API_BASE}/api/v2.2/films/${kinopoiskId}`] }
    const selectedHint = aiReview?.hint ?? fallbackHint
    const hintValidation = validateMovieHint(selectedHint, movie)
    if (hintValidation.valid) movie.plotHint = hintValidation.text
    const accepted = assessment.accepted && aiReview?.decision === 'accept' && hintValidation.valid
    const rejected = hardFailure || aiReview?.decision === 'reject'
    return {
      status: accepted ? 'completed' : rejected ? 'failed' : 'review', usedAi: Boolean(aiReview),
      output: {
        schemaVersion: 1, domain: 'movie', entityKey: queueItem.key, inputFingerprint: queueItem.fingerprint,
        enrichedAt: new Date().toISOString(), disposition: rejected ? 'rejected' : accepted ? 'accepted' : 'manual_review',
        assessment, aiReview, aiError, hintValidation, record: movie,
      },
    }
  },

  async discover({ items, outputPath, count }) {
    const existing = new Set(items.map((item) => item.kinopoiskId))
    const saved = fs.existsSync(outputPath) ? readJson(outputPath) : []
    const candidates = Array.isArray(saved) ? saved : []
    for (const item of candidates) existing.add(Number(item.kinopoiskId))
    const additions = []
    for (let page = 1; page <= 5 && additions.length < count; page += 1) {
      const collection = await requestKinopoisk(`/api/v2.2/films/collections?type=TOP_250_MOVIES&page=${page}`)
      for (const item of collection?.items ?? []) {
        const kinopoiskId = extractKinopoiskId(item.kinopoiskId)
        if (!kinopoiskId || existing.has(kinopoiskId)) continue
        existing.add(kinopoiskId)
        additions.push({ kinopoiskId, rank: (page - 1) * 20 + additions.length + 1, title: item.nameRu || item.nameOriginal || null, provenance: { source: 'kinopoisk_top_250', sourceUrls: [`https://www.kinopoisk.ru/film/${kinopoiskId}/`] } })
        if (additions.length >= count) break
      }
    }
    if (!additions.length) throw new Error('Kinopoisk discovery returned no new movies')
    writeJsonAtomic(outputPath, [...candidates, ...additions])
    return { added: additions.length, total: candidates.length + additions.length, outputPath, additions }
  },

  buildAggregate(records) {
    const accepted = records.filter((item) => item.disposition === 'accepted')
    return {
      schemaVersion: 1, domain: 'movie', generatedAt: new Date().toISOString(), count: accepted.length,
      reviewCount: records.length - accepted.length, items: accepted.map((item) => item.record),
      decisions: records.map(({ entityKey, disposition, assessment, aiReview, hintValidation }) => ({ entityKey, disposition, assessment, aiReview, hintValidation })),
    }
  },
}

