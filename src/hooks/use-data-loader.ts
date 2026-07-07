import { useEffect, useState } from 'react'
import type { CaseVignetteMap, DiagnosisCaseVignettes, TitleItem, TitleMode } from '../types'
import { MODE_CONFIG } from '../app/mode-config'

type ModeData = Record<TitleMode, TitleItem[]>
type ModeCounts = { movie: number | null; series: number | null; game: number | null; diagnosis: number | null }

const initialData: ModeData = { movie: [], series: [], game: [], diagnosis: [] }
const initialCounts: ModeCounts = { movie: null, series: null, game: null, diagnosis: null }
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

export const useDataLoader = (mode: TitleMode) => {
  const [data, setData] = useState<ModeData>(initialData)
  const [titleCounts, setTitleCounts] = useState<ModeCounts>(initialCounts)
  const [caseVignettes, setCaseVignettes] = useState<CaseVignetteMap>({})
  const [globalDailySalt, setGlobalDailySalt] = useState(0)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetchJsonCached<{ movieCount?: number; seriesCount?: number; gameCount?: number; diagnosisCount?: number }>('./data/source.json')
      .then((source) => {
        setTitleCounts((current) => ({
          movie: Number.isFinite(source.movieCount) ? source.movieCount! : current.movie,
          series: Number.isFinite(source.seriesCount) ? source.seriesCount! : current.series,
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
  }, [])

  useEffect(() => {
    if (data[mode].length) return
    setLoading(true)
    fetchJsonCached<TitleItem[]>(`./data/${MODE_CONFIG[mode].dataFile}.generated.json`)
      .then((items) => {
        setData((current) => ({ ...current, [mode]: items }))
        setTitleCounts((current) => ({ ...current, [mode]: current[mode] ?? items.length }))
      })
      .finally(() => setLoading(false))
  }, [mode, data])

  return { data, titleCounts, caseVignettes, loading, globalDailySalt }
}
