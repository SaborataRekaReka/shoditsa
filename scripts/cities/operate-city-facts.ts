import { randomUUID } from 'node:crypto'
import { and, asc, eq, sql } from 'drizzle-orm'
import { loadConfig } from '@shoditsa/config'
import {
  contentItemVersions,
  contentRevisions,
  createDatabase,
  pipelineRunItems,
  pipelineRuns,
  playerProfiles,
} from '@shoditsa/database'
import { loadIntegrationEnvironment } from '../../apps/api/src/modules/admin/integration-secrets.js'
import { requestNormalization } from '../../apps/api/src/modules/admin/normalization-pipeline.js'

const ACTIONS = ['prepare', 'source-retry', 'work', 'status', 'retry'] as const
type Action = typeof ACTIONS[number]
type Json = Record<string, unknown>

const action = process.argv[2] as Action | undefined
if (!action || !ACTIONS.includes(action)) throw new Error(`Usage: city-facts <${ACTIONS.join('|')}> [run-id]`)

const config = loadConfig()
const { db, client } = createDatabase(config)
const operation = 'city-facts-wikipedia-nano-v1'
const userAgent = 'Shoditsa/1.0 (https://shoditsa.ru; mailto:breneize@yandex.ru)'
const workerLabel = process.env.CITY_FACT_WORKER_ID?.trim() || `city-fact-${process.pid}`
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const record = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const strings = (value: unknown) => Array.isArray(value) ? value.flatMap((entry) => typeof entry === 'string' ? [entry.trim()] : []).filter(Boolean) : []
const normalize = (value: unknown) => text(value).normalize('NFKD').toLocaleLowerCase('ru-RU')
  .replace(/[\u0300-\u036f]/g, '').replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, ' ').trim()
const safeError = (error: unknown) => (error instanceof Error ? error.message : String(error))
  .replace(/(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]+)/gi, '[redacted]').slice(0, 1_000)

const htmlEntities = (value: string) => value
  .replace(/&#(\d+);/g, (_match, number: string) => String.fromCodePoint(Number(number)))
  .replace(/&#x([0-9a-f]+);/gi, (_match, number: string) => String.fromCodePoint(Number.parseInt(number, 16)))
  .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'").replace(/&ndash;/gi, '–').replace(/&mdash;/gi, '—')
  .replace(/&laquo;/gi, '«').replace(/&raquo;/gi, '»')

const plainText = (html: string) => htmlEntities(html
  .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, ' ')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
  .replace(/<[^>]+>/g, ' '))
  .replace(/\s+/g, ' ').trim()

const wikipediaParagraphs = (html: string) => [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
  .map((match) => plainText(match[1])).filter((paragraph) => paragraph.length >= 80)
  .filter((paragraph) => !/^(?:координаты|источник|основная статья)\b/i.test(paragraph))
  .slice(0, 14)

const fetchJson = async (url: string) => {
  let lastError: unknown = null
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': userAgent }, signal: AbortSignal.timeout(30_000) })
      if (response.ok) return record(await response.json())
      lastError = new Error(`Wikimedia HTTP ${response.status}`)
      if (![429, 500, 502, 503, 504].includes(response.status)) break
      const retryAfterSeconds = Number(response.headers.get('retry-after'))
      const delayMs = response.status === 429
        ? Math.min(60_000, Math.max(5_000, Number.isFinite(retryAfterSeconds) ? retryAfterSeconds * 1_000 : 8_000 * (attempt + 1)))
        : 1_000 * (attempt + 1)
      await sleep(delayMs + Math.floor(Math.random() * 750))
      continue
    } catch (error) { lastError = error }
    await sleep(750 * (attempt + 1))
  }
  throw lastError ?? new Error('Wikimedia request failed')
}

type WikiCandidate = { key: string; title: string; description: string; excerpt: string }
type WikiSource = { language: string; title: string; url: string; revisionId: number | null; license: string; excerpt: string }

