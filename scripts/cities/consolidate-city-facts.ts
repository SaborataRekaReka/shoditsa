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
import { requestNormalization, type NormalizationResult } from '../../apps/api/src/modules/admin/normalization-pipeline.js'

const ACTIONS = ['prepare', 'work', 'status'] as const
type Action = typeof ACTIONS[number]
type Json = Record<string, unknown>

const action = process.argv[2] as Action | undefined
if (!action || !ACTIONS.includes(action)) throw new Error(`Usage: city-facts-final <${ACTIONS.join('|')}> <run ids...>`)

const config = loadConfig()
const { db, client } = createDatabase(config)
const operation = 'city-facts-cached-mini-v3'
const workerLabel = process.env.CITY_FACT_WORKER_ID?.trim() || `city-fact-final-${process.pid}`
const workerMax = Math.max(0, Number(process.env.CITY_FACT_WORKER_MAX) || 0)
const hardBudgetUsd = Math.max(0.1, Number(process.env.CITY_FACT_BUDGET_USD) || 1.5)
const factModel = process.env.CITY_FACT_MODEL === 'gpt-5-nano' ? 'gpt-5-nano' : 'gpt-5-mini'
const record = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const strings = (value: unknown) => Array.isArray(value) ? value.flatMap((entry) => typeof entry === 'string' ? [entry.trim()] : []).filter(Boolean) : []
const normalize = (value: unknown) => text(value).normalize('NFKD').toLocaleLowerCase('ru-RU')
  .replace(/[\u0300-\u036f]/g, '').replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, ' ').trim()
const safeError = (error: unknown) => (error instanceof Error ? error.message : String(error))
  .replace(/(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]+)/gi, '[redacted]').slice(0, 1_000)

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

type SourceItem = { entityKey: string; status: string; proposed: unknown; sources: unknown }
const sourceItems = async (runId: string) => db.select({
  entityKey: pipelineRunItems.entityKey,
  status: pipelineRunItems.status,
  proposed: pipelineRunItems.proposedJson,
  sources: pipelineRunItems.sourcesJson,
}).from(pipelineRunItems).where(eq(pipelineRunItems.runId, runId)) as Promise<SourceItem[]>

