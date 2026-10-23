import { useEffect, useReducer } from 'react'
import type { DashboardResponse } from '@shoditsa/contracts'
import { queryKeys } from '../../api/client'
import { SERVER_RUNTIME } from '../../hooks/use-server-runtime'
import { useStudyAccountCache } from './study-account-cache'

export function readStudyPlayer(storage: Pick<Storage, 'getItem'> | null) {
  let balance = 0, streak = 0
  const read = (key: string) => { try { return JSON.parse(storage?.getItem(key) ?? 'null') } catch { return null } }
  const wallet = read('seans:v1:wallet')
  const attendance = read('seans:v1:attendance:stats')
  if (Number.isInteger(wallet?.tickets) && wallet.tickets >= 0) balance = wallet.tickets
  if (Number.isInteger(attendance?.currentDailyStreak) && attendance.currentDailyStreak >= 0) streak = attendance.currentDailyStreak
  return { balance, streak }
}

export function useStudyPlayer(refreshKey?: string) {
  const dashboard = useStudyAccountCache<DashboardResponse>(queryKeys.dashboard)
  const [, refresh] = useReducer(value => value + 1, 0)
  useEffect(() => {
    const changed = (event: StorageEvent) => { if (!event.key || ['seans:v1:wallet', 'seans:v1:attendance:stats'].includes(event.key)) refresh() }
    const visible = () => { if (document.visibilityState === 'visible') refresh() }
    window.addEventListener('storage', changed)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', visible)
    return () => { window.removeEventListener('storage', changed); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', visible) }
  }, [])
  useEffect(() => { queueMicrotask(refresh) }, [refreshKey])
  if (SERVER_RUNTIME) return { balance: dashboard?.wallet?.balance ?? 0, streak: dashboard?.attendance?.currentDailyStreak ?? 0 }
  try { return readStudyPlayer(typeof window === 'undefined' ? null : window.localStorage) }
  catch { return readStudyPlayer(null) }
}