const searchWikipedia = async (language: 'ru' | 'en', query: string): Promise<WikiCandidate[]> => {
  const payload = await fetchJson(`https://${language}.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(query)}&limit=6`)
  return (Array.isArray(payload.pages) ? payload.pages : []).map((entry) => record(entry)).flatMap((entry) => {
    const key = text(entry.key); const title = text(entry.title)
    return key && title ? [{ key, title, description: text(entry.description), excerpt: plainText(text(entry.excerpt)) }] : []
  })
}

const candidateScore = (candidate: WikiCandidate, card: Json, language: 'ru' | 'en') => {
  const names = [card.titleRu, card.titleOriginal, ...strings(card.alternativeTitles)].map(normalize).filter(Boolean)
  const title = normalize(candidate.title); const description = normalize(candidate.description); const excerpt = normalize(candidate.excerpt)
  if (/значения|disambiguation|may refer to/.test(description)) return -1_000
  let score = names.includes(title) ? 100 : names.some((name) => name.length >= 4 && (title.includes(name) || name.includes(title))) ? 45 : 0
  if (/(?:город|city|capital|municipality|metropolis|urban)/i.test(`${candidate.description} ${candidate.excerpt}`)) score += 25
  const country = normalize(card.country)
  if (country && (description.includes(country) || excerpt.includes(country) || title.includes(country))) score += 30
  if (language === 'ru' && /город/.test(description)) score += 10
  return score
}

const loadWikipediaPage = async (language: 'ru' | 'en', candidate: WikiCandidate): Promise<WikiSource> => {
  const payload = await fetchJson(`https://${language}.wikipedia.org/w/rest.php/v1/page/${encodeURIComponent(candidate.key)}/with_html`)
  const paragraphs = wikipediaParagraphs(text(payload.html))
  let excerpt = paragraphs.join('\n').slice(0, 8_000)
  if (excerpt.length < 300) {
    const summary = await fetchJson(`https://${language}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(candidate.key)}`)
    excerpt = [excerpt, text(summary.extract), candidate.excerpt].filter(Boolean).join('\n').slice(0, 8_000)
  }
  if (excerpt.length < 160) throw new Error('Wikipedia page has too little readable text')
  const latest = record(payload.latest); const license = record(payload.license)
  return {
    language,
    title: text(payload.title) || candidate.title,
    url: `https://${language}.wikipedia.org/wiki/${encodeURIComponent(candidate.key)}`,
    revisionId: Number(latest.id) || null,
    license: text(license.title) || 'CC BY-SA',
    excerpt,
  }
}

const resolveWikipedia = async (card: Json): Promise<WikiSource> => {
  const attempts: Array<{ language: 'ru' | 'en'; query: string }> = [
    { language: 'ru', query: `${text(card.titleRu)} ${text(card.country)}` },
    { language: 'ru', query: text(card.titleRu) },
    { language: 'en', query: `${text(card.titleOriginal) || text(card.titleRu)} city` },
  ]
  let best: { language: 'ru' | 'en'; candidate: WikiCandidate; score: number } | null = null
  for (const attempt of attempts) {
    if (!attempt.query.trim()) continue
    const candidates = await searchWikipedia(attempt.language, attempt.query)
    for (const candidate of candidates) {
      const score = candidateScore(candidate, card, attempt.language)
      if (!best || score > best.score) best = { language: attempt.language, candidate, score }
    }
    if (best && best.score >= 120) break
  }
  if (!best || best.score < 65) throw new Error(`Wikipedia page is ambiguous (best score ${best?.score ?? 0})`)
  return loadWikipediaPage(best.language, best.candidate)
}

const actor = async () => {
  const rows = await db.select({ id: playerProfiles.userId }).from(playerProfiles)
    .where(eq(playerProfiles.role, 'admin')).orderBy(asc(playerProfiles.createdAt)).limit(1)
  if (!rows[0]) throw new Error('Production admin actor was not found')
  return rows[0]
}

