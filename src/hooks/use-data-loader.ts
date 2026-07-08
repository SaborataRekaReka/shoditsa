import { useEffect, useState } from 'react'
import type { CaseVignetteMap, DiagnosisCaseVignettes, LibrarySearchIndex, TitleItem, TitleMode } from '../types'
import { MODE_CONFIG } from '../app/mode-config'

type ModeData = Record<TitleMode, TitleItem[]>
type ModeCounts = { movie: number | null; series: number | null; anime: number | null; game: number | null; diagnosis: number | null }
type ModeSearchIndexes = Record<TitleMode, LibrarySearchIndex | null>

const initialData: ModeData = { movie: [], series: [], anime: [], game: [], diagnosis: [] }
const initialCounts: ModeCounts = { movie: null, series: null, anime: null, game: null, diagnosis: null }
const initialSearchIndexes: ModeSearchIndexes = { movie: null, series: null, anime: null, game: null, diagnosis: null }
const toIntegerOrNull = (value: unknown) => {
  const parsed = Math.trunc(Number(value))
  return Number.isFinite(parsed) ? parsed : null
}

const requestCache = new Map<string, Promise<unknown>>()

const fetchJsonCached = async <T,>(url: string): Promise<T> => {
  if (!requestCache.has(url)) {
    requestCache.set(url, fetch(url).then(async (response) => {
      if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`)
      return response.json()
    }))
  }
  return requestCache.get(url) as Promise<T>
}

const loadModeItems = async (dataFile: string) => {
  try {
    return await fetchJsonCached<TitleItem[]>(`./data/${dataFile}.generated.json`)
  } catch {
    return fetchJsonCached<TitleItem[]>(`./data/libraries/${dataFile}/items.json`)
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
    fetchJsonCached<{ movieCount?: number; seriesCount?: number; animeCount?: number; gameCount?: number; diagnosisCount?: number }>('./data/source.json')
      .then((source) => {
        setTitleCounts((current) => ({
          movie: Number.isFinite(source.movieCount) ? source.movieCount! : current.movie,
          series: Number.isFinite(source.seriesCount) ? source.seriesCount! : current.series,
          anime: Number.isFinite(source.animeCount) ? source.animeCount! : current.anime,
          game: Number.isFinite(source.gameCount) ? source.gameCount! : current.game,
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
        setData((current) => ({ ...current, [mode]: items }))
        setTitleCounts((current) => ({ ...current, [mode]: current[mode] ?? items.length }))
      })
      .finally(() => setLoading(false))
  }, [mode, data])

  return { data, titleCounts, caseVignettes, loading, globalDailySalt, searchIndex: searchIndexes[mode] }
}
