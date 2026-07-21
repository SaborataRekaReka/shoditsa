import type { ReactNode } from 'react'
import { AppHeader } from '../app-shell/AppShell'
import type { GameStatus, TitleMode } from '../../types'
import { GameScreenShell } from './GameScreenShell'

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
export function GamePageFrame({ controller, navigation, onBack, children }: { controller: GameControllerSnapshot; navigation: GamePageNavigation; onBack: () => void; children: ReactNode }) {
  return <>
    <AppHeader {...navigation} />
    <GameScreenShell
      variant="session"
      onBack={onBack}
      className="game-shell"
      data-controller={controller.source}
      data-game-mode={controller.mode}
      data-game-status={controller.status}
      data-attempts={controller.attemptsCount}
      data-variant={controller.variantKey ?? undefined}
    >{children}</GameScreenShell>
  </>
}
