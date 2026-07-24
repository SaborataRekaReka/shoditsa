import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export const loadSeriesOverrides = async (root) => {
  const file = resolve(root, 'data/series/manual/overrides.json')
  const parsed = JSON.parse(await readFile(file, 'utf8'))
  if (!parsed || typeof parsed !== 'object' || !parsed.byId || typeof parsed.byId !== 'object') {
    throw new Error(`Invalid series overrides: ${file}`)
  }
  return parsed
}

export const applySeriesOverride = (item, overrides) => {
  if (!item || item.mode !== 'series') return item
  const id = typeof item.id === 'string'
    ? item.id
    : Number.isInteger(item.kinopoiskId) ? `kp_${item.kinopoiskId}` : null
  const override = id ? overrides.byId[id] : null
  if (!override) return item

  const merged = { ...item, ...override }
  merged.notes = [...new Set([...(item.notes ?? []), ...(override.notes ?? [])])]
  merged.dataQuality = {
    ...(item.dataQuality ?? {}),
    source: [...new Set([...(item.dataQuality?.source ?? []), 'series_manual_overrides'])],
  }
  return merged
}
