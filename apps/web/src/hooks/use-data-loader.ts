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
const DATA_FETCH_TIMEOUT_MS = 20_000
const RETRY_DELAY_MS = 350
const configuredMediaOrigin = String(import.meta.env.VITE_MEDIA_ORIGIN || '').trim().replace(/\/$/, '')
const mediaOrigin = configuredMediaOrigin

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

const fetchJson = async <T,>(url: string): Promise<T> => {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), DATA_FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal })
    if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`)
    return response.json() as Promise<T>
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error(`Timed out while loading ${url}`)
    throw error
  } finally {
    window.clearTimeout(timeoutId)
  }
}

export const fetchJsonCached = async <T,>(url: string): Promise<T> => {
  if (!requestCache.has(url)) {
    let request: Promise<unknown>
    request = fetchJson<T>(url).catch((error) => {
      if (requestCache.get(url) === request) requestCache.delete(url)
      throw error
    })
    requestCache.set(url, request)
  }
  return requestCache.get(url) as Promise<T>
}

const fetchJsonNoCache = <T,>(url: string): Promise<T> => fetchJson<T>(url)
const waitForRetry = () => new Promise<void>((resolve) => window.setTimeout(resolve, RETRY_DELAY_MS))

const withCacheBuster = (url: string) => `${url}${url.includes('?') ? '&' : '?'}ts=${Date.now()}`

const loadModeItems = async (dataFile: string) => {
  const libraryUrl = `./data/libraries/${dataFile}/items.json`
  try {
    return await fetchJsonCached<TitleItem[]>(libraryUrl)
  } catch (primaryError) {
    await waitForRetry()
    try {
      return await fetchJsonNoCache<TitleItem[]>(withCacheBuster(libraryUrl))
    } catch (retryError) {
      try {
        return await fetchJsonCached<TitleItem[]>(`./data/${dataFile}.generated.json`)
      } catch (fallbackError) {
        const primaryMessage = primaryError instanceof Error ? primaryError.message : String(primaryError)
        const retryMessage = retryError instanceof Error ? retryError.message : String(retryError)
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
        throw new Error(`Failed to load dataset "${dataFile}". Primary: ${primaryMessage}. Retry: ${retryMessage}. Fallback: ${fallbackMessage}`)
      }
    }
  }
}

export const useDataLoader = (mode: TitleMode, enabled = true) => {
  const [data, setData] = useState<ModeData>(initialData)
  const [titleCounts, setTitleCounts] = useState<ModeCounts>(initialCounts)
  const [searchIndexes, setSearchIndexes] = useState<ModeSearchIndexes>(initialSearchIndexes)
  const [caseVignettes, setCaseVignettes] = useState<CaseVignetteMap>({})
  const [globalDailySalt, setGlobalDailySalt] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadErrors, setLoadErrors] = useState<Partial<Record<TitleMode, string>>>({})
  const [retryVersion, setRetryVersion] = useState(0)

  useEffect(() => {
    if (!enabled) return
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

    fetchJsonNoCache<{ globalSalt?: number; dailySalt?: number }>(withCacheBuster('./data/daily-config.json'))
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
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    let canceled = false

    const syncGlobalDailySalt = () => {
      fetchJsonNoCache<{ globalSalt?: number; dailySalt?: number }>(withCacheBuster('./data/daily-config.json'))
        .then((config) => {
          if (canceled) return
          const configSalt = toIntegerOrNull(config.globalSalt ?? config.dailySalt)
          if (configSalt != null) setGlobalDailySalt(configSalt)
        })
        .catch(() => undefined)
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') syncGlobalDailySalt()
    }

    const intervalId = window.setInterval(syncGlobalDailySalt, 60_000)
    window.addEventListener('focus', syncGlobalDailySalt)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      canceled = true
      window.clearInterval(intervalId)
      window.removeEventListener('focus', syncGlobalDailySalt)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    if (searchIndexes[mode]) return
    const libraryKey = MODE_CONFIG[mode].dataFile
    fetchJsonCached<LibrarySearchIndex>(`./data/libraries/${libraryKey}/search-index.json`)
      .then((index) => {
        if (!index || typeof index !== 'object' || !index.tokenToIds) return
        setSearchIndexes((current) => ({ ...current, [mode]: index }))
      })
      .catch(() => undefined)
  }, [enabled, mode, searchIndexes])

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }
    if (data[mode].length) {
      setLoading(false)
      return
    }
    let canceled = false
    setLoading(true)
    setLoadErrors((current) => ({ ...current, [mode]: undefined }))
    loadModeItems(MODE_CONFIG[mode].dataFile)
      .then((items) => {
        if (canceled) return
        const normalizedItems = normalizeItemMediaUrls(items)
        setData((current) => ({ ...current, [mode]: normalizedItems }))
        setTitleCounts((current) => ({ ...current, [mode]: current[mode] ?? normalizedItems.length }))
      })
      .catch((error) => {
        if (canceled) return
        const message = error instanceof Error ? error.message : String(error)
        setLoadErrors((current) => ({ ...current, [mode]: message }))
      })
      .finally(() => {
        if (!canceled) setLoading(false)
      })
    return () => { canceled = true }
  }, [enabled, mode, data, retryVersion])

  const retryLoading = () => {
    const dataFile = MODE_CONFIG[mode].dataFile
    requestCache.delete(`./data/libraries/${dataFile}/items.json`)
    requestCache.delete(`./data/${dataFile}.generated.json`)
    setRetryVersion((version) => version + 1)
  }

  return { data, titleCounts, caseVignettes, loading, loadError: loadErrors[mode] ?? null, retryLoading, globalDailySalt, searchIndex: searchIndexes[mode] }
}
