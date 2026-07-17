import { createHash } from 'node:crypto'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { ContentMode, TitleItem } from '@shoditsa/contracts'
import {
  appSettings, auditLog, contentAliases, contentItems, contentItemVersions, contentRevisionModes, contentRevisions,
  contentWorkspaceChanges, contentWorkspaces, diagnosisVignettes, type Database,
} from '@shoditsa/database'
import { isAllowedInRegularGame, normalize } from '@shoditsa/game-core'
import { ApiError } from '../../lib/errors.js'

type Actor = { id: string }
type WorkspaceInput = {
  mode: ContentMode
  payload: Record<string, unknown>
  expectedVersion: number
  source?: 'manual' | 'ai_pipeline' | 'bulk' | 'import' | 'rollback' | 'report_fix'
  reason?: string
  pipelineRunId?: string
  pipelineRunItemId?: string
}

export type ValidationIssue = { level: 'error' | 'warning'; field: string; code: string; message: string }

const asRecord = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null
const contentModes: ContentMode[] = ['movie', 'series', 'anime', 'game', 'music', 'diagnosis', 'city']

export const validateContentPayload = (payload: Record<string, unknown>, mode: ContentMode): ValidationIssue[] => {
  const issues: ValidationIssue[] = []
  const error = (field: string, code: string, message: string) => issues.push({ level: 'error', field, code, message })
  const warning = (field: string, code: string, message: string) => issues.push({ level: 'warning', field, code, message })
  if (!text(payload.id)) error('id', 'required', 'У карточки должен быть ID')
  if (payload.mode !== mode) error('mode', 'mode_mismatch', 'Режим карточки не совпадает с выбранной категорией')
  if (!text(payload.titleRu)) error('titleRu', 'required', 'Укажите русское название')
  if (typeof payload.titleOriginal !== 'string') error('titleOriginal', 'invalid_type', 'Оригинальное название должно быть строкой')
  if (!Array.isArray(payload.alternativeTitles)) error('alternativeTitles', 'invalid_type', 'Альтернативные названия должны быть массивом')
  const year = number(payload.year)
  if (payload.year != null && (year == null || !Number.isInteger(year) || year < 1800 || year > 2200)) error('year', 'invalid_range', 'Год должен быть от 1800 до 2200')
  const activityStartYear = number(payload.activityStartYear)
  if (payload.activityStartYear != null && (activityStartYear == null || !Number.isInteger(activityStartYear) || activityStartYear < 1800 || activityStartYear > new Date().getUTCFullYear() + 1)) error('activityStartYear', 'invalid_range', 'Начало деятельности должно быть годом от 1800 до текущего')
  const media = [payload.posterUrl, payload.headerUrl, payload.backdropUrl, ...(Array.isArray(payload.screenshots) ? payload.screenshots : [])]
  for (const value of media) {
    if (value != null && value !== '' && (typeof value !== 'string' || !/^(https?:\/\/|(?:\.\/)?\/?(?:data|media|images)\/)/.test(value))) {
      error('media', 'invalid_url', 'Медиа должно использовать HTTPS или разрешённый внутренний путь')
      break
    }
  }
  if (mode === 'music' && typeof payload.allowedInGame !== 'boolean') error('allowedInGame', 'required', 'Для музыки нужен явный статус участия в игре')
  if (mode === 'music' && payload.year != null) warning('year', 'legacy_music_year', 'Для музыки используйте activityStartYear; поле year неоднозначно и не показывается игрокам')
  if (mode === 'diagnosis' && !(Array.isArray(payload.icd10) && payload.icd10.length) && !text(payload.icdGroup)) error('icd10', 'required', 'Укажите ICD-10 или группу диагноза')
  if (mode === 'city' && !text(payload.country)) error('country', 'required', 'Укажите страну города')
  if (mode === 'city' && !text(payload.continent)) error('continent', 'required', 'Укажите континент города')
  if (mode === 'city' && number(payload.population) == null) warning('population', 'missing_population', 'Население города не заполнено')
  if (mode === 'anime' && Array.isArray(payload.facts)) {
    const modelFacts = new Set([
      text(payload.animeKind) ? `Формат: ${text(payload.animeKind)}` : '',
      text(payload.animeStatus) ? `Статус: ${text(payload.animeStatus)}` : '',
      number(payload.episodes) != null ? `Эпизоды: ${number(payload.episodes)}` : '',
      number(payload.animeEpisodesAired) != null ? `Вышло эпизодов: ${number(payload.animeEpisodesAired)}` : '',
    ].map(normalize).filter(Boolean))
    const duplicatedFacts = payload.facts.map(text).filter((fact) => fact && modelFacts.has(normalize(fact)))
    if (duplicatedFacts.length) error('facts', 'duplicate_model_fact', 'Интересные факты не должны повторять формат, статус или количество эпизодов')
  }
  const hint = text(payload.plotHint)
  if (!hint) warning('plotHint', 'missing_hint', 'Подсказка не заполнена')
  if (hint && hint.length < 20) warning('plotHint', 'short_hint', 'Подсказка слишком короткая')
  if (hint && /(?:\.\.\.|…)\s*$/.test(hint)) error('plotHint', 'truncated_hint', 'Подсказка не должна заканчиваться многоточием')
  if (hint && text(payload.titleRu) && normalize(hint).includes(normalize(text(payload.titleRu)))) error('plotHint', 'answer_leak', 'Подсказка содержит название ответа')
  if (hint && /(?:json|undefined|null|nan|stack trace|exception|http(?:s)?:\/\/|\bapi\b|\bid\s*[:=])/i.test(hint)) error('plotHint', 'technical_leak', 'Подсказка содержит технический текст')
  return issues
}

