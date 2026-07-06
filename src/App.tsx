import { useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import {
  Archive,
  ArrowDown,
  ArrowUp,
  BarChart3,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Copy,
  Film,
  Lock,
  MapPin,
  Music2,
  Play,
  RotateCcw,
  Search,
  Share2,
  Sparkles,
  Stethoscope,
  Ticket,
  Target,
  Tv,
  X,
} from 'lucide-react'
import { compareTitles, dailyTitle, getMoscowDate, PERIODS, poolFor, prettyDate, resultText, searchTitles } from './game'
import { allGames, gameKey, loadGame, loadStats, saveGame, saveStats } from './storage'
import type { AssistHintKey, Attempt, GameStatus, HintCheckpoint, HintChoice, HintPerson, PeriodKey, Person, SavedGame, Stats, TitleItem, TitleMode } from './types'

const statusLabel = {
  match: 'точно',
  close: 'рядом',
  partial: 'частично',
  miss: 'мимо',
  unknown: 'нет данных',
}

const normalizeTextMatch = (value: string) => value.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е')
const modeIcon = (mode: TitleMode) => mode === 'movie' ? <Film /> : mode === 'series' ? <Tv /> : <Stethoscope />
const modeTitle = (mode: TitleMode) => mode === 'movie' ? 'Кино' : mode === 'series' ? 'Сериалы' : 'Диагнозы'
const modePlural = (mode: TitleMode) => mode === 'movie' ? 'Фильмы' : mode === 'series' ? 'Сериалы' : 'Диагнозы'
const modeSubject = (mode: TitleMode) => mode === 'movie' ? 'фильм' : mode === 'series' ? 'сериал' : 'диагноз'
const modeSubjectGenitive = (mode: TitleMode) => mode === 'movie' ? 'фильма' : mode === 'series' ? 'сериала' : 'диагноза'
const modeDaily = (mode: TitleMode) => mode === 'movie' ? 'Фильм' : mode === 'series' ? 'Сериал' : 'Диагноз'
const modeLower = (mode: TitleMode) => mode === 'movie' ? 'кино' : mode === 'series' ? 'сериалы' : 'диагнозы'
const modeSearchPlaceholder = (mode: TitleMode) => mode === 'movie' ? 'Найти фильм…' : mode === 'series' ? 'Найти сериал…' : 'Найти диагноз…'
const modePoolLabel = (mode: TitleMode, count: number) => mode === 'diagnosis' ? `${count} диагнозов в подборке` : `${count} тайтлов в подборке`
const modeDataFile = (mode: TitleMode) => mode === 'movie' ? 'movies' : mode === 'series' ? 'series' : 'diagnoses'

type AssistHintView = {
  key: AssistHintKey
  title: string
  subtitle: string
  body?: string
  people?: Person[]
  available: boolean
}

const cleanHintText = (value: string) => value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const cropHintText = (value: string, max = 210) => value.length > max ? `${value.slice(0, max).trimEnd()}…` : value
const personName = (person: { nameRu: string; nameOriginal: string }) => person.nameRu || person.nameOriginal || 'Без имени'

const buildAssistHints = (item: TitleItem): AssistHintView[] => {
  const plot = cropHintText(cleanHintText(item.plotHint || item.description || ''))
  const facts = (item.facts ?? []).map(cleanHintText).filter(Boolean)
  const fact = facts[0] || cropHintText(cleanHintText(item.slogan || ''))

  if (item.mode === 'diagnosis') {
    const diagnosticsHint = cropHintText(cleanHintText((item.diagnostics ?? []).slice(0, 4).join(', ')))
    const safetyHint = cropHintText(cleanHintText(item.safetyDisclaimer || fact))
    return [
      {
        key: 'plot',
        title: 'Описание',
        subtitle: 'Короткое описание состояния',
        body: plot,
        available: Boolean(plot),
      },
      {
        key: 'slogan',
        title: 'Диагностика',
        subtitle: 'Что обычно назначают для проверки',
        body: diagnosticsHint,
        available: Boolean(diagnosticsHint),
      },
      {
        key: 'fact',
        title: 'Важно',
        subtitle: 'Образовательный дисклеймер',
        body: safetyHint,
        available: Boolean(safetyHint),
      },
    ]
  }

  const mainCast = (item.cast ?? []).filter((person) => personName(person) !== 'Без имени').slice(0, 5)

  return [
    {
      key: 'plot',
      title: 'Сюжет',
      subtitle: 'Короткое описание истории',
      body: plot,
      available: Boolean(plot),
    },
    {
      key: 'cast_main',
      title: 'Актёрский состав',
      subtitle: 'Пять портретов из основного каста',
      people: mainCast,
      available: mainCast.length > 0,
    },
    {
      key: 'fact',
      title: 'Факт',
      subtitle: 'Интересный факт без спойлеров',
      body: fact,
      available: Boolean(fact),
    },
  ]
}

const dayNumber = (date: string) => {
  const start = Date.UTC(2026, 0, 1)
  const current = Date.parse(`${date}T00:00:00Z`)
  return Math.max(1, Math.floor((current - start) / 86_400_000) + 1)
}

const Poster = ({ item, className = '' }: { item: TitleItem; className?: string }) => {
  const [failed, setFailed] = useState(false)
  return item.posterUrl && !failed
    ? <img className={className} src={item.posterUrl} alt={`Постер «${item.titleRu}»`} onError={() => setFailed(true)} />
    : <div className={`${className} poster-fallback`}>{modeIcon(item.mode)}<span>{item.titleRu}</span></div>
}

function BrandLogo({ className = '' }: { className?: string }) {
  return <img className={className} src="/images/logo.svg" alt="Сходится!" />
}

function ActionButton({ variant = 'primary', className = '', children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'hint'
}) {
  return <button className={`ui-button ui-button--${variant} ${className}`.trim()} {...props}>{children}</button>
}

function GameSelector({ mode, onClick, compact = false }: { mode: TitleMode; onClick: () => void; compact?: boolean }) {
  return <button className={`game-selector ${compact ? 'game-selector--compact' : ''}`} onClick={onClick}>
    <span>{modeIcon(mode)}</span>
    <i>Тема</i>
    <strong>{modeTitle(mode)}</strong>
    <ChevronRight />
  </button>
}

function PeriodControl({ value, onChange, compact = false }: { value: PeriodKey; onChange: (period: PeriodKey) => void; compact?: boolean }) {
  return <label className={`period-control ${compact ? 'period-control--compact' : ''}`}>
    <span>Период</span>
    <select value={value} onChange={(event) => onChange(event.target.value as PeriodKey)}>
      {Object.entries(PERIODS).map(([id, item]) => <option value={id} key={id}>{item.label}</option>)}
    </select>
  </label>
}

function AppHeader({ onHome, onArchive, onStats, onRules }: {
  onHome: () => void
  onArchive: () => void
  onStats: () => void
  onRules: () => void
}) {
  return <header className="app-header">
    <div className="app-header__inner">
      <button className="brand" aria-label="На главный экран" onClick={onHome}><BrandLogo /></button>
      <nav aria-label="Навигация">
        <button onClick={onRules} aria-label="Как играть"><CircleHelp /></button>
        <button onClick={onArchive} aria-label="Архив"><Archive /></button>
        <button onClick={onStats} aria-label="Статистика"><BarChart3 /></button>
      </nav>
    </div>
  </header>
}

function HubScreen({ onSelect, onRewatch, onStats, onRules, titleCounts }: {
  onSelect: (mode: TitleMode) => void
  onRewatch: () => void
  onStats: () => void
  onRules: () => void
  titleCounts: { movie: number | null; series: number | null; diagnosis: number | null }
}) {
  const futureCategories = [
    { title: 'Музыка', copy: 'Угадайте группу или исполнителя', icon: <Music2 /> },
    { title: 'Города', copy: 'Найдите город по его признакам', icon: <MapPin /> },
  ]
  const scrollToGames = () => document.getElementById('available-games')?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return <>
    <AppHeader onHome={() => undefined} onArchive={onRewatch} onStats={onStats} onRules={onRules} />
    <main className="hub-screen">
      <section className="hub-hero">
        <div className="hub-hero__copy">
          <span>Ежедневные игры</span>
          <h1>Выберите тему<br />{' '}и всё сойдется!</h1>
          <p>Кино, сериалы, города, музыка и диагнозы. Каждый день — новая загадка и 10 попыток, чтобы найти ответ по подсказкам.</p>
          <div className="hub-hero__actions">
            <ActionButton onClick={scrollToGames}><Play /> Играть сейчас</ActionButton>
            <ActionButton variant="secondary" onClick={onRules}><CircleHelp /> Как это работает</ActionButton>
          </div>
          <div className="hub-hero__facts" aria-label="Об игре">
            <span><CalendarDays /><strong>1 загадка в день</strong></span>
            <span><Target /><strong>10 попыток</strong></span>
          </div>
        </div>
        <div className="hub-hero__visual" aria-hidden="true">
          <img src="/images/hero.png" alt="" />
        </div>
      </section>

      <section className="category-section" id="available-games">
        <div className="category-heading"><span>Доступно сейчас</span><small>03 игры</small></div>
        <div className="category-grid category-grid--active">
          <button className="category-card category-card--movie" onClick={() => onSelect('movie')}>
            <div className="category-card__head">
              <span className="category-card__icon"><Film /></span>
              <span className="category-card__pool"><b>{titleCounts.movie ?? '—'}</b> в пуле</span>
            </div>
            <i>Ежедневная игра</i><h2>Кино</h2>
            <p>Угадайте фильм по актёрам, жанрам, году и рейтингам.</p>
            <strong>Играть <ChevronRight /></strong>
          </button>
          <button className="category-card category-card--series" onClick={() => onSelect('series')}>
            <div className="category-card__head">
              <span className="category-card__icon"><Tv /></span>
              <span className="category-card__pool"><b>{titleCounts.series ?? '—'}</b> в пуле</span>
            </div>
            <i>Ежедневная игра</i><h2>Сериалы</h2>
            <p>Найдите сериал, сравнивая создателей, каст и периоды.</p>
            <strong>Играть <ChevronRight /></strong>
          </button>
          <button className="category-card category-card--diagnosis" onClick={() => onSelect('diagnosis')}>
            <div className="category-card__head">
              <span className="category-card__icon"><Stethoscope /></span>
              <span className="category-card__pool"><b>{titleCounts.diagnosis ?? '—'}</b> в пуле</span>
            </div>
            <i>Ежедневная игра</i><h2>Диагнозы</h2>
            <p>Угадайте диагноз по симптомам, системе, факторам риска и МКБ-подсказкам.</p>
            <strong>Играть <ChevronRight /></strong>
          </button>
        </div>
      </section>

      <section className="category-section category-section--future">
        <div className="category-heading"><span>Следующие темы</span><small>в разработке</small></div>
        <div className="category-grid category-grid--future">
          {futureCategories.map((category) => <article className="category-card category-card--locked" key={category.title}>
            <span className="category-card__icon">{category.icon}</span><span className="category-card__lock"><Lock /> Скоро</span>
            <h3>{category.title}</h3><p>{category.copy}</p>
          </article>)}
        </div>
      </section>
    </main>
  </>
}

function TitleScreen({ mode, period, setPeriod, date, onHome, onBack, onPlay, onRewatch, onStats, onRules, isLeaving }: {
  mode: TitleMode
  period: PeriodKey
  setPeriod: (period: PeriodKey) => void
  date: string
  onHome: () => void
  onBack: () => void
  onPlay: () => void
  onRewatch: () => void
  onStats: () => void
  onRules: () => void
  isLeaving?: boolean
}) {
  return <>
    <AppHeader onHome={onHome} onArchive={onRewatch} onStats={onStats} onRules={onRules} />
    <main className={`title-screen ${isLeaving ? 'is-leaving' : ''}`}>
      <div className="screen-back-row">
        <button className="screen-back" onClick={onBack} aria-label="Назад"><ChevronLeft /></button>
      </div>
      <section className="title-stage">
        <div className="title-game-mark">
          <span>{modeIcon(mode)}</span>
          <i>Игра дня · №{dayNumber(date)}</i>
          <h1>{modeTitle(mode)}</h1>
        </div>
        <time>{prettyDate(date)} · {new Date(`${date}T12:00:00+03:00`).getFullYear()}</time>
        <p>Угадайте {modeSubject(mode)} дня за десять попыток</p>
        {mode === 'diagnosis'
          ? <section className="med-chart">
              <div className="med-chart__stub">
                <span className="med-chart__cross" aria-hidden="true"><i /><i /></span>
                <span>ПРИЁМ</span><strong>ОТКРЫТ</strong><small>Карта № {dayNumber(date)}</small><em>{date.slice(8, 10)}.{date.slice(5, 7)}</em>
                <svg className="med-chart__pulse" viewBox="0 0 120 28" preserveAspectRatio="none" aria-hidden="true">
                  <path d="M0 14 H30 L37 14 L42 4 L49 24 L55 14 L61 9 L66 14 H120" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                </svg>
              </div>
              <div className="med-chart__body">
                <div className="med-chart__kicker"><span>Амбулаторная карта</span><i /> <small>анонимный пациент</small></div>
                <h1>Ежедневная игра: диагнозы</h1>
                <p>Каждый день — новый пациент с набором симптомов. У вас есть <strong>10 попыток</strong>, чтобы поставить верный диагноз по признакам.</p>
                <div className="med-chart__note" role="note"><span aria-hidden="true"><i /><i /></span> Образовательная игра — не для самодиагностики.</div>
              </div>
            </section>
          : <section className="admit-ticket">
              <div className="admit-ticket__stub">
                <span>ВХОД</span><strong>ОДИН</strong><small>№ {dayNumber(date)}</small><em>{date.slice(8,10)}.{date.slice(5,7)}</em><i />
              </div>
              <div className="admit-ticket__body">
                <div className="ticket-kicker"><span>Ежедневная премьера</span><i /> <small>полночный сеанс</small></div>
                <h1>Ежедневная игра: {modeLower(mode)}</h1>
                <p>Каждый день доступна новая загадка. У вас есть <strong>10 попыток</strong>, а каждый ответ открывает сравнительные подсказки.</p>
                <div className="ticket-settings">
                  <PeriodControl value={period} onChange={setPeriod} compact />
                </div>
              </div>
            </section>}
        <ActionButton className="play-button" onClick={onPlay}><Play /> Начать игру</ActionButton>
      </section>
    </main>
  </>
}

function RewatchScreen({ mode, setMode, period, setPeriod, dates, games, onOpen, onHome, onStats, onRules }: {
  mode: TitleMode
  setMode: (mode: TitleMode) => void
  period: PeriodKey
  setPeriod: (period: PeriodKey) => void
  dates: string[]
  games: SavedGame[]
  onOpen: (date: string, game: SavedGame | null) => void
  onHome: () => void
  onStats: () => void
  onRules: () => void
}) {
  const latestByUpdatedAt = (items: SavedGame[]): SavedGame | null => {
    if (!items.length) return null
    return items.reduce((best, current) => current.updatedAt > best.updatedAt ? current : best)
  }

  return <>
    <AppHeader onHome={onHome} onArchive={() => undefined} onStats={onStats} onRules={onRules} />
    <main className="rewatch-screen">
      <div className="rewatch-heading"><RotateCcw /><h1>Ревотч</h1><p>Пропустили премьеру? Пройдите один из шести прошлых сеансов.</p></div>
      <div className="rewatch-toolbar">
        <div className="mode-tabs"><button className={mode === 'movie' ? 'active' : ''} onClick={() => setMode('movie')}>Фильмы</button><button className={mode === 'series' ? 'active' : ''} onClick={() => setMode('series')}>Сериалы</button><button className={mode === 'diagnosis' ? 'active' : ''} onClick={() => setMode('diagnosis')}>Диагнозы</button></div>
        {mode !== 'diagnosis' && <PeriodControl value={period} onChange={setPeriod} />}
      </div>
      <section className="rewatch-grid">{dates.map((itemDate, index) => {
        const dayGames = games.filter((game) => game.date === itemDate && game.mode === mode)
        const playedInCurrentPeriod = dayGames.find((game) => game.period === period)
        const played = playedInCurrentPeriod ?? latestByUpdatedAt(dayGames)
        return <button className={`rewatch-item ${played?.status ?? ''}`} key={itemDate} onClick={() => onOpen(itemDate, played)}>
          <div className="rewatch-poster"><span>#{dayNumber(itemDate)}</span><i>{played?.status === 'won' ? `${played.attempts.length}/10` : played?.status === 'lost' ? '×' : ''}</i></div>
          <strong>{index === 0 ? 'Вчера' : prettyDate(itemDate)}</strong>
          <small>{played
            ? `${played.status === 'won' ? 'Угадан' : played.status === 'lost' ? 'Не угадан' : 'В процессе'}${played.mode === 'diagnosis' ? '' : ` · ${PERIODS[played.period].short}`}`
            : 'Не сыгран'}</small>
        </button>
      })}</section>
      <ActionButton variant="secondary" className="back-to-premiere" onClick={onHome}>К выбору игры</ActionButton>
    </main>
  </>
}

function PersonPortrait({ person }: { person: HintPerson }) {
  const [failed, setFailed] = useState(false)
  const name = person.nameRu || person.nameOriginal || 'Нет данных'
  const initials = name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
  return <div className={`hint-person ${person.matched ? 'matched' : ''}`}>
    <div className="hint-person__portrait">
      {person.photoUrl && !failed
        ? <img src={person.photoUrl} alt={name} onError={() => setFailed(true)} />
        : <span>{initials || '—'}</span>}
    </div>
    <strong>{name}</strong>
  </div>
}

function ClueTile({ hint, delay }: { hint: Attempt['hints'][number]; delay: number }) {
  const genreTiles = hint.key === 'genres' ? hint.value.split(',').map((genre) => genre.trim()).filter(Boolean) : []
  return <div className={`clue-tile ${hint.status} clue-${hint.key}`} style={{ animationDelay: `${delay * 30}ms` }}>
    <div className="clue-tile__top">
      <span>{hint.label}</span>
      {hint.direction === 'up' ? <ArrowUp /> : hint.direction === 'down' ? <ArrowDown /> : hint.status === 'match' ? <Check /> : null}
    </div>
    {genreTiles.length
      ? <div className="clue-genre-list">{genreTiles.map((genre) => <span key={genre}>{genre}</span>)}</div>
      : <strong>{hint.value}</strong>}
    <small>{statusLabel[hint.status]}</small>
  </div>
}

function PeopleGroup({ hint }: { hint: Attempt['hints'][number] }) {
  return <div className={`people-group ${hint.status}`}>
    <div className="people-group__head"><span>{hint.label}</span><small>{statusLabel[hint.status]}</small></div>
    <div className="people-row">
      {hint.people?.length
        ? hint.people.map((person, index) => <PersonPortrait key={`${person.nameRu}-${index}`} person={person} />)
        : <span className="people-empty">Нет данных</span>}
    </div>
  </div>
}

function AttemptCard({ attempt, item, index }: { attempt: Attempt; item: TitleItem; index: number }) {
  const byKey = new Map(attempt.hints.map((hint) => [hint.key, hint]))
  const primary = ['year', 'country', 'kp'].map((key) => byKey.get(key)).filter(Boolean) as Attempt['hints']
  const people = ['creator', 'cast'].map((key) => byKey.get(key)).filter(Boolean) as Attempt['hints']
  const secondary = ['imdb', 'runtime', 'age', 'popularity'].map((key) => byKey.get(key)).filter(Boolean) as Attempt['hints']
  const genresHint = byKey.get('genres')
  const matchedGenres = new Set((genresHint?.matchedValues ?? []).map(normalizeTextMatch))
  return <article className="attempt-card">
    <div className="attempt-card__header">
      <span className="attempt-card__number">{String(index + 1).padStart(2, '0')}</span>
      <Poster item={item} />
      <div className="attempt-card__identity">
        <span className="attempt-label">Попытка {index + 1}</span>
        <h2>{item.titleRu}</h2>
        <p>{item.titleOriginal || 'Оригинальное название не указано'} · {item.year}</p>
        <div className="genre-pills">{(item.genres ?? []).map((genre) => {
          const normalizedGenre = normalizeTextMatch(genre)
          const pillStatus = genresHint?.status === 'unknown'
            ? 'unknown'
            : matchedGenres.has(normalizedGenre)
              ? 'match'
              : 'miss'
          return <span key={genre} className={pillStatus}>{genre}</span>
        })}</div>
      </div>
      <div className="rating-badge"><small>КП</small><strong>{item.ratings?.kinopoisk?.toFixed(1) ?? '—'}</strong></div>
    </div>
    <div className="primary-clues">{primary.map((hint, hintIndex) => <ClueTile key={hint.key} hint={hint} delay={hintIndex} />)}</div>
    <div className="people-strip">{people.map((hint) => <PeopleGroup key={hint.key} hint={hint} />)}</div>
    <div className="secondary-clues">{secondary.map((hint, hintIndex) => <ClueTile key={hint.key} hint={hint} delay={hintIndex + primary.length} />)}</div>
  </article>
}

function DxAttrBadge({ hint }: { hint: Attempt['hints'][number] }) {
  return <div className={`dx-attr ${hint.status}`}>
    <span className="dx-attr__label">{hint.label}</span>
    <strong className="dx-attr__val">{hint.value}</strong>
    <i className="dx-attr__mark" aria-hidden="true">
      {hint.status === 'match' ? <Check /> : hint.status === 'miss' ? <X /> : null}
    </i>
  </div>
}

function DxChipCloud({ label, hint, items, limit = 6 }: { label: string; hint: Attempt['hints'][number] | undefined; items: string[]; limit?: number }) {
  const [expanded, setExpanded] = useState(false)
  if (!items.length) return null
  const matched = new Set((hint?.matchedValues ?? []).map(normalizeTextMatch))
  const matchedCount = items.filter((value) => matched.has(normalizeTextMatch(value))).length
  const visible = expanded ? items : items.slice(0, limit)
  const hidden = items.slice(limit)
  const countTone = matchedCount === items.length ? 'match' : matchedCount ? 'partial' : 'miss'
  return <div className="dx-cloud">
    <div className="dx-cloud__head">
      <span>{label}</span>
      <small className={countTone}>{matchedCount}/{items.length}</small>
    </div>
    <div className="dx-cloud__chips">
      {visible.map((value) => {
        const isMatched = matched.has(normalizeTextMatch(value))
        return <span key={value} className={`dx-chip ${isMatched ? 'match' : 'miss'}`}>{isMatched && <Check />}{value}</span>
      })}
      {!expanded && hidden.length > 0 && <button type="button" className="dx-chip dx-chip--more" title={hidden.join(', ')} onClick={() => setExpanded(true)}>+{hidden.length}</button>}
      {expanded && items.length > limit && <button type="button" className="dx-chip dx-chip--more" onClick={() => setExpanded(false)}>свернуть</button>}
    </div>
  </div>
}

function DiagnosisAttemptCard({ attempt, item, index }: { attempt: Attempt; item: TitleItem; index: number }) {
  const byKey = new Map(attempt.hints.map((hint) => [hint.key, hint]))
  const attrs = ['body_systems', 'disease_types', 'course', 'contagiousness', 'typical_age', 'localization']
    .map((key) => byKey.get(key))
    .filter(Boolean) as Attempt['hints']
  const total = attempt.hints.length
  const matchedCount = attempt.hints.filter((hint) => hint.status === 'match').length
  const icdValue = item.icd10?.[0] ?? item.icdGroup ?? '—'

  return <article className="attempt-card attempt-card--dx">
    <div className="dx-head">
      <span className="attempt-card__number">{String(index + 1).padStart(2, '0')}</span>
      <span className="dx-head__icon"><Stethoscope /></span>
      <div className="dx-head__identity">
        <span className="attempt-label">Попытка {index + 1}</span>
        <h2>{item.titleRu}</h2>
        <p>{item.titleOriginal || 'Оригинальное название не указано'}</p>
      </div>
      <div className="dx-head__icd"><small>МКБ</small><strong>{icdValue}</strong></div>
    </div>

    <div className="dx-score" aria-label={`Совпало признаков: ${matchedCount} из ${total}`}>
      <span>Совпадений</span>
      <div className="dx-score__bar">{Array.from({ length: total }, (_, i) => <i key={i} className={i < matchedCount ? 'on' : ''} />)}</div>
      <strong>{matchedCount}/{total}</strong>
    </div>

    {!!attrs.length && <div className="dx-attrs">{attrs.map((hint) => <DxAttrBadge key={hint.key} hint={hint} />)}</div>}

    <div className="dx-clouds">
      <DxChipCloud label="Симптомы" hint={byKey.get('symptoms')} items={item.keySymptoms ?? []} limit={6} />
      <DxChipCloud label="Диагностика" hint={byKey.get('diagnostics')} items={item.diagnostics ?? []} limit={4} />
      <DxChipCloud label="Факторы риска" hint={byKey.get('risk_factors')} items={item.riskFactors ?? []} limit={4} />
    </div>
  </article>
}

function Progress({ attempts }: { attempts: number }) {
  return <div className="progress-block">
    <div className="progress-copy"><span>Попытка</span><strong>{Math.min(attempts + 1, 10)} <i>из 10</i></strong></div>
    <div className="progress-track" aria-label={`Использовано попыток: ${attempts} из 10`}>
      {Array.from({ length: 10 }, (_, index) => <i key={index} className={index < attempts ? 'used' : index === attempts ? 'current' : ''} />)}
    </div>
  </div>
}

function Game({
  titles,
  mode,
  period,
  setPeriod,
  date,
  setDate,
  onHome,
  onBack,
  onArchive,
  onStats,
  onRules,
}: {
  titles: TitleItem[]
  mode: TitleMode
  period: PeriodKey
  setPeriod: (period: PeriodKey) => void
  date: string
  setDate: (date: string) => void
  onHome: () => void
  onBack: () => void
  onArchive: () => void
  onStats: () => void
  onRules: () => void
}) {
  const effectivePeriod: PeriodKey = mode === 'diagnosis' ? 'all' : period
  const pool = useMemo(() => poolFor(titles, mode, effectivePeriod), [titles, mode, effectivePeriod])
  const answer = useMemo(() => pool.length ? dailyTitle(pool, mode, effectivePeriod, date) : null, [pool, mode, effectivePeriod, date])
  const key = gameKey(mode, effectivePeriod, date)
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [status, setStatus] = useState<GameStatus>('playing')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<TitleItem | null>(null)
  const [message, setMessage] = useState('')
  const [hintChoices, setHintChoices] = useState<HintChoice[]>([])
  const [dismissedHintRounds, setDismissedHintRounds] = useState<HintCheckpoint[]>([])
  const [hintModalRound, setHintModalRound] = useState<HintCheckpoint | null>(null)
  const [copied, setCopied] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const saved = loadGame(key)
    setAttempts(saved?.attempts ?? [])
    setStatus(saved?.status ?? 'playing')
    const restoredChoices = Array.isArray(saved?.hintChoices)
      ? saved.hintChoices
      : (saved?.usedHints ?? []).slice(0, 2).map((hintKey, index) => ({ round: (index === 0 ? 5 : 8) as HintCheckpoint, key: hintKey }))
    setHintChoices(restoredChoices)
    setDismissedHintRounds(Array.isArray(saved?.dismissedHintRounds) ? saved.dismissedHintRounds : [])
    setHintModalRound(null)
    setQuery('')
    setSelected(null)
    setMessage('')
  }, [key])

  const used = useMemo(() => new Set(attempts.map((attempt) => attempt.titleId)), [attempts])
  const suggestions = useMemo(() => searchTitles(pool, query, used), [pool, query, used])
  const assistHints = useMemo(() => answer ? buildAssistHints(answer) : [], [answer])
  const usedHintsSet = useMemo(() => new Set(hintChoices.map((choice) => choice.key)), [hintChoices])
  const revealedAssistHints = useMemo(() => assistHints.filter((hint) => usedHintsSet.has(hint.key)), [assistHints, usedHintsSet])
  const currentRound = Math.min(attempts.length + 1, 10)
  const activeHintRound = status === 'playing' && (currentRound === 5 || currentRound === 8) ? currentRound as HintCheckpoint : null
  const hasUsedActiveHint = activeHintRound !== null && hintChoices.some((choice) => choice.round === activeHintRound)

  useEffect(() => {
    if (activeHintRound && !hasUsedActiveHint && !dismissedHintRounds.includes(activeHintRound)) {
      setHintModalRound(activeHintRound)
    } else if (!activeHintRound) {
      setHintModalRound(null)
    }
  }, [activeHintRound, hasUsedActiveHint, dismissedHintRounds])

  const updateStats = (won: boolean, count: number) => {
    const stats = loadStats(mode)
    const next: Stats = {
      ...stats,
      distribution: [...stats.distribution],
      played: stats.played + 1,
      won: stats.won + (won ? 1 : 0),
      currentStreak: won ? stats.currentStreak + 1 : 0,
      bestStreak: won ? Math.max(stats.bestStreak, stats.currentStreak + 1) : stats.bestStreak,
    }
    if (won) next.distribution[count - 1] += 1
    saveStats(mode, next)
  }

  const persistGame = (nextAttempts: Attempt[], nextStatus: GameStatus, nextHintChoices: HintChoice[], nextDismissedRounds = dismissedHintRounds) => {
    if (!answer) return
    saveGame({
      key,
      mode,
      period: effectivePeriod,
      date,
      answerId: answer.id,
      attempts: nextAttempts,
      status: nextStatus,
      usedHints: nextHintChoices.map((choice) => choice.key),
      hintChoices: nextHintChoices,
      dismissedHintRounds: nextDismissedRounds,
      updatedAt: Date.now(),
    })
  }

  const revealAssistHint = (hintKey: AssistHintKey) => {
    if (!answer || status !== 'playing' || !activeHintRound) return
    if (usedHintsSet.has(hintKey)) return

    const targetHint = assistHints.find((hint) => hint.key === hintKey)
    if (!targetHint?.available) {
      setMessage('Для этой подсказки пока нет данных')
      return
    }
    const nextHintChoices = [...hintChoices, { round: activeHintRound, key: hintKey }]
    setHintChoices(nextHintChoices)
    setHintModalRound(null)
    setMessage('')
    persistGame(attempts, status, nextHintChoices)
  }

  const dismissHintModal = () => {
    if (!hintModalRound) return
    const nextDismissedRounds = [...new Set([...dismissedHintRounds, hintModalRound])] as HintCheckpoint[]
    setDismissedHintRounds(nextDismissedRounds)
    setHintModalRound(null)
    persistGame(attempts, status, hintChoices, nextDismissedRounds)
  }

  const submit = (forcedSelection?: TitleItem) => {
    const nextSelection = forcedSelection ?? selected
    if (!nextSelection || !answer || status !== 'playing') {
      setMessage('Выберите вариант из найденного списка')
      return
    }
    if (used.has(nextSelection.id)) {
      setMessage('Этот вариант уже был в попытках')
      return
    }
    const nextAttempts = [...attempts, { titleId: nextSelection.id, hints: compareTitles(nextSelection, answer) }]
    const nextStatus: GameStatus = nextSelection.id === answer.id ? 'won' : nextAttempts.length >= 10 ? 'lost' : 'playing'
    setAttempts(nextAttempts)
    setStatus(nextStatus)
    setQuery('')
    setSelected(null)
    setMessage('')
    persistGame(nextAttempts, nextStatus, hintChoices)
    if (nextStatus !== 'playing') updateStats(nextStatus === 'won', nextAttempts.length)
    setTimeout(() => {
      const targetSelector = nextStatus === 'playing' ? '.attempt-card:first-child' : '.result-card'
      document.querySelector(targetSelector)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 100)
  }

  const share = async () => {
    const text = resultText(mode, date, effectivePeriod, attempts.map((attempt) => attempt.hints), status === 'won')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      setMessage('Не удалось скопировать результат')
    }
  }

  if (!answer) return <div className="loading">В этой теме пока нет записей.</div>

  return <>
    <AppHeader onHome={onHome} onArchive={onArchive} onStats={onStats} onRules={onRules} />
    <main className="game-shell">
      <div className="screen-back-row">
        <button className="screen-back" onClick={onBack} aria-label="Назад"><ChevronLeft /></button>
      </div>
      <section className="game-heading">
        <div>
          <span className="game-heading__kicker">{date === getMoscowDate() ? 'Сегодня' : 'Архив'} · Сеанс №{dayNumber(date)}</span>
          <h1>{modeDaily(mode)} дня</h1>
          <p>{prettyDate(date)} · обновление в 00:00 МСК</p>
        </div>
        <div className="mini-ticket" aria-hidden="true"><Ticket /><span>{date.slice(8, 10)}<small>/{date.slice(5, 7)}</small></span></div>
      </section>

      <section className="game-toolbar" aria-label="Настройки игры">
        <GameSelector mode={mode} onClick={onHome} />
        {mode !== 'diagnosis' && <PeriodControl value={period} onChange={setPeriod} />}
        {date !== getMoscowDate() && <ActionButton variant="ghost" className="today-link" onClick={() => setDate(getMoscowDate())}>Сегодня</ActionButton>}
      </section>

      <div className="progress-row">
        <Progress attempts={attempts.length} />
        {activeHintRound && !hasUsedActiveHint && !hintModalRound && <ActionButton variant="hint" className="hint-trigger" onClick={() => setHintModalRound(activeHintRound)}><Sparkles /> Подсказка</ActionButton>}
      </div>

      {!!revealedAssistHints.length && <section className="assist-revealed" aria-label="Открытые подсказки">
        {revealedAssistHints.map((hint) => <article key={hint.key} className="assist-reveal-card">
          <span><Sparkles /> {hint.title}</span>
          {hint.body && <p>{hint.body}</p>}
          {!!hint.people?.length && <div className="assist-people-row">
            {hint.people.map((person, index) => <PersonPortrait key={`${personName(person)}-${index}`} person={person} />)}
          </div>}
        </article>)}
      </section>}

      {status !== 'playing' && <section className={`result-card ${status}`}>
        <Poster item={answer} />
        <div className="result-card__copy">
          <span>{status === 'won' ? 'Сеанс угадан' : 'Сеанс завершён'}</span>
          <h2>{answer.titleRu}</h2>
          <p>{answer.mode === 'diagnosis'
            ? [answer.titleOriginal, ...(answer.icd10?.length ? [answer.icd10.join(', ')] : []), ...(answer.icdGroup ? [answer.icdGroup] : [])].filter(Boolean).join(' · ')
            : `${answer.titleOriginal || 'Оригинальное название не указано'} · ${answer.year ?? '—'}`}</p>
          <div className="result-tags">{(answer.mode === 'diagnosis'
            ? [...(answer.bodySystems ?? []).slice(0, 2), ...(answer.diseaseTypes ?? []).slice(0, 2), ...(answer.icd10 ?? []).slice(0, 1)]
            : (answer.genres ?? [])
          ).map((tag) => <i key={tag}>{tag}</i>)}</div>
          {answer.mode === 'diagnosis' && answer.safetyDisclaimer && <p>{answer.safetyDisclaimer}</p>}
          <strong>{status === 'won' ? `${attempts.length}/10 — верный ответ` : 'Правильный ответ открыт'}</strong>
        </div>
        <div className="result-actions">
          <button onClick={share}>{copied ? <Check /> : <Copy />}{copied ? 'Скопировано' : 'Скопировать'}</button>
          <a href={`https://t.me/share/url?url=${encodeURIComponent(location.href)}&text=${encodeURIComponent(resultText(mode, date, effectivePeriod, attempts.map((attempt) => attempt.hints), status === 'won'))}`} target="_blank" rel="noreferrer"><Share2 /> Telegram</a>
        </div>
      </section>}

      {status === 'playing' && <section className="search-area">
        <label htmlFor="movie-search">{mode === 'diagnosis' ? 'Введите диагноз' : 'Введите название'}</label>
        <div className={`search-box ${selected ? 'selected' : ''}`}>
          <Search />
          <input
            ref={inputRef}
            id="movie-search"
            value={query}
            autoComplete="off"
            placeholder={modeSearchPlaceholder(mode)}
            onChange={(event) => { setQuery(event.target.value); setSelected(null); setMessage('') }}
            onKeyDown={(event) => event.key === 'Enter' && submit()}
          />
          {selected && <Check className="selected-check" />}
          <button onClick={() => submit()} aria-label="Проверить ответ"><ChevronRight /></button>
        </div>
        {query && !selected && <div className="suggestions">
          {suggestions.length ? suggestions.map((item) => <button key={item.id} onClick={() => submit(item)}>
            <Poster item={item} />
            <span><strong>{item.titleRu}</strong><small>{item.mode === 'diagnosis'
              ? [item.titleOriginal || 'Без оригинального названия', ...(item.icd10?.length ? [item.icd10.join(', ')] : []), ...(item.icdGroup ? [item.icdGroup] : [])].filter(Boolean).join(' · ')
              : `${item.titleOriginal || 'Без оригинального названия'} · ${item.year ?? '—'}`}</small></span>
            <em>{item.mode === 'diagnosis' ? (item.contagiousness ?? item.icd10?.[0] ?? '—') : (item.ratings?.kinopoisk?.toFixed(1) ?? '—')}</em>
          </button>) : <div className="empty-search">Ничего не найдено</div>}
        </div>}
        <div className="search-meta"><span>{modePoolLabel(mode, pool.length)}</span>{message && <strong>{message}</strong>}</div>
      </section>}

      {!attempts.length && status === 'playing' && <section className="empty-card">
        <div className="empty-card__icon">{modeIcon(mode)}</div>
        <div><h2>Начните с любого {modeSubjectGenitive(mode)}</h2><p>{mode === 'diagnosis'
          ? 'После ответа появятся сравнения по системе, симптомам, диагностике и коду МКБ.'
          : 'После ответа появятся сравнения по году, жанрам, актёрам, стране и рейтингам.'}</p></div>
        <ActionButton variant="secondary" onClick={onRules}>Как читать подсказки <ChevronRight /></ActionButton>
      </section>}

      {!!attempts.length && <section className="attempt-list">
        <div className="section-title"><span>Ваши попытки</span><strong>{attempts.length}/10</strong></div>
        {attempts.map((attempt, index) => ({ attempt, index })).reverse().map(({ attempt, index }) => {
          const item = titles.find((title) => title.id === attempt.titleId)
          if (!item) return null
          return item.mode === 'diagnosis'
            ? <DiagnosisAttemptCard key={`${attempt.titleId}-${index}`} attempt={attempt} item={item} index={index} />
            : <AttemptCard key={`${attempt.titleId}-${index}`} attempt={attempt} item={item} index={index} />
        })}
      </section>}
    </main>

    {hintModalRound && <div className="hint-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && dismissHintModal()}>
      <section className="hint-modal" role="dialog" aria-modal="true" aria-labelledby="hint-modal-title">
        <div className="hint-modal__head">
          <span><Sparkles /> Возможность · попытка {hintModalRound}</span>
          <button onClick={dismissHintModal} aria-label="Закрыть"><X /></button>
        </div>
        <h2 id="hint-modal-title">Выберите подсказку</h2>
        <p>{hintModalRound === 5 ? 'Можно открыть одну из трёх. Следующая возможность появится перед 8-й попыткой.' : 'Это последняя возможность открыть одну из оставшихся подсказок.'}</p>
        <div className="hint-modal__options">
          {assistHints.map((hint, index) => {
            const isOpen = usedHintsSet.has(hint.key)
            return <button key={hint.key} disabled={isOpen || !hint.available} onClick={() => revealAssistHint(hint.key)}>
              <i>0{index + 1}</i><span><strong>{hint.title}</strong><small>{isOpen ? 'Уже открыта' : !hint.available ? 'Нет данных' : hint.subtitle}</small></span><ChevronRight />
            </button>
          })}
        </div>
        <button className="hint-modal__later" onClick={dismissHintModal}>Не сейчас</button>
      </section>
    </div>}
  </>
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-head"><h2>{title}</h2><button onClick={onClose} aria-label="Закрыть"><X /></button></div>
      {children}
    </div>
  </div>
}

