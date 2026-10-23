import { useEffect } from 'react'
import { Play, RotateCcw, Trophy } from 'lucide-react'
import { AppHeader } from '../../components/app-shell/AppShell'
import { GameLaunchButton, GameLaunchControls } from '../../components/game-launch-controls/GameLaunchControls'
import { GameScreenShell } from '../../components/game-shell/GameScreenShell'
import { GameArtifactSeoDetails } from '../../components/seo-content/SeoContent'
import { REFERENCE_PRESENTATION } from '../../app/local-presentation'
import { SERVER_RUNTIME } from '../../hooks/use-server-runtime'
import { ReferencePuzzleTitle } from '../title/ReferenceTitle'

type ConnectionsTitleStatus = 'new' | 'active' | 'completed'

export function ConnectionsTitleScreen({
  date,
  status,
  busy,
  onHome,
  onBack,
  onArchive,
  onStats,
  onRules,
  onReview,
  onPlay,
}: {
  date: string
  status: ConnectionsTitleStatus
  busy: boolean
  onHome: () => void
  onBack: () => void
  onArchive: () => void
  onStats: () => void
  onRules: () => void
  onReview: () => void
  onPlay: () => void
}) {
  const action = status === 'active'
    ? { label: 'Продолжить', icon: RotateCcw }
    : status === 'completed'
      ? { label: 'Посмотреть результат', icon: Trophy }
      : { label: 'Начать игру', icon: Play }
  const ActionIcon = action.icon
  const canPlay = !busy && (!REFERENCE_PRESENTATION || SERVER_RUNTIME)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.key === 'Escape') {
        event.preventDefault()
        onBack()
      } else if (event.key === 'Enter' && canPlay) {
        if (event.target instanceof HTMLElement && event.target.closest('button, a, input, select, textarea, summary, [role="option"]')) return
        event.preventDefault()
        onPlay()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [canPlay, onBack, onPlay])

  return <>
    <AppHeader onHome={onHome} onArchive={onArchive} onStats={onStats} onRules={onRules} onReview={onReview} />
    <GameScreenShell className="title-screen reference-title-screen" variant="title" onBack={onBack} backLabel="Все игры">
      <ReferencePuzzleTitle mode="connections" date={date} onRules={onRules} details={<GameArtifactSeoDetails mode="connections" />} launchControls={<GameLaunchControls mode="connections" action={<GameLaunchButton className="play-button game-launch-controls__play" disabled={!canPlay} onClick={onPlay}><ActionIcon />{busy ? 'Открываем…' : action.label}</GameLaunchButton>} />} extra={!SERVER_RUNTIME ? <p className="reference-online-note">В этом локальном просмотре доступно оформление. Решать «Связи» можно <a href="https://shoditsa.ru/games/connections" target="_blank" rel="noreferrer">на основном сайте ↗</a>.</p> : undefined} />
    </GameScreenShell>
  </>

}
