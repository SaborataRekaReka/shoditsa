import type { ReactNode } from 'react'
import { ArrowRight, CalendarDays, CircleHelp, Search, Lightbulb, Ticket } from 'lucide-react'
import { ActionButton, ControlButton } from '../../components/ui'
import { DailyProgressStub } from '../daily-progress/DailyProgressStub'
import type { DailyHubState } from '../daily-progress/daily-progress.types'
import { publicAssetUrl } from '../../app/public-asset'
import { getMoscowDate } from '../../game'
import './AfishaHome.css'

type Props = {
  header: ReactNode
  cards: Array<{ id: string; content: ReactNode }>
  state: DailyHubState
  onStart: () => void
  onArchive: () => void
  onRules: () => void
}

export function AfishaHome({ header, cards, state, onStart, onArchive, onRules }: Props) {
  const today = getMoscowDate()
  const date = new Date(`${today}T12:00:00+03:00`)
  const dateLabel = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
  const weekday = date.toLocaleDateString('ru-RU', { weekday: 'long' })

  return <>
    {header}
    <main className="afisha-home">
      <div className="afisha-home__edition">
        <span><span className="afisha-home__live" /> Клуб ежедневных открытий</span>
        <time dateTime={today}>{weekday}, {dateLabel}</time>
      </div>

      <section className="hub-hero afisha-home__hero" aria-labelledby="afisha-heading">
        <div className="afisha-home__copy">
          <span className="afisha-home__eyebrow"><Lightbulb size={15} aria-hidden="true" /> Хороший день для маленького открытия</span>
          <h1 id="afisha-heading">Что сегодня <span>сойдётся?</span></h1>
          <p>Угадайте ответ за десять попыток.<br />Каждая догадка открывает подсказки.</p>
          <div className="afisha-home__actions">
            <ActionButton className="afisha-home__primary" onClick={onStart}>
              {state.activeGame ? state.primaryLabel : 'Начать с кино'} <ArrowRight aria-hidden="true" />
            </ActionButton>
            <ControlButton className="afisha-home__rules" onClick={onRules}><CircleHelp size={17} aria-hidden="true" /> Как играть</ControlButton>
          </div>
        </div>
        <div className="afisha-home__art" aria-hidden="true">
          <div className="afisha-home__orbit" />
          <img src={publicAssetUrl('images/hero.webp')} width="1122" height="913" alt="" fetchPriority="high" decoding="async" />
          <span className="afisha-home__stamp"><span>Новая загадка</span><strong>каждый день</strong><CalendarDays size={17} /></span>
        </div>
      </section>

      <div className="afisha-home__progress"><DailyProgressStub state={state} /></div>

      <section className="afisha-home__catalog" id="available-games" aria-labelledby="afisha-catalog-heading">
        <div className="afisha-home__section-head">
          <div><span className="afisha-home__eyebrow">Сегодня в программе</span><h2 id="afisha-catalog-heading">Выберите свою загадку</h2></div>
          <span className="afisha-home__catalog-note">{cards.length} тем, новые ответы каждый день</span>
        </div>
        <div className="afisha-home__grid">{cards.map(({ id, content }) => <div key={id}>{content}</div>)}</div>
      </section>

      <section className="afisha-home__invitation" aria-labelledby="afisha-invitation-heading">
        <div className="afisha-home__invitation-mark" aria-hidden="true"><img src={publicAssetUrl('images/symbol.svg')} alt="" width="72" height="72" /></div>
        <div><span className="afisha-home__eyebrow">Всего одна догадка — и вы уже в игре</span><h2 id="afisha-invitation-heading">Любопытство здесь вознаграждается</h2><p>Каждый ответ приближает к разгадке. Каждый законченный сеанс пополняет вашу коллекцию.</p></div>
        <ActionButton variant="secondary" onClick={onArchive}>Открыть архив <ArrowRight aria-hidden="true" /></ActionButton>
      </section>

      <section className="afisha-home__how" aria-label="Как устроена игра">
        <article><Search aria-hidden="true" /><div><h3>Начните с догадки</h3><p>Введите знакомое название. Первый ответ может быть любым.</p></div></article>
        <article><Lightbulb aria-hidden="true" /><div><h3>Следуйте подсказкам</h3><p>Сравнивайте признаки и шаг за шагом сужайте круг.</p></div></article>
        <article><Ticket aria-hidden="true" /><div><h3>Собирайте открытия</h3><p>Завершайте игры, получайте билетики и возвращайтесь завтра.</p></div></article>
      </section>
    </main>
  </>
}
