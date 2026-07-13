import fs from 'node:fs'
import path from 'node:path'
import { readJson, writeJsonAtomic } from '../core.mjs'
import { buildPlotHint, cleanText, titleTokens, titleVariants } from '../../shared/plot-hint.mjs'
import { openAiFetch } from '../../shared/openai-fetch.mjs'

const API_BASE = 'https://shikimori.one'
const ALLOWED_KINDS = new Set(['tv', 'movie', 'ova', 'ona', 'special', 'tv_special'])
const KIND_LABELS = { tv: 'TV сериал', movie: 'Фильм', ova: 'OVA', ona: 'ONA', special: 'Спешл', tv_special: 'TV спешл' }
const STATUS_LABELS = { anons: 'Анонс', ongoing: 'Онгоинг', released: 'Вышло' }
const SOURCE_LABELS = { original: 'Оригинал', manga: 'Манга', novel: 'Роман', light_novel: 'Ранобэ', visual_novel: 'Визуальная новелла', game: 'Игра', web_manga: 'Веб-манга', card_game: 'Карточная игра', radio: 'Радио', music: 'Музыка', other: 'Другое', unknown: 'Неизвестно' }
const AGE_LABELS = { none: null, g: 'G', pg: 'PG', pg_13: 'PG-13', r: 'R', r_plus: 'R+', rx: 'Rx' }

const userAgent = () => String(process.env.SHIKIMORI_USER_AGENT || process.env.SHIKIMORI_APP_NAME || '').trim()
let lastRequestAt = 0
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const requestShikimori = async (endpoint) => {
  const agent = userAgent()
  if (!agent) throw new Error('SHIKIMORI_USER_AGENT is required')
  let lastError = null
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const elapsed = Date.now() - lastRequestAt
    if (elapsed < 350) await wait(350 - elapsed)
    const token = String(process.env.SHIKIMORI_ACCESS_TOKEN ?? '').trim()
    const response = await fetch(`${API_BASE}${endpoint}`, {
      headers: { 'User-Agent': agent, Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
    lastRequestAt = Date.now()
    if (response.ok) return response.json()
    const body = await response.text().catch(() => '')
    lastError = new Error(`Shikimori HTTP ${response.status}: ${body.slice(0, 180)}`)
    if (response.status !== 429 && response.status < 500) throw lastError
    const retryAfter = Number(response.headers.get('retry-after'))
    await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1_000 : Math.min(8_000, (attempt + 1) * 1_000))
  }
  throw lastError ?? new Error(`Shikimori request failed: ${endpoint}`)
}

const unique = (values) => [...new Set(values.map((value) => cleanText(value)).filter(Boolean))]
const integer = (value) => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null
const numberOrNull = (value) => value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null
const yearOf = (value) => Number(String(value ?? '').match(/\b(19\d{2}|20\d{2})\b/)?.[1]) || null
const absoluteUrl = (value) => {
  const text = cleanText(value)
  return !text ? null : /^https?:\/\//i.test(text) ? text : `${API_BASE}${text.startsWith('/') ? text : `/${text}`}`
}
const stripMarkup = (value) => cleanText(String(value ?? '').replace(/\[\[([^\[\]]+)\]\]/g, '$1').replace(/\[\/?[a-z_]+(?:=[^\]]+)?\]/gi, ' ').replace(/<[^>]+>/g, ' '))

const extractShikimoriId = (value) => {
  const direct = integer(value)
  if (direct) return direct
  const match = String(value ?? '').match(/(?:shikimori\.(?:one|io)\/(?:animes?|anime)\/|shiki[_:-]?)(\d+)/i)
  return match ? Number(match[1]) : null
}

const normalizeInput = (entry) => {
  const object = entry && typeof entry === 'object' ? entry : { shikimoriId: entry }
  const shikimoriId = extractShikimoriId(object.shikimoriId ?? object.id ?? object.url)
  return shikimoriId ? { ...object, shikimoriId } : null
}

