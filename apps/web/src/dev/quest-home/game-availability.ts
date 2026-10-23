import { useEffect, useState } from 'react'
import { getMoscowDate } from '@shoditsa/game-core'
import { CATALOG_GUESS_MODE_IDS, KPOP_ARTISTS_PACK_ID } from '@shoditsa/contracts'
import { INDEXABLE_GAME_SEO, type SeoGameMode } from '../../app/seo-content'

export type GameAvailability = 'new' | 'in-progress' | 'completed' | 'online'
export type GameAvailabilityMap = Record<SeoGameMode, GameAvailability>
export const STUDY_ACTIVITY_KEY = 'shoditsa:study-daily-activity:anime'
const savedGamePrefix = 'seans:v1:game:'
type ReadStorage = Pick<Storage, 'length' | 'key' | 'getItem'>
type DailyActivity = { mode: SeoGameMode; date: string; status: string; attempts: number }

export const supportsClubFreePlay = (mode: SeoGameMode) => CATALOG_GUESS_MODE_IDS.some(id => id === mode)

export function summarizeAvailability(availability: GameAvailabilityMap) {
  return Object.values(availability).reduce((counts, state) => {
    counts[state]++
    return counts
  }, { new: 0, 'in-progress': 0, completed: 0, online: 0 })
}

function activityFromStorage(value: string | null, storageKey: string, dailySalt: number): DailyActivity | null {
  try {
    const raw = JSON.parse(value ?? 'null')
    if (!raw || !CATALOG_GUESS_MODE_IDS.includes(raw.mode) || typeof raw.date !== 'string') return null
    // A daily schedule revision is distinct from a free-play launch.
    const key = typeof raw.key === 'string' ? raw.key : storageKey.slice(savedGamePrefix.length)
    if (raw.variantKey === KPOP_ARTISTS_PACK_ID || /\|free:\d+$/.test(key)) return null
    const salt = key.match(/\|salt:(-?\d+)$/)
    if (salt ? Number(salt[1]) !== dailySalt : dailySalt !== 0) return null
    const attempts = Array.isArray(raw.attemptTitleIds) && raw.attemptTitleIds.length
      ? raw.attemptTitleIds.length
      : Array.isArray(raw.attempts) ? raw.attempts.length : Number(raw.attemptCount) || 0
    return { mode: raw.mode, date: raw.date, status: raw.status, attempts }
  } catch { return null }
}

/** Read only: never migrate, remove, or overwrite the player's saved games. */
export function readGameAvailability(storage: ReadStorage | null, date: string, dailySalt = 0): GameAvailabilityMap {
  const result = Object.fromEntries(INDEXABLE_GAME_SEO.map(game => [game.mode,
    game.mode === 'connections' || game.mode === 'danetki' ? 'online' : 'new',
  ])) as GameAvailabilityMap
  const activities: DailyActivity[] = []
  try {
    if (storage) for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index)
      if (!key?.startsWith(savedGamePrefix)) continue
      const activity = activityFromStorage(storage.getItem(key), key, dailySalt)
      if (activity?.date === date) activities.push(activity)
    }
  } catch { /* Storage restrictions must not prevent browsing the catalogue. */ }
  for (const activity of activities) {
    if (activity.status === 'won' || activity.status === 'lost') result[activity.mode] = 'completed'
    else if (result[activity.mode] !== 'completed' && ['playing', 'final_choice'].includes(activity.status) && activity.attempts > 0) result[activity.mode] = 'in-progress'
  }
  return result
}

export function writeStudyActivity(storage: Pick<Storage, 'setItem'>, date: string, attempts: number, status: 'playing' | 'won' | 'lost') {
  // Standalone anime study only. No account or production save key is changed.
  try { storage.setItem(STUDY_ACTIVITY_KEY, JSON.stringify({ mode: 'anime', date, attemptCount: attempts, status })) } catch { /* Optional local preview persistence. */ }
}

function currentAvailability(dailySalt = 0) {
  try { return readGameAvailability(typeof window === 'undefined' ? null : window.localStorage, getMoscowDate(), dailySalt) }
  catch { return readGameAvailability(null, getMoscowDate(), dailySalt) }
}

export function useGameAvailability(date: string, refreshKey?: string): GameAvailabilityMap {
  const [dailySalt, setDailySalt] = useState(0)
  const [availability, setAvailability] = useState(() => currentAvailability())
  useEffect(() => {
    const controller = new AbortController()
    const loadSchedule = async () => {
      for (const path of ['/data/daily-config.json', '/data/source.json']) {
        try {
          const response = await fetch(path, { cache: 'no-store', signal: controller.signal })
          if (!response.ok) continue
          const config = await response.json()
          const salt = config.globalSalt ?? config.dailySalt
          if (Number.isInteger(salt)) { if (!controller.signal.aborted) setDailySalt(salt); return }
        } catch { if (controller.signal.aborted) return }
      }
    }
    void loadSchedule()
    return () => controller.abort()
  }, [date])
  useEffect(() => {
    const refresh = () => setAvailability(currentAvailability(dailySalt))
    refresh()
    const visible = () => { if (document.visibilityState === 'visible') refresh() }
    const changed = (event: StorageEvent) => { if (!event.key || event.key.startsWith(savedGamePrefix)) refresh() }
    const nextMoscowDay = Date.parse(`${date}T00:00:00+03:00`) + 86_400_000
    const midnight = window.setTimeout(refresh, Math.max(100, nextMoscowDay - Date.now() + 100))
    window.addEventListener('focus', refresh)
    window.addEventListener('storage', changed)
    document.addEventListener('visibilitychange', visible)
    return () => { clearTimeout(midnight); window.removeEventListener('focus', refresh); window.removeEventListener('storage', changed); document.removeEventListener('visibilitychange', visible) }
  }, [date, dailySalt, refreshKey])
  return availability
}
