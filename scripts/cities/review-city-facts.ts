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

const ACTIONS = ['prepare', 'work', 'status', 'retry'] as const
type Action = typeof ACTIONS[number]
type Json = Record<string, unknown>

const action = process.argv[2] as Action | undefined
if (!action || !ACTIONS.includes(action)) throw new Error(`Usage: city-facts-web <${ACTIONS.join('|')}> <source-run-id|run-id>`)

const config = loadConfig()
const { db, client } = createDatabase(config)
const operation = 'city-facts-web-nano-v2'
const workerLabel = process.env.CITY_FACT_WORKER_ID?.trim() || `city-fact-web-${process.pid}`
const workerMax = Math.max(0, Number(process.env.CITY_FACT_WORKER_MAX) || 0)
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
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

const sourceRunIdFromArgs = () => {
  const value = process.argv[3]?.trim()
  if (!value) throw new Error('Source pipeline run id is required')
  return value
}

const runIdFromArgs = async () => {
  if (process.argv[3]) return process.argv[3]
  const latest = (await db.select({ id: pipelineRuns.id }).from(pipelineRuns)
    .where(and(eq(pipelineRuns.pipelineKey, 'normalization'), sql`${pipelineRuns.inputDefinitionJson}->>'operation' = ${operation}`))
    .orderBy(sql`${pipelineRuns.createdAt} desc`).limit(1))[0]
  if (!latest) throw new Error('City facts web review run was not found')
  return latest.id
}