const scopeName = (sourcePath) => path.basename(sourcePath, path.extname(sourcePath)).toLowerCase()
  .replace(/[^a-z0-9а-яё]+/gi, '-').replace(/^-|-$/g, '') || 'custom'

const person = (value) => ({
  nameRu: cleanText(value?.russian || value?.name),
  nameOriginal: cleanText(value?.name || value?.russian),
  photoUrl: absoluteUrl(value?.image?.x96 || value?.image?.original || value?.image?.preview),
})

const parseRoles = (roles) => {
  const creators = []; const cast = []; const characterNames = []
  for (const role of Array.isArray(roles) ? roles : []) {
    const labels = [...(role?.roles ?? []), ...(role?.roles_russian ?? [])].join(' ').toLowerCase()
    if (role?.character) characterNames.push(role.character.russian || role.character.name)
    if (!role?.person) continue
    if (/director|режисс|creator|создател|author|автор|screenplay|сценар|series composition|композици/i.test(labels)) creators.push(person(role.person))
    if (/seiyuu|voice|actor|акт[её]р|озвуч/i.test(labels)) cast.push(person(role.person))
  }
  const dedupe = (items, limit) => [...new Map(items.filter((item) => item.nameRu || item.nameOriginal).map((item) => [`${item.nameRu}|${item.nameOriginal}`, item])).values()].slice(0, limit)
  return { creators: dedupe(creators, 4), cast: dedupe(cast, 8), characterNames: unique(characterNames) }
}

const forbiddenValues = (anime, characterNames = []) => unique([
  anime.titleRu, anime.titleOriginal, ...(anime.alternativeTitles ?? []), ...characterNames,
  ...(anime.creators ?? anime.directors ?? []).flatMap((entry) => [entry.nameRu, entry.nameOriginal]),
  ...(anime.cast ?? []).flatMap((entry) => [entry.nameRu, entry.nameOriginal]),
]).flatMap((value) => [value, ...titleVariants(value), ...titleTokens(value)]).map((value) => cleanText(value).toLowerCase()).filter((value) => value.length >= 3)