const activeCityCards = async () => {
  const active = (await db.select({ id: contentRevisions.id }).from(contentRevisions).where(eq(contentRevisions.status, 'active')).limit(1))[0]
  if (!active) throw new Error('Active content revision was not found')
  const cards = await db.select({ itemId: contentItemVersions.itemId, versionId: contentItemVersions.id, payload: contentItemVersions.payload })
    .from(contentItemVersions).where(and(eq(contentItemVersions.revisionId, active.id), eq(contentItemVersions.mode, 'city')))
    .orderBy(asc(contentItemVersions.itemId))
  if (cards.length !== 980) throw new Error(`Expected 980 active cities, found ${cards.length}`)
  return cards
}

const mapPool = async <T, R>(items: T[], concurrency: number, handler: (item: T, index: number) => Promise<R>) => {
  const results = new Array<R>(items.length); let cursor = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) { const index = cursor++; results[index] = await handler(items[index], index) }
  }))
  return results
}

const prepare = async () => {
  const admin = await actor(); const cards = await activeCityCards()
  const existing = (await db.select({ id: pipelineRuns.id, status: pipelineRuns.status }).from(pipelineRuns)
    .where(and(eq(pipelineRuns.pipelineKey, 'normalization'), sql`${pipelineRuns.inputDefinitionJson}->>'operation' = ${operation}`))
    .orderBy(sql`${pipelineRuns.createdAt} desc`).limit(1))[0]
  if (existing && !['failed', 'cancelled', 'published', 'partially_published'].includes(existing.status)) return { skipped: true, runId: existing.id, status: existing.status }

  const run = (await db.insert(pipelineRuns).values({
    pipelineKey: 'normalization', pipelineVersion: operation, status: 'queued', createdBy: admin.id, itemsTotal: cards.length,
    inputDefinitionJson: { operation, scenario: 'wikipedia_fact', mode: 'city', field: 'facts', source: 'Wikipedia/Wikimedia REST API' },
    settingsJson: { model: 'gpt-5-mini', webSearch: false, workerMode: 'claim_skip_locked', source: 'wikipedia' },
    estimatedCost: '3.000000', resultExpiresAt: new Date(Date.now() + 30 * 86_400_000),
  }).returning())[0]

  let resolved = 0; let failed = 0
  await mapPool(cards, 3, async (card, index) => {
    try {
      const source = await resolveWikipedia(record(card.payload)); resolved += 1
      await db.insert(pipelineRunItems).values({
        runId: run.id, entityKey: card.itemId, cardId: card.itemId, inputItemVersionId: card.versionId, status: 'pending',
        beforeJson: card.payload, sourcesJson: source, idempotencyKey: `${run.id}:${card.itemId}`,
      })
    } catch (error) {
      failed += 1
      await db.insert(pipelineRunItems).values({
        runId: run.id, entityKey: card.itemId, cardId: card.itemId, inputItemVersionId: card.versionId, status: 'failed',
        beforeJson: card.payload, errorCode: 'CITY_WIKIPEDIA_SOURCE_FAILED', safeErrorMessage: safeError(error), idempotencyKey: `${run.id}:${card.itemId}`,
      })
    }
    if ((index + 1) % 20 === 0 || index + 1 === cards.length) {
      await db.update(pipelineRuns).set({ heartbeatAt: new Date(), logExcerpt: `Wikipedia: ${index + 1}/${cards.length} · найдено ${resolved} · ошибки ${failed}` }).where(eq(pipelineRuns.id, run.id))
    }
  })
  await db.update(pipelineRuns).set({ itemsProcessed: failed, itemsFailed: failed, logExcerpt: `Wikipedia: найдено ${resolved}/${cards.length}, ошибки ${failed}` }).where(eq(pipelineRuns.id, run.id))
  return { skipped: false, runId: run.id, total: cards.length, resolved, failed, model: 'gpt-5-mini', webSearch: false }
}