const prepare = async () => {
  const sourceRunId = sourceRunIdFromArgs()
  const sourceRun = (await db.select({ id: pipelineRuns.id }).from(pipelineRuns).where(eq(pipelineRuns.id, sourceRunId)).limit(1))[0]
  if (!sourceRun) throw new Error(`Source run ${sourceRunId} was not found`)

  const existing = (await db.select({ id: pipelineRuns.id, status: pipelineRuns.status }).from(pipelineRuns)
    .where(and(eq(pipelineRuns.pipelineKey, 'normalization'), sql`${pipelineRuns.inputDefinitionJson}->>'operation' = ${operation}`, sql`${pipelineRuns.inputDefinitionJson}->>'sourceRunId' = ${sourceRunId}`))
    .orderBy(sql`${pipelineRuns.createdAt} desc`).limit(1))[0]
  if (existing && !['failed', 'cancelled', 'published', 'partially_published'].includes(existing.status)) {
    return { skipped: true, runId: existing.id, status: existing.status }
  }

  const admin = await actor()
  const cards = await activeCityCards()
  const sourceItems = await db.select({
    entityKey: pipelineRunItems.entityKey,
    status: pipelineRunItems.status,
    proposed: pipelineRunItems.proposedJson,
    sources: pipelineRunItems.sourcesJson,
  }).from(pipelineRunItems).where(eq(pipelineRunItems.runId, sourceRunId))
  const sourceByEntity = new Map(sourceItems.map((item) => [item.entityKey, item]))

  const run = (await db.insert(pipelineRuns).values({
    pipelineKey: 'normalization', pipelineVersion: operation, status: 'queued', createdBy: admin.id, itemsTotal: cards.length,
    inputDefinitionJson: { operation, scenario: 'keep_or_web_regenerate_city_fact', mode: 'city', field: 'facts', sourceRunId },
    settingsJson: { criticModel: 'gpt-5-nano', generationModel: 'gpt-5-nano', webSearch: true, webSearchRequired: true, workerMode: 'claim_skip_locked' },
    estimatedCost: '12.000000', resultExpiresAt: new Date(Date.now() + 30 * 86_400_000),
  }).returning())[0]

  for (const card of cards) {
    const sourceItem = sourceByEntity.get(card.itemId)
    const sourceProposed = record(sourceItem?.proposed)
    const sourceSources = record(sourceItem?.sources)
    const oldFact = strings(sourceProposed.facts)[0] ?? ''
    await db.insert(pipelineRunItems).values({
      runId: run.id, entityKey: card.itemId, cardId: card.itemId, inputItemVersionId: card.versionId, status: 'pending',
      beforeJson: card.payload,
      sourcesJson: {
        sourceRunId,
        previousStatus: sourceItem?.status ?? 'missing',
        previousFact: oldFact || null,
        previousSupportingQuote: text(sourceSources.supportingQuote) || null,
        previousSourceUrl: text(sourceSources.url) || null,
      },
      idempotencyKey: `${run.id}:${card.itemId}`,
    })
  }
  return { skipped: false, runId: run.id, total: cards.length, sourceRunId, model: 'gpt-5-nano', webSearch: true }
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

const CRITIC_PROMPT = [
  'Оцени существующий факт как строгий выпускающий редактор игры в угадывание города.',
  'Верни keep только если одновременно выполнено всё: факт полностью и без добавлений следует из SUPPORTING_QUOTE; написан безупречным естественным русским; интересен и характерен именно для города; не называет город, страну или столичный статус; не повторяет обычные поля карточки.',
  'Всегда отклоняй население, площадь, плотность, климатические средние, административное устройство или реформы, муниципальный статус, перечни учреждений, текущие рейтинги и метаинформацию Wikipedia.',
  'Если есть хотя бы небольшое сомнение, верни clear. При keep верни исходный массив facts без изменений. Web search на этом шаге не нужен.',
  'SUPPORTING_QUOTE: %supportingQuote%',
].join(' ')

const WEB_FACT_PROMPT = [
  'Обязательно выполни web search и найди один достоверный, необычный и характерный факт именно об этом городе.',
  'Предпочитай первичные и официальные источники: сайты музеев, университетов, органов охраны наследия, UNESCO, Guinness World Records, официальные городские или туристические ресурсы. Допустимы надёжные энциклопедии и крупные медиа. Не опирайся только на Wikipedia.',
  'Факт должен помогать узнать город после размышления, но не называть сам город, варианты его названия, страну, жителей страны или столичный статус. Не повторяй plotHint и обычные поля карточки.',
  'Не используй население, площадь, плотность, климатические средние, административные реформы, муниципальный статус, перечни организаций, текущие рейтинги или проходную статистику. Не пересказывай REJECTED_FACT другими словами.',
  'Выбирай устойчивую деталь: уникальный объект, происхождение узнаваемой традиции, инженерную особенность, важное историческое событие или подтверждённый рекорд.',
  'Верни decision=update и value как JSON-массив ровно из одного естественного русского предложения длиной 80–210 знаков. Все имена и названия передай кириллицей: в итоговом предложении не должно быть латинских букв. Проверь падежи, согласование и отсутствие канцелярита.',
  'В reason кратко объясни, чем источник подтверждает факт. В sourceUrls верни 1–3 реально использованных HTTPS-ссылки.',
  'REJECTED_FACT: %rejectedFact%',
].join(' ')

const FINAL_CRITIC_PROMPT = [
  'Ты выпускающий редактор одного игрового факта о городе. Проверяй только качество текста и пригодность для игры; ничего не переписывай.',
  'Верни keep и исходный массив facts без изменений только если предложение безупречно по-русски, самостоятельно понятно без скрытого контекста, конкретно, интересно и характерно для города.',
  'Отклоняй: местоимения без названного объекта вроде «этот музей»; неестественное управление и кальки; канцелярит; расплывчатые похвалы; перечисления; население, площадь, климат, администрацию; латиницу; название города, страны или столичный статус.',
  'Если есть хотя бы небольшое сомнение, верни clear. Не добавляй и не исправляй сведения.',
  'EVIDENCE: %evidence%',
].join(' ')

const baseFactProblem = (before: Json, fact: string) => {
  if (fact.length < 80 || fact.length > 210) return `fact length ${fact.length}`
  if (!/[а-яё]/i.test(fact)) return 'fact is not Russian'
  if (/[a-z]/i.test(fact)) return 'Latin letters are not allowed'
  if (/^(?:этот|эта|это|эти|это место|здесь|город|удивительный факт)(?:\s|$)/i.test(fact)) return 'weak opening'
  if (/^(?:единственн|интересн|необычн|любопытн|примечательн)[а-яё\s-]{0,30}факт(?:\s|:|—|-)/i.test(fact)) return 'editorial meta opening'
  if (/\b(?=[a-zа-яё]*[a-z])(?=[a-zа-яё]*[а-яё])[a-zа-яё]+\b/i.test(fact)) return 'mixed Cyrillic and Latin word'
  if (/(?:^|\s)столиц[а-яё]*(?:\s|$|[.,;:!?—-])/i.test(fact)) return 'capital status leak'
  if (/(?:населени[ея]|плотност[ьи]|площад[ьи]|административн|муниципал|постановлен|городск(?:ой|ого) округ|префектур|климат|среднегодов|перепис[ьи]|вики[- ]?(?:стать|запис))/i.test(fact)) return 'dry or administrative fact'
  const normalizedFact = normalize(fact)
  const forbidden = [before.titleRu, before.titleOriginal, before.country, ...strings(before.alternativeTitles)]
    .flatMap((value) => normalize(value).split(' ')).filter((value) => value.length >= 3)
    .map((value) => value.length <= 4 ? value.slice(0, Math.max(3, value.length - 1)) : value.slice(0, Math.max(4, value.length - 2)))
  const leak = forbidden.find((value) => normalizedFact.split(' ').some((token) => token.startsWith(value)))
  return leak ? `answer leak: ${leak}` : null
}

const criticKept = (before: Json, oldFact: string, result: NormalizationResult) => {
  if (result.decision !== 'keep') return false
  if (!Array.isArray(result.value) || result.value.length !== 1 || text(result.value[0]) !== oldFact) return false
  return !baseFactProblem(before, oldFact)
}

const generatedFactProblem = (before: Json, result: NormalizationResult) => {
  if (result.decision !== 'update') return `decision ${result.decision}`
  if (!Array.isArray(result.value) || result.value.length !== 1 || typeof result.value[0] !== 'string') return 'value must contain exactly one string'
  const problem = baseFactProblem(before, text(result.value[0]))
  if (problem) return problem
  if (!result.sourceUrls.length) return 'source URL is required'
  if (!result.usage?.webSearchCalls) return 'web search was not used'
  return null
}

const usageSummary = (...results: Array<NormalizationResult | null>) => {
  const entries = results.map((result) => result?.usage).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
  return {
    responses: entries,
    costUsd: Number(entries.reduce((sum, entry) => sum + entry.costUsd, 0).toFixed(8)),
    webSearchCalls: entries.reduce((sum, entry) => sum + entry.webSearchCalls, 0),
  }
}

const updateRunSnapshot = async (runId: string) => {
  await db.execute(sql`
    with stats as (
      select count(*)::int as total,
        count(*) filter (where status in ('review_required','rejected','failed'))::int as processed,
        count(*) filter (where status = 'review_required')::int as regenerated,
        count(*) filter (where status = 'rejected')::int as kept,
        count(*) filter (where status = 'failed')::int as failed,
        count(*) filter (where status = 'pending')::int as pending,
        count(*) filter (where status = 'running')::int as running,
        coalesce(sum(nullif(confidence_json->'usage'->>'costUsd','')::numeric), 0) as cost
      from pipeline_run_items where run_id = ${runId}::uuid
    )
    update pipeline_runs set
      items_processed = stats.processed, items_succeeded = stats.regenerated + stats.kept, items_failed = stats.failed,
      actual_cost = stats.cost, heartbeat_at = now(), worker_id = ${workerLabel},
      status = case when stats.pending > 0 or stats.running > 0 then 'running'
        when stats.failed > 0 then 'partially_failed' else 'review_required' end,
      finished_at = case when stats.pending = 0 and stats.running = 0 then now() else null end,
      log_excerpt = concat('City facts web nano: ', stats.processed, '/', stats.total, ' · оставлено ', stats.kept, ' · перегенерировано ', stats.regenerated, ' · ошибки ', stats.failed)
    from stats where pipeline_runs.id = ${runId}::uuid
  `)
}

const requestWithRetries = async (factory: () => Promise<NormalizationResult>) => {
  let lastError: unknown = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await factory() } catch (error) {
      lastError = error
      if (attempt < 2) await sleep(900 * (attempt + 1))
    }
  }
  throw lastError ?? new Error('OpenAI did not return a result')
}

