import { ThemedArtwork } from '../../components/ui/ThemedArtwork'
import { useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { ReferenceIcon } from '../../components/ui/ReferenceIcon'
import { ActionButton, ControlButton, TextInput } from '../../components/ui'
import { DialogSurface } from '../../components/ui/DialogSurface'
import { MODE_CONFIG, MODE_TABS } from '../../app/mode-config'
import { HOME_HERO_COPY, HOME_PUZZLE_COPY } from '../../app/home-copy'
import { GAME_SEO } from '../../app/seo-content'
import { CATEGORY_TICKET_CONFIG } from '../../components/category-ticket/category-ticket.config'
import { HomeSeoContent } from '../../components/seo-content/SeoContent'
import { publicAssetUrl } from '../../app/public-asset'
import { Mascot } from '../../components/mascot/Mascot'
import { localPresentationLink } from '../../app/local-presentation'
import { getMoscowDate } from '../../game'
import type { TitleMode } from '../../types'
import type { DailyHubState } from '../daily-progress/daily-progress.types'
import { REFERENCE_HOME_CARD_COPY, REFERENCE_HOME_INTRO } from './reference-home-copy'
import './ReferenceHome.css'

type Props = {
  header: ReactNode
  state: DailyHubState
  onSelect: (mode: TitleMode) => void
  onStart: () => void
  onStats: () => void
  onRules: () => void
  onDanetki?: () => void
  onConnections?: () => void
}

const catalogTones: Record<TitleMode, string> = {
  movie: 'lilac',
  series: 'yellow',
  anime: 'coral',
  game: 'mint',
  city: 'blue',
  music: 'peach',
  diagnosis: 'blue',
  animal: 'mint',
  book: 'yellow',
  character: 'lilac',
}

const cards = [
  ...CATEGORY_TICKET_CONFIG.map(({ mode, title }) => ({ id: mode, title, description: REFERENCE_HOME_CARD_COPY[mode], tone: catalogTones[mode], art: mode, href: GAME_SEO[mode].canonicalPath })),
  { id: 'yesno', title: HOME_PUZZLE_COPY.danetki.title, description: REFERENCE_HOME_CARD_COPY.danetki, tone: 'coral', art: 'yes-no', href: GAME_SEO.danetki.canonicalPath },
  { id: 'connections', title: HOME_PUZZLE_COPY.connections.title, description: REFERENCE_HOME_CARD_COPY.connections, tone: 'peach', art: 'connections', href: GAME_SEO.connections.canonicalPath },
]

const riddle = <>Я всегда перед тобой,<br />но меня не видно.<br />Ты не можешь меня потрогать,<br />но я могу всё изменить.<br />Что я?</>

export function ReferenceHome({ header, state, onSelect, onStart, onStats, onRules, onDanetki, onConnections }: Props) {
  const [dialog, setDialog] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [answer, setAnswer] = useState('')
  const [answerState, setAnswerState] = useState<'idle' | 'wrong' | 'correct'>('idle')
  const today = getMoscowDate()
  const dateLabel = new Date(`${today}T12:00:00+03:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
  const selectedCard = cards.find((card) => card.id === dialog)
  const searchCards = cards.filter((card) => {
    const mode = MODE_TABS.find((mode) => mode === card.id)
    const searchText = `${card.title} ${card.description} ${mode ? `${MODE_CONFIG[mode].plural} ${MODE_CONFIG[mode].subject}` : ''}`
    return searchText.toLocaleLowerCase('ru-RU').includes(query.trim().toLocaleLowerCase('ru-RU'))
  })
  const close = () => setDialog(null)
  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' })
  }
  const openCatalog = () => { setQuery(''); setDialog('catalog') }
  const selectCard = (id: string) => {
    const mode = MODE_TABS.find((mode) => mode === id)
    if (mode) { onSelect(mode); return }
    if (id === 'yesno' && onDanetki) { onDanetki(); return }
    if (id === 'connections' && onConnections) { onConnections(); return }
    setDialog(id)
  }

  return <div className="reference-home">
    <a className="reference-skip" href="#reference-main" onClick={(event) => { event.preventDefault(); document.getElementById('reference-main')?.focus(); scrollTo('reference-main') }}>Перейти к содержимому</a>
    {header}

    <main id="reference-main" tabIndex={-1}>
      <section className="reference-hero" aria-labelledby="reference-heading">
        <div className="reference-container reference-hero__grid">
          <div className="reference-hero__copy">
            <h1 id="reference-heading">{HOME_HERO_COPY.heading}</h1>
            <p className="reference-hero__intro">{REFERENCE_HOME_INTRO}</p>
            <div className="reference-hero__actions">
              <ActionButton className="reference-pill reference-play" onClick={onStart}>{state.activeGame ? 'Продолжить игру' : HOME_HERO_COPY.playLabel}<ReferenceIcon name="arrow" size={20} /></ActionButton>
              <ControlButton className="reference-how" onClick={onRules}><ReferenceIcon name="guide" size={21} />{HOME_HERO_COPY.rulesLabel}</ControlButton>
            </div>
            <div className="reference-social">
              <ReferenceIcon name="idea" />
              <p>Для тех, кто <strong>любит думать</strong><br />и находить ответы каждый день</p>
            </div>
          </div>
          <div className="reference-hero__art" aria-hidden="true"><Mascot pose="heroScene" fetchPriority="high" /></div>
          <aside className="reference-riddle" id="reference-today" aria-labelledby="reference-riddle-heading">
            <div className="reference-riddle__head"><h2 id="reference-riddle-heading">Разминка для ума</h2><time dateTime={today}>{dateLabel}</time></div>
            <p className="reference-riddle__text">{riddle}</p>
            <ActionButton className="reference-pill" onClick={() => setDialog('riddle')}>Попробовать угадать<ReferenceIcon name="arrow" size={21} /></ActionButton>
            <p className="reference-riddle__note">Разминка перед большой игрой</p>
            <span className="reference-scribble" aria-hidden="true" />
          </aside>
        </div>
      </section>

      <div className="reference-container reference-lower">
        <section className="reference-games" id="reference-games" aria-labelledby="reference-games-heading">
          <div className="reference-section-head"><h2 id="reference-games-heading">Выбери свою игру</h2></div>
          <div className="reference-game-grid">
            {cards.map((card) => <a key={card.id} className={`reference-card reference-card--${card.tone}`} href={localPresentationLink(card.href)} onClick={(event) => {
              if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
              event.preventDefault()
              selectCard(card.id)
            }}>
              <h3>{card.title}</h3><p>{card.description}</p>
              <span className="reference-card__arrow" aria-hidden="true"><ReferenceIcon name="arrow" size={20} /></span>
              <ThemedArtwork className={`reference-card__art reference-card__art--${card.art}`} src={publicAssetUrl(`images/home-doodle/${card.art}.webp`)} width="400" height="400" loading="lazy" alt="" />
            </a>)}
          </div>
        </section>

        <section className="reference-widgets" aria-label="Каждый день — маленькое открытие">
          <article className="reference-streak">
            <h3><ReferenceIcon name="flame" className="reference-fire" />Твои открытия сегодня</h3>
            <div className="reference-streak__days" aria-label={`Сегодня завершено ${state.completedCount} игр`}>
              {state.dailyModes.map((mode) => <span key={mode} className={state.completedModes.includes(mode) ? 'is-complete' : ''} title={mode in MODE_CONFIG ? MODE_CONFIG[mode as TitleMode].plural : 'Связи'}>{state.completedModes.includes(mode) ? <ReferenceIcon name="check" size={16} aria-label="Готово" aria-hidden={false} role="img" /> : <span aria-hidden="true">·</span>}</span>)}
            </div>
            <p><strong>{state.completedCount > 0 ? `Сегодня разгадано: ${state.completedCount}` : 'Всё начинается с первой загадки'}</strong><br />{state.completedCount > 0 ? 'Продолжай в том же духе!' : 'Пять минут для твоего любопытства.'}</p>
          </article>
          <article className="reference-quote"><blockquote>«Любопытство<br />— это уже половина<br />разгадки»</blockquote><span>Мысль дня</span><div className="reference-eyes" aria-hidden="true"><i /><i /></div></article>
          <article className="reference-personal-progress"><h3><ReferenceIcon name="idea" />Маленькие победы</h3><p>Каждая догадка — новый опыт. Здесь твои результаты, любимые игры и достижения.</p><ActionButton className="reference-pill reference-pill--light" onClick={onStats} variant="secondary">Моя статистика<ReferenceIcon name="arrow" /></ActionButton></article>
        </section>

        <section className="reference-community" id="reference-community" aria-labelledby="reference-community-heading">
          <h2 id="reference-community-heading">Больше, чем<br /><span>просто игры</span></h2>
          <div className="reference-community__drawing" aria-hidden="true"><ReferenceIcon name="globe" /></div>
          <p>Стань частью сообщества, где ценят<br className="reference-desktop-break" /> любознательность, логику и хорошее настроение.</p>
          <a className="ui-button reference-community__action" href={localPresentationLink('/games/together')}>Играть с друзьями<ReferenceIcon name="arrow" size={20} /></a>
          <span className="reference-scribble" aria-hidden="true" />
        </section>
        <div className="reference-home-guide"><HomeSeoContent variant="reference" /></div>
      </div>
    </main>

    {dialog && <DialogSurface onClose={close} ariaLabel={selectedCard?.title ?? (dialog === 'riddle' ? 'Разминка для ума' : 'Все игры')} backdropClassName="reference-dialog-backdrop" className="reference-dialog">
      <ControlButton className="reference-dialog__close" aria-label="Закрыть" onClick={close}><X /></ControlButton>
      {dialog === 'catalog' ? <>
        <span className="reference-eyebrow">Каждая догадка — шаг к ответу</span><h2>Во что сыграем?</h2>
        <label className="reference-search-field"><ReferenceIcon name="search" size={20} /><TextInput aria-label="Поиск по играм" placeholder="Найти свою игру…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <div className="reference-catalog-list">{searchCards.map((card) => <ControlButton key={card.id} onClick={() => { close(); selectCard(card.id) }}><span>{card.title}</span><ReferenceIcon name="arrow" size={18} /></ControlButton>)}</div>
        {searchCards.length === 0 && <p className="reference-empty">Такой игры пока нет. Попробуй «кино», «книги» или «города».</p>}
      </> : dialog === 'riddle' ? <>
        <span className="reference-eyebrow">Минутка для любопытства</span><h2>Есть догадка?</h2><p className="reference-dialog__riddle">{riddle}</p>
        <form onSubmit={(event) => { event.preventDefault(); setAnswerState(/^(будущее|будущ(ее|ий)|завтра)$/iu.test(answer.trim().replace(/[.!?]+$/, '')) ? 'correct' : 'wrong') }}>
          <label htmlFor="reference-answer">Твой ответ</label><TextInput id="reference-answer" surface="paper" placeholder="Кажется, это…" value={answer} onChange={(event) => { setAnswer(event.target.value); setAnswerState('idle') }} autoComplete="off" required />
          <ActionButton className="reference-pill" type="submit">Проверить догадку<ReferenceIcon name="arrow" size={18} /></ActionButton>
        </form>
        <p className={`reference-answer reference-answer--${answerState}`} role="status">{answerState === 'correct' ? 'Сходится! Это будущее. Всё самое интересное — впереди.' : answerState === 'wrong' ? 'Пока не сходится. Подсказка: оно ещё не наступило.' : 'Не торопись. Хорошие ответы любят немного тишины.'}</p>
      </> : selectedCard ? <>
        <span className="reference-eyebrow">Игра «Сходится!»</span><h2>{selectedCard.title}</h2><p>{selectedCard.description}</p>
        <p>Этот режим работает с сервером и недоступен в автономном предпросмотре. Здесь можно сыграть в десять других игр.</p>
        <ActionButton className="reference-pill" onClick={openCatalog}>Выбрать доступную игру<ReferenceIcon name="arrow" size={18} /></ActionButton>
      </> : null}
    </DialogSurface>}
  </div>
}