function StatsView({ mode }: { mode: TitleMode }) {
  const stats = loadStats(mode)
  const rate = stats.played ? Math.round(stats.won / stats.played * 100) : 0
  const max = Math.max(1, ...stats.distribution)
  return <>
    <div className="stats-grid">
      <div><strong>{stats.played}</strong><span>сеансов</span></div>
      <div><strong>{rate}%</strong><span>побед</span></div>
      <div><strong>{stats.currentStreak}</strong><span>серия</span></div>
      <div><strong>{stats.bestStreak}</strong><span>рекорд</span></div>
    </div>
    <h3 className="subheading">Победы по попыткам</h3>
    <div className="distribution">{stats.distribution.map((count, index) => <div key={index}><span>{index + 1}</span><i style={{ width: `${Math.max(6, count / max * 100)}%` }}>{count}</i></div>)}</div>
  </>
}

function RulesView() {
  return <div className="rules-list">
    <p>Выберите тайтл из поиска. После каждой попытки значения сравниваются с ответом дня.</p>
    <p>Перед 5-й и 8-й попытками можно открыть по одной из трёх дополнительных подсказок.</p>
    <p>Режим «Диагнозы» носит образовательный характер и не предназначен для самодиагностики.</p>
    <div><i className="match" /><span><strong>Точно</strong> — значение совпало.</span></div>
    <div><i className="close" /><span><strong>Рядом</strong> — число близко или есть частичное совпадение.</span></div>
    <div><i className="miss" /><span><strong>Мимо</strong> — значение не совпало.</span></div>
    <p>Стрелка показывает, выше или ниже находится правильный год, рейтинг или хронометраж.</p>
  </div>
}