const work = async () => {
  const runId = await runIdFromArgs()
  const environment = await loadIntegrationEnvironment(db, config)
  if (!environment.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured')
  await db.update(pipelineRuns).set({ status: 'running', startedAt: new Date(), workerId: workerLabel }).where(eq(pipelineRuns.id, runId))
  let completed = 0
  while (!workerMax || completed < workerMax) {
    const item = await claimItem(runId)
    if (!item) break
    const before = record(item.beforeJson)
    const source = record(item.sourcesJson)
    const oldFact = text(source.previousFact)
    let critic: NormalizationResult | null = null
    let generation: NormalizationResult | null = null
    let finalCritic: NormalizationResult | null = null
    try {
      if (oldFact && text(source.previousSupportingQuote)) {
        critic = await requestWithRetries(() => requestNormalization({
          apiKey: environment.OPENAI_API_KEY, proxyUrl: environment.MUSIC_OUTBOUND_PROXY_URL,
          model: 'gpt-5-nano', webSearch: false, mode: 'city', field: 'facts', prompt: CRITIC_PROMPT,
          payload: { ...before, facts: [oldFact], supportingQuote: source.previousSupportingQuote },
          contextFields: ['country', 'plotHint', 'supportingQuote'], availableFields: ['supportingQuote'], cardId: item.entityKey,
        }))
      }

      if (critic && criticKept(before, oldFact, critic)) {
        const usage = usageSummary(critic)
        await db.update(pipelineRunItems).set({
          status: 'rejected', warningsJson: ['Существующий факт прошёл строгую редакторскую проверку и оставлен без изменений.'],
          confidenceJson: { outcome: 'kept_existing', critic: { decision: critic.decision, confidence: critic.confidence, reason: critic.reason }, usage },
          rawResultRef: critic.responseId || null, errorCode: null, safeErrorMessage: null, updatedAt: new Date(),
        }).where(eq(pipelineRunItems.id, item.id))
      } else {
        generation = await requestWithRetries(() => requestNormalization({
          apiKey: environment.OPENAI_API_KEY, proxyUrl: environment.MUSIC_OUTBOUND_PROXY_URL,
          model: 'gpt-5-nano', webSearch: true, webSearchRequired: true, mode: 'city', field: 'facts', prompt: WEB_FACT_PROMPT,
          payload: { ...before, facts: oldFact ? [oldFact] : [], rejectedFact: oldFact || 'нет' },
          contextFields: ['country', 'plotHint', 'rejectedFact'], availableFields: ['rejectedFact'], cardId: item.entityKey,
        }))
        const invalid = generatedFactProblem(before, generation)
        if (invalid) throw new Error(`CITY_WEB_FACT_INVALID: ${invalid}`)
        const fact = text((generation.value as unknown[])[0])
        finalCritic = await requestWithRetries(() => requestNormalization({
          apiKey: environment.OPENAI_API_KEY, proxyUrl: environment.MUSIC_OUTBOUND_PROXY_URL,
          model: 'gpt-5-nano', webSearch: false, mode: 'city', field: 'facts', prompt: FINAL_CRITIC_PROMPT,
          payload: { ...before, facts: [fact], evidence: generation!.reason },
          contextFields: ['country', 'plotHint', 'evidence'], availableFields: ['evidence'], cardId: item.entityKey,
        }))
        if (!criticKept(before, fact, finalCritic)) throw new Error(`CITY_WEB_FACT_INVALID: final editor rejected: ${finalCritic.reason || finalCritic.decision}`)
        const usage = usageSummary(critic, generation, finalCritic)
        await db.update(pipelineRunItems).set({
          status: 'review_required', proposedJson: { ...before, facts: [fact] }, warningsJson: [],
          sourcesJson: { ...source, sourceUrls: generation.sourceUrls, evidence: generation.reason },
          confidenceJson: { outcome: 'regenerated', critic: critic ? { decision: critic.decision, confidence: critic.confidence, reason: critic.reason } : null, generation: { confidence: generation.confidence }, finalCritic: { confidence: finalCritic.confidence, reason: finalCritic.reason }, usage },
          rawResultRef: generation.responseId || null, errorCode: null, safeErrorMessage: null, updatedAt: new Date(),
        }).where(eq(pipelineRunItems.id, item.id))
      }
    } catch (error) {
      const usage = usageSummary(critic, generation, finalCritic)
      await db.update(pipelineRunItems).set({
        status: 'failed', confidenceJson: { outcome: 'failed', usage }, errorCode: /CITY_WEB_FACT_INVALID/.test(safeError(error)) ? 'CITY_WEB_FACT_INVALID' : 'CITY_WEB_FACT_GENERATION_FAILED',
        safeErrorMessage: safeError(error), updatedAt: new Date(),
      }).where(eq(pipelineRunItems.id, item.id))
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
    where run_id = ${runId}::uuid and status = 'failed' returning id
  `)
  const count = Array.from(updated as Iterable<unknown>).length
  if (count) await db.update(pipelineRuns).set({ status: 'queued', finishedAt: null }).where(eq(pipelineRuns.id, runId))
  return { runId, queued: count }
}

try {
  const result = action === 'prepare' ? await prepare()
    : action === 'work' ? await work()
      : action === 'status' ? await status()
        : await retry()
  console.log(JSON.stringify(result, null, 2))
} finally {
  await client.end()
}