const changedFields = (before: Record<string, unknown> | null, after: Record<string, unknown>) => {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after)])
  return [...keys].filter((key) => JSON.stringify(before?.[key]) !== JSON.stringify(after[key])).sort()
}

const validationIssueKey = (issue: ValidationIssue) => `${issue.field}:${issue.code}`
const validationIssueDependsOnChangedField = (issue: ValidationIssue, fields: Set<string>) => {
  if (fields.has(issue.field)) return true
  if (issue.field === 'media') return ['posterUrl', 'headerUrl', 'backdropUrl', 'screenshots'].some((field) => fields.has(field))
  if (issue.field === 'plotHint') return fields.has('titleRu')
  return false
}

/**
 * Existing content predates some of the current validation rules. Editing one
 * field must not be blocked by an unrelated legacy defect, while a new defect
 * (or a still-invalid field that was edited) must remain a hard error.
 */
export const blockingContentValidationIssues = (
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
  mode: ContentMode,
) => {
  const afterErrors = validateContentPayload(after, mode).filter((issue) => issue.level === 'error')
  if (!before) return afterErrors
  const beforeErrors = new Set(validateContentPayload(before, mode).filter((issue) => issue.level === 'error').map(validationIssueKey))
  const fields = new Set(changedFields(before, after))
  return afterErrors.filter((issue) => !beforeErrors.has(validationIssueKey(issue)) || validationIssueDependsOnChangedField(issue, fields))
}

const activeRevision = async (db: Database) => {
  const rows = await db.select().from(contentRevisions).where(eq(contentRevisions.status, 'active')).limit(1)
  if (!rows[0]) throw new ApiError(409, 'ACTIVE_REVISION_REQUIRED', 'Активная ревизия контента не найдена')
  return rows[0]
}

export const getOrCreateWorkspace = async (db: Database, actor: Actor) => {
  const existing = await db.select().from(contentWorkspaces)
    .where(sql`${contentWorkspaces.status} in ('open','building','ready')`).limit(1)
  if (existing[0]) return existing[0]
  const active = await activeRevision(db)
  const created = await db.insert(contentWorkspaces).values({ baseRevisionId: active.id, createdBy: actor.id }).returning()
  return created[0]
}