export default function App() {
  const [screen, setScreen] = useState<'hub' | 'title' | 'game' | 'rewatch'>('hub')
  const [transition, setTransition] = useState<'idle' | 'title-to-game'>('idle')
  const [mode, setMode] = useState<TitleMode>('movie')
  const [period, setPeriod] = useState<PeriodKey>('all')
  const [date, setDate] = useState(getMoscowDate())
  const [gameBackTarget, setGameBackTarget] = useState<'title' | 'rewatch' | 'hub'>('title')
  const [data, setData] = useState<Record<TitleMode, TitleItem[]>>({ movie: [], series: [], diagnosis: [] })
  const [titleCounts, setTitleCounts] = useState<{ movie: number | null; series: number | null; diagnosis: number | null }>({ movie: null, series: null, diagnosis: null })
  const [modal, setModal] = useState<'stats' | 'rules' | null>(null)
  const [loading, setLoading] = useState(false)
  const transitionTimerRef = useRef<number | null>(null)

  useEffect(() => {
    fetch('/data/source.json')
      .then((response) => response.json())
      .then((source) => setTitleCounts({
        movie: Number.isFinite(source.movieCount) ? source.movieCount : null,
        series: Number.isFinite(source.seriesCount) ? source.seriesCount : null,
        diagnosis: Number.isFinite(source.diagnosisCount) ? source.diagnosisCount : null,
      }))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    fetch('/data/diagnoses.generated.json')
      .then((response) => response.json())
      .then((items: TitleItem[]) => setTitleCounts((current) => ({ ...current, diagnosis: current.diagnosis ?? items.length })))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (data[mode].length) return
    setLoading(true)
    fetch(`/data/${modeDataFile(mode)}.generated.json`)
      .then((response) => response.json())
      .then((items: TitleItem[]) => {
        setData((current) => ({ ...current, [mode]: items }))
        setTitleCounts((current) => ({
          ...current,
          [mode]: current[mode] ?? items.length,
        }))
      })
      .finally(() => setLoading(false))
  }, [mode, data])

  useEffect(() => {
    if (mode === 'diagnosis' && period !== 'all') {
      setPeriod('all')
    }
  }, [mode, period])

  const archiveDates = Array.from({ length: 6 }, (_, offset) => {
    const day = new Date(`${getMoscowDate()}T12:00:00+03:00`)
    day.setDate(day.getDate() - offset - 1)
    return getMoscowDate(day)
  })
  const clearTransitionTimer = () => {
    if (transitionTimerRef.current !== null) {
      window.clearTimeout(transitionTimerRef.current)
      transitionTimerRef.current = null
    }
  }
  useEffect(() => clearTransitionTimer, [])

  const setModeSafe = (nextMode: TitleMode) => {
    setMode(nextMode)
    if (nextMode === 'diagnosis') {
      setPeriod('all')
    }
  }

  const moveToScreen = (target: 'hub' | 'title' | 'rewatch') => {
    clearTransitionTimer()
    setTransition('idle')
    if (target === 'hub') {
      setDate(getMoscowDate())
    }
    setScreen(target)
    setModal(null)
    window.scrollTo({ top: 0 })
  }

  const games = allGames()
  const goHome = () => moveToScreen('hub')
  const goBackFromTitle = () => moveToScreen('hub')
  const goBackFromGame = () => moveToScreen(gameBackTarget)
  const selectCategory = (nextMode: TitleMode) => {
    clearTransitionTimer()
    setTransition('idle')
    setModeSafe(nextMode)
    setDate(getMoscowDate())
    setScreen('title')
    setModal(null)
    window.scrollTo({ top: 0 })
  }
  const playToday = () => {
    if (transition === 'title-to-game') return
    const backTarget = screen === 'rewatch' ? 'rewatch' : screen === 'title' ? 'title' : 'hub'
    setGameBackTarget(backTarget)
    setDate(getMoscowDate())
    setModal(null)
    window.scrollTo({ top: 0 })
    if (screen !== 'title') {
      clearTransitionTimer()
      setTransition('idle')
      setScreen('game')
      return
    }
    setTransition('title-to-game')
    clearTransitionTimer()
    transitionTimerRef.current = window.setTimeout(() => {
      setScreen('game')
      setTransition('idle')
      transitionTimerRef.current = null
    }, 460)
  }
  const openArchive = (archiveDate: string, savedGame: SavedGame | null) => {
    clearTransitionTimer()
    setTransition('idle')
    setGameBackTarget('rewatch')
    if (savedGame) {
      setModeSafe(savedGame.mode)
      setPeriod(savedGame.mode === 'diagnosis' ? 'all' : savedGame.period)
    }
    setDate(archiveDate)
    setScreen('game')
    setModal(null)
    window.scrollTo({ top: 0 })
  }
  const appTone = transition === 'title-to-game' ? 'transition-game' : screen

  return <div className={`app app--${appTone}`}>
    {screen === 'hub' && <HubScreen onSelect={selectCategory} onRewatch={() => setScreen('rewatch')} onStats={() => setModal('stats')} onRules={() => setModal('rules')} titleCounts={titleCounts} />}

    {screen === 'title' && <TitleScreen mode={mode} period={period} setPeriod={setPeriod} date={getMoscowDate()} onHome={goHome} onBack={goBackFromTitle} onPlay={playToday} onRewatch={() => setScreen('rewatch')} onStats={() => setModal('stats')} onRules={() => setModal('rules')} isLeaving={transition === 'title-to-game'} />}

    {screen === 'rewatch' && <RewatchScreen mode={mode} setMode={setModeSafe} period={period} setPeriod={setPeriod} dates={archiveDates} games={games} onOpen={openArchive} onHome={goHome} onStats={() => setModal('stats')} onRules={() => setModal('rules')} />}

    {screen === 'game' && (loading || !data[mode].length
      ? <div className="loading"><Sparkles /> Настраиваем проектор…</div>
      : <Game
          titles={data[mode]}
          mode={mode}
          period={period}
          setPeriod={setPeriod}
          date={date}
          setDate={setDate}
          onHome={goHome}
          onBack={goBackFromGame}
          onArchive={() => setScreen('rewatch')}
          onStats={() => setModal('stats')}
          onRules={() => setModal('rules')}
        />)}

    {modal === 'rules' && <Modal title="Как играть" onClose={() => setModal(null)}><RulesView /></Modal>}
    {modal === 'stats' && <Modal title="Статистика" onClose={() => setModal(null)}><div className="modal-mode">{modePlural(mode)}</div><StatsView mode={mode} /></Modal>}
  </div>
}
