import { ThemedArtwork } from '../../components/ui/ThemedArtwork'
import { PageHeading } from '../../components/ui/PageHeading'
import { useEffect } from 'react'
import { Crown, Gamepad2, Infinity, Play, Users } from 'lucide-react'
import { AppHeader, ActionButton } from '../../components/app-shell/AppShell'
import { QuestButton } from '../../components/ui/QuestPrimitives'
import { GeneratedShoditsaGlyph as Glyph } from '../../dev/quest-game/GeneratedShoditsaArt'
import { STUDY_CLUB_OFFER_HREF } from '../../dev/quest-game/account-routing'
import { APPLICATION_DESIGN } from '../../app/application-design'
import { ClubAccessPanel } from '../../components/club-access-panel/ClubAccessPanel'
import { GameScreenShell } from '../../components/game-shell/GameScreenShell'
import { AdmissionTitleTicket, TicketKicker } from '../../components/title-ticket'
import { publicAssetUrl } from '../../app/public-asset'
import { REFERENCE_PRESENTATION } from '../../app/local-presentation'
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

  if (APPLICATION_DESIGN) return <>
    <AppHeader onHome={onHome} onArchive={onArchive} onStats={onStats} onRules={onRules} onReview={onReview} />
    <section className="friends-welcome" aria-labelledby="friends-room-title">
      <PageHeading id="friends-room-title" title="Игра с друзьями" description="Собирайтесь вместе, отвечайте со своих устройств и сравнивайте результаты. Категории и темп выбирает хозяин комнаты." />
      <ul className="friends-welcome__facts" aria-label="Возможности комнаты">
        <li><Glyph name="profile" size={36} /><strong>До 8</strong><span>участников</span></li>
        <li><Glyph name="play" size={36} /><strong>{territoryEnabled ? 12 : 11}</strong><span>игровых режимов</span></li>
        <li><Glyph name="quests" size={36} /><strong>До 30</strong><span>раундов</span></li>
      </ul>
      <section className="friends-welcome__access" aria-labelledby="friends-access-title">
        <Glyph name={canCreate ? 'play' : 'medal'} size={54} />
        <div><h2 id="friends-access-title">{canCreate ? 'Всё готово для вашей игры' : 'Собери компанию с Клубом'}</h2><p>{canCreate ? 'Создай комнату, выбери любимые категории или совместные Данетки и отправь друзьям код.' : 'Клубный билет открывает создание комнат и совместные Данетки. Друзья присоединяются по коду приглашения.'}</p>
          <div className="friends-welcome__actions">
            {canCreate ? <QuestButton onClick={onStart}><Play size={18} />Создать комнату</QuestButton> : <>
              <a className="quest-button quest-button--primary" href={STUDY_CLUB_OFFER_HREF} onClick={() => trackClientEvent('special_club_cta_clicked', { placement: 'friends_intro' })}><Crown size={18} />Выбрать клубный билет</a>
              <QuestButton kind="text" onClick={onClub}>Что входит в Клуб</QuestButton>
            </>}
          </div>
        </div>
      </section>
      <section className="friends-welcome__steps" aria-labelledby="friends-how-title">
        <h2 id="friends-how-title">Как собраться</h2>
        <ol><li><b>1</b><div><h3>Создай комнату</h3><p>Выбери категории, число раундов и удобный темп.</p></div></li><li><b>2</b><div><h3>Пригласи друзей</h3><p>Отправь код комнаты. Каждый играет со своего устройства.</p></div></li><li><b>3</b><div><h3>Играйте вместе</h3><p>Отвечайте одновременно и следите за общим зачётом.</p></div></li></ol>
      </section>
    </section>
  </>

  const benefits = <div className="friends-intro-benefits" aria-label="Возможности комнаты">
    <span><Users aria-hidden="true" /><strong>До 8</strong><small>участников</small></span>
    <span><Gamepad2 aria-hidden="true" /><strong>{territoryEnabled ? '12 игр' : '11 игр'}</strong><small>режимов</small></span>
    <span><Infinity aria-hidden="true" /><strong>До 30</strong><small>раундов</small></span>
  </div>
  const access = canCreate
    ? <div className={REFERENCE_PRESENTATION ? 'reference-friends-intro__actions' : 'friends-intro-actions'}>
        <ActionButton className={REFERENCE_PRESENTATION ? 'reference-friends-intro__start' : 'friends-intro-start'} onClick={onStart}><Play />Создать комнату<span className="keycap-hint keycap-hint--inline" aria-hidden="true">Enter</span></ActionButton>
      </div>
    : <ClubAccessPanel
        actionsLayout={REFERENCE_PRESENTATION ? 'inline' : 'stacked'}
        title="Комнаты доступны участникам Клуба"
        description="Клубный билет открывает комнаты и совместные Данетки без списания билетиков, а также архив, свободную игру и спецпоказы."
        primaryLabel="Выбрать клубный билет"
        secondaryLabel="Посмотреть все преимущества"
        onPrimary={() => {
          trackClientEvent('special_club_cta_clicked', { placement: 'friends_intro' })
          onClub()
        }}
        onSecondary={onClub}
      />

  if (REFERENCE_PRESENTATION) return <>
    <AppHeader onHome={onHome} onArchive={onArchive} onStats={onStats} onRules={onRules} onReview={onReview} />
    <GameScreenShell variant="title" onBack={onHome} backLabel="Все игры" className="title-screen friends-intro-screen">
      <div className="reference-friends-intro">
        <section className="reference-friends-intro__hero" aria-labelledby="friends-room-title">
          <div className="reference-friends-intro__copy">
            <p className="reference-friends-intro__eyebrow"><Users size={17} aria-hidden="true" />Клубная игра · до 8 участников</p>
            <h1 id="friends-room-title">Игра с друзьями</h1>
            <p className="reference-friends-intro__description">Создайте приватную комнату, отправьте друзьям код и проходите любимые категории одновременно, расследуйте Данетки{territoryEnabled ? ' или сражайтесь за территории вдвоём' : ''}.</p>
            {benefits}
            {access}
          </div>
          <div className="reference-friends-intro__illustration">
            <p>Одна комната — вся компания</p>
            <ThemedArtwork src={publicAssetUrl('images/home-doodle/associations.webp')} width={420} height={420} alt="" />
          </div>
        </section>
        <section className="reference-friends-intro__about" aria-labelledby="friends-room-about">
          <div>
            <p className="reference-friends-intro__eyebrow">Совместная игра · {canCreate ? 'клубный билет активен' : 'только в Клубе'}</p>
            <h2 id="friends-room-about">Соберите всех за одним столом</h2>
          </div>
          <p>Хозяин выбирает категории и темп. Все отвечают со своих устройств, а результаты сходятся в общем зачёте.</p>
        </section>
      </div>
    </GameScreenShell>
  </>

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
          {benefits}
          {access}
        </AdmissionTitleTicket>
      </section>
    </GameScreenShell>
  </>
}
