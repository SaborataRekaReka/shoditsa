import { useContext, useEffect, useReducer } from 'react'
import { QueryClient, QueryClientContext, useQuery } from '@tanstack/react-query'
import type { DashboardResponse, MeResponse } from '@shoditsa/contracts'
import { getMoscowDate } from '@shoditsa/game-core'
import { api, queryKeys } from '../../api/client'
import { INDEXABLE_GAME_SEO, type SeoGameMode } from '../../app/seo-content'
import { SERVER_RUNTIME } from '../../hooks/use-server-runtime'
import { allGames } from '../../storage'
import { archiveItemToSavedGame, isCatalogArchiveItem } from '../server-runtime/adapters'
import { useStudyAccountCache } from '../../dev/quest-game/study-account-cache'

export type ApplicationGame = { id: string; mode: SeoGameMode; title: string; date: string; status: string; attempts: number; href: string }
const isolatedClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

export function useApplicationGames(refreshKey?: string) {
  const [, refresh] = useReducer(value => value + 1, 0)
  const client = useContext(QueryClientContext)
  const me = useStudyAccountCache<MeResponse>(queryKeys.me)
  const dashboard = useStudyAccountCache<DashboardResponse>(queryKeys.dashboard)
  const archive = useQuery({ queryKey: queryKeys.archive({ application: true }), queryFn: () => api.archive(), enabled: SERVER_RUNTIME && !!me, retry: 1 }, client ?? isolatedClient)
  useEffect(() => { queueMicrotask(refresh) }, [refreshKey])
  useEffect(() => {
    const changed = (event: StorageEvent) => { if (!event.key || event.key.startsWith('seans:v1:game:')) refresh() }
    window.addEventListener('storage', changed); window.addEventListener('focus', refresh)
    return () => { window.removeEventListener('storage', changed); window.removeEventListener('focus', refresh) }
  }, [])
  let saved: ReturnType<typeof allGames> = []
  try { saved = SERVER_RUNTIME ? (archive.data?.items ?? []).filter(isCatalogArchiveItem).map(archiveItemToSavedGame) : typeof window !== 'undefined' ? allGames() : [] } catch { /* A restricted storage must not hide the page. */ }
  const games: ApplicationGame[] = saved.map(game => ({
    id: game.key, mode: game.mode, title: INDEXABLE_GAME_SEO.find(item => item.mode === game.mode)?.shortName ?? game.mode,
    date: game.date, status: game.status, attempts: game.attempts.length,
    href: SERVER_RUNTIME && game.key.startsWith('server:') ? `/sessions/${encodeURIComponent(game.key.slice(7))}` : `/play/${game.mode}?game=${encodeURIComponent(game.key)}`,
  }))
  for (const session of SERVER_RUNTIME ? dashboard?.activeSessions ?? [] : []) {
    if (games.some(game => game.id === `server:${session.id}`)) continue
    const mode = INDEXABLE_GAME_SEO.find(item => item.mode === session.mode)
    if (mode) games.unshift({ id: `server:${session.id}`, mode: mode.mode, title: mode.shortName, date: session.puzzleDate, status: session.status, attempts: session.attemptsCount, href: `/sessions/${encodeURIComponent(session.id)}` })
  }
  games.sort((a, b) => b.date.localeCompare(a.date))
  const active = games.filter(game => ['playing', 'final_choice'].includes(game.status) && game.attempts > 0)
  const today = games.filter(game => game.date === getMoscowDate() && (game.attempts > 0 || ['won', 'lost'].includes(game.status)))
  return { games, active, today, loading: archive.isLoading && SERVER_RUNTIME, error: SERVER_RUNTIME ? archive.error : null, retry: () => { void archive.refetch() }, user: me?.user ?? null, dashboard }
}