export const workspaceSummary = async (db: Database, actor: Actor) => {
  const workspace = await getOrCreateWorkspace(db, actor)
  const stats = await db.select({
    changesCount: sql<number>`count(*)::int`,
    errorsCount: sql<number>`coalesce(sum(case when ${contentWorkspaceChanges.validationIssues} @> '[{"level":"error"}]'::jsonb then 1 else 0 end),0)::int`,
    warningsCount: sql<number>`coalesce(sum(case when ${contentWorkspaceChanges.validationIssues} @> '[{"level":"warning"}]'::jsonb then 1 else 0 end),0)::int`,
  }).from(contentWorkspaceChanges).where(eq(contentWorkspaceChanges.workspaceId, workspace.id))
  return { ...workspace, ...(stats[0] ?? { changesCount: 0, errorsCount: 0, warningsCount: 0 }) }
}

export const saveWorkspaceItem = async (db: Database, actor: Actor, itemId: string, input: WorkspaceInput, requestId: string) => db.transaction(async (tx) => {
  const workspace = await getOrCreateWorkspace(db, actor)
  if (workspace.status !== 'open') throw new ApiError(409, 'WORKSPACE_LOCKED', 'Рабочая версия сейчас недоступна для изменений')
  const existingChange = await tx.select().from(contentWorkspaceChanges).where(and(
    eq(contentWorkspaceChanges.workspaceId, workspace.id), eq(contentWorkspaceChanges.itemId, itemId),
  )).for('update').limit(1)
  const currentVersion = existingChange[0]?.version ?? 0
  if (currentVersion !== input.expectedVersion) throw new ApiError(409, 'WORKSPACE_VERSION_CONFLICT', 'Карточка уже изменена в другом окне', {
    expectedVersion: input.expectedVersion, currentVersion, current: existingChange[0] ?? null,
  })
  const base = await tx.select({
    id: contentItemVersions.id, payload: contentItemVersions.payload, mode: contentItemVersions.mode, allowedInGame: contentItemVersions.allowedInGame,
  }).from(contentItemVersions).where(and(
    eq(contentItemVersions.revisionId, workspace.baseRevisionId), eq(contentItemVersions.itemId, itemId),
  )).limit(1)
  const beforePayload = base[0] ? asRecord(base[0].payload) : null
  const payload = { ...input.payload, id: itemId, mode: input.mode }
  const issues = validateContentPayload(payload, input.mode)
  const blockingIssues = blockingContentValidationIssues(beforePayload, payload, input.mode)
  if (blockingIssues.length) throw new ApiError(422, 'CONTENT_VALIDATION_FAILED', 'Карточка содержит новые ошибки в изменённых полях', { fieldErrors: blockingIssues })
  if (base[0] && base[0].mode !== input.mode) throw new ApiError(409, 'CONTENT_MODE_IMMUTABLE', 'Категорию существующей карточки изменить нельзя')
  if (!base[0]) {
    await tx.insert(contentItems).values({ id: itemId, mode: input.mode }).onConflictDoNothing()
    const identity = await tx.select({ mode: contentItems.mode }).from(contentItems).where(eq(contentItems.id, itemId)).limit(1)
    if (identity[0]?.mode !== input.mode) throw new ApiError(409, 'CONTENT_ID_TAKEN', 'Этот ID уже занят карточкой другой категории')
  }
  const fields = changedFields(beforePayload, payload)
  const changeType = !base[0] ? 'create' : input.payload['allowedInGame'] === false && beforePayload?.allowedInGame !== false ? 'disable' : 'update'
  const values = {
    workspaceId: workspace.id, itemId, mode: input.mode, changeType,
    baseItemVersionId: base[0]?.id ?? null, beforePayload, afterPayload: payload, changedFields: fields,
    source: input.source ?? 'manual', actorUserId: actor.id, reason: input.reason ?? null,
    pipelineRunId: input.pipelineRunId ?? null, pipelineRunItemId: input.pipelineRunItemId ?? null,
    version: currentVersion + 1, validationIssues: issues, updatedAt: new Date(),
  } as const
  const rows = existingChange[0]
    ? await tx.update(contentWorkspaceChanges).set(values).where(eq(contentWorkspaceChanges.id, existingChange[0].id)).returning()
    : await tx.insert(contentWorkspaceChanges).values(values).returning()
  await tx.update(contentWorkspaces).set({ version: sql`${contentWorkspaces.version} + 1`, updatedAt: new Date(), lastValidationSummary: null }).where(eq(contentWorkspaces.id, workspace.id))
  await tx.insert(auditLog).values({ actorUserId: actor.id, action: 'content.workspace.save', entityType: 'content_item', entityId: itemId, before: existingChange[0] ?? beforePayload, after: rows[0], reason: input.reason, requestId })
  return rows[0]
})