const requiredArg = (index: number, name: string) => {
  const value = process.argv[index]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

const prepare = async () => {
  const wikipediaRunId = requiredArg(3, 'Wikipedia run id')
  const webRunId = requiredArg(4, 'Web run id')
  const hintsRunId = requiredArg(5, 'Hints run id')
  const cards = await activeCityCards()
  const [wikipediaItems, webItems, hintItems] = await Promise.all([
    sourceItems(wikipediaRunId), sourceItems(webRunId), sourceItems(hintsRunId),
  ])
  const wikipediaByEntity = new Map(wikipediaItems.map((item) => [item.entityKey, item]))
  const webByEntity = new Map(webItems.map((item) => [item.entityKey, item]))
  const hintByEntity = new Map(hintItems.map((item) => [item.entityKey, item]))

  const existing = (await db.select({ id: pipelineRuns.id, status: pipelineRuns.status }).from(pipelineRuns)
    .where(and(eq(pipelineRuns.pipelineKey, 'normalization'), sql`${pipelineRuns.inputDefinitionJson}->>'operation' = ${operation}`))
    .orderBy(sql`${pipelineRuns.createdAt} desc`).limit(1))[0]
  if (existing && !['failed', 'cancelled', 'published', 'partially_published'].includes(existing.status)) {
    return { skipped: true, runId: existing.id, status: existing.status }
  }

  const admin = await actor()
  const run = (await db.insert(pipelineRuns).values({
    pipelineKey: 'normalization', pipelineVersion: operation, status: 'queued', createdBy: admin.id, itemsTotal: cards.length,
    inputDefinitionJson: { operation, scenario: 'consolidate_cached_city_facts', mode: 'city', field: 'facts', wikipediaRunId, webRunId, hintsRunId },
    settingsJson: { model: 'gpt-5-mini', webSearch: false, retries: 0, hardBudgetUsd, workerMode: 'claim_skip_locked' },
    estimatedCost: hardBudgetUsd.toFixed(6), resultExpiresAt: new Date(Date.now() + 30 * 86_400_000),
  }).returning())[0]

  let candidates = 0; let sources = 0
  for (const card of cards) {
    const wiki = wikipediaByEntity.get(card.itemId)
    const web = webByEntity.get(card.itemId)
    const hint = hintByEntity.get(card.itemId)
    const wikiProposed = record(wiki?.proposed)
    const wikiSources = record(wiki?.sources)
    const webProposed = record(web?.proposed)
    const webSources = record(web?.sources)
    const hintProposed = record(hint?.proposed)

    let candidateFact = ''
    let candidateOrigin = ''
    let candidateEvidence = ''
    let candidateUrls: string[] = []
    if (web?.status === 'approved' && strings(webProposed.facts)[0]) {
      candidateFact = strings(webProposed.facts)[0]
      candidateOrigin = 'web-approved'
      candidateEvidence = text(webSources.evidence)
      candidateUrls = strings(webSources.sourceUrls)
    } else if (web?.status === 'rejected' && text(webSources.previousFact)) {
      candidateFact = text(webSources.previousFact)
      candidateOrigin = 'web-kept-existing'
      candidateEvidence = text(webSources.previousSupportingQuote)
      candidateUrls = [text(webSources.previousSourceUrl)].filter(Boolean)
    } else if (wiki?.status === 'review_required' && strings(wikiProposed.facts)[0]) {
      candidateFact = strings(wikiProposed.facts)[0]
      candidateOrigin = 'wikipedia-candidate'
      candidateEvidence = text(wikiSources.supportingQuote)
      candidateUrls = [text(wikiSources.url)].filter(Boolean)
    }
    if (candidateFact) candidates += 1
    if (text(wikiSources.excerpt)) sources += 1

    await db.insert(pipelineRunItems).values({
      runId: run.id, entityKey: card.itemId, cardId: card.itemId, inputItemVersionId: card.versionId, status: 'pending',
      beforeJson: card.payload,
      sourcesJson: {
        candidateFact: candidateFact || null,
        candidateOrigin: candidateOrigin || null,
        candidateEvidence: candidateEvidence || null,
        candidateUrls,
        approvedPlotHint: text(hintProposed.plotHint) || null,
        wikipediaUrl: text(wikiSources.url) || null,
        wikipediaExcerpt: text(wikiSources.excerpt).slice(0, 6_000) || null,
        wikipediaRevisionId: wikiSources.revisionId ?? null,
      },
      idempotencyKey: `${run.id}:${card.itemId}`,
    })
  }
  return { skipped: false, runId: run.id, total: cards.length, candidates, wikipediaSources: sources, model: 'gpt-5-mini', webSearch: false, hardBudgetUsd }
}

const runIdFromArgs = async () => {
  if (process.argv[3]) return process.argv[3]
  const latest = (await db.select({ id: pipelineRuns.id }).from(pipelineRuns)
    .where(and(eq(pipelineRuns.pipelineKey, 'normalization'), sql`${pipelineRuns.inputDefinitionJson}->>'operation' = ${operation}`))
    .orderBy(sql`${pipelineRuns.createdAt} desc`).limit(1))[0]
  if (!latest) throw new Error('Cached city facts run was not found')
  return latest.id
}

type ClaimedItem = { id: string; entityKey: string; beforeJson: unknown; sourcesJson: unknown; confidenceJson: unknown }
const claimItem = async (runId: string): Promise<ClaimedItem | null> => {
  const claimed = await db.execute(sql`
    update pipeline_run_items set status = 'running', "updatedAt" = now()
    where id = (
      select item.id from pipeline_run_items item
      join pipeline_runs run on run.id = item.run_id
      where item.run_id = ${runId}::uuid and item.status = 'pending'
        and run.cancel_requested_at is null and run.status in ('queued','running')
        and coalesce(run.actual_cost, 0) < coalesce((run.settings_json->>'hardBudgetUsd')::numeric, ${hardBudgetUsd})
      order by item.entity_key for update of item skip locked limit 1
    )
    returning id, entity_key as "entityKey", before_json as "beforeJson", sources_json as "sourcesJson", confidence_json as "confidenceJson"
  `)
  return Array.from(claimed as Iterable<ClaimedItem>)[0] ?? null
}

const FACT_PROMPT = [
  'Подготовь один качественный игровой факт о городе. Web search запрещён: используй только CURRENT_CANDIDATE, CANDIDATE_EVIDENCE и WIKIPEDIA_EXCERPT.',
  'Если CURRENT_CANDIDATE написан естественно, интересен, не спойлерит ответ и полностью подтверждается CANDIDATE_EVIDENCE либо WIKIPEDIA_EXCERPT — верни keep и сохрани его дословно.',
  'Если кандидат плохой или отсутствует, выбери из WIKIPEDIA_EXCERPT другой конкретный и характерный факт: уникальный объект, традицию, инженерную особенность, происхождение названия или важное историческое событие.',
  'Не используй население, площадь, плотность, климатические средние, административные реформы, муниципальный статус, перечни организаций, текущие рейтинги и проходную статистику.',
  'Не называй город, варианты его названия, страну, жителей страны или столичный статус. Не повторяй APPROVED_PLOT_HINT.',
  'Факт — одно самостоятельное естественное русское предложение длиной 80–210 знаков, без латинских букв, канцелярита и местоимений без названного объекта.',
  'При update верни value как массив ровно из одной строки, а в reason дословно скопируй одно предложение из WIKIPEDIA_EXCERPT, которое полностью подтверждает факт. sourceUrls должен содержать только WIKIPEDIA_URL.',
  'При keep верни исходный массив facts без изменений; в reason кратко объясни качество кандидата, sourceUrls сохрани из CANDIDATE_URLS.',
  'CURRENT_CANDIDATE: %candidateFact%',
  'CANDIDATE_EVIDENCE: %candidateEvidence%',
  'CANDIDATE_URLS: %candidateUrls%',
  'APPROVED_PLOT_HINT: %approvedPlotHint%',
  'WIKIPEDIA_EXCERPT: %wikipediaExcerpt%',
  'WIKIPEDIA_URL: %wikipediaUrl%',
  'Обязательно верни ровно одну законченную строку в value. Если CURRENT_CANDIDATE пуст, используй decision=update; не возвращай clear или пустой value. Начинай сразу с события, объекта или традиции; не начинай со слов «этот город», «в этом городе», «здесь» или «город».',
].join(' ')

const baseFactProblem = (before: Json, fact: string) => {
  if (fact.length < 80 || fact.length > 210) return `fact length ${fact.length}`
  if (!/[а-яё]/i.test(fact)) return 'fact is not Russian'
  if (/[a-z]/i.test(fact)) return 'Latin letters are not allowed'
  if (/^(?:этот|эта|это|эти|это место|в этом городе|здесь|город|удивительный факт)(?:\s|$)/i.test(fact)) return 'weak opening'
  if (/^(?:единственн|интересн|необычн|любопытн|примечательн)[а-яё\s-]{0,30}факт(?:\s|:|—|-)/i.test(fact)) return 'editorial meta opening'
  if (/(?:^|\s)столиц[а-яё]*(?:\s|$|[.,;:!?—-])/i.test(fact)) return 'capital status leak'
  if (/(?:населени[ея]|плотност[ьи]|площад[ьи]|административн|муниципал|постановлен|городск(?:ой|ого) округ|префектур|среднегодов|перепис[ьи]|вики[- ]?(?:стать|запис))/i.test(fact)) return 'dry or administrative fact'
  const normalizedFact = normalize(fact)
  const forbidden = [before.titleRu, before.titleOriginal, before.country, ...strings(before.alternativeTitles)]
    .flatMap((value) => normalize(value).split(' ')).filter((value) => value.length >= 3)
    .map((value) => value.length <= 4 ? value.slice(0, Math.max(3, value.length - 1)) : value.slice(0, Math.max(4, value.length - 2)))
  const leak = forbidden.find((value) => normalizedFact.split(' ').some((token) => token.startsWith(value)))
  return leak ? `answer leak: ${leak}` : null
}

const validateResult = (before: Json, source: Json, result: NormalizationResult) => {
  const candidate = text(source.candidateFact)
  if (!['keep', 'update', 'review'].includes(result.decision)) return `decision ${result.decision}`
  if (!Array.isArray(result.value) || result.value.length !== 1 || typeof result.value[0] !== 'string') return 'value must contain exactly one string'
  const fact = text(result.value[0])
  const problem = baseFactProblem(before, fact)
  if (problem) return problem
  if (result.decision === 'keep') {
    if (!candidate || fact !== candidate) return 'keep must preserve the candidate exactly'
    return null
  }
  const excerpt = normalize(source.wikipediaExcerpt)
  const quote = normalize(result.reason)
  if (!excerpt || quote.length < 40 || !excerpt.includes(quote)) return 'supporting quote is not verbatim Wikipedia text'
  return null
}

const salvageableReviewFact = (before: Json, result: NormalizationResult | null) => {
  if (!result || !Array.isArray(result.value) || result.value.length !== 1 || typeof result.value[0] !== 'string') return null
  const fact = text(result.value[0])
  if (fact.length < 20 || fact.length > 500 || !/[а-яё]/i.test(fact)) return null
  if (/(?:^|\s)столиц[а-яё]*(?:\s|$|[.,;:!?—-])/i.test(fact)) return null
  const normalizedFact = normalize(fact)
  const forbidden = [before.titleRu, before.titleOriginal, before.country, ...strings(before.alternativeTitles)]
    .flatMap((value) => normalize(value).split(' ')).filter((value) => value.length >= 3)
    .map((value) => value.length <= 4 ? value.slice(0, Math.max(3, value.length - 1)) : value.slice(0, Math.max(4, value.length - 2)))
  if (forbidden.some((value) => normalizedFact.split(' ').some((token) => token.startsWith(value)))) return null
  const problem = baseFactProblem(before, fact)
  return { fact, warning: problem ?? 'source evidence needs human review' }
}

const usageWithPreviousCost = (usage: NormalizationResult['usage'], confidenceJson: unknown) => {
  if (!usage) return null
  const previousUsage = record(record(confidenceJson).usage)
  return { ...usage, costUsd: Number(usage.costUsd ?? 0) + Number(previousUsage.costUsd ?? 0) }
}

const updateRunSnapshot = async (runId: string) => {
  await db.execute(sql`
    with stats as (
      select count(*)::int total,
        count(*) filter (where status not in ('pending','running'))::int processed,
        count(*) filter (where status in ('review_required','approved','rejected','staged','published'))::int succeeded,
        count(*) filter (where status = 'failed')::int failed,
        count(*) filter (where status = 'review_required')::int review_required,
        count(*) filter (where status = 'pending')::int pending,
        count(*) filter (where status = 'running')::int running,
        coalesce(sum(nullif(confidence_json->'usage'->>'costUsd','')::numeric), 0) cost
      from pipeline_run_items where run_id = ${runId}::uuid
    )
    update pipeline_runs set
      items_processed = stats.processed, items_succeeded = stats.succeeded, items_failed = stats.failed,
      actual_cost = stats.cost, heartbeat_at = now(), worker_id = ${workerLabel},
      cancel_requested_at = case when stats.cost >= coalesce((pipeline_runs.settings_json->>'hardBudgetUsd')::numeric, ${hardBudgetUsd}) then coalesce(pipeline_runs.cancel_requested_at, now()) else pipeline_runs.cancel_requested_at end,
      status = case
        when pipeline_runs.cancel_requested_at is not null or stats.cost >= coalesce((pipeline_runs.settings_json->>'hardBudgetUsd')::numeric, ${hardBudgetUsd}) then 'cancelled'
        when stats.pending > 0 or stats.running > 0 then 'running'
        when stats.failed > 0 then 'partially_failed'
        when stats.review_required > 0 then 'review_required' else 'review_required' end,
      finished_at = case when pipeline_runs.cancel_requested_at is not null or stats.cost >= coalesce((pipeline_runs.settings_json->>'hardBudgetUsd')::numeric, ${hardBudgetUsd}) or (stats.pending = 0 and stats.running = 0) then now() else null end,
      log_excerpt = concat('Cached facts mini: ', stats.processed, '/', stats.total, ' · готово ', stats.succeeded, ' · ошибки ', stats.failed, ' · $', round(stats.cost, 4))
    from stats where pipeline_runs.id = ${runId}::uuid
  `)
}

const work = async () => {
  const runId = await runIdFromArgs()
  const environment = await loadIntegrationEnvironment(db, config)
  if (!environment.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured')
  const started = await db.update(pipelineRuns).set({ status: 'running', startedAt: new Date(), workerId: workerLabel })
    .where(and(eq(pipelineRuns.id, runId), sql`${pipelineRuns.status} in ('queued','running')`, sql`${pipelineRuns.cancelRequestedAt} is null`))
    .returning({ id: pipelineRuns.id })
  if (!started.length) return { runId, worker: workerLabel, completed: 0, cancelled: true }

  let completed = 0
  while (!workerMax || completed < workerMax) {
    const item = await claimItem(runId)
    if (!item) break
    const before = record(item.beforeJson)
    const source = record(item.sourcesJson)
    const accumulatedUsage = (usage: NormalizationResult['usage']) => usageWithPreviousCost(usage, item.confidenceJson)
    let result: NormalizationResult | null = null
    try {
      result = await requestNormalization({
        apiKey: environment.OPENAI_API_KEY, proxyUrl: environment.MUSIC_OUTBOUND_PROXY_URL,
        model: factModel, webSearch: false, mode: 'city', field: 'facts', prompt: FACT_PROMPT, maxOutputTokens: 1_800,
        payload: { ...before, facts: text(source.candidateFact) ? [text(source.candidateFact)] : [], ...source },
        contextFields: ['country', 'plotHint', 'candidateFact', 'candidateEvidence', 'candidateUrls', 'approvedPlotHint', 'wikipediaExcerpt', 'wikipediaUrl'],
        availableFields: ['candidateFact', 'candidateEvidence', 'candidateUrls', 'approvedPlotHint', 'wikipediaExcerpt', 'wikipediaUrl'], cardId: item.entityKey,
      })
      const invalid = validateResult(before, source, result)
      if (invalid) throw new Error(`CITY_CACHED_FACT_INVALID: ${invalid}`)
      const fact = text((result.value as unknown[])[0])
      const urls = result.decision === 'keep' ? strings(source.candidateUrls) : [text(source.wikipediaUrl)].filter(Boolean)
      await db.update(pipelineRunItems).set({
        status: 'review_required', proposedJson: { ...before, facts: [fact] }, warningsJson: [],
        sourcesJson: { ...source, finalSourceUrls: urls, finalEvidence: result.reason },
        confidenceJson: { decision: result.decision, confidence: result.confidence, usage: accumulatedUsage(result.usage) },
        rawResultRef: result.responseId || null, errorCode: null, safeErrorMessage: null, updatedAt: new Date(),
      }).where(eq(pipelineRunItems.id, item.id))
    } catch (error) {
      const salvage = salvageableReviewFact(before, result)
      if (salvage && result) {
        const urls = result.decision === 'keep' ? strings(source.candidateUrls) : [text(source.wikipediaUrl)].filter(Boolean)
        await db.update(pipelineRunItems).set({
          status: 'review_required', proposedJson: { ...before, facts: [salvage.fact] },
          warningsJson: [{ code: 'CITY_FACT_NEEDS_REVIEW', message: salvage.warning }],
          sourcesJson: { ...source, finalSourceUrls: urls, finalEvidence: result.reason },
          confidenceJson: { decision: result.decision, confidence: result.confidence, usage: accumulatedUsage(result.usage) },
          rawResultRef: result.responseId || null, errorCode: null, safeErrorMessage: null, updatedAt: new Date(),
        }).where(eq(pipelineRunItems.id, item.id))
      } else {
        await db.update(pipelineRunItems).set({
          status: 'failed', errorCode: /CITY_CACHED_FACT_INVALID/.test(safeError(error)) ? 'CITY_CACHED_FACT_INVALID' : 'CITY_CACHED_FACT_GENERATION_FAILED',
          safeErrorMessage: safeError(error),
          confidenceJson: result?.usage ? { decision: result.decision, confidence: result.confidence, usage: accumulatedUsage(result.usage) } : item.confidenceJson,
          rawResultRef: result?.responseId || null,
          updatedAt: new Date(),
        }).where(eq(pipelineRunItems.id, item.id))
      }
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
  return { runId, status: run.status, total: run.itemsTotal, processed: run.itemsProcessed, succeeded: run.itemsSucceeded, failed: run.itemsFailed, cost: run.actualCost, grouped: Object.fromEntries(grouped.map((entry) => [entry.status, entry.count])) }
}

try {
  const result = action === 'prepare' ? await prepare() : action === 'work' ? await work() : await status()
  console.log(JSON.stringify(result, null, 2))
} finally {
  await client.end()
}
