import { createHash, randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import type {
  ContentExchangeDocument, ContentExchangeExportBody, ContentExchangeImportApplyBody, ContentMode,
} from '@shoditsa/contracts'
import {
  auditLog, contentItems, contentItemVersions, contentRevisions, contentWorkspaceChanges, type Database,
} from '@shoditsa/database'
import { ApiError } from '../../lib/errors.js'
import { getOrCreateWorkspace, saveWorkspaceItem, validateContentPayload } from './content-service.js'

type Actor = { id: string }
type Json = Record<string, unknown>
type ImportStatus = 'create' | 'update' | 'unchanged' | 'conflict' | 'invalid'

const modes: ContentMode[] = ['movie', 'series', 'anime', 'game', 'music', 'diagnosis', 'city']
const fieldNamePattern = /^[A-Za-z][A-Za-z0-9_]*$/
const asRecord = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
const hasOwn = (value: Json, field: string) => Object.prototype.hasOwnProperty.call(value, field)
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value as Json).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, stable(entry)]))
  : value
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')
const fieldHash = (payload: Json, field: string) => hash(hasOwn(payload, field) ? { present: true, value: payload[field] } : { present: false })
const itemKey = (mode: ContentMode, id: string) => JSON.stringify([mode, id])

const unique = <T>(values: T[]) => [...new Set(values)]

const loadExchangeContext = async (db: Database, actor: Actor, itemIds: string[]) => {
  const workspace = await getOrCreateWorkspace(db, actor)
  const ids = unique(itemIds)
  const [revision, bases, drafts, identities] = await Promise.all([
    db.select({ id: contentRevisions.id, version: contentRevisions.version }).from(contentRevisions).where(eq(contentRevisions.id, workspace.baseRevisionId)).limit(1),
    db.select({ itemId: contentItemVersions.itemId, itemVersionId: contentItemVersions.id, mode: contentItemVersions.mode, payload: contentItemVersions.payload })
      .from(contentItemVersions).where(and(eq(contentItemVersions.revisionId, workspace.baseRevisionId), inArray(contentItemVersions.itemId, ids))),
    db.select({ itemId: contentWorkspaceChanges.itemId, mode: contentWorkspaceChanges.mode, payload: contentWorkspaceChanges.afterPayload, version: contentWorkspaceChanges.version })
      .from(contentWorkspaceChanges).where(and(eq(contentWorkspaceChanges.workspaceId, workspace.id), inArray(contentWorkspaceChanges.itemId, ids))),
    db.select({ id: contentItems.id, mode: contentItems.mode }).from(contentItems).where(inArray(contentItems.id, ids)),
  ])
  const baseById = new Map(bases.map((entry) => [entry.itemId, { ...entry, payload: asRecord(entry.payload) }]))
  const draftById = new Map(drafts.map((entry) => [entry.itemId, { ...entry, payload: asRecord(entry.payload) }]))
  const identityById = new Map(identities.map((entry) => [entry.id, entry.mode]))
  const effectiveById = new Map(ids.flatMap((id) => {
    const draft = draftById.get(id); const base = baseById.get(id)
    if (!draft && !base) return []
    return [[id, {
      id,
      mode: (draft?.mode ?? base?.mode) as ContentMode,
      payload: draft?.payload ?? base!.payload,
      itemVersionId: base?.itemVersionId ?? null,
      workspaceChangeVersion: draft?.version ?? null,
    }] as const]
  }))
  return { workspace, revision: revision[0] ?? null, baseById, draftById, identityById, effectiveById }
}

export const describeContentExchangeSelection = async (db: Database, actor: Actor, itemIds: string[]) => {
  const context = await loadExchangeContext(db, actor, itemIds)
  const requested = unique(itemIds)
  const found = requested.flatMap((id) => context.effectiveById.get(id) ? [context.effectiveById.get(id)!] : [])
  const fieldMap = new Map<string, { field: string; count: number; modes: Set<ContentMode> }>()
  for (const item of found) for (const field of Object.keys(item.payload)) {
    if (field === 'id' || field === 'mode' || !fieldNamePattern.test(field)) continue
    const current = fieldMap.get(field) ?? { field, count: 0, modes: new Set<ContentMode>() }
    current.count += 1; current.modes.add(item.mode); fieldMap.set(field, current)
  }
  return {
    requested: requested.length,
    found: found.length,
    missingItemIds: requested.filter((id) => !context.effectiveById.has(id)),
    modes: Object.fromEntries(modes.map((mode) => [mode, found.filter((item) => item.mode === mode).length])),
    fields: [...fieldMap.values()].sort((left, right) => left.field.localeCompare(right.field)).map((entry) => ({ ...entry, modes: [...entry.modes] })),
  }
}

