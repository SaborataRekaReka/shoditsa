import { Suspense, type ReactNode } from 'react'
import { preloadableScreen } from '../../app/preloadable-screen'
import { AppHeader } from '../app-shell/AppShell'
import { LOCAL_PRESENTATION, REFERENCE_PRESENTATION } from '../../app/local-presentation'
import { isStudySessionPresentation } from '../../app/local-study-launch'
import { ReferenceGameCommunity, ReferenceGameSidebar } from '../../features/game/ReferenceGameSidebar'
import type { Attempt, GameStatus, TitleMode } from '../../types'
import { GameScreenShell } from './GameScreenShell'
import { APPLICATION_DESIGN } from '../../app/application-design'
import { RoutePending } from '../../app/RoutePending'

const StudySessionFrame = APPLICATION_DESIGN
  ? preloadableScreen(() => import('../../dev/quest-game/StudySessionFrame'))
  : null

export const prepareGamePageFrame = () => StudySessionFrame?.preload()

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
  attempts?: Attempt[]
  variantKey: string | null
}

/** Shared visual shell for local and server-authoritative game controllers. */
export function GamePageFrame({ controller, navigation, onBack, children }: { controller: GameControllerSnapshot; navigation: GamePageNavigation; onBack: () => void; children: ReactNode }) {
  if (StudySessionFrame && (APPLICATION_DESIGN || isStudySessionPresentation({ dev: import.meta.env.DEV, local: LOCAL_PRESENTATION, study: import.meta.env.VITE_QUEST_STUDY === '1', source: controller.source, search: window.location.search }))) {
    return <Suspense fallback={<RoutePending />}><StudySessionFrame controller={controller} navigation={navigation}>{children}</StudySessionFrame></Suspense>
  }
  const continueGame = () => {
    const target = document.getElementById('movie-search') ?? document.querySelector('.reference-play-main .final-choice-panel button')
    if (!(target instanceof HTMLElement)) return
    target.focus({ preventScroll: true })
    target.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
  }

  return <>
    <AppHeader {...navigation} hideMobileNav={!REFERENCE_PRESENTATION} />
    <GameScreenShell
      variant="session"
      presentation={REFERENCE_PRESENTATION ? 'sidebar' : 'default'}
      onBack={onBack}
      className="game-shell"
      data-controller={controller.source}
      data-game-mode={controller.mode}
      data-game-status={controller.status}
      data-attempts={controller.attemptsCount}
      data-variant={controller.variantKey ?? undefined}
    >{REFERENCE_PRESENTATION ? <div className="reference-play-layout">
      <div className="reference-play-main">
        {children}
        <ReferenceGameCommunity onHome={navigation.onHome} />
      </div>
      <ReferenceGameSidebar
        mode={controller.mode}
        puzzleDate={controller.puzzleDate}
        status={controller.status}
        attemptsCount={controller.attemptsCount}
        onContinue={continueGame}
        onHome={navigation.onHome}
      />
    </div> : children}</GameScreenShell>
  </>
}
