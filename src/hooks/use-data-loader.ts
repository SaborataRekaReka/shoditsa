import { useEffect, useState } from 'react'
import type { CaseVignetteMap, DiagnosisCaseVignettes, LibrarySearchIndex, TitleItem, TitleMode } from '../types'
import { MODE_CONFIG } from '../app/mode-config'

type ModeData = Record<TitleMode, TitleItem[]>
type ModeCounts = { movie: number | null; series: number | null; anime: number | null; game: number | null; music: number | null; diagnosis: number | null }
type ModeSearchIndexes = Record<TitleMode, LibrarySearchIndex | null>

const initialData: ModeData = { movie: [], series: [], anime: [], game: [], music: [], diagnosis: [] }
const initialCounts: ModeCounts = { movie: null, series: null, anime: null, game: null, music: null, diagnosis: null }
const initialSearchIndexes: ModeSearchIndexes = { movie: null, series: null, anime: null, game: null, music: null, diagnosis: null }
const toIntegerOrNull = (value: unknown) => {
  const parsed = Math.trunc(Number(value))
  return Number.isFinite(parsed) ? parsed : null
}

const requestCache = new Map<string, Promise<unknown>>()
const configuredMediaOrigin = String(import.meta.env.VITE_MEDIA_ORIGIN || '').trim().replace(/\/$/, '')
const mediaOrigin = configuredMediaOrigin || (import.meta.env.PROD ? 'https://shoditsa.ru' : '')

