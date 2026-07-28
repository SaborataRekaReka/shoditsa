import { CalendarDays, Grid2X2, Play, RotateCcw, Trophy } from 'lucide-react'
import { publicAssetUrl } from '../../app/public-asset'
import { ActionButton, AppHeader } from '../../components/app-shell/AppShell'
import { GameScreenShell } from '../../components/game-shell/GameScreenShell'
import './ConnectionsTitleScreen.css'

type ConnectionsTitleStatus = 'new' | 'active' | 'completed'

const dateLabel = (date: string) => new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  timeZone: 'Europe/Moscow',
}).format(new Date(`${date}T12:00:00+03:00`))

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
      : { label: 'Играть', icon: Play }
  const ActionIcon = action.icon

  return <>
    <AppHeader onHome={onHome} onArchive={onArchive} onStats={onStats} onRules={onRules} onReview={onReview} />
    <GameScreenShell className="connections-title" variant="title" onBack={onBack}>
      <section className="connections-title__ticket" aria-labelledby="connections-title-heading">
        <div className="connections-title__art">
          <img
            src={publicAssetUrl('images/connections/connections-title-hero-v2.webp')}
            alt="Коллаж из шестнадцати карточек, объединённых линиями и цветными метками"
            width="1536"
            height="1024"
            fetchPriority="high"
            decoding="async"
          />
          <span className="connections-title__stamp">ЕЖЕДНЕВНАЯ ИГРА</span>
        </div>
        <div className="connections-title__copy">
          <p className="connections-title__date"><CalendarDays aria-hidden="true" /> {dateLabel(date)}</p>
          <h1 id="connections-title-heading">Связи</h1>
          <p className="connections-title__lead">Соберите 16 слов в четыре группы по смыслу или форме.</p>
          <div className="connections-title__mini-grid" aria-hidden="true">
            {Array.from({ length: 4 }, (_, index) => <span key={index}><Grid2X2 /></span>)}
          </div>
          <p className="connections-title__rules">4 группы <i aria-hidden="true">·</i> можно допустить 4 ошибки</p>
          <ActionButton className="connections-title__action" onClick={onPlay} disabled={busy}>
            <ActionIcon aria-hidden="true" />
            {busy ? 'Открываем…' : action.label}
          </ActionButton>
        </div>
      </section>
      <p className="connections-title__footnote">Один и тот же набор для всех игроков. Новый раунд — в 00:00 МСК.</p>
    </GameScreenShell>
  </>
}
