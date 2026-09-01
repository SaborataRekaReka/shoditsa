import { useEffect } from 'react'
import { Gamepad2, Infinity, Play, Users } from 'lucide-react'
import { AppHeader, ActionButton } from '../../components/app-shell/AppShell'
import { ClubAccessPanel } from '../../components/club-access-panel/ClubAccessPanel'
import { GameScreenShell } from '../../components/game-shell/GameScreenShell'
import { AdmissionTitleTicket, TicketKicker } from '../../components/title-ticket'
import { publicAssetUrl } from '../../app/public-asset'
import { trackClientEvent } from '../../app/client-events'
import './FriendsRoomIntroScreen.css'

export function FriendsRoomIntroScreen({
  canCreate,
  territoryEnabled,
  onHome,
  onArchive,
  onStats,
  onRules,
  onReview,
  onStart,
  onClub,
}: {
  canCreate: boolean
  territoryEnabled: boolean
  onHome: () => void
  onArchive: () => void
  onStats: () => void
  onRules: () => void
  onReview: () => void
  onStart: () => void
  onClub: () => void
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.key === 'Escape') {
        event.preventDefault()
        onHome()
      }
      if (event.key === 'Enter' && canCreate) {
        event.preventDefault()
        onStart()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [canCreate, onHome, onStart])

  return <>
    <AppHeader onHome={onHome} onArchive={onArchive} onStats={onStats} onRules={onRules} onReview={onReview} />
    <GameScreenShell variant="title" onBack={onHome} className="title-screen friends-intro-screen">
      <section className="title-stage">
        <div className="title-game-mark">
          <span><Users /></span>
          <i>Клубная игра · до 8 участников</i>
          <h1>Игра с друзьями</h1>
        </div>
        <time>Одна комната — вся компания</time>
        <p>Создайте приватную комнату, отправьте друзьям код и проходите любимые категории одновременно, расследуйте Данетки{territoryEnabled ? ' или сражайтесь за территории вдвоём' : ''}.</p>
        <AdmissionTitleTicket
          id="ticket-friends-room"
          mode="series"
          posterUrl={publicAssetUrl('images/friends-room/friends-ticket-art-v2.webp')}
          stubLabel="КОМНАТА"
          stubTitle="ВМЕСТЕ"
          stubMeta="8 ИГРОКОВ"
          stubEnd="30 РАУНДОВ"
          className="friends-intro-ticket"
        >
          <TicketKicker title="Совместная игра" detail={canCreate ? 'клубный билет активен' : 'только в Клубе'} />
          <h2 id="ticket-friends-room">Соберите всех за одним столом</h2>
          <p>Хозяин выбирает категории и темп. Все отвечают со своих устройств, а результаты сходятся в общем зачёте.</p>
          <div className="friends-intro-benefits" aria-label="Возможности комнаты">
            <span><Users /><strong>До 8</strong><small>участников</small></span>
            <span><Gamepad2 /><strong>{territoryEnabled ? '12 игр' : '11 игр'}</strong><small>режимов</small></span>
            <span><Infinity /><strong>До 30</strong><small>раундов</small></span>
          </div>
          {canCreate
            ? <div className="friends-intro-actions">
                <ActionButton className="friends-intro-start" onClick={onStart}><Play />Создать комнату<span className="keycap-hint keycap-hint--inline" aria-hidden="true">Enter</span></ActionButton>
              </div>
            : <ClubAccessPanel
              title="Комнаты доступны участникам Клуба"
              description="Клубный билет открывает комнаты и совместные Данетки без списания билетиков, а также архив, свободную игру и спецпоказы."
              primaryLabel="Выбрать клубный билет"
              secondaryLabel="Посмотреть все преимущества"
              onPrimary={() => {
                trackClientEvent('special_club_cta_clicked', { placement: 'friends_intro' })
                onClub()
              }}
              onSecondary={onClub}
            />}
        </AdmissionTitleTicket>
      </section>
    </GameScreenShell>
  </>
}
