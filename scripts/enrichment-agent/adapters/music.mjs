import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { readJson, writeJsonAtomic } from '../core.mjs'
import { isNonArtistType, namesReferToSameArtist } from '../../music/artist-identity.mjs'
import { openAiFetch } from '../../shared/openai-fetch.mjs'
import { createOpenAiWebSearchTool, isOpenAiWebSearchRegionalError } from '../../shared/openai-web-search.mjs'

const normalizeKeyPart = (value) => String(value ?? '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9а-яё]+/gi, '-')
  .replace(/^-|-$/g, '')

const primaryValue = (field) => field?.primaryValue
const hasValue = (value) => value !== null
  && value !== undefined
  && value !== ''
  && (!Array.isArray(value) || value.length > 0)

const compactEvidence = (record) => ({
  artist: record?.input?.artist,
  sourceStatus: record?.pipeline?.sourceStatus,
  fields: Object.fromEntries([
    'canonicalName', 'displayNameRu', 'displayNameEn', 'artistType', 'country', 'city',
    'beginYear', 'endYear', 'isActive', 'genres', 'topTracks', 'topAlbums', 'members',
    'popularityMetrics', 'matchConfidence', 'biography',
  ].map((field) => [field, record?.[field]]).filter(([, value]) => value !== undefined)),
  reviewReasons: record?.manualReviewReason ?? [],
})

const runtimeItemToSeed = (item) => ({
  artist: String(item?.titleOriginal || item?.titleRu || '').trim(),
  rank: item?.topRank ?? null,
  topTrack: item?.topTracks?.[0]?.title ?? item?.slogan ?? null,
  alternative_names: [item?.titleRu, ...(item?.alternativeTitles ?? [])].filter(Boolean),
  type: item?.musicType ?? null,
  country: item?.countries?.[0] ?? null,
  debutYear: item?.year ?? null,
  topAlbum: item?.topAlbums?.[0]?.title ?? null,
  genres: Array.isArray(item?.genres) ? item.genres : [],
  similarArtists: Array.isArray(item?.similarArtists) ? item.similarArtists : [],
  _entityKey: String(item?.id ?? '').replace(/^music:/, ''),
  _runtimeId: item?.id ?? null,
})

const normalizeText = (value) => String(value ?? '')
  .normalize('NFKC')
  .toLowerCase()
  .replace(/ё/g, 'е')
  .replace(/[^a-zа-я0-9]+/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const hintWordPattern = (word) => {
  if (/^[а-яё]{5,}$/u.test(word) && /[аяоеийь]$/u.test(word)) {
    return `${escapeRegex(word.slice(0, -1))}[а-яё]*`
  }
  return escapeRegex(word)
}
const hintPhrasePattern = (phrase, separator) => phrase.split(' ').map(hintWordPattern).join(separator)

const hintForbiddenPhrases = (record) => {
  const fieldValues = [
    record?.input?.artist,
    primaryValue(record?.canonicalName),
    primaryValue(record?.displayNameRu),
    primaryValue(record?.displayNameEn),
    ...((primaryValue(record?.aliases) ?? []).map?.((item) => String(item)) ?? []),
    ...((primaryValue(record?.topTracks) ?? []).map?.((item) => item?.title) ?? []),
    ...((primaryValue(record?.topAlbums) ?? []).map?.((item) => item?.title) ?? []),
  ]
  return [...new Set(fieldValues.map(normalizeText).filter((value) => value.length >= 3))]
}

export const validateMusicHint = (hint, record) => {
  const text = String(hint?.text ?? '').replace(/\s+/g, ' ').trim()
  const normalized = normalizeText(text)
  const forbiddenMatches = hintForbiddenPhrases(record).filter((phrase) => new RegExp(
    `(?:^|\\s)${hintPhrasePattern(phrase, '\\s+')}(?=\\s|$)`,
    'iu',
  ).test(normalized))
  const errors = [
    text.length < 80 ? 'hint_too_short' : null,
    text.length > 280 ? 'hint_too_long' : null,
    !/[а-яё]/i.test(text) ? 'hint_not_russian' : null,
    forbiddenMatches.length ? 'hint_contains_answer_or_title' : null,
    !Array.isArray(hint?.sourceUrls) || hint.sourceUrls.length === 0 ? 'hint_has_no_sources' : null,
  ].filter(Boolean)
  return { valid: errors.length === 0, text, errors, forbiddenMatches }
}

const extractResponseText = (payload) => {
  if (typeof payload?.output_text === 'string') return payload.output_text
  return (payload?.output ?? [])
    .flatMap((item) => item?.content ?? [])
    .map((content) => content?.text ?? content?.output_text ?? '')
    .filter(Boolean)
    .join('\n')
}

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

const countWebSearchCalls = (payload) => (payload?.output ?? []).filter((item) => item?.type === 'web_search_call').length

const callAiReviewer = async ({ record, options }) => {
  const apiKey = process.env[options.apiKeyEnv]
  if (!apiKey) throw new Error(`${options.apiKeyEnv} is not configured`)

  const prompt = [
    'You are a music research and fact-checking agent for a Russian guessing game.',
    'Use web search to verify identity and find one distinctive, well-sourced biographical or career fact.',
    'Judge whether the normalized artist identity is safe to accept based on the supplied evidence and research.',
    'Conflicts in identity, artist type, country, start year, or implausible top tracks require review.',
    'Generate one Russian hint of 80-280 characters. It must not contain the artist name, aliases, member names, track titles, album titles, or direct wordplay on the answer.',
    'The hint must describe a verified distinctive fact, not generic genres or popularity.',
    'Return JSON only: {"decision":"accept|review|reject","confidence":0..1,"reasons":[...],"resolved":{},"hint":{"text":"...","confidence":0..1,"sourceUrls":["https://..."]}}.',
    'Do not invent missing facts. Put only strongly supported corrections into resolved.',
    JSON.stringify(compactEvidence(record)),
  ].join('\n\n')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.aiTimeoutMs)
  try {
    const request = {
      model: options.model,
      input: prompt,
      reasoning: { effort: 'low' },
      max_output_tokens: 2400,
      text: {
        format: {
          type: 'json_schema',
          name: 'music_reviewer_response',
          strict: false,
          schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              decision: { type: 'string', enum: ['accept', 'review', 'reject'] },
              confidence: { type: 'number' },
              reasons: { type: 'array', items: { type: 'string' } },
              resolved: { type: 'object', additionalProperties: true },
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
    const requestResponse = async (cacheOnly = false) => {
      const response = await openAiFetch(`${options.apiBaseUrl}/responses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...request, ...(options.aiWebSearch ? { tools: [createOpenAiWebSearchTool({ cacheOnly })] } : {}) }),
        signal: controller.signal,
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error?.message || `OpenAI HTTP ${response.status}`)
      return payload
    }
    const payload = await requestResponse().catch(async (error) => {
      if (!options.aiWebSearch || !isOpenAiWebSearchRegionalError(error)) throw error
      return requestResponse(true)
    })
    const responseText = extractResponseText(payload)
    if (!String(responseText).trim()) {
      const incompleteReason = payload?.incomplete_details?.reason
      throw new Error(incompleteReason ? `OpenAI response incomplete: ${incompleteReason}` : `OpenAI returned no text output (status: ${payload?.status ?? 'unknown'})`)
    }
    const review = parseJsonResponse(responseText)
    if (!['accept', 'review', 'reject'].includes(review?.decision)) {
      throw new Error('AI reviewer returned an invalid decision')
    }
    return {
      ...review,
      model: options.model,
      reviewedAt: new Date().toISOString(),
      usage: payload?.usage ?? null,
      webSearchCalls: countWebSearchCalls(payload),
      responseId: payload?.id ?? null,
    }
  } finally {
    clearTimeout(timeout)
  }
}

export const assessMusicRecord = (record, confidenceThreshold) => {
  const statuses = Object.values(record?.pipeline?.sourceStatus ?? {})
  const okSources = statuses.filter((status) => status === 'ok').length
  const confidence = Number(primaryValue(record?.matchConfidence))
  const reviewReasons = Array.isArray(record?.manualReviewReason) ? record.manualReviewReason : []
  const canonical = primaryValue(record?.canonicalName)
  const inputArtist = record?.input?.artist
  const artistTypes = Array.isArray(primaryValue(record?.artistType)) ? primaryValue(record?.artistType) : [primaryValue(record?.artistType)]
  const identityConflict = !namesReferToSameArtist(inputArtist, canonical)
    || artistTypes.some(isNonArtistType)
    || reviewReasons.includes('canonical_name_missing')
  const requiredFieldsPresent = hasValue(primaryValue(record?.canonicalName))
    && hasValue(primaryValue(record?.topTracks))

  const accepted = okSources >= 2
    && requiredFieldsPresent
    && !identityConflict
    && (!Number.isFinite(confidence) || confidence >= confidenceThreshold)

  return {
    accepted,
    okSources,
    confidence: Number.isFinite(confidence) ? confidence : null,
    requiredFieldsPresent,
    identityConflict,
    reviewReasons,
    hardFailure: identityConflict || okSources < 2 || !requiredFieldsPresent,
  }
}

const evidenceUrls = (record) => {
  const field = record?.officialLinks
  const values = [primaryValue(field), ...(field?.sourceEvidence ?? []).map((entry) => entry?.value)]
  const urls = values.flatMap((value) => Array.isArray(value) ? value : [])
    .map((entry) => typeof entry === 'string' ? entry : entry?.url)
    .filter((url) => /^https:\/\//i.test(String(url)))
  return [...new Set(urls)].sort((left, right) => Number(/wikipedia\.org/i.test(right)) - Number(/wikipedia\.org/i.test(left)))
}

export const buildFallbackMusicHint = (record) => {
  let text = String(primaryValue(record?.biography) ?? '').normalize('NFKD').replace(/\u0301/g, '').normalize('NFC').replace(/\s+/g, ' ').trim()
  if (!text) return null
  const forbidden = hintForbiddenPhrases(record)
  for (const phrase of forbidden) {
    const pattern = hintPhrasePattern(phrase, '[\\s\\p{P}\\p{S}]*')
    text = text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, 'giu'), '')
  }
  text = text
    .replace(/[«“"']\s*[»”"']/g, '')
    .replace(/^[\s,.;:—–-]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
  text = text ? `${text[0].toUpperCase()}${text.slice(1)}` : text
  if (text.length > 280) {
    const cut = text.slice(0, 280)
    text = cut.slice(0, Math.max(cut.lastIndexOf('. ') + 1, cut.lastIndexOf(', '), cut.lastIndexOf(' '))).trim()
  }
  const hint = { text, confidence: 0.7, sourceUrls: evidenceUrls(record).slice(0, 3) }
  return validateMusicHint(hint, record).valid ? hint : null
}

export const musicAdapter = {
  domain: 'music',
  sourcePath: 'public/data/libraries/music/items.json',

  loadItems(root, sourceOverride) {
    const sourcePath = path.resolve(root, sourceOverride || this.sourcePath)
    const sourceItems = readJson(sourcePath)
    if (!Array.isArray(sourceItems)) throw new Error('Music source must contain a JSON array')
    const runtimeSource = sourceItems.some((item) => String(item?.id ?? '').startsWith('music:'))
    const items = runtimeSource ? sourceItems.map(runtimeItemToSeed) : sourceItems
    const sourceName = normalizeKeyPart(path.relative(root, sourcePath)).slice(0, 60) || 'custom'
    return { items, sourcePath, scope: runtimeSource ? 'production' : `candidates-${sourceName}` }
  },

  entityKey(item, index) {
    if (item?._entityKey) return item._entityKey
    const rank = Number.parseInt(String(item?.rank), 10)
    const prefix = Number.isFinite(rank) ? String(rank).padStart(4, '0') : String(index + 1).padStart(4, '0')
    return `${prefix}_${normalizeKeyPart(item?.artist) || 'artist'}`
  },

  fingerprintInput(item) {
    const { _runtimeId, ...input } = item
    return input
  },

  bootstrap({ root, items, state, recordsDir, persist, sha256 }) {
    if (Object.keys(state.entities).length > 0) return { accepted: 0, review: 0 }

    const sourceMetaPath = path.join(root, 'public', 'data', 'source.json')
    const runtimeItemsPath = path.join(root, 'public', 'data', 'libraries', 'music', 'items.json')
    if (!fs.existsSync(sourceMetaPath) || !fs.existsSync(runtimeItemsPath)) return { accepted: 0, review: 0 }

    const sourceMeta = readJson(sourceMetaPath)
    const baselineRelative = String(sourceMeta?.musicSource ?? '').trim()
    const baselinePath = baselineRelative ? path.resolve(root, baselineRelative) : null
    if (!baselinePath || !fs.existsSync(baselinePath)) return { accepted: 0, review: 0 }

    const baselinePayload = readJson(baselinePath)
    const baselineRecords = Array.isArray(baselinePayload?.items) ? baselinePayload.items : []
    const runtimeItems = readJson(runtimeItemsPath)
    const runtimeIds = new Set((Array.isArray(runtimeItems) ? runtimeItems : [])
      .map((item) => String(item?.id ?? '').trim())
      .filter(Boolean))
    const itemByRuntimeId = new Map(items.map((item, index) => [String(item?._runtimeId ?? ''), { item, index }]))
    const itemByRank = new Map(items.map((item, index) => [Number.parseInt(String(item?.rank), 10), { item, index }]))
    const itemByName = new Map(items.map((item, index) => [normalizeKeyPart(item?.artist), { item, index }]))
    const imported = { accepted: 0, review: 0 }

    for (const record of baselineRecords) {
      const rank = Number.parseInt(String(record?.input?.rank), 10)
      const position = Number.parseInt(String(record?.input?.position), 10)
      const recordName = normalizeKeyPart(record?.input?.artist)
      const positionCandidate = Number.isFinite(position) ? { item: items[position - 1], index: position - 1 } : null
      const rankCandidate = itemByRank.get(rank)
      const runtimeCandidate = itemByRuntimeId.get(`music:${record?.artistKey}`)
      const sourceItem = runtimeCandidate
        ?? (positionCandidate?.item && normalizeKeyPart(positionCandidate.item?.artist) === recordName
        ? positionCandidate
        : rankCandidate?.item && normalizeKeyPart(rankCandidate.item?.artist) === recordName
          ? rankCandidate
          : itemByName.get(recordName))
      if (!sourceItem) continue
      const key = this.entityKey(sourceItem.item, sourceItem.index)
      const assessment = assessMusicRecord(record, 0.75)
      const accepted = runtimeIds.has(`music:${record?.artistKey}`)
      const status = accepted ? 'completed' : 'review'
      const output = {
        schemaVersion: 1,
        domain: 'music',
        entityKey: key,
        inputFingerprint: null,
        enrichedAt: record?.pipeline?.fetchedAt ?? baselinePayload?.generatedAt ?? new Date().toISOString(),
        disposition: accepted ? 'accepted' : 'manual_review',
        assessment,
        aiReview: null,
        aiError: null,
        record,
        baseline: true,
      }
      const outputPath = path.join(recordsDir, `${key}.json`)
      const inputFingerprint = sha256(this.fingerprintInput(sourceItem.item))
      output.inputFingerprint = inputFingerprint
      state.entities[key] = {
        key,
        inputFingerprint,
        status,
        attempts: 0,
        completedAt: output.enrichedAt,
        output: path.relative(root, outputPath).replace(/\\/g, '/'),
        baseline: true,
      }
      imported[accepted ? 'accepted' : 'review'] += 1
      if (persist) writeJsonAtomic(outputPath, output)
    }

    return imported
  },

  async process({ root, queueItem, runId, workDir, options, aiReviewAllowed }) {
    const inputPath = path.join(workDir, `${queueItem.key}.input.json`)
    writeJsonAtomic(inputPath, [queueItem.item])
    const runTag = `agent-${runId}-${queueItem.key}`
    const command = spawnSync(process.execPath, [
      'scripts/music/enrich-artists.mjs',
      `--input=${inputPath}`,
      '--limit=1',
      `--run-tag=${runTag}`,
    ], {
      cwd: root,
      encoding: 'utf8',
      env: process.env,
    })

    if (command.status !== 0) {
      throw new Error(command.stderr?.trim() || command.stdout?.trim() || `Music enricher exited with ${command.status}`)
    }

    const normalizedPath = path.join(root, 'data', 'music', 'normalized', `music_artists_enriched_${runTag}.json`)
    const normalized = readJson(normalizedPath)
    const record = normalized?.items?.[0]
    if (!record) throw new Error('Music enricher produced no normalized record')

    const assessment = assessMusicRecord(record, options.confidenceThreshold)
    const shouldUseAi = options.ai !== 'never'
    let aiReview = null
    let aiError = null

    if (shouldUseAi && aiReviewAllowed) {
      try {
        aiReview = await callAiReviewer({ record, options })
      } catch (error) {
        aiError = error instanceof Error ? error.message : String(error)
      }
    }

    const fallbackHint = !assessment.hardFailure ? buildFallbackMusicHint(record) : null
    const selectedHint = aiReview?.hint ?? fallbackHint
    const hintValidation = validateMusicHint(selectedHint, record)
    if (hintValidation.valid) {
      record.agentHint = {
        text: hintValidation.text,
        confidence: Number(selectedHint?.confidence) || null,
        sourceUrls: selectedHint.sourceUrls,
        generatedAt: aiReview?.reviewedAt ?? new Date().toISOString(),
        model: aiReview?.model ?? 'deterministic-biography-fallback',
      }
    }

    const accepted = aiReview?.decision === 'accept'
      && assessment.accepted
      && hintValidation.valid
    const rejected = assessment.hardFailure || aiReview?.decision === 'reject'

    return {
      status: accepted ? 'completed' : rejected ? 'failed' : 'review',
      usedAi: Boolean(aiReview),
      output: {
        schemaVersion: 1,
        domain: 'music',
        entityKey: queueItem.key,
        inputFingerprint: queueItem.fingerprint,
        enrichedAt: new Date().toISOString(),
        disposition: rejected ? 'rejected' : accepted ? 'accepted' : 'manual_review',
        assessment,
        aiReview,
        aiError,
        hintValidation,
        record,
      },
    }
  },

  async discover({ items, options, outputPath, count }) {
    const apiKey = process.env[options.apiKeyEnv]
    if (!apiKey) throw new Error(`${options.apiKeyEnv} is required for artist discovery`)

    const existingCandidates = fs.existsSync(outputPath) ? readJson(outputPath) : []
    const candidates = Array.isArray(existingCandidates) ? existingCandidates : []
    const knownNames = new Set([
      ...items.flatMap((item) => [item?.artist, ...(item?.alternative_names ?? [])]),
      ...candidates.flatMap((item) => [item?.artist, ...(item?.alternative_names ?? [])]),
    ].map(normalizeText).filter(Boolean))
    const prompt = [
      'You are a music catalog discovery agent.',
      `Find ${count} widely recognizable music artists missing from the supplied catalog.`,
      'Use current web search. Prefer durable popularity evidence: reputable charts, streaming/editorial catalogs, major music databases, or authoritative profiles.',
      'Keep a balanced mix of Russian-language and international artists when evidence supports it.',
      'Do not return tribute acts, duplicate spellings, fictional artists, or artists without at least two source URLs.',
      'Return JSON only: {"candidates":[{"artist":"canonical name","alternative_names":[],"country":null,"reason":"why this belongs in the catalog","sourceUrls":["https://...","https://..."]}]}',
      `Existing names: ${[...knownNames].join(' | ')}`,
    ].join('\n\n')

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options.aiTimeoutMs)
    try {
      const requestResponse = async (cacheOnly = false) => {
        const response = await openAiFetch(`${options.apiBaseUrl}/responses`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: options.model,
            input: prompt,
            reasoning: { effort: 'low' },
            max_output_tokens: 4000,
            tools: [createOpenAiWebSearchTool({ cacheOnly })],
          }),
          signal: controller.signal,
        })
        const payload = await response.json()
        if (!response.ok) throw new Error(payload?.error?.message || `OpenAI HTTP ${response.status}`)
        return payload
      }
      const payload = await requestResponse().catch(async (error) => {
        if (!isOpenAiWebSearchRegionalError(error)) throw error
        return requestResponse(true)
      })
      const parsed = parseJsonResponse(extractResponseText(payload))
      const discoveredAt = new Date().toISOString()
      const additions = []

      for (const candidate of Array.isArray(parsed?.candidates) ? parsed.candidates : []) {
        const artist = String(candidate?.artist ?? '').trim()
        const key = normalizeText(artist)
        const sourceUrls = [...new Set((candidate?.sourceUrls ?? [])
          .map((url) => String(url ?? '').trim())
          .filter((url) => /^https:\/\//i.test(url)))]
        if (!artist || knownNames.has(key) || sourceUrls.length < 2) continue
        knownNames.add(key)
        additions.push({
          artist,
          rank: null,
          alternative_names: Array.isArray(candidate?.alternative_names) ? candidate.alternative_names : [],
          country: candidate?.country ?? null,
          genres: [],
          debutYear: null,
          provenance: {
            discoveredAt,
            model: options.model,
            reason: String(candidate?.reason ?? '').trim(),
            sourceUrls,
            responseId: payload?.id ?? null,
            usage: payload?.usage ?? null,
            webSearchCalls: countWebSearchCalls(payload),
          },
        })
        if (additions.length >= count) break
      }

      if (!additions.length) throw new Error('Discovery returned no new candidates with at least two source URLs')
      writeJsonAtomic(outputPath, [...candidates, ...additions])
      return { added: additions.length, total: candidates.length + additions.length, outputPath, additions }
    } finally {
      clearTimeout(timeout)
    }
  },

  buildAggregate(records) {
    const acceptedRecords = records.filter((item) => item.disposition === 'accepted')
    return {
      schemaVersion: 1,
      domain: 'music',
      generatedAt: new Date().toISOString(),
      count: acceptedRecords.length,
      reviewCount: records.length - acceptedRecords.length,
      items: acceptedRecords.map((item) => item.record),
      decisions: records.map((item) => ({
        entityKey: item.entityKey,
        disposition: item.disposition,
        assessment: item.assessment,
        aiReview: item.aiReview,
        hintValidation: item.hintValidation,
      })),
    }
  },
}