export const discardWorkspaceItem = async (db: Database, actor: Actor, itemId: string, requestId: string) => db.transaction(async (tx) => {
  const workspace = await getOrCreateWorkspace(db, actor)
  if (workspace.status !== 'open') throw new ApiError(409, 'WORKSPACE_LOCKED', 'Рабочая версия сейчас недоступна для изменений')
  const before = await tx.select().from(contentWorkspaceChanges).where(and(eq(contentWorkspaceChanges.workspaceId, workspace.id), eq(contentWorkspaceChanges.itemId, itemId))).limit(1)
  if (!before[0]) return { discarded: false }
  await tx.delete(contentWorkspaceChanges).where(eq(contentWorkspaceChanges.id, before[0].id))
  await tx.update(contentWorkspaces).set({ version: sql`${contentWorkspaces.version} + 1`, updatedAt: new Date() }).where(eq(contentWorkspaces.id, workspace.id))
  await tx.insert(auditLog).values({ actorUserId: actor.id, action: 'content.workspace.discard', entityType: 'content_item', entityId: itemId, before: before[0], after: null, requestId })
  return { discarded: true }
})

export const validateWorkspace = async (db: Database, actor: Actor) => {
  const workspace = await getOrCreateWorkspace(db, actor)
  const changes = await db.select().from(contentWorkspaceChanges).where(eq(contentWorkspaceChanges.workspaceId, workspace.id))
  const issues = changes.flatMap((change) => validateContentPayload(asRecord(change.afterPayload), change.mode).map((issue) => ({ ...issue, itemId: change.itemId })))
  const summary = {
    checked: changes.length,
    errors: issues.filter((issue) => issue.level === 'error').length,
    warnings: issues.filter((issue) => issue.level === 'warning').length,
    issues,
    validatedAt: new Date().toISOString(),
  }
  await db.update(contentWorkspaces).set({ lastValidationSummary: summary, updatedAt: new Date() }).where(eq(contentWorkspaces.id, workspace.id))
  return summary
}

const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]))
  : value
const sha256 = (value: unknown) => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')
export const contentPayloadsEqual = (left: unknown, right: unknown) => sha256(left) === sha256(right)

const aliasesFor = (payload: Record<string, unknown>) => {
  const entries: Array<[unknown, string]> = [
    [payload.titleRu, 'ru'], [payload.titleOriginal, 'original'],
    ...(Array.isArray(payload.alternativeTitles) ? payload.alternativeTitles.map((entry) => [entry, 'alternative'] as [unknown, string]) : []),
    ...(Array.isArray(payload.aliases) ? payload.aliases.map((entry) => [entry, 'external'] as [unknown, string]) : []),
  ]
  const unique = new Map<string, { alias: string; normalizedAlias: string; kind: string }>()
  for (const [entry, kind] of entries) {
    const alias = text(entry); const normalizedAlias = normalize(alias)
    if (alias && normalizedAlias && !unique.has(normalizedAlias)) unique.set(normalizedAlias, { alias, normalizedAlias, kind })
  }
  return [...unique.values()]
}