const withMediaOrigin = (value: unknown) => {
  const raw = String(value ?? '').trim()
  if (!raw || !mediaOrigin) return raw
  if (/^https?:\/\//i.test(raw)) return raw

  // Keep local/dev behavior for non-library paths; rewrite only data assets paths.
  if (!(raw.startsWith('./data/') || raw.startsWith('/data/'))) return raw

  const normalized = raw.startsWith('./') ? raw.slice(1) : raw
  return `${mediaOrigin}${normalized.startsWith('/') ? normalized : `/${normalized}`}`
}

const normalizeItemMediaUrls = (items: TitleItem[]) => {
  if (!mediaOrigin) return items

  return items.map((item) => {
    const next: TitleItem = {
      ...item,
      posterUrl: withMediaOrigin(item.posterUrl) || null,
      headerUrl: withMediaOrigin(item.headerUrl) || null,
      backdropUrl: withMediaOrigin(item.backdropUrl) || null,
      screenshots: Array.isArray(item.screenshots)
        ? item.screenshots.map((entry) => withMediaOrigin(entry)).filter(Boolean)
        : item.screenshots,
    }

    for (const [key, value] of Object.entries(next)) {
      if (!Array.isArray(value)) continue
      if (!value.length) continue

      const maybePeople = value as Array<Record<string, unknown>>
      const normalizedPeople = maybePeople.map((entry) => {
        if (!entry || typeof entry !== 'object') return entry
        if (!Object.prototype.hasOwnProperty.call(entry, 'photoUrl')) return entry
        return {
          ...entry,
          photoUrl: withMediaOrigin((entry as { photoUrl?: unknown }).photoUrl) || null,
        }
      })

      ;(next as unknown as Record<string, unknown>)[key] = normalizedPeople
    }

    return next
  })
}

const fetchJsonCached = async <T,>(url: string): Promise<T> => {
  if (!requestCache.has(url)) {
    requestCache.set(url, fetch(url, { cache: 'no-store' }).then(async (response) => {
      if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`)
      return response.json()
    }))
  }
  return requestCache.get(url) as Promise<T>
}

const loadModeItems = async (dataFile: string) => {
  try {
    return await fetchJsonCached<TitleItem[]>(`./data/libraries/${dataFile}/items.json`)
  } catch (primaryError) {
    try {
      return await fetchJsonCached<TitleItem[]>(`./data/${dataFile}.generated.json`)
    } catch (fallbackError) {
      const primaryMessage = primaryError instanceof Error ? primaryError.message : String(primaryError)
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
      throw new Error(`Failed to load dataset "${dataFile}". Primary source error: ${primaryMessage}. Fallback source error: ${fallbackMessage}`)
    }
  }
}

export const useDataLoader = (mode: TitleMode) => {
  const [data, setData] = useState<ModeData>(initialData)
  const [titleCounts, setTitleCounts] = useState<ModeCounts>(initialCounts)
  const [searchIndexes, setSearchIndexes] = useState<ModeSearchIndexes>(initialSearchIndexes)
  const [caseVignettes, setCaseVignettes] = useState<CaseVignetteMap>({})
  const [globalDailySalt, setGlobalDailySalt] = useState(0)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetchJsonCached<{ movieCount?: number; seriesCount?: number; animeCount?: number; gameCount?: number; musicCount?: number; diagnosisCount?: number }>('./data/source.json')
      .then((source) => {
        setTitleCounts((current) => ({
          movie: Number.isFinite(source.movieCount) ? source.movieCount! : current.movie,
          series: Number.isFinite(source.seriesCount) ? source.seriesCount! : current.series,
          anime: Number.isFinite(source.animeCount) ? source.animeCount! : current.anime,
          game: Number.isFinite(source.gameCount) ? source.gameCount! : current.game,
          music: Number.isFinite(source.musicCount) ? source.musicCount! : current.music,
          diagnosis: Number.isFinite(source.diagnosisCount) ? source.diagnosisCount! : current.diagnosis,
        }))

        const sourceSalt = toIntegerOrNull((source as { dailySalt?: number }).dailySalt)
        if (sourceSalt != null) setGlobalDailySalt(sourceSalt)
      })
      .catch(() => undefined)

    fetchJsonCached<{ globalSalt?: number; dailySalt?: number }>('./data/daily-config.json')
      .then((config) => {
        const configSalt = toIntegerOrNull(config.globalSalt ?? config.dailySalt)
        if (configSalt != null) setGlobalDailySalt(configSalt)
      })
      .catch(() => undefined)

    fetchJsonCached<DiagnosisCaseVignettes[]>('./data/diagnosis-case-vignettes.by-id.json')
      .then((entries) => {
        if (!Array.isArray(entries)) return
        const map: CaseVignetteMap = {}
        for (const entry of entries) {
          if (entry?.diagnosisId && Array.isArray(entry.caseVignettes)) map[entry.diagnosisId] = entry.caseVignettes
        }
        setCaseVignettes(map)
      })
      .catch(() => undefined)

    fetchJsonCached<TitleItem[]>('./data/diagnoses.generated.json')
      .then((items) => setTitleCounts((current) => ({ ...current, diagnosis: current.diagnosis ?? items.length })))
      .catch(() => undefined)

    fetchJsonCached<TitleItem[]>('./data/games.generated.json')
      .then((items) => setTitleCounts((current) => ({ ...current, game: current.game ?? items.length })))
      .catch(() => undefined)

    fetchJsonCached<TitleItem[]>('./data/animes.generated.json')
      .then((items) => setTitleCounts((current) => ({ ...current, anime: current.anime ?? items.length })))
      .catch(() => undefined)

    fetchJsonCached<TitleItem[]>('./data/music.generated.json')
      .then((items) => setTitleCounts((current) => ({ ...current, music: current.music ?? items.length })))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (searchIndexes[mode]) return
    const libraryKey = MODE_CONFIG[mode].dataFile
    fetchJsonCached<LibrarySearchIndex>(`./data/libraries/${libraryKey}/search-index.json`)
      .then((index) => {
        if (!index || typeof index !== 'object' || !index.tokenToIds) return
        setSearchIndexes((current) => ({ ...current, [mode]: index }))
      })
      .catch(() => undefined)
  }, [mode, searchIndexes])

  useEffect(() => {
    if (data[mode].length) return
    setLoading(true)
    loadModeItems(MODE_CONFIG[mode].dataFile)
      .then((items) => {
        const normalizedItems = normalizeItemMediaUrls(items)
        setData((current) => ({ ...current, [mode]: normalizedItems }))
        setTitleCounts((current) => ({ ...current, [mode]: current[mode] ?? normalizedItems.length }))
      })
      .finally(() => setLoading(false))
  }, [mode, data])

  return { data, titleCounts, caseVignettes, loading, globalDailySalt, searchIndex: searchIndexes[mode] }
}