export const exportContentExchange = async (db: Database, actor: Actor, body: ContentExchangeExportBody): Promise<ContentExchangeDocument> => {
  const context = await loadExchangeContext(db, actor, body.itemIds)
  if (body.fields.some((field) => field === 'id' || field === 'mode')) throw new ApiError(422, 'CONTENT_EXPORT_IDENTITY_FIELDS_RESERVED', 'ID и категория добавляются в служебную identity и не выбираются как payload-поля')
  const fields = unique(body.fields)
  const missing = unique(body.itemIds).filter((id) => !context.effectiveById.has(id))
  if (missing.length) throw new ApiError(404, 'CONTENT_EXPORT_ITEMS_NOT_FOUND', 'Часть выбранных карточек не найдена в рабочей версии', { missingItemIds: missing })
  const items = unique(body.itemIds).map((id) => {
    const current = context.effectiveById.get(id)!
    return {
      id,
      mode: current.mode,
      base: {
        revisionId: context.revision?.id ?? null,
        itemVersionId: current.itemVersionId,
        workspaceChangeVersion: current.workspaceChangeVersion,
        payloadHash: hash(current.payload),
        fieldHashes: Object.fromEntries(fields.map((field) => [field, fieldHash(current.payload, field)])),
      },
      data: Object.fromEntries(fields.filter((field) => hasOwn(current.payload, field)).map((field) => [field, current.payload[field]])),
      unsetFields: fields.filter((field) => !hasOwn(current.payload, field)),
    }
  })
  return {
    format: 'shoditsa-content-exchange',
    schemaVersion: 1,
    exportId: randomUUID(),
    exportedAt: new Date().toISOString(),
    source: {
      revisionId: context.revision?.id ?? null,
      revisionVersion: context.revision?.version ?? null,
      workspaceId: context.workspace.id,
      workspaceVersion: context.workspace.version,
    },
    fields,
    items,
  }
}

type InternalPreviewItem = {
  id: string
  mode: ContentMode
  status: ImportStatus
  title: string
  changedFields: string[]
  conflicts: string[]
  issues: ReturnType<typeof validateContentPayload>
  message: string | null
  desired: Json | null
  expectedVersion: number
}

const buildImportPreview = async (db: Database, actor: Actor, document: ContentExchangeDocument) => {
  const context = await loadExchangeContext(db, actor, document.items.map((item) => item.id))
  const selectedFields = new Set(document.fields)
  const reservedFields = document.fields.filter((field) => field === 'id' || field === 'mode')
  const seen = new Set<string>()
  const internalItems: InternalPreviewItem[] = document.items.map((item) => {
    const id = item.id.trim(); const mode = item.mode; const key = itemKey(mode, id)
    const current = context.effectiveById.get(id)
    const existingMode = context.identityById.get(id) ?? current?.mode
    const data = asRecord(item.data); const unsetFields = item.unsetFields ?? []
    const invalidFields = unique([...Object.keys(data), ...unsetFields]).filter((field) => !selectedFields.has(field) || field === 'id' || field === 'mode')
    const overlapping = unsetFields.filter((field) => hasOwn(data, field))
    const baseIssues: ReturnType<typeof validateContentPayload> = []
    let message: string | null = null
    if (item.id !== id) message = 'ID не должен начинаться или заканчиваться пробелами'
    else if (reservedFields.length) message = 'ID и категория должны находиться в identity, а не в списке payload-полей'
    else if (seen.has(key)) message = 'Дубликат ID и категории внутри файла'
    else if (existingMode && existingMode !== mode) message = `ID уже принадлежит категории «${existingMode}»`
    else if (invalidFields.length) message = `Поля вне экспортированного набора: ${invalidFields.join(', ')}`
    else if (overlapping.length) message = `Поля одновременно заданы и удалены: ${overlapping.join(', ')}`
    seen.add(key)
    if (message) return { id, mode, status: 'invalid', title: String(data.titleRu ?? current?.payload.titleRu ?? id), changedFields: [], conflicts: [], issues: baseIssues, message, desired: null, expectedVersion: context.draftById.get(id)?.version ?? 0 }

    const desired: Json = current ? { ...current.payload } : { id, mode }
    for (const [field, value] of Object.entries(data)) desired[field] = value
    for (const field of unsetFields) delete desired[field]
    desired.id = id; desired.mode = mode
    const changedFields = document.fields.filter((field) => fieldHash(current?.payload ?? {}, field) !== fieldHash(desired, field))
    const issues = validateContentPayload(desired, mode)
    if (issues.some((issue) => issue.level === 'error')) {
      return { id, mode, status: 'invalid', title: String(desired.titleRu ?? id), changedFields, conflicts: [], issues, message: 'Карточка не проходит проверку обязательных полей', desired, expectedVersion: context.draftById.get(id)?.version ?? 0 }
    }
    if (!current) return { id, mode, status: 'create', title: String(desired.titleRu ?? id), changedFields, conflicts: [], issues, message: null, desired, expectedVersion: 0 }
    if (!changedFields.length) return { id, mode, status: 'unchanged', title: String(desired.titleRu ?? id), changedFields, conflicts: [], issues, message: null, desired, expectedVersion: context.draftById.get(id)?.version ?? 0 }
    const conflicts = changedFields.filter((field) => item.base?.fieldHashes?.[field] && item.base.fieldHashes[field] !== fieldHash(current.payload, field))
    if (conflicts.length) return { id, mode, status: 'conflict', title: String(desired.titleRu ?? id), changedFields, conflicts, issues, message: 'Эти поля изменились в системе после экспорта', desired, expectedVersion: context.draftById.get(id)?.version ?? 0 }
    return { id, mode, status: 'update', title: String(desired.titleRu ?? id), changedFields, conflicts: [], issues, message: null, desired, expectedVersion: context.draftById.get(id)?.version ?? 0 }
  })
  const publicItems = internalItems.map(({ desired: _desired, expectedVersion: _expectedVersion, ...item }) => item)
  const summary = Object.fromEntries((['create', 'update', 'unchanged', 'conflict', 'invalid'] as ImportStatus[]).map((status) => [status, publicItems.filter((item) => item.status === status).length])) as Record<ImportStatus, number>
  const documentHash = hash(document)
  const previewHash = hash({ documentHash, workspaceId: context.workspace.id, workspaceVersion: context.workspace.version, items: publicItems })
  return { context, internalItems, response: { format: document.format, schemaVersion: document.schemaVersion, exportId: document.exportId, documentHash, previewHash, fields: document.fields, summary: { total: publicItems.length, ...summary }, items: publicItems } }
}