export const buildWorkspaceRevision = async (db: Database, actor: Actor, workspaceId: string, requestId: string) => {
  try {
    return await db.transaction(async (tx) => {
      const workspaces = await tx.select().from(contentWorkspaces).where(eq(contentWorkspaces.id, workspaceId)).for('update').limit(1)
      const workspace = workspaces[0]
      if (!workspace || !['open', 'building'].includes(workspace.status)) throw new ApiError(409, 'WORKSPACE_NOT_BUILDABLE', 'Рабочая версия не готова к сборке')
      const active = await tx.select().from(contentRevisions).where(eq(contentRevisions.status, 'active')).limit(1)
      if (!active[0] || active[0].id !== workspace.baseRevisionId) throw new ApiError(409, 'WORKSPACE_REBASE_REQUIRED', 'Активная ревизия изменилась; требуется перепроверить конфликты')
      await tx.update(contentWorkspaces).set({ status: 'building', lockedAt: new Date(), updatedAt: new Date() }).where(eq(contentWorkspaces.id, workspace.id))
      const [baseRows, changes, baseVignettes] = await Promise.all([
        tx.select().from(contentItemVersions).where(eq(contentItemVersions.revisionId, workspace.baseRevisionId)).orderBy(asc(contentItemVersions.mode), asc(contentItemVersions.sortOrder)),
        tx.select().from(contentWorkspaceChanges).where(eq(contentWorkspaceChanges.workspaceId, workspace.id)),
        tx.select({ itemVersionId: diagnosisVignettes.itemVersionId, id: diagnosisVignettes.id, text: diagnosisVignettes.text, sortOrder: diagnosisVignettes.sortOrder }).from(diagnosisVignettes)
          .innerJoin(contentItemVersions, eq(contentItemVersions.id, diagnosisVignettes.itemVersionId)).where(eq(contentItemVersions.revisionId, workspace.baseRevisionId)),
      ])
      const changesByItem = new Map(changes.map((change) => [change.itemId, change]))
      const baseByItem = new Map(baseRows.map((row) => [row.itemId, row]))
      const merged = baseRows.map((row) => ({ base: row, change: changesByItem.get(row.itemId), payload: asRecord(changesByItem.get(row.itemId)?.afterPayload ?? row.payload) }))
      for (const change of changes) if (!baseByItem.has(change.itemId)) merged.push({ base: null as never, change, payload: asRecord(change.afterPayload) })
      // The active revision can contain legacy records created before a newer validation rule.
      // A workspace build must block regressions in changed cards, not unrelated unchanged records.
      const changedEntries = merged.filter((entry) => entry.change)
      const changedIssues = changedEntries.flatMap((entry) => validateContentPayload(entry.payload, entry.change!.mode as ContentMode).map((issue) => ({ ...issue, itemId: text(entry.payload.id) })))
      const blockingIssues = changedEntries.flatMap((entry) => blockingContentValidationIssues(entry.change!.beforePayload ? asRecord(entry.change!.beforePayload) : null, entry.payload, entry.change!.mode as ContentMode).map((issue) => ({ ...issue, itemId: text(entry.payload.id) })))
      if (blockingIssues.length) throw new ApiError(422, 'WORKSPACE_VALIDATION_FAILED', 'Сборка остановлена из-за новых ошибок в изменённых полях', { fieldErrors: blockingIssues.slice(0, 200) })
      const changedWarnings = changedIssues.filter((issue) => issue.level === 'warning')
      const baseModeCounts = new Map<ContentMode, number>()
      const nextModeCounts = new Map<ContentMode, number>()
      for (const row of baseRows) baseModeCounts.set(row.mode, (baseModeCounts.get(row.mode) ?? 0) + 1)
      for (const entry of merged) {
        const mode = (entry.change?.mode ?? entry.base.mode) as ContentMode
        nextModeCounts.set(mode, (nextModeCounts.get(mode) ?? 0) + 1)
      }
      for (const mode of contentModes) {
        const before = baseModeCounts.get(mode) ?? 0; const after = nextModeCounts.get(mode) ?? 0
        if (before > 0 && after < Math.ceil(before * .95)) throw new ApiError(409, 'CONTENT_MODE_COUNT_DROP_GUARD', `Защита от потери данных: в режиме ${mode} количество карточек уменьшилось более чем на 5%`, { mode, before, after })
        if (before > 0 && after === 0) throw new ApiError(409, 'CONTENT_MODE_EMPTY_GUARD', `Режим ${mode} не может стать пустым`, { mode, before, after })
      }
      const checksum = sha256(merged.map((entry) => entry.payload))
      const existing = await tx.select({ id: contentRevisions.id }).from(contentRevisions).where(eq(contentRevisions.checksumSha256, checksum)).limit(1)
      if (existing[0]) throw new ApiError(409, 'REVISION_CHECKSUM_EXISTS', 'Ревизия с таким содержимым уже существует')
      const version = `admin-${new Date().toISOString().replace(/[-:.]/g, '')}-${checksum.slice(0, 8)}`
      const revision = (await tx.insert(contentRevisions).values({
        version, checksumSha256: checksum, status: 'importing', createdBy: actor.id,
        sourceManifest: { source: 'admin_workspace', workspaceId, baseRevisionId: workspace.baseRevisionId, changedItems: changes.length },
      }).returning())[0]
      const modeCounts = new Map<ContentMode, number>()
      const modeSort = new Map<ContentMode, number>()
      const baseVignettesByVersion = new Map<string, typeof baseVignettes>()
      for (const row of baseVignettes) baseVignettesByVersion.set(row.itemVersionId, [...(baseVignettesByVersion.get(row.itemVersionId) ?? []), row])
      for (let offset = 0; offset < merged.length; offset += 250) {
        const chunk = merged.slice(offset, offset + 250)
        const versionRows = chunk.map((entry) => {
          const payload = entry.payload
          const mode = (entry.change?.mode ?? entry.base.mode) as ContentMode
          const sortOrder = modeSort.get(mode) ?? 0; modeSort.set(mode, sortOrder + 1); modeCounts.set(mode, (modeCounts.get(mode) ?? 0) + 1)
          return {
            itemId: text(payload.id), revisionId: revision.id, mode,
            titleRu: text(payload.titleRu), titleOriginal: text(payload.titleOriginal), normalizedTitle: normalize(text(payload.titleRu)),
            year: number(payload.year), endYear: number(payload.endYear), popularityScore: number(payload.popularityScore) ?? 0,
            topRank: number(payload.topRank), sortOrder, allowedInGame: mode === 'city' ? payload.allowedInGame !== false : isAllowedInRegularGame(payload as TitleItem),
            contentStatus: text(payload.contentStatus) || null, payload,
          }
        })
        const inserted = await tx.insert(contentItemVersions).values(versionRows).returning({ id: contentItemVersions.id, itemId: contentItemVersions.itemId })
        const insertedByItem = new Map(inserted.map((row) => [row.itemId, row.id]))
        const aliases = chunk.flatMap((entry) => aliasesFor(entry.payload).map((alias) => ({ itemVersionId: insertedByItem.get(text(entry.payload.id))!, ...alias })))
        if (aliases.length) await tx.insert(contentAliases).values(aliases)
        const vignetteRows = chunk.flatMap((entry) => {
          if ((entry.change?.mode ?? entry.base.mode) !== 'diagnosis') return []
          const fromPayload = Array.isArray(entry.payload.caseVignettes) ? entry.payload.caseVignettes : null
          const values = fromPayload?.map((value, index) => ({ id: text(asRecord(value).id) || `${text(entry.payload.id)}:${index + 1}`, text: text(asRecord(value).text), sortOrder: index }))
            ?? (entry.base ? baseVignettesByVersion.get(entry.base.id) ?? [] : [])
          return values.filter((value) => value.text).map((value) => ({ id: `${revision.id.slice(0, 8)}:${value.id}`, itemVersionId: insertedByItem.get(text(entry.payload.id))!, text: value.text, sortOrder: value.sortOrder }))
        })
        if (vignetteRows.length) await tx.insert(diagnosisVignettes).values(vignetteRows)
      }
      await tx.insert(contentRevisionModes).values([...modeCounts].map(([mode, itemsCount]) => ({ revisionId: revision.id, mode, itemsCount, sourceChecksum: sha256(merged.filter((entry) => (entry.change?.mode ?? entry.base.mode) === mode).map((entry) => entry.payload)) })))
      await tx.update(contentRevisions).set({ status: 'ready' }).where(eq(contentRevisions.id, revision.id))
      await tx.update(contentWorkspaces).set({ status: 'ready', builtRevisionId: revision.id, updatedAt: new Date(), lastValidationSummary: { errors: 0, warnings: changedWarnings.length, issues: changedWarnings.slice(0, 200) } }).where(eq(contentWorkspaces.id, workspace.id))
      await tx.insert(auditLog).values({ actorUserId: actor.id, action: 'content.workspace.build', entityType: 'content_workspace', entityId: workspace.id, before: { baseRevisionId: workspace.baseRevisionId }, after: { builtRevisionId: revision.id, checksum, counts: Object.fromEntries(modeCounts) }, requestId })
      return { workspaceId: workspace.id, revisionId: revision.id, version, checksum, counts: Object.fromEntries(modeCounts), warnings: changedWarnings }
    })
  } catch (error) {
    const code = error instanceof ApiError ? error.code : 'REVISION_BUILD_FAILED'
    const message = error instanceof ApiError ? error.message : 'Не удалось собрать ревизию'
    await db.update(contentWorkspaces).set({ status: error instanceof ApiError ? 'open' : 'failed', lockedAt: null, failureCode: code, safeFailureMessage: message, updatedAt: new Date() }).where(eq(contentWorkspaces.id, workspaceId))
    throw error
  }
}