export const validateAnimeHint = (hint, anime, characterNames = []) => {
  const text = cleanText(hint?.text)
  const normalized = text.toLowerCase().replace(/ё/g, 'е')
  const forbiddenMatches = forbiddenValues(anime, characterNames).filter((value) => normalized.includes(value.replace(/ё/g, 'е')))
  const errors = [
    text.length < 40 ? 'hint_too_short' : null,
    text.length > 280 ? 'hint_too_long' : null,
    !/[а-яё]/i.test(text) ? 'hint_not_russian' : null,
    forbiddenMatches.length ? 'hint_contains_answer_character_or_actor' : null,
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

const callAiReviewer = async ({ anime, options }) => {
  const apiKey = process.env[options.apiKeyEnv]
  if (!apiKey) throw new Error(`${options.apiKeyEnv} is not configured`)
  const prompt = [
    'Ты фактчекер каталога аниме и автор подсказок для русской игры-угадайки.',
    'Проверь идентичность тайтла, формат, студию, первоисточник и ключевой факт по надёжным источникам.',
    'Создай одну русскую подсказку длиной 40-280 символов. Не называй тайтл, франшизу, персонажей, сэйю или варианты названия.',
    'Верни только JSON: {"decision":"accept|review|reject","confidence":0..1,"reasons":[],"hint":{"text":"...","confidence":0..1,"sourceUrls":["https://..."]}}.',
    'Не выдумывай факты; при конфликте выбери review или reject.',
    JSON.stringify(anime),
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
          name: 'anime_reviewer_response',
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
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(request),
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

const buildAnime = ({ id, details, roles, rank }) => {
  const roleData = parseRoles(roles)
  const titleRu = cleanText(details?.russian || details?.name || `Anime #${id}`)
  const titleOriginal = cleanText(details?.name || details?.russian)
  const alternativeTitles = unique([...(details?.synonyms ?? []), ...(details?.english ?? []), ...(details?.japanese ?? [])]).filter((value) => value !== titleRu && value !== titleOriginal)
  const genres = unique((details?.genres ?? []).map((entry) => entry?.russian || entry?.name)).slice(0, 8)
  const studios = unique((details?.studios ?? []).map((entry) => entry?.name || entry?.filtered_name)).slice(0, 5)
  const description = stripMarkup(details?.description)
  const fallbackHint = buildPlotHint({ title: titleRu || titleOriginal, text: description, maxLength: 260 })
  const kindCode = cleanText(details?.kind).toLowerCase(); const statusCode = cleanText(details?.status).toLowerCase(); const sourceCode = cleanText(details?.source).toLowerCase()
  const episodes = integer(details?.episodes); const aired = integer(details?.episodes_aired)
  const anime = {
    id: `shiki_${id}`, mode: 'anime', titleRu, titleOriginal, alternativeTitles,
    year: yearOf(details?.aired_on), endYear: yearOf(details?.released_on), releaseDate: cleanText(details?.aired_on) || null,
    countries: ['Япония'], originalLanguage: 'ja', genres, ageRating: AGE_LABELS[cleanText(details?.rating).toLowerCase()] ?? null,
    runtimeMinutes: integer(details?.duration), episodes, directors: roleData.creators, cast: roleData.cast, studios,
    ratings: { recognizability: numberOrNull(details?.score) }, votes: {},
    popularityScore: Math.max(1, Math.round(101 - (rank ?? 100) * .25)),
    posterUrl: absoluteUrl(details?.image?.original || details?.image?.preview), headerUrl: null,
    backdropUrl: absoluteUrl(details?.image?.original || details?.image?.preview), screenshots: [],
    description: description || null, shortDescription: fallbackHint || null, plotHint: fallbackHint || null, slogan: null,
    facts: [details?.season ? `Сезон: ${cleanText(details.season)}` : null].filter(Boolean), awards: null, topRank: rank ?? null,
    seriesStatus: STATUS_LABELS[statusCode] ?? statusCode ?? null, seasonsCount: null,
    animeKind: KIND_LABELS[kindCode] ?? kindCode ?? null, animeKindCode: kindCode || null,
    animeStatus: STATUS_LABELS[statusCode] ?? statusCode ?? null, animeStatusCode: statusCode || null,
    animeEpisodesAired: aired && aired !== episodes ? aired : null,
    animeSource: SOURCE_LABELS[sourceCode] ?? sourceCode ?? null, animeSourceCode: sourceCode || null,
    shikimoriId: id, shikimoriScore: numberOrNull(details?.score), shikimoriUrl: absoluteUrl(details?.url || `/animes/${id}`),
    allowedInGame: false, contentStatus: 'review',
    dataQuality: { source: ['shikimori_api_v1', 'shikimori_roles'], verified: true, missingFields: [] },
  }
  anime.dataQuality.missingFields = ['description', 'plotHint', 'posterUrl', 'studios', 'cast'].filter((field) => !anime[field] || (Array.isArray(anime[field]) && !anime[field].length))
  return { anime, characterNames: roleData.characterNames, kindCode, ratingCode: cleanText(details?.rating).toLowerCase() }
}

export const animeAdapter = {
  discoveryRequiresAi: false,

  loadItems(root, source) {
    const sourcePath = source ? path.resolve(root, source) : path.join(root, 'public', 'data', 'libraries', 'animes', 'items.json')
    const parsed = readJson(sourcePath)
    const rawItems = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : []
    return { items: rawItems.map(normalizeInput).filter(Boolean), sourcePath, scope: source ? scopeName(sourcePath) : 'production' }
  },

  entityKey(item) { return `shiki-${item.shikimoriId}` },
  fingerprintInput(item) { return { shikimoriId: item.shikimoriId, hint: item.hint ?? null } },

  async process({ queueItem, options, aiReviewAllowed }) {
    const id = queueItem.item.shikimoriId
    const [details, roles] = await Promise.all([requestShikimori(`/api/animes/${id}`), requestShikimori(`/api/animes/${id}/roles`).catch(() => [])])
    const built = buildAnime({ id, details, roles, rank: queueItem.item.rank })
    const hardFailure = built.ratingCode === 'rx' || !ALLOWED_KINDS.has(built.kindCode)
    const reviewReasons = [...(hardFailure ? ['unsupported_or_nsfw_kind'] : []), ...built.anime.dataQuality.missingFields.map((field) => `missing_${field}`)]
    const assessment = { accepted: !hardFailure && built.anime.dataQuality.missingFields.length <= 1, hardFailure, reviewReasons }
    let aiReview = null; let aiError = null
    if (options.ai !== 'never' && aiReviewAllowed && !hardFailure) {
      try { aiReview = await callAiReviewer({ anime: built.anime, options }) }
      catch (error) { aiError = error instanceof Error ? error.message : String(error) }
    }
    const selectedHint = aiReview?.hint ?? { text: built.anime.plotHint, sourceUrls: [built.anime.shikimoriUrl] }
    const hintValidation = validateAnimeHint(selectedHint, built.anime, built.characterNames)
    if (hintValidation.valid) built.anime.plotHint = hintValidation.text
    const accepted = assessment.accepted && aiReview?.decision === 'accept' && hintValidation.valid
    const rejected = hardFailure || aiReview?.decision === 'reject'
    return {
      status: accepted ? 'completed' : rejected ? 'failed' : 'review', usedAi: Boolean(aiReview),
      output: {
        schemaVersion: 1, domain: 'anime', entityKey: queueItem.key, inputFingerprint: queueItem.fingerprint,
        enrichedAt: new Date().toISOString(), disposition: rejected ? 'rejected' : accepted ? 'accepted' : 'manual_review',
        assessment, aiReview, aiError, hintValidation, record: built.anime,
      },
    }
  },

  async discover({ items, outputPath, count }) {
    const known = new Set(items.map((item) => item.shikimoriId))
    const saved = fs.existsSync(outputPath) ? readJson(outputPath) : []
    const candidates = Array.isArray(saved) ? saved : []
    for (const item of candidates) known.add(Number(item.shikimoriId))
    const additions = []
    for (let page = 1; page <= 60 && additions.length < count; page += 1) {
      const params = new URLSearchParams({ order: 'popularity', limit: '50', page: String(page), censored: 'true' })
      const chunk = await requestShikimori(`/api/animes?${params}`)
      if (!Array.isArray(chunk) || !chunk.length) break
      for (const item of chunk) {
        const shikimoriId = integer(item?.id); const kind = cleanText(item?.kind).toLowerCase()
        if (!shikimoriId || known.has(shikimoriId) || (kind && !ALLOWED_KINDS.has(kind))) continue
        known.add(shikimoriId)
        additions.push({ shikimoriId, rank: (page - 1) * 50 + chunk.indexOf(item) + 1, title: item.russian || item.name || null, provenance: { source: 'shikimori_popularity', sourceUrls: [absoluteUrl(item.url || `/animes/${shikimoriId}`)] } })
        if (additions.length >= count) break
      }
    }
    if (!additions.length) throw new Error('Shikimori discovery returned no new anime')
    writeJsonAtomic(outputPath, [...candidates, ...additions])
    return { added: additions.length, total: candidates.length + additions.length, outputPath, additions }
  },

  buildAggregate(records) {
    const accepted = records.filter((item) => item.disposition === 'accepted')
    return {
      schemaVersion: 1, domain: 'anime', generatedAt: new Date().toISOString(), count: accepted.length,
      reviewCount: records.length - accepted.length, items: accepted.map((item) => item.record),
      decisions: records.map(({ entityKey, disposition, assessment, aiReview, hintValidation }) => ({ entityKey, disposition, assessment, aiReview, hintValidation })),
    }
  },
}
