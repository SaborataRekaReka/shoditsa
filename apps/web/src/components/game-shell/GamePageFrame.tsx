import type { ReactNode } from 'react'
import { AppHeader } from '../app-shell/AppShell'
import type { GameStatus, TitleMode } from '../../types'

export type GamePageNavigation = {
  onHome: () => void
  onArchive: () => void
  onStats: () => void
  onRules: () => void
  onReview: () => void
}

export type GameControllerSnapshot = {
  source: 'local' | 'server'
  mode: TitleMode
  puzzleDate: string
  status: GameStatus
  attemptsCount: number
  variantKey: string | null
}

/** Shared visual shell for local and server-authoritative game controllers. */
export function GamePageFrame({ controller, navigation, children }: { controller: GameControllerSnapshot; navigation: GamePageNavigation; children: ReactNode }) {
  return <>
    <AppHeader {...navigation} />
    <main
      className="game-shell"
      data-controller={controller.source}
      data-game-mode={controller.mode}
      data-game-status={controller.status}
      data-attempts={controller.attemptsCount}
      data-variant={controller.variantKey ?? undefined}
    >{children}</main>
  </>
}