export const activateWorkspaceRevision = async (db: Database, actor: Actor, workspaceId: string, requestId: string) => db.transaction(async (tx) => {
  const workspace = (await tx.select().from(contentWorkspaces).where(eq(contentWorkspaces.id, workspaceId)).for('update').limit(1))[0]
  if (!workspace?.builtRevisionId || workspace.status !== 'ready') throw new ApiError(409, 'WORKSPACE_NOT_READY', 'Сначала соберите и проверьте рабочую версию')
  const revision = (await tx.select().from(contentRevisions).where(eq(contentRevisions.id, workspace.builtRevisionId)).for('update').limit(1))[0]
  if (!revision || revision.status !== 'ready') throw new ApiError(409, 'REVISION_NOT_READY', 'Собранная ревизия не готова к активации')
  await tx.update(contentRevisions).set({ status: 'retired' }).where(eq(contentRevisions.status, 'active'))
  await tx.update(contentRevisions).set({ status: 'active', activatedAt: new Date() }).where(eq(contentRevisions.id, revision.id))
  await tx.insert(appSettings).values({ key: 'active_content_revision_id', value: revision.id, updatedBy: actor.id }).onConflictDoUpdate({ target: appSettings.key, set: { value: revision.id, updatedBy: actor.id, updatedAt: new Date(), version: sql`${appSettings.version} + 1` } })
  await tx.update(contentWorkspaces).set({ status: 'published', publishedAt: new Date(), updatedAt: new Date() }).where(eq(contentWorkspaces.id, workspace.id))
  const next = (await tx.insert(contentWorkspaces).values({ baseRevisionId: revision.id, createdBy: actor.id }).returning())[0]
  await tx.insert(auditLog).values({ actorUserId: actor.id, action: 'content.workspace.activate', entityType: 'content_revision', entityId: revision.id, before: { workspaceId }, after: { status: 'active', nextWorkspaceId: next.id }, requestId })
  return { revision, workspace: next }
})

