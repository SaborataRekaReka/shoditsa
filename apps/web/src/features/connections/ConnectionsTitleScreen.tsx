import { useEffect } from 'react'
import { Play, RotateCcw, Trophy, Waypoints } from 'lucide-react'
import { publicAssetUrl } from '../../app/public-asset'
import { ActionButton, AppHeader } from '../../components/app-shell/AppShell'
import { GameLaunchControls } from '../../components/game-launch-controls/GameLaunchControls'
import { GameScreenShell } from '../../components/game-shell/GameScreenShell'
import { GameArtifactSeoDetails } from '../../components/seo-content/SeoContent'
import { AdmissionTitleTicket, TicketKicker } from '../../components/title-ticket/TitleTicket'
import { prettyDate } from '../../game'
import { dayNumber } from '../../game/day-number'
import './ConnectionsTitleScreen.css'

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
  const canPlay = !busy

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.key === 'Escape') {
        event.preventDefault()
        onBack()
      } else if (event.key === 'Enter' && canPlay) {
        event.preventDefault()
        onPlay()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [canPlay, onBack, onPlay])

  return <>
    <AppHeader onHome={onHome} onArchive={onArchive} onStats={onStats} onRules={onRules} onReview={onReview} />
    <GameScreenShell className="title-screen connections-title" variant="title" onBack={onBack}>
      <section className="title-stage connections-title__stage">
        <div className="title-game-mark">
          <span aria-hidden="true"><Waypoints /></span>
          <i>Игра дня · №{dayNumber(date)}</i>
          <h1>Связи</h1>
        </div>
        <time>{prettyDate(date)} · {new Date(`${date}T12:00:00+03:00`).getFullYear()}</time>
        <p>Русскоязычная головоломка: соберите 16 слов в четыре группы по смыслу или форме</p>

        <AdmissionTitleTicket
          id="ticket-connections"
          mode="connections"
          className="connections-title__ticket"
          posterUrl={publicAssetUrl('images/connections/connections-title-hero-v2.webp')}
          stubLabel="ВХОД"
          stubTitle="ОДИН"
          stubMeta={`№ ${dayNumber(date)}`}
          stubEnd={`${date.slice(8, 10)}.${date.slice(5, 7)}`}
          details={<GameArtifactSeoDetails mode="connections" />}
          eager
        >
          <TicketKicker title="Ежедневная загадка" detail="новая сетка в полночь" />
          <h2 id="ticket-connections">Connections на русском: игра «Связи»</h2>
          <p>Найдите четыре скрытые связи и соберите по четыре слова в каждую группу. Можно допустить <strong>4 ошибки</strong>.</p>
          <GameLaunchControls
            mode="connections"
            action={<ActionButton
              className={`play-button game-launch-controls__play ${!canPlay ? 'is-disabled' : ''}`}
              onClick={onPlay}
              disabled={!canPlay}
            >
              <ActionIcon className={status === 'active' ? 'play-button__replay-icon' : undefined} aria-hidden="true" />
              {busy ? 'Открываем…' : action.label}
              {canPlay && <span className="keycap-hint keycap-hint--inline" aria-hidden="true">Enter</span>}
            </ActionButton>}
          />
        </AdmissionTitleTicket>
      </section>
    </GameScreenShell>
  </>
}