const runIdFromArgs = async () => {
  if (process.argv[3]) return process.argv[3]
  const latest = (await db.select({ id: pipelineRuns.id }).from(pipelineRuns)
    .where(and(eq(pipelineRuns.pipelineKey, 'normalization'), sql`${pipelineRuns.inputDefinitionJson}->>'operation' = ${operation}`))
    .orderBy(sql`${pipelineRuns.createdAt} desc`).limit(1))[0]
  if (!latest) throw new Error('City facts pipeline run was not found')
  return latest.id
}

type ClaimedItem = { id: string; entityKey: string; beforeJson: unknown; sourcesJson: unknown }
const claimItem = async (runId: string): Promise<ClaimedItem | null> => {
  const claimed = await db.execute(sql`
    update pipeline_run_items set status = 'running', "updatedAt" = now()
    where id = (
      select id from pipeline_run_items where run_id = ${runId}::uuid and status = 'pending'
      order by entity_key for update skip locked limit 1
    )
    returning id, entity_key as "entityKey", before_json as "beforeJson", sources_json as "sourcesJson"
  `)
  return Array.from(claimed as Iterable<ClaimedItem>)[0] ?? null
}

const FACT_PROMPT = [
  'SOURCE — это фрагмент статьи Wikipedia именно об этом городе. Используй только информацию, которая прямо содержится в SOURCE, и ничего не добавляй из памяти.',
  'Выбери один конкретный, характерный и интересный факт: уникальный объект, историческое событие, инженерную особенность, традицию или действительно подтверждённый рекорд.',
  'Не называй город и варианты его названия даже в косвенных падежах. Не называй страну, жителей страны, столичный статус, координаты, флаг или герб.',
  'Не повторяй plotHint и обычные поля карточки. Не используй расплывчатые слова «город», «место», «регион» вместо конкретного подлежащего.',
  'Верни decision=update и value как JSON-массив ровно из одного хорошо отредактированного русского предложения длиной 90–220 знаков.',
  'Проверь падежи, согласование, управление и отсутствие повторов. Не смешивай кириллицу с латиницей внутри слова. Не начинай со слов «Этот», «Это место», «Здесь», «Город» или «Удивительный факт».',
  'В reason дословно скопируй из SOURCE одно предложение, которое полностью подтверждает выбранный факт. В sourceUrls верни только WIKIPEDIA_URL.',
  'SOURCE: %wikipediaExcerpt%',
  'WIKIPEDIA_URL: %wikipediaUrl%',
].join(' ')

const invalidFactReason = (before: Json, source: WikiSource, result: Awaited<ReturnType<typeof requestNormalization>>) => {
  if (result.decision !== 'update') return `decision ${result.decision}`
  if (!Array.isArray(result.value) || result.value.length !== 1 || typeof result.value[0] !== 'string') return 'value must contain exactly one string'
  const fact = text(result.value[0])
  if (fact.length < 90 || fact.length > 220) return `fact length ${fact.length}`
  if (!/[а-яё]/i.test(fact)) return 'fact is not Russian'
  if (/^(?:этот|это место|здесь|город|удивительный факт)\b/i.test(fact)) return 'weak opening'
  if (/\b(?=[a-zа-яё]*[a-z])(?=[a-zа-яё]*[а-яё])[a-zа-яё]+\b/i.test(fact)) return 'mixed Cyrillic and Latin word'
  if (/\bстолиц[а-яё]*\b/i.test(fact)) return 'capital status leak'
  const repeated = fact.match(/\b([а-яё]{5,})\b[\s\S]{0,90}\b\1\b/i)?.[1]
  if (repeated) return `repeated word: ${repeated}`
  const normalizedFact = normalize(fact)
  const forbidden = [before.titleRu, before.titleOriginal, before.country, ...strings(before.alternativeTitles)]
    .flatMap((value) => normalize(value).split(' ')).filter((value) => value.length >= 3)
    .map((value) => value.length <= 4 ? value.slice(0, Math.max(3, value.length - 1)) : value.slice(0, Math.max(4, value.length - 2)))
  const leak = forbidden.find((value) => normalizedFact.split(' ').some((token) => token.startsWith(value)))
  if (leak) return `answer leak: ${leak}`
  const quote = normalize(result.reason); const excerpt = normalize(source.excerpt)
  if (quote.length < 40 || !excerpt.includes(quote)) return 'supporting quote is not verbatim Wikipedia text'
  return null
}

