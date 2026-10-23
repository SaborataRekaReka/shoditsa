import type { ReactNode } from 'react'
import { useApplicationGames, type ApplicationGame } from './useApplicationGames'

export function applicationContinueHref(games: ApplicationGame[]) {
  const active = games.filter(game => ['playing', 'final_choice'].includes(game.status))
  return (active.find(game => game.mode === 'anime') ?? active[0])?.href ?? '/play/anime'
}

/** Real session URLs survive direct entry and work without an in-page router callback. */
export function ApplicationContinueLink({ className, children }: { className?: string; children?: ReactNode }) {
  const { games } = useApplicationGames()
  return <a className={`quest-button ${className ?? ''}`} href={applicationContinueHref(games)}>{children ?? 'Продолжить игру'}</a>
}
