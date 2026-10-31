import { createHash } from 'node:crypto'
import type { Catalog, EditableQuestion, SvoyakWorkspace } from '@shoditsa/contracts/svoyak'
import { ApiError } from '../../lib/errors.js'

export function normalizeWorkspace(input: SvoyakWorkspace): SvoyakWorkspace {
  const value = structuredClone(input)
  const ids = new Set<string>(),
    packs = new Map(value.catalog.packs.map((p) => [p.id, p]))
  if (packs.size !== value.catalog.packs.length)
    throw new ApiError(422, 'PACK_DUPLICATE', 'ID паков должны быть уникальными')
  for (const p of packs.values())
    if (!p.title.trim()) throw new ApiError(422, 'PACK_TITLE_REQUIRED', 'Укажите название пака')
  for (const q of value.questions) {
    if (ids.has(q.id)) throw new ApiError(422, 'QUESTION_DUPLICATE', 'ID вопроса повторяется: ' + q.id)
    ids.add(q.id)
    const pack = packs.get(q.packId)
    if (!pack) throw new ApiError(422, 'PACK_REQUIRED', 'Выберите пак для вопроса ' + q.id)
    if (!q.prompt.trim() || !q.answer.trim() || !q.theme.trim() || !q.themeId.trim())
      throw new ApiError(422, 'QUESTION_INCOMPLETE', 'Заполните тему, вопрос и ответ: ' + q.id)
    if (!value.catalog.topics.some((t) => t.id === q.topic))
      throw new ApiError(422, 'TOPIC_REQUIRED', 'Выберите интерес для вопроса ' + q.id)
    q.packTitle = pack.title.trim()
    q.media = (q.media ?? []).map((m) => {
      let safe = /^\/media\/[a-zA-Z0-9/_.-]+$/.test(m.url) && !m.url.includes('..')
      try {
        const u = new URL(m.url)
        safe = u.protocol === 'https:' && !u.username && !u.password
      } catch {
        /* Relative media path. */
      }
      if (!safe) throw new ApiError(422, 'MEDIA_URL_INVALID', 'Медиа: используйте HTTPS или файл из хранилища сайта')
      return m
    })
    const { hash: _, enabled: _enabled, ...content } = q
    q.hash = createHash('sha256').update(JSON.stringify(content)).digest('hex')
  }
  const enabled = value.questions.filter((q) => q.enabled)
  const playableIds = playableQuestionIds(enabled)
  value.catalog = {
    ...value.catalog,
    localOnly: false,
    total: value.questions.length,
    playable: playableIds.size,
    packs: [...packs.values()].map((p) => ({
      ...p,
      total: value.questions.filter((q) => q.packId === p.id).length,
      playable: enabled.filter((q) => q.packId === p.id && playableIds.has(q.id)).length,
      topics: [...new Set(enabled.filter((q) => q.packId === p.id).map((q) => q.topic))],
    })),
    topics: value.catalog.topics.map((t) => ({
      ...t,
      playable: enabled.filter((q) => q.topic === t.id && playableIds.has(q.id)).length,
    })),
  }
  return value
}

export function playableQuestionIds(questions: EditableQuestion[]) {
  const groups = new Map<string, EditableQuestion[]>()
  for (const q of questions) {
    const key = `${q.themeId}:${q.topic}`
    groups.set(key, [...(groups.get(key) ?? []), q])
  }
  return new Set([...groups.values()].filter((g) => g.length >= 5).flatMap((g) => g.map((q) => q.id)))
}

export const revisionCatalog = (workspace: SvoyakWorkspace, revision: string): Catalog => ({
  ...workspace.catalog,
  revision,
})