const updateRunSnapshot = async (runId: string) => {
  await db.execute(sql`
    with stats as (
      select count(*)::int as total,
        count(*) filter (where status in ('review_required','failed'))::int as processed,
        count(*) filter (where status = 'review_required')::int as succeeded,
        count(*) filter (where status = 'failed')::int as failed,
        count(*) filter (where status = 'pending')::int as pending,
        count(*) filter (where status = 'running')::int as running,
        coalesce(sum(nullif(confidence_json->'usage'->>'costUsd','')::numeric), 0) as cost
      from pipeline_run_items where run_id = ${runId}::uuid
    )
    update pipeline_runs set
      items_processed = stats.processed, items_succeeded = stats.succeeded, items_failed = stats.failed,
      actual_cost = stats.cost, heartbeat_at = now(), worker_id = ${workerLabel},
      status = case when stats.pending > 0 or stats.running > 0 then 'running'
        when stats.failed > 0 then 'partially_failed' else 'review_required' end,
      finished_at = case when stats.pending = 0 and stats.running = 0 then now() else null end,
      log_excerpt = concat('Wikipedia facts: ', stats.processed, '/', stats.total, ' · готово ', stats.succeeded, ' · ошибки ', stats.failed)
    from stats where pipeline_runs.id = ${runId}::uuid
  `)
}

const sourceRetry = async () => {
  const runId = await runIdFromArgs()
  const failedItems = await db.select({ id: pipelineRunItems.id, before: pipelineRunItems.beforeJson }).from(pipelineRunItems)
    .where(and(eq(pipelineRunItems.runId, runId), eq(pipelineRunItems.status, 'failed'), sql`${pipelineRunItems.sourcesJson} is null`))
  let resolved = 0; let failed = 0
  await mapPool(failedItems, 2, async (item, index) => {
    try {
      const source = await resolveWikipedia(record(item.before)); resolved += 1
      await db.update(pipelineRunItems).set({ status: 'pending', sourcesJson: source, errorCode: null, safeErrorMessage: null, updatedAt: new Date() }).where(eq(pipelineRunItems.id, item.id))
    } catch (error) {
      failed += 1
      await db.update(pipelineRunItems).set({ errorCode: 'CITY_WIKIPEDIA_SOURCE_FAILED', safeErrorMessage: safeError(error), updatedAt: new Date() }).where(eq(pipelineRunItems.id, item.id))
    }
    if ((index + 1) % 10 === 0 || index + 1 === failedItems.length) {
      await db.update(pipelineRuns).set({ heartbeatAt: new Date(), logExcerpt: `Wikipedia retry: ${index + 1}/${failedItems.length} · найдено ${resolved} · ошибки ${failed}` }).where(eq(pipelineRuns.id, runId))
    }
  })
  await updateRunSnapshot(runId)
  return { runId, attempted: failedItems.length, resolved, failed }
}

