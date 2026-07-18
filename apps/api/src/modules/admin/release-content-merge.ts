import { createHash } from 'node:crypto'
import type { ContentMode } from '@shoditsa/contracts'
import type { LoadedReleaseLibrary, ReleaseContentItem } from './release-content-loader.js'

export type ActiveReleaseRow = {
  id: string
  itemId: string
  mode: ContentMode
  payload: unknown
  sortOrder: number
}

export type ReleaseMergeEntry = {
  source: 'release' | 'active'
  activeVersionId: string | null
  itemId: string
  mode: ContentMode
  payload: ReleaseContentItem
}

export type ReleaseMergeModePreview = {
  active: number
  release: number
  conflicted: number
  updated: number
  unchanged: number
  added: number
  preserved: number
  final: number
}

export type ReleaseMergePreview = {
  activeItems: number
  releaseItems: number
  conflicted: number
  modeConflicts: Array<{ itemId: string; activeMode: ContentMode; releaseMode: ContentMode }>
  updated: number
  unchanged: number
  added: number
  preserved: number
  deleted: 0
  finalItems: number
  modes: Record<ContentMode, ReleaseMergeModePreview>
}

const MODES: ContentMode[] = ['movie', 'series', 'anime', 'game', 'music', 'diagnosis', 'city']
const emptyModePreview = (): ReleaseMergeModePreview => ({ active: 0, release: 0, conflicted: 0, updated: 0, unchanged: 0, added: 0, preserved: 0, final: 0 })
const canonicalize = (value: unknown): unknown => Array.isArray(value)
  ? value.map(canonicalize)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]))
    : value
const canonicalJson = (value: unknown) => JSON.stringify(canonicalize(value))
const asTitleItem = (row: ActiveReleaseRow): ReleaseContentItem => {
  if (!row.payload || typeof row.payload !== 'object' || Array.isArray(row.payload)) throw new Error(`Active content payload is invalid: ${row.itemId}`)
  return row.payload as ReleaseContentItem
}

export const buildReleaseMergePlan = (activeRows: ActiveReleaseRow[], libraries: LoadedReleaseLibrary[]) => {
  const activeById = new Map(activeRows.map((row) => [row.itemId, row]))
  if (activeById.size !== activeRows.length) throw new Error('Active revision contains duplicate item IDs')
  const releaseIds = new Set<string>()
  const entries: ReleaseMergeEntry[] = []
  const modeConflicts: ReleaseMergePreview['modeConflicts'] = []
  const modes = Object.fromEntries(MODES.map((mode) => [mode, emptyModePreview()])) as Record<ContentMode, ReleaseMergeModePreview>

  for (const row of activeRows) modes[row.mode].active += 1
  for (const library of libraries) {
    for (const item of library.items) {
      if (releaseIds.has(item.id)) throw new Error(`Release contains duplicate item ID: ${item.id}`)
      const active = activeById.get(item.id)
      const modePreview = modes[library.mode]
      modePreview.release += 1
      if (active && active.mode !== library.mode) {
        modePreview.conflicted += 1
        modeConflicts.push({ itemId: item.id, activeMode: active.mode, releaseMode: library.mode })
        continue
      }
      releaseIds.add(item.id)
      const unchanged = active ? canonicalJson(active.payload) === canonicalJson(item) : false
      if (!active) modePreview.added += 1
      else if (unchanged) modePreview.unchanged += 1
      else modePreview.updated += 1
      entries.push({ source: 'release', activeVersionId: active?.id ?? null, itemId: item.id, mode: library.mode, payload: item })
    }
  }

  for (const mode of MODES) {
    const preserved = activeRows.filter((row) => row.mode === mode && !releaseIds.has(row.itemId)).sort((left, right) => left.sortOrder - right.sortOrder)
    for (const row of preserved) entries.push({ source: 'active', activeVersionId: row.id, itemId: row.itemId, mode, payload: asTitleItem(row) })
    modes[mode].preserved = preserved.length
    modes[mode].final = modes[mode].release - modes[mode].conflicted + preserved.length
    if (modes[mode].final < modes[mode].active) throw new Error(`Release merge would remove content in mode ${mode}`)
  }

  const preview: ReleaseMergePreview = {
    activeItems: activeRows.length,
    releaseItems: libraries.reduce((total, library) => total + library.items.length, 0),
    conflicted: modeConflicts.length,
    modeConflicts,
    updated: MODES.reduce((total, mode) => total + modes[mode].updated, 0),
    unchanged: MODES.reduce((total, mode) => total + modes[mode].unchanged, 0),
    added: MODES.reduce((total, mode) => total + modes[mode].added, 0),
    preserved: MODES.reduce((total, mode) => total + modes[mode].preserved, 0),
    deleted: 0,
    finalItems: entries.length,
    modes,
  }
  if (preview.finalItems < preview.activeItems) throw new Error('Release merge would reduce the active content total')
  return { entries, preview }
}

export const releaseMergeChecksum = (entries: ReleaseMergeEntry[]) => createHash('sha256')
  .update(canonicalJson(entries.map((entry) => ({ itemId: entry.itemId, mode: entry.mode, payload: entry.payload })))).digest('hex')

export const releaseMergeModeChecksum = (entries: ReleaseMergeEntry[], mode: ContentMode) => createHash('sha256')
  .update(canonicalJson(entries.filter((entry) => entry.mode === mode).map((entry) => ({ itemId: entry.itemId, payload: entry.payload })))).digest('hex')
