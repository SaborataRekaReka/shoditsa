import { publicAssetUrl } from '../../app/public-asset'
import type { Ref } from 'react'
import { ArrowDown, ArrowRight, ChevronDown, Ticket } from 'lucide-react'
import { Mascot } from '../../components/mascot/Mascot'
import { ReferenceIcon, type ReferenceIconName } from '../../components/ui/ReferenceIcon'
import { GAME_SEO } from '../../app/seo-content'
import './hero-concepts.css'

const lead = GAME_SEO.movie.lead
const criteria: Array<{ label: string; icon: ReferenceIconName }> = [
  { label: 'Год', icon: 'calendar' }, { label: 'Жанры', icon: 'movie' },
  { label: 'Актёры', icon: 'user' }, { label: 'Страна', icon: 'globe' }, { label: 'Рейтинг', icon: 'idea' },
]

function MovieArt({ className = '' }: { className?: string }) {
  return <img className={`direction-movie-art ${className}`} src={publicAssetUrl('images/home-doodle/movie.webp')} width="250" height="250" alt="Нарисованные кинохлопушка и катушка плёнки" />
}

function Criteria() {
  return <div className="direction-criteria"><span>Что сравниваем</span><ul aria-label="Что сравниваем">{criteria.map(item => <li key={item.label}><ReferenceIcon name={item.icon} size={15} /><span>{item.label}</span></li>)}</ul></div>
}

function HowTo({ className = '' }: { className?: string }) {
  return <a className={`direction-how ${className}`} href="#direction-guide"><ReferenceIcon name="guide" size={16} />Как играть?<ArrowDown size={14} aria-hidden="true" /></a>
}

function Period() {
  return <label className="mini-period"><span className="mini-period__caption"><ReferenceIcon name="calendar" size={12} />Период</span><span className="mini-period__cost"><Ticket size={12} aria-hidden="true" /><span aria-label="15 билетов">15</span></span><select aria-label="Период фильмов" defaultValue="all"><option value="all">Все годы</option></select><ChevronDown size={14} aria-hidden="true" /></label>
}

function Launch({ onStart, buttonRef }: { onStart: () => void; buttonRef?: Ref<HTMLButtonElement> }) {
  return <div className="mini-launch direction-launch">
    <button ref={buttonRef} className="mini-primary mini-primary--mascot" type="button" onClick={onStart}>
      <span className="mini-primary__peek" aria-hidden="true"><span className="mini-primary__peek-rise"><Mascot pose="peek" width={1254} height={1254} draggable={false} /></span></span>
      <span className="mini-primary__content">Начать игру<kbd>Enter</kbd><ArrowRight size={17} strokeWidth={1.7} aria-hidden="true" /></span>
    </button>
    <Period />
  </div>
}

function PosterHero({ onStart, startRef }: { onStart: () => void; startRef: Ref<HTMLButtonElement> }) {
  return <section className="hero-direction hero-direction--poster" aria-labelledby="poster-game-title">
    <div className="poster-scene">
      <MovieArt />
      <div className="poster-facts">
        <div className="poster-attempts"><strong>10</strong><span>попыток</span></div>
        <div className="poster-daily"><ReferenceIcon name="calendar" size={24} /><span>Новая загадка<strong>каждый день</strong></span></div>
      </div>
    </div>
    <div className="direction-copy">
      <h3 className="direction-title" id="poster-game-title">Угадай фильм</h3>
      <p className="direction-lead">{lead}</p>
      <Launch onStart={onStart} buttonRef={startRef} />
      <HowTo />
    </div>
    <Criteria />
  </section>
}

function ConsoleHero({ onStart }: { onStart: () => void }) {
  return <section className="hero-direction hero-direction--console" aria-labelledby="console-game-title">
    <div className="direction-copy">
      <h3 className="direction-title" id="console-game-title">Угадай фильм</h3>
      <p className="direction-lead">{lead}</p>
      <Launch onStart={onStart} />
    </div>
    <div className="console-art"><MovieArt /></div>
    <div className="console-status">
      <div className="console-status__daily"><ReferenceIcon name="calendar" size={19} /><span>Новая загадка<strong>каждый день</strong></span></div>
      <div className="console-status__attempts"><span><strong>10</strong> попыток</span><div className="console-status__segments" role="img" aria-label="Десять доступных попыток">{Array.from({ length: 10 }, (_, i) => <i key={i} />)}</div></div>
      <HowTo />
    </div>
    <Criteria />
  </section>
}

function TicketHero({ onStart }: { onStart: () => void }) {
  return <section className="hero-direction hero-direction--ticket" aria-labelledby="ticket-game-title">
    <div className="ticket-intro">
      <h3 className="direction-title" id="ticket-game-title">Угадай фильм</h3>
      <p className="direction-lead">{lead}</p>
      <MovieArt />
    </div>
    <div className="game-pass">
      <div className="game-pass__daily"><ReferenceIcon name="calendar" size={17} /><span>Новая загадка<strong>каждый день</strong></span></div>
      <div className="game-pass__attempts"><strong>10</strong><span>попыток</span><ReferenceIcon name="movie" size={27} /></div>
      <Launch onStart={onStart} />
      <HowTo />
    </div>
    <Criteria />
  </section>
}

export function HeroConceptStudy({ onStart, startRef }: { onStart: () => void; startRef: Ref<HTMLButtonElement> }) {
  return <>
    <nav className="direction-nav" aria-label="Варианты подачи хиро">
      <a className="direction-nav__home" href="/mini-landing.html?preview=reference&layout=sections">Текущий макет ↗</a>
      <div><a href="#direction-a">A · Афиша</a><a href="#direction-b">B · Пульт</a><a href="#direction-c">C · Билет</a></div>
    </nav>
    <main className="direction-gallery">
      <header className="direction-gallery__intro"><h1>Три разных способа начать игру</h1><p>Разная типографика, иерархия и форма сведений. Содержание игры одинаковое.</p></header>
      <article className="direction-case" id="direction-a"><header><span>A</span><div><h2>Киноафиша</h2><p>Выразительное описание. Попытки и ежедневность — отдельные объекты рядом с иллюстрацией.</p></div></header><PosterHero onStart={onStart} startRef={startRef} /></article>
      <article className="direction-case" id="direction-b"><header><span>B</span><div><h2>Игровой пульт</h2><p>Спокойный мелкий текст. Все сведения собраны в один модуль со шкалой попыток.</p></div></header><ConsoleHero onStart={onStart} /></article>
      <article className="direction-case" id="direction-c"><header><span>C</span><div><h2>Билет на игру</h2><p>Мягкий цветной текст. Условия и запуск собраны в самостоятельный белый пропуск.</p></div></header><TicketHero onStart={onStart} /></article>
      <section className="direction-guide" id="direction-guide" aria-labelledby="direction-guide-title"><h2 id="direction-guide-title">Как играть</h2><p>Введите название фильма, изучите совпадения и уточняйте версию. На ответ — десять попыток.</p><a href="/mini-landing.html?preview=reference&layout=sections#mini-guide">Посмотреть правила и остальные секции<ArrowRight size={15} /></a></section>
    </main>
  </>
}