const work = async () => {
  const runId = await runIdFromArgs(); const environment = await loadIntegrationEnvironment(db, config)
  if (!environment.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured')
  await db.update(pipelineRuns).set({ status: 'running', startedAt: new Date(), workerId: workerLabel }).where(eq(pipelineRuns.id, runId))
  let completed = 0
  while (true) {
    const item = await claimItem(runId)
    if (!item) break
    const before = record(item.beforeJson); const source = record(item.sourcesJson) as WikiSource
    try {
      let result: Awaited<ReturnType<typeof requestNormalization>> | null = null; let lastError: unknown = null
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          result = await requestNormalization({
            apiKey: environment.OPENAI_API_KEY, proxyUrl: environment.MUSIC_OUTBOUND_PROXY_URL,
            model: 'gpt-5-mini', webSearch: false, mode: 'city', field: 'facts', prompt: FACT_PROMPT,
            payload: { ...before, wikipediaExcerpt: source.excerpt, wikipediaUrl: source.url },
            contextFields: ['country', 'plotHint', 'wikipediaExcerpt', 'wikipediaUrl'],
            availableFields: ['wikipediaExcerpt', 'wikipediaUrl'], cardId: item.entityKey,
          })
          break
        } catch (error) {
          lastError = error
          if (!/(?:country, region, or territory|fetch failed|ECONN|timeout)/i.test(safeError(error)) || attempt === 2) break
          await sleep(800 * (attempt + 1))
        }
      }
      if (!result) throw lastError ?? new Error('OpenAI did not return a result')
      const invalid = invalidFactReason(before, source, result)
      if (invalid) throw new Error(`CITY_FACT_INVALID: ${invalid}`)
      const fact = text((result.value as unknown[])[0])
      await db.update(pipelineRunItems).set({
        status: 'review_required', proposedJson: { ...before, facts: [fact] }, warningsJson: [],
        sourcesJson: { ...source, supportingQuote: result.reason }, confidenceJson: { decision: result.decision, confidence: result.confidence, usage: result.usage },
        rawResultRef: result.responseId || null, errorCode: null, safeErrorMessage: null, updatedAt: new Date(),
      }).where(eq(pipelineRunItems.id, item.id))
    } catch (error) {
      await db.update(pipelineRunItems).set({ status: 'failed', errorCode: /CITY_FACT_INVALID/.test(safeError(error)) ? 'CITY_FACT_INVALID' : 'CITY_FACT_GENERATION_FAILED', safeErrorMessage: safeError(error), updatedAt: new Date() }).where(eq(pipelineRunItems.id, item.id))
    }
    completed += 1
    await updateRunSnapshot(runId)
  }
  await updateRunSnapshot(runId)
  return { runId, worker: workerLabel, completed }
}

const status = async () => {
  const runId = await runIdFromArgs()
  const run = (await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).limit(1))[0]
  if (!run) throw new Error(`Pipeline run ${runId} was not found`)
  const grouped = await db.select({ status: pipelineRunItems.status, count: sql<number>`count(*)::int` }).from(pipelineRunItems)
    .where(eq(pipelineRunItems.runId, runId)).groupBy(pipelineRunItems.status)
  const errors = await db.select({ entityKey: pipelineRunItems.entityKey, code: pipelineRunItems.errorCode, message: pipelineRunItems.safeErrorMessage })
    .from(pipelineRunItems).where(and(eq(pipelineRunItems.runId, runId), eq(pipelineRunItems.status, 'failed'))).limit(10)
  return { runId, status: run.status, total: run.itemsTotal, processed: run.itemsProcessed, succeeded: run.itemsSucceeded, failed: run.itemsFailed, cost: run.actualCost, grouped: Object.fromEntries(grouped.map((entry) => [entry.status, entry.count])), errors }
}

const retry = async () => {
  const runId = await runIdFromArgs()
  const updated = await db.execute(sql`
    update pipeline_run_items set status = 'pending', error_code = null, safe_error_message = null, "updatedAt" = now()
    where run_id = ${runId}::uuid and status = 'failed' and sources_json is not null returning id
  `)
  const count = Array.from(updated as Iterable<unknown>).length
  if (count) await db.update(pipelineRuns).set({ status: 'queued', finishedAt: null }).where(eq(pipelineRuns.id, runId))
  return { runId, queued: count }
}

try {
  const result = action === 'prepare' ? await prepare()
    : action === 'source-retry' ? await sourceRetry()
      : action === 'work' ? await work()
        : action === 'status' ? await status()
          : await retry()
  console.log(JSON.stringify(result, null, 2))
} finally {
  await client.end()
}