export const activateContentRevision = async (db: Database, actor: Actor, revisionId: string, requestId: string, reason?: string) => db.transaction(async (tx) => {
  const target = (await tx.select().from(contentRevisions).where(eq(contentRevisions.id, revisionId)).for('update').limit(1))[0]
  if (!target || !['ready', 'retired', 'active'].includes(target.status)) throw new ApiError(422, 'REVISION_NOT_ACTIVATABLE', 'Ревизия не готова к активации или откату')
  const current = (await tx.select().from(contentRevisions).where(eq(contentRevisions.status, 'active')).for('update').limit(1))[0]
  const targetBaseRevisionId = text(asRecord(target.sourceManifest).baseRevisionId)
  if (target.status === 'ready' && targetBaseRevisionId && current?.id !== targetBaseRevisionId) {
    throw new ApiError(409, 'REVISION_BASE_CHANGED', 'После сборки активный контент изменился. Пересоберите ревизию на актуальной базе перед активацией.', {
      builtFromRevisionId: targetBaseRevisionId, currentRevisionId: current?.id ?? null,
    })
  }
  const workspace = (await tx.select().from(contentWorkspaces).where(sql`${contentWorkspaces.status} in ('open','building','ready')`).for('update').limit(1))[0]
  let nextWorkspaceId = workspace?.id ?? null
  if (workspace && workspace.baseRevisionId !== revisionId) {
    const changes = (await tx.select({ count: sql<number>`count(*)::int` }).from(contentWorkspaceChanges).where(eq(contentWorkspaceChanges.workspaceId, workspace.id)))[0]?.count ?? 0
    if (changes > 0) throw new ApiError(409, 'CONTENT_WORKSPACE_CHANGES_PENDING', 'В рабочей версии есть несохранённые правки. Сначала опубликуйте их или удалите, затем переключите ревизию.', { workspaceId: workspace.id, changes })
    await tx.update(contentWorkspaces).set({ status: 'abandoned', lockedAt: null, updatedAt: new Date() }).where(eq(contentWorkspaces.id, workspace.id))
    nextWorkspaceId = (await tx.insert(contentWorkspaces).values({ baseRevisionId: revisionId, createdBy: actor.id }).returning({ id: contentWorkspaces.id }))[0].id
  } else if (!workspace) {
    nextWorkspaceId = (await tx.insert(contentWorkspaces).values({ baseRevisionId: revisionId, createdBy: actor.id }).returning({ id: contentWorkspaces.id }))[0].id
  }
  if (current?.id !== revisionId) {
    await tx.update(contentRevisions).set({ status: 'retired' }).where(eq(contentRevisions.status, 'active'))
    await tx.update(contentRevisions).set({ status: 'active', activatedAt: new Date() }).where(eq(contentRevisions.id, revisionId))
  }
  await tx.insert(appSettings).values({ key: 'active_content_revision_id', value: revisionId, updatedBy: actor.id }).onConflictDoUpdate({ target: appSettings.key, set: { value: revisionId, updatedBy: actor.id, updatedAt: new Date(), version: sql`${appSettings.version} + 1` } })
  await tx.insert(auditLog).values({ actorUserId: actor.id, action: current?.id === revisionId ? 'content.revision.activate.noop' : target.status === 'retired' ? 'content.revision.rollback' : 'content.revision.activate', entityType: 'content_revision', entityId: revisionId, before: current ?? null, after: { ...target, status: 'active', workspaceId: nextWorkspaceId }, reason, requestId })
  return { activated: revisionId, previousRevisionId: current?.id ?? null, rollback: target.status === 'retired', workspaceId: nextWorkspaceId }
})

export const loadWorkspaceChanges = (db: Database, workspaceId: string, itemIds?: string[]) => {
  const conditions = [eq(contentWorkspaceChanges.workspaceId, workspaceId)]
  if (itemIds?.length) conditions.push(inArray(contentWorkspaceChanges.itemId, itemIds))
  return db.select().from(contentWorkspaceChanges).where(and(...conditions))
}