export const previewContentExchangeImport = async (db: Database, actor: Actor, document: ContentExchangeDocument) => (await buildImportPreview(db, actor, document)).response

export const applyContentExchangeImport = async (db: Database, actor: Actor, body: ContentExchangeImportApplyBody, requestId: string) => {
  const preview = await buildImportPreview(db, actor, body.document)
  if (preview.response.previewHash !== body.previewHash) throw new ApiError(409, 'CONTENT_IMPORT_PREVIEW_STALE', 'Рабочая версия изменилась после предварительной проверки. Проверьте файл ещё раз')
  const requested = new Set(body.items.map((item) => itemKey(item.mode, item.id.trim())))
  const selected = preview.internalItems.filter((item) => requested.has(itemKey(item.mode, item.id)))
  if (selected.length !== requested.size) throw new ApiError(422, 'CONTENT_IMPORT_SELECTION_INVALID', 'В выборе есть карточки, которых нет в импортируемом файле')
  const blocked = selected.filter((item) => item.status !== 'create' && item.status !== 'update')
  if (blocked.length) throw new ApiError(409, 'CONTENT_IMPORT_SELECTION_NOT_ACTIONABLE', 'Часть выбранных карточек нельзя применить', { items: blocked.map(({ id, mode, status }) => ({ id, mode, status })) })
  const results: Array<{ id: string; mode: ContentMode; status: 'staged' | 'failed'; error?: string }> = []
  for (const item of selected) {
    try {
      await saveWorkspaceItem(db, actor, item.id, {
        mode: item.mode,
        payload: item.desired!,
        expectedVersion: item.expectedVersion,
        source: 'import',
        reason: body.reason,
      }, requestId)
      results.push({ id: item.id, mode: item.mode, status: 'staged' })
    } catch (error) {
      results.push({ id: item.id, mode: item.mode, status: 'failed', error: error instanceof Error ? error.message : String(error) })
    }
  }
  const summary = { requested: selected.length, staged: results.filter((item) => item.status === 'staged').length, failed: results.filter((item) => item.status === 'failed').length }
  await db.insert(auditLog).values({
    actorUserId: actor.id,
    action: 'content.exchange.import',
    entityType: 'content_workspace',
    entityId: preview.context.workspace.id,
    before: { exportId: body.document.exportId, previewHash: body.previewHash },
    after: { summary, results },
    reason: body.reason,
    requestId,
  })
  return { summary, results }
}
