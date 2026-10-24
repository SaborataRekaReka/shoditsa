import { ThemedArtwork } from '../../components/ui/ThemedArtwork'
import { GameArtwork } from '../../components/ui/GameArtwork'
import { useState } from 'react'
import { ArrowRight, Clock3, UsersRound, Mic2 } from 'lucide-react'
import { PageHeading } from '../../components/ui/PageHeading'
import { QuestButton, QuestInput } from '../../components/ui/QuestPrimitives'
import { publicAssetUrl } from '../../app/public-asset'
import { svoyakHref } from './contracts'
import './svoyak-welcome.css'
import { useRoomCreationAccess } from '../rooms/RoomCreationAccess'
import { STUDY_CLUB_OFFER_HREF } from '../../dev/quest-game/account-routing'
import { SvoyakSeoContent } from './SvoyakSeoContent'
import '../../components/game-information/GameInformation.css'
import './SvoyakSeoContent.css'

const topics = [
  { image: 'movie', label: 'Кино' },
  { image: 'game', label: 'Игры' },
  { image: 'music', label: 'Музыка' },
]

export function SvoyakWelcome({ navigate }: { navigate: (path: string) => void }) {
  const [code, setCode] = useState('')
  const access = useRoomCreationAccess()

  return <><div className="svoyak-welcome">
    <section className="svoyak-welcome__hero" aria-labelledby="svoyak-welcome-title">
      <div className="svoyak-welcome__copy">
        <p className="svoyak-welcome__eyebrow">Викторина для вашей компании</p>
        <PageHeading id="svoyak-welcome-title" title="Своя игра" description="Здесь каждый в своей теме. Собирай друзей, выбирай вопросы и жми первым, чтобы забрать очки." />
        <QuestButton disabled={access.status !== 'ready'} onClick={() => navigate(access.allowed ? svoyakHref.create : STUDY_CLUB_OFFER_HREF)}>{access.status === 'loading' ? 'Проверяем доступ…' : access.allowed ? 'Создать комнату' : 'Открыть с Клубом'}<ArrowRight size={19} aria-hidden="true" /></QuestButton>
        <p className="svoyak-welcome__invitation">Клубный билет нужен ведущему. Друзья входят по коду бесплатно.</p>
        {access.status === 'error' && <QuestButton kind="text" onClick={access.retry}>Повторить проверку доступа</QuestButton>}
      </div>
      <div className="svoyak-welcome__art" aria-hidden="true">
        <div className="svoyak-welcome__board">
          {topics.map(topic => <div className="svoyak-welcome__board-column" key={topic.image}>
            <GameArtwork mode={topic.image} alt="" width="44" height="44" />
            {[100, 300, 500].map(points => <span className={topic.image === 'game' && points === 300 ? 'is-picked' : undefined} key={points}>{points}</span>)}
          </div>)}
        </div>
        <ThemedArtwork className="svoyak-welcome__company" src={publicAssetUrl('images/home-doodle/together.svg')} alt="" width="100" height="100" />
        <span className="svoyak-welcome__score">+300</span>
      </div>
    </section>

    <ul className="svoyak-welcome__facts" aria-label="Об игре">
      <li><UsersRound size={21} aria-hidden="true" /><span><strong>2–12 игроков</strong><small>Собирайтесь вместе</small></span></li>
      <li><Mic2 size={21} aria-hidden="true" /><span><strong>Один ведущий</strong><small>Задаёт ход игры</small></span></li>
      <li><Clock3 size={21} aria-hidden="true" /><span><strong>От 10 минут</strong><small>Или на целый вечер</small></span></li>
    </ul>

    <section className="svoyak-welcome__join" aria-labelledby="svoyak-join-title">
      <div><h2 id="svoyak-join-title">Тебя уже ждут?</h2><p id="svoyak-code-hint">Введи код от ведущего</p></div>
      <form className="svoyak-welcome__join-form" onSubmit={event => {
        event.preventDefault()
        if (/^[A-F0-9]{6}$/.test(code)) navigate(svoyakHref.join(code))
      }}>
        <QuestInput aria-label="Код комнаты" aria-describedby="svoyak-code-hint" placeholder="Код комнаты" value={code} maxLength={6} pattern="[a-fA-F0-9]{6}" autoComplete="off" autoCapitalize="characters" spellCheck={false} required onChange={event => setCode(event.target.value.replace(/[^a-fA-F0-9]/g, '').toUpperCase())} />
        <QuestButton kind="outline" type="submit" disabled={code.length !== 6}>Войти<ArrowRight size={17} aria-hidden="true" /></QuestButton>
      </form>
    </section>

    <section className="svoyak-welcome__how" aria-labelledby="svoyak-how-title">
      <h2 id="svoyak-how-title">Как играть</h2>
      <ol>
        <li><span className="svoyak-welcome__step" aria-hidden="true">1</span><div><h3>Найдите общие темы</h3><p>Каждый отмечает свои интересы. Вопросы собираются с учётом выбора всей компании.</p></div></li>
        <li><span className="svoyak-welcome__step" aria-hidden="true">2</span><div><h3>Выберите вопрос</h3><p>Тема и цена — за вами. Чем сложнее вопрос, тем больше очков на кону.</p></div></li>
        <li><span className="svoyak-welcome__step" aria-hidden="true">3</span><div><h3>Успейте ответить первым</h3><p>Жми кнопку, когда знаешь ответ. Верный ответ приносит очки, ошибка их отнимает. Решает ведущий.</p></div></li>
      </ol>
    </section>
  </div><SvoyakSeoContent /></>
}
