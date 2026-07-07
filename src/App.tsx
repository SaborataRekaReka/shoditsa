import { useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react'
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
  ClipboardList,
  Copy,
  Film,
  Gamepad2,
  HeartPulse,
  Lock,
  MapPin,
  Music2,
  NotebookText,
  Play,
  RotateCcw,
  Search,
  Share2,
  Sparkles,
  Stethoscope,
  Ticket,
  Target,
  Trophy,
  Tv,
  UserRound,
  X,
} from 'lucide-react'
import { compareTitles, dailyTitle, getMoscowDate, PERIODS, pickDailyVignette, poolFor, prettyDate, resultText, searchTitles } from './game'
import { allGames, gameKey, loadGame, loadStats, saveGame, saveStats } from './storage'
import type { AssistHintKey, Attempt, CaseVignetteMap, DiagnosisCaseVignettes, GameStatus, HintCheckpoint, HintChoice, HintPerson, PeriodKey, Person, SavedGame, Stats, TitleItem, TitleMode } from './types'

const normalizeTextMatch = (value: string) => value.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е')
const modeIcon = (mode: TitleMode) => mode === 'movie' ? <Film /> : mode === 'series' ? <Tv /> : mode === 'game' ? <Gamepad2 /> : <Stethoscope />
const modeTitle = (mode: TitleMode) => mode === 'movie' ? 'Кино' : mode === 'series' ? 'Сериалы' : mode === 'game' ? 'Игры' : 'Диагнозы'
const modePlural = (mode: TitleMode) => mode === 'movie' ? 'Фильмы' : mode === 'series' ? 'Сериалы' : mode === 'game' ? 'Игры' : 'Диагнозы'
const modeSubject = (mode: TitleMode) => mode === 'movie' ? 'фильм' : mode === 'series' ? 'сериал' : mode === 'game' ? 'игру' : 'диагноз'
const modeSubjectGenitive = (mode: TitleMode) => mode === 'movie' ? 'фильма' : mode === 'series' ? 'сериала' : mode === 'game' ? 'игры' : 'диагноза'
const modeDaily = (mode: TitleMode) => mode === 'movie' ? 'Фильм' : mode === 'series' ? 'Сериал' : mode === 'game' ? 'Игра' : 'Диагноз'
const modeLower = (mode: TitleMode) => mode === 'movie' ? 'кино' : mode === 'series' ? 'сериалы' : mode === 'game' ? 'игры' : 'диагнозы'
const modeSearchPlaceholder = (mode: TitleMode) => mode === 'movie' ? 'Найти фильм…' : mode === 'series' ? 'Найти сериал…' : mode === 'game' ? 'Найти игру…' : 'Найти диагноз…'
const modeDataFile = (mode: TitleMode) => mode === 'movie' ? 'movies' : mode === 'series' ? 'series' : mode === 'game' ? 'games' : 'diagnoses'
const normalizeSystemKey = (value: string) => normalizeTextMatch(value).replace(/[^a-zа-я0-9]+/gi, ' ').trim()
const diagnosisSystemIconByKey = new Map<string, string>([
  ['дыхательная система', '/images/diagnosis-systems/respiratory.svg'],
  ['пищеварительная система', '/images/diagnosis-systems/digestive.svg'],
  ['психика и поведение', '/images/diagnosis-systems/mental.svg'],
  ['зубы и полость рта', '/images/diagnosis-systems/dental.svg'],
  ['мочевыделительная система', '/images/diagnosis-systems/urinary.svg'],
  ['нервная система', '/images/diagnosis-systems/nervous.svg'],
  ['органы зрения', '/images/diagnosis-systems/vision.svg'],
  ['органы слуха', '/images/diagnosis-systems/hearing.svg'],
  ['кожа и подкожная клетчатка', '/images/diagnosis-systems/skin.svg'],
  ['костно мышечная система', '/images/diagnosis-systems/musculoskeletal.svg'],
  ['кровь и иммунная система', '/images/diagnosis-systems/blood-immune.svg'],
  ['репродуктивная система', '/images/diagnosis-systems/reproductive.svg'],
  ['сердечно сосудистая система', '/images/diagnosis-systems/cardiovascular.svg'],
  ['эндокринная система', '/images/diagnosis-systems/endocrine.svg'],
])
const defaultDiagnosisSystemIcon = '/images/diagnosis-systems/nervous.svg'
const splitHintValues = (value: string) => value.split(',').map((item) => item.trim()).filter((item) => item && item !== 'Нет данных')

const isEditableTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

type AssistHintView = {
  key: AssistHintKey
  title: string
  subtitle: string
  body?: string
  people?: Person[]
  available: boolean
}

type AppScreen = 'hub' | 'title' | 'game' | 'rewatch'
const isAppScreen = (value: unknown): value is AppScreen => value === 'hub' || value === 'title' || value === 'game' || value === 'rewatch'

const cleanHintText = (value: string) => value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const cropHintText = (value: string, max = 210) => value.length > max ? `${value.slice(0, max).trimEnd()}…` : value
const REDACTED_TOKEN_RE = /(\[+\s*REDACTED\s*\]+)/gi
const isRedactedToken = (value: string) => /^\[+\s*REDACTED\s*\]+$/i.test(value)
const renderHintBody = (value: string): ReactNode => {
  const text = cleanHintText(value)
  if (!text) return ''

  const parts = text.split(REDACTED_TOKEN_RE).filter(Boolean)
  if (parts.length === 1) return text

  const nodes: ReactNode[] = []
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]
    if (isRedactedToken(part)) {
      nodes.push(<span className="redaction-chip" key={`redaction-${i}`} aria-label="Скрытый фрагмент">██████</span>)
      continue
    }
    nodes.push(part)
  }

  return nodes
}
const personName = (person: { nameRu: string; nameOriginal: string }) => person.nameRu || person.nameOriginal || 'Без имени'
const progressOverlapHintKeys = new Set([
  'body_systems',
  'symptoms',
  'diagnostics',
  'risk_factors',
  'genres',
  'steam_categories',
  'platforms',
])
const hintProgressScore = (hint: Attempt['hints'][number]) => {
  if (progressOverlapHintKeys.has(hint.key)) {
    const overlapCount = (hint.matchedValues ?? []).filter(Boolean).length
    if (overlapCount > 0) return overlapCount
  }
  if ((hint.key === 'creator' || hint.key === 'cast') && hint.people?.some((person) => person.matched)) return 1
  return hint.status === 'match' ? 1 : 0
}
const progressMatches = (hints: Attempt['hints']) => {
  const raw = hints.reduce((sum, hint) => sum + hintProgressScore(hint), 0)
  return Math.min(hints.length, raw)
}
const alignSystemTooltip = (iconEl: HTMLElement | null) => {
  if (!iconEl || typeof window === 'undefined') return

  if (!window.matchMedia('(max-width: 719px)').matches) {
    iconEl.style.setProperty('--dx-tooltip-shift', '0px')
    return
  }

  const tooltipEl = iconEl.querySelector<HTMLElement>('.dx-system-icon__tooltip')
  if (!tooltipEl) return

  iconEl.style.setProperty('--dx-tooltip-shift', '0px')
  const tooltipRect = tooltipEl.getBoundingClientRect()
  const viewportPadding = 10
  let shift = 0

  if (tooltipRect.left < viewportPadding) {
    shift = viewportPadding - tooltipRect.left
  } else if (tooltipRect.right > window.innerWidth - viewportPadding) {
    shift = window.innerWidth - viewportPadding - tooltipRect.right
  }

  iconEl.style.setProperty('--dx-tooltip-shift', `${Math.round(shift)}px`)
}
const steamCategoryIcon = (value: string): 'single' | 'multi' | null => {
  const text = normalizeTextMatch(value).trim()
  if (!text) return null

  const countMatch = text.match(/^(\d+)/)
  if (countMatch) {
    const count = Number(countMatch[1])
    return count === 1 ? 'single' : 'multi'
  }
  if (text.includes('одиноч')) return 'single'
  if (text.includes('мульти') || text.includes('кооп') || text.includes('онлайн') || text.includes('игрок')) return 'multi'
  return null
}
const playerCountFromCategory = (value: string) => {
  const text = normalizeTextMatch(value)
  const matches = [...text.matchAll(/\d{1,2}/g)]
  if (!matches.length || !/(игрок|player)/.test(text)) return null
  const numbers = matches.map((match) => Number(match[0])).filter((num) => Number.isFinite(num))
  if (!numbers.length) return null
  return Math.max(...numbers)
}
const isPlayerCategory = (value: string) => {
  const text = normalizeTextMatch(value).trim()
  if (!text) return false
  if (playerCountFromCategory(text) != null) return true
  return text.includes('одиноч')
    || text.includes('single')
    || text.includes('мульти')
    || text.includes('multiplayer')
    || text.includes('кооп')
    || text.includes('coop')
    || text.includes('co-op')
    || text.includes('игрок')
    || text.includes('player')
    || text.includes('сетев')
    || text.includes('online')
}
const normalizeGameCategoryKey = (value: string) => {
  const text = normalizeTextMatch(value).trim()
  if (!text) return ''
  const playersCount = playerCountFromCategory(text)
  if (playersCount != null) return `players:${playersCount}`
  if (text.includes('одиноч') || text.includes('single')) return 'players:single'
  if (text.includes('мульти') || text.includes('multiplayer') || text.includes('кооп') || text.includes('coop') || text.includes('co-op') || text.includes('игрок') || text.includes('player') || text.includes('online') || text.includes('сетев')) {
    return 'players:multi'
  }
  return text.replace(/[^a-zа-я0-9]+/gi, ' ').trim()
}
const dedupeGameCategories = (categories: string[], removePlayerCategories: boolean) => {
  const seen = new Set<string>()
  const result: string[] = []

  for (const rawCategory of categories) {
    const category = rawCategory.trim()
    if (!category) continue
    if (removePlayerCategories && isPlayerCategory(category)) continue
    const key = normalizeGameCategoryKey(category) || normalizeTextMatch(category)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(category)
  }

  return result
}
const collectMatchedTags = (attempts: Attempt[]) => {
  const tags: string[] = []
  const seen = new Set<string>()

  for (const attempt of attempts) {
    for (const hint of attempt.hints) {
      const matchedValues = (hint.matchedValues ?? []).map((value) => value.trim()).filter(Boolean)
      for (const value of matchedValues) {
        const hash = `value:${normalizeTextMatch(value)}`
        if (seen.has(hash)) continue
        seen.add(hash)
        tags.push(value)
      }

      if (matchedValues.length || hint.status !== 'match') continue
      if (['creator', 'cast'].includes(hint.key)) continue
      if (!hint.value || hint.value === '—' || hint.value === 'Нет данных') continue

      const exactTag = `${hint.label}: ${hint.value}`
      const hash = `exact:${hint.key}:${normalizeTextMatch(hint.value)}`
      if (seen.has(hash)) continue
      seen.add(hash)
      tags.push(exactTag)
    }
  }

  return tags
}

const buildAssistHints = (item: TitleItem): AssistHintView[] => {
  const plot = cropHintText(cleanHintText(item.plotHint || item.description || ''))
  const facts = (item.facts ?? []).map(cleanHintText).filter(Boolean)
  const fact = facts[0] || cropHintText(cleanHintText(item.slogan || ''))

  if (item.mode === 'diagnosis') {
    const diagnosticsHint = cropHintText(cleanHintText((item.diagnostics ?? []).slice(0, 4).join(', ')))
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
        title: 'Факт',
        subtitle: 'Дополнительная деталь по состоянию',
        body: fact,
        available: Boolean(fact),
      },
    ]
  }

  if (item.mode === 'game') {
    const dedupedGameCategories = dedupeGameCategories(item.steamCategories ?? [], true)
    const tagsHint = cropHintText(cleanHintText([
      ...(item.genres ?? []).slice(0, 3),
      ...dedupedGameCategories.slice(0, 3),
    ].join(', ')))
    const gameFact = cropHintText(cleanHintText([
      item.year ? `Год релиза: ${item.year}` : '',
      item.topRank ? `Позиция в топе: #${item.topRank}` : '',
      item.ratings?.metacritic ?? item.metacritic ? `Metacritic: ${item.ratings?.metacritic ?? item.metacritic}` : '',
    ].filter(Boolean).join(' · ')))
    return [
      {
        key: 'plot',
        title: 'Описание',
        subtitle: 'Фрагмент карточки игры без спойлеров',
        body: plot,
        available: Boolean(plot),
      },
      {
        key: 'slogan',
        title: 'Жанры и категории',
        subtitle: 'Подсказка по жанрам и тегам Steam',
        body: tagsHint,
        available: Boolean(tagsHint),
      },
      {
        key: 'fact',
        title: 'Релизный факт',
        subtitle: 'Год, место в топе или оценка Metacritic',
        body: gameFact,
        available: Boolean(gameFact),
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
    : <div className={`${className} poster-fallback`}>
      {item.mode !== 'diagnosis' ? modeIcon(item.mode) : null}
      <span>{item.titleRu}</span>
    </div>
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

function HubScreen({ onSelect, onRewatch, onStats, onRules, onResume, activeSessionsCount, titleCounts }: {
  onSelect: (mode: TitleMode) => void
  onRewatch: () => void
  onStats: () => void
  onRules: () => void
  onResume: () => void
  activeSessionsCount: number
  titleCounts: { movie: number | null; series: number | null; game: number | null; diagnosis: number | null }
}) {
  const futureCategories = [
    { title: 'Музыка', copy: 'Угадайте группу или исполнителя', icon: <Music2 /> },
    { title: 'Города', copy: 'Найдите город по его признакам', icon: <MapPin /> },
  ]
  const availableNowCount = 4
  const scrollToGames = () => document.getElementById('available-games')?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return <>
    <AppHeader onHome={() => undefined} onArchive={onRewatch} onStats={onStats} onRules={onRules} />
    <main className="hub-screen">
      <section className="hub-hero">
        <div className="hub-hero__copy">
          <span>Ежедневные игры</span>
          <h1>Выберите тему<br />{' '}и всё сойдется!</h1>
          <p>Кино, сериалы, игры, города, музыка и диагнозы. Каждый день — новая загадка и 10 попыток, чтобы найти ответ по подсказкам.</p>
          <div className="hub-hero__actions">
            <ActionButton onClick={scrollToGames}><Play /> Играть сейчас</ActionButton>
            {activeSessionsCount > 0
              ? <ActionButton variant="secondary" onClick={onResume}><RotateCcw /> {activeSessionsCount > 1 ? `Вернуться к игре (${activeSessionsCount})` : 'Вернуться к игре'}</ActionButton>
              : <ActionButton variant="secondary" onClick={onRules}><CircleHelp /> Как это работает</ActionButton>}
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
        <div className="category-heading"><span>Доступно сейчас</span><small>{String(availableNowCount).padStart(2, '0')} игры</small></div>
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
          <button className="category-card category-card--game" onClick={() => onSelect('game')}>
            <div className="category-card__head">
              <span className="category-card__icon"><Gamepad2 /></span>
              <span className="category-card__pool"><b>{titleCounts.game ?? '—'}</b> в пуле</span>
            </div>
            <i>Ежедневная игра</i><h2>Игры</h2>
            <p>Угадайте игру по жанрам, рейтингу, месту в топе и метрикам Steam.</p>
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

function TitleScreen({ mode, period, setPeriod, date, onHome, onBack, onPlay, onRewatch, onStats, onRules, isLeaving, onReadAnamnesis, hasAnamnesis }: {
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
  onReadAnamnesis: () => void
  hasAnamnesis: boolean
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.key === 'Escape') {
        event.preventDefault()
        onBack()
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        onPlay()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onBack, onPlay])

  return <>
    <AppHeader onHome={onHome} onArchive={onRewatch} onStats={onStats} onRules={onRules} />
    <main className={`title-screen ${isLeaving ? 'is-leaving' : ''}`}>
      <div className="screen-back-row">
        <button className="screen-back" onClick={onBack} aria-label="Назад"><ChevronLeft /></button>
        <span className="keycap-hint" aria-hidden="true">Esc</span>
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
                {hasAnamnesis && <button type="button" className="med-chart__anamnesis" onClick={onReadAnamnesis}>
                  <span className="med-chart__anamnesis-portrait" aria-hidden="true"><UserRound /></span>
                  <span className="med-chart__anamnesis-copy"><strong>Прочитать анамнез</strong><small>С чем пациент пришёл на приём</small></span>
                  <ChevronRight aria-hidden="true" />
                </button>}
              </div>
            </section>
          : mode === 'game'
            ? <section className="game-case">
                <div className="game-case__spine" aria-hidden="true"><span>Сходится · Игры</span></div>
                <div className="game-case__body">
                  <div className="game-case__band">
                    <span className="game-case__platform">PC</span>
                    <span className="game-case__band-title">Игра дня</span>
                    <span className="game-case__band-no">№ {dayNumber(date)}</span>
                  </div>
                  <div className="game-case__cover">
                    <span className="game-case__disc" aria-hidden="true"><i /></span>
                    <div className="game-case__info">
                      <div className="game-case__kicker"><span>Ежедневный релиз</span><i /> <small>глобальный чарт</small></div>
                      <h1>Ежедневная игра: игры</h1>
                      <p>Каждый день — новая игра из мирового чарта. У вас есть <strong>10 попыток</strong>, чтобы узнать её по жанрам, студии и рейтингам.</p>
                    </div>
                  </div>
                  <div className="game-case__actions">
                    <ActionButton className="game-case__play" onClick={onPlay}><Play /> Начать игру <span className="keycap-hint keycap-hint--inline" aria-hidden="true">Enter</span></ActionButton>
                  </div>
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
        {mode !== 'game' && <ActionButton className="play-button" onClick={onPlay}><Play /> Начать игру <span className="keycap-hint keycap-hint--inline" aria-hidden="true">Enter</span></ActionButton>}
      </section>
    </main>
  </>
}

function RewatchScreen({ mode, setMode, period, dates, games, onOpen, onHome, onStats, onRules }: {
  mode: TitleMode
  setMode: (mode: TitleMode) => void
  period: PeriodKey
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
      <div className="rewatch-heading"><RotateCcw /><h1>Архив</h1><p>История по всем режимам: сегодня и шесть предыдущих дней.</p></div>
      <div className="rewatch-toolbar">
        <div className="mode-tabs"><button className={mode === 'movie' ? 'active' : ''} onClick={() => setMode('movie')}>Фильмы</button><button className={mode === 'series' ? 'active' : ''} onClick={() => setMode('series')}>Сериалы</button><button className={mode === 'game' ? 'active' : ''} onClick={() => setMode('game')}>Игры</button><button className={mode === 'diagnosis' ? 'active' : ''} onClick={() => setMode('diagnosis')}>Диагнозы</button></div>
      </div>
      <section className="rewatch-grid">{dates.map((itemDate, index) => {
        const dayGames = games.filter((game) => game.date === itemDate && game.mode === mode)
        const playedInCurrentPeriod = dayGames.find((game) => game.period === period)
        const played = playedInCurrentPeriod ?? latestByUpdatedAt(dayGames)
        return <button className={`rewatch-item ${played?.status ?? ''}`} key={itemDate} onClick={() => onOpen(itemDate, played)}>
          <div className="rewatch-poster"><span>#{dayNumber(itemDate)}</span><i>{played?.status === 'won' ? `${played.attempts.length}/10` : played?.status === 'lost' ? '×' : ''}</i></div>
          <strong>{index === 0 ? 'Сегодня' : index === 1 ? 'Вчера' : prettyDate(itemDate)}</strong>
          <small>{played
            ? `${played.status === 'won' ? 'Угадан' : played.status === 'lost' ? 'Не угадан' : 'В процессе'}${played.mode === 'movie' || played.mode === 'series' ? ` · ${PERIODS[played.period].short}` : ''}`
            : 'Не сыгран'}</small>
        </button>
      })}</section>
      <ActionButton variant="secondary" className="back-to-premiere" onClick={onHome}>На главный экран</ActionButton>
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
  </div>
}

function DxSystemIcons({ hint }: { hint: Attempt['hints'][number] }) {
  const systems = splitHintValues(hint.value)
  if (!systems.length) return null

  const matched = new Set((hint.matchedValues ?? []).map(normalizeSystemKey))
  const matchedCount = systems.filter((value) => matched.has(normalizeSystemKey(value))).length
  const countTone = matchedCount === systems.length ? 'match' : matchedCount ? 'partial' : 'miss'

  return <section className="dx-systems" aria-label={`Совпадение систем: ${matchedCount} из ${systems.length}`}>
    <div className="dx-systems__head">
      <span>{hint.label}</span>
      <small className={countTone}>{matchedCount}/{systems.length}</small>
    </div>
    <div className="dx-systems__list">
      {systems.map((system, index) => {
        const key = normalizeSystemKey(system)
        const icon = diagnosisSystemIconByKey.get(key) ?? defaultDiagnosisSystemIcon
        const isMatched = matched.has(key)
        const style = {
          '--dx-system-icon': `url("${icon}")`,
          animationDelay: `${index * 26}ms`,
        } as CSSProperties
        return <span
          key={`${hint.key}-${system}`}
          className={`dx-system-icon ${isMatched ? 'match' : 'miss'}`}
          style={style}
          aria-label={system}
          tabIndex={0}
          onMouseEnter={(event) => alignSystemTooltip(event.currentTarget)}
          onFocus={(event) => alignSystemTooltip(event.currentTarget)}
          onTouchStart={(event) => alignSystemTooltip(event.currentTarget)}
        >
          <span className="dx-system-icon__glyph" aria-hidden="true" />
          <span className="dx-system-icon__tooltip" role="tooltip">{system}</span>
        </span>
      })}
    </div>
  </section>
}

function HorizontalScrollLane({ className, children }: { className: string; children: ReactNode }) {
  const laneRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef({
    pointerId: -1,
    startX: 0,
    startScrollLeft: 0,
    moved: false,
  })
  const [isDragging, setIsDragging] = useState(false)

  const stopDrag = (pointerId: number) => {
    const lane = laneRef.current
    if (!lane) return
    if (lane.hasPointerCapture(pointerId)) lane.releasePointerCapture(pointerId)
    const shouldResetAfterClick = dragRef.current.moved
    dragRef.current.pointerId = -1
    setIsDragging(false)
    if (shouldResetAfterClick) {
      requestAnimationFrame(() => {
        dragRef.current.moved = false
      })
    }
  }

  return <div
    ref={laneRef}
    className={`${className} ${isDragging ? 'is-dragging' : ''}`.trim()}
    onWheel={(event) => {
      const lane = laneRef.current
      if (!lane || lane.scrollWidth <= lane.clientWidth) return
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      if (!delta) return
      lane.scrollLeft += delta
      event.preventDefault()
    }}
    onPointerDown={(event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return
      const lane = laneRef.current
      if (!lane || lane.scrollWidth <= lane.clientWidth) return
      dragRef.current.pointerId = event.pointerId
      dragRef.current.startX = event.clientX
      dragRef.current.startScrollLeft = lane.scrollLeft
      dragRef.current.moved = false
      lane.setPointerCapture(event.pointerId)
      setIsDragging(true)
    }}
    onPointerMove={(event) => {
      const lane = laneRef.current
      if (!lane || dragRef.current.pointerId !== event.pointerId) return
      const dx = event.clientX - dragRef.current.startX
      if (Math.abs(dx) > 4) dragRef.current.moved = true
      lane.scrollLeft = dragRef.current.startScrollLeft - dx
    }}
    onPointerUp={(event) => stopDrag(event.pointerId)}
    onPointerCancel={(event) => stopDrag(event.pointerId)}
    onPointerLeave={(event) => {
      if (event.pointerType === 'mouse' && dragRef.current.pointerId === event.pointerId) stopDrag(event.pointerId)
    }}
    onClickCapture={(event) => {
      if (!dragRef.current.moved) return
      event.preventDefault()
      event.stopPropagation()
      dragRef.current.moved = false
    }}
  >
    {children}
  </div>
}

function PeopleGroup({ hint }: { hint: Attempt['hints'][number] }) {
  return <div className={`people-group ${hint.status} people-${hint.key}`}>
    <div className="people-group__head"><span>{hint.label}</span></div>
    <div className="people-row">
      {hint.people?.length
        ? hint.people.map((person, index) => <PersonPortrait key={`${person.nameRu}-${index}`} person={person} />)
        : <span className="people-empty">Нет данных</span>}
    </div>
  </div>
}

function AttemptCard({ attempt, item, index }: { attempt: Attempt; item: TitleItem; index: number }) {
  const byKey = new Map(attempt.hints.map((hint) => [hint.key, hint]))
  const metricClues = ['country', 'series_status', 'seasons', 'runtime', 'kp', 'imdb'].map((key) => byKey.get(key)).filter(Boolean) as Attempt['hints']
  const people = ['creator', 'cast'].map((key) => byKey.get(key)).filter(Boolean) as Attempt['hints']
  const genresHint = byKey.get('genres')
  const genres = item.genres ?? []
  const genreMatched = new Set((genresHint?.matchedValues ?? []).map(normalizeTextMatch))
  const total = attempt.hints.length
  const matchedCount = progressMatches(attempt.hints)
  const yearHint = byKey.get('year')
  const ageHint = byKey.get('age')
  const yearText = item.year != null ? String(item.year) : null
  const ageText = item.ageRating ?? '—'
  const isSeriesAttempt = item.mode === 'series'
  return <article className={`attempt-card attempt-card--screen${isSeriesAttempt ? ' attempt-card--screen-series' : ''}`}>
    <div className="attempt-card__header">
      <span className="attempt-card__number">{String(index + 1).padStart(2, '0')}</span>
      <Poster item={item} />
      <div className="attempt-card__identity">
        <span className="attempt-label">Попытка {index + 1}</span>
        <h2>{item.titleRu}</h2>
        <p className="gm-head__sub">
          <span className="gm-head__orig">{item.titleOriginal || 'Оригинальное название не указано'}</span>
          {yearText && <>
            <i className="gm-head__dot" aria-hidden="true">·</i>
            <span className={`gm-year ${yearHint?.status ?? ''}`}>
              {yearText}
              {yearHint?.direction === 'up' ? <ArrowUp /> : yearHint?.direction === 'down' ? <ArrowDown /> : yearHint?.status === 'match' ? <Check /> : null}
            </span>
          </>}
          {ageText !== '—' && <>
            <i className="gm-head__dot" aria-hidden="true">·</i>
            <span className={`gm-year gm-year--age ${ageHint?.status ?? ''}`}>
              {ageText}
              {ageHint?.direction === 'up' ? <ArrowUp /> : ageHint?.direction === 'down' ? <ArrowDown /> : ageHint?.status === 'match' ? <Check /> : null}
            </span>
          </>}
        </p>
        {!!genres.length && <div className="gm-genres">
          {genres.slice(0, 4).map((genre) => {
            const isMatch = genreMatched.has(normalizeTextMatch(genre))
            return <span key={genre} className={`gm-genre ${isMatch ? 'match' : ''}`}>{genre}{isMatch && <Check />}</span>
          })}
        </div>}
      </div>
      <div className="rating-badge"><small>КП</small><strong>{item.ratings?.kinopoisk?.toFixed(1) ?? '—'}</strong></div>
    </div>

    <div className="dx-score" aria-label={`Совпало признаков: ${matchedCount} из ${total}`}>
      <span>Совпадений</span>
      <div className="dx-score__bar">{Array.from({ length: total }, (_, i) => <i key={i} className={i < matchedCount ? 'on' : ''} />)}</div>
      <strong>{matchedCount}/{total}</strong>
    </div>

    <div className="attempt-clue-grid">
      {metricClues.map((hint, hintIndex) => <ClueTile key={hint.key} hint={hint} delay={hintIndex} />)}
      {people.map((hint) => <PeopleGroup key={hint.key} hint={hint} />)}
    </div>
  </article>
}

function GameStudioPlate({ label, names, hint }: { label: string; names: string[]; hint: Attempt['hints'][number] | undefined }) {
  if (!names.length) return null
  const matched = new Set((hint?.matchedValues ?? []).map(normalizeTextMatch))
  const isMatch = hint?.status === 'match' || names.some((name) => matched.has(normalizeTextMatch(name)))
  const monogram = (names[0].match(/[A-Za-zА-Яа-я0-9]+/g) ?? []).slice(0, 2).map((word) => word[0]).join('').toUpperCase() || '?'
  return <div className={`gm-studio ${isMatch ? 'match' : 'miss'}`}>
    <span className="gm-studio__logo" aria-hidden="true">{monogram}</span>
    <span className="gm-studio__meta">
      <small>{label}</small>
      <strong title={names.join(', ')}>{names.join(', ')}</strong>
    </span>
    <i className="gm-studio__mark" aria-hidden="true">{isMatch ? <Check /> : null}</i>
  </div>
}

function GameAttemptCard({ attempt, item, index }: { attempt: Attempt; item: TitleItem; index: number }) {
  const byKey = new Map(attempt.hints.map((hint) => [hint.key, hint]))
  const genresHint = byKey.get('genres')
  const rankHint = byKey.get('rank')
  const yearHint = byKey.get('year')
  const total = attempt.hints.length
  const matchedCount = progressMatches(attempt.hints)
  const genres = item.genres ?? []
  const genreMatched = new Set((genresHint?.matchedValues ?? []).map(normalizeTextMatch))
  const attrs = ['players', 'metacritic', 'steam_positive', 'reviews', 'price', 'age']
    .map((key) => byKey.get(key))
    .filter(Boolean) as Attempt['hints']
  const steamCategories = dedupeGameCategories(item.steamCategories ?? [], Boolean(byKey.get('players')))
  const platforms = dedupeGameCategories(item.platforms ?? [], false)
  const rankText = item.topRank != null ? `#${item.topRank}` : '—'

  return <article className="attempt-card attempt-card--game">
    <div className="gm-head">
      <span className="attempt-card__number">{String(index + 1).padStart(2, '0')}</span>
      <Poster item={item} className="gm-head__art" />
      <div className="gm-head__identity">
        <span className="attempt-label">Попытка {index + 1}</span>
        <h2>{item.titleRu}</h2>
        <p className="gm-head__sub">
          <span className="gm-head__orig">{item.titleOriginal || 'Оригинальное название не указано'}</span>
          {item.year != null && <>
            <i className="gm-head__dot" aria-hidden="true">·</i>
            <span className={`gm-year ${yearHint?.status ?? ''}`}>
              {item.year}
              {yearHint?.direction === 'up' ? <ArrowUp /> : yearHint?.direction === 'down' ? <ArrowDown /> : yearHint?.status === 'match' ? <Check /> : null}
            </span>
          </>}
        </p>
        {!!genres.length && <div className="gm-genres">
          {genres.slice(0, 4).map((genre) => {
            const isMatch = genreMatched.has(normalizeTextMatch(genre))
            return <span key={genre} className={`gm-genre ${isMatch ? 'match' : ''}`}>{genre}{isMatch && <Check />}</span>
          })}
        </div>}
      </div>
      {rankHint && <div className={`gm-rank ${rankHint.status}`}>
        <span className="gm-rank__ico" aria-hidden="true"><Trophy /></span>
        <div className="gm-rank__val">
          <strong>{rankText}</strong>
          {rankHint.direction === 'up' ? <ArrowUp /> : rankHint.direction === 'down' ? <ArrowDown /> : null}
        </div>
        <small>место</small>
      </div>}
    </div>

    <div className="dx-score" aria-label={`Совпало признаков: ${matchedCount} из ${total}`}>
      <span>Совпадений</span>
      <div className="dx-score__bar">{Array.from({ length: total }, (_, i) => <i key={i} className={i < matchedCount ? 'on' : ''} />)}</div>
      <strong>{matchedCount}/{total}</strong>
    </div>

    {(!!(item.developers ?? []).length || !!(item.publishers ?? []).length) && <div className="gm-studios">
      <GameStudioPlate label="Разработчик" names={item.developers ?? []} hint={byKey.get('developer')} />
      <GameStudioPlate label="Издатель" names={item.publishers ?? []} hint={byKey.get('publisher')} />
    </div>}

    {!!attrs.length && <div className="dx-attrs">{attrs.map((hint, hintIndex) => <ClueTile key={hint.key} hint={hint} delay={hintIndex} />)}</div>}

    <div className="dx-clouds">
      <DxChipCloud label="Категории" hint={byKey.get('steam_categories')} items={steamCategories} limit={6} iconKind="steam-categories" />
      <DxChipCloud label="Платформы" hint={byKey.get('platforms')} items={platforms} limit={6} />
    </div>
  </article>
}

function DxChipCloud({ label, hint, items, limit = 6, iconKind, wrap = false }: { label: string; hint: Attempt['hints'][number] | undefined; items: string[]; limit?: number; iconKind?: 'steam-categories'; wrap?: boolean }) {
  if (!items.length) return null
  const matched = new Set((hint?.matchedValues ?? []).map(normalizeTextMatch))
  const matchedCount = items.filter((value) => matched.has(normalizeTextMatch(value))).length
  const shouldScroll = !wrap && items.length > limit
  const countTone = matchedCount === items.length ? 'match' : matchedCount ? 'partial' : 'miss'
  const chipsClassName = ['dx-cloud__chips', wrap ? 'is-wrap' : '', shouldScroll ? 'is-scrollable' : ''].filter(Boolean).join(' ')
  return <div className="dx-cloud">
    <div className="dx-cloud__head">
      <span>{label}</span>
      <small className={countTone}>{matchedCount}/{items.length}</small>
    </div>
    <HorizontalScrollLane className={chipsClassName}>
      {items.map((value) => {
        const isMatched = matched.has(normalizeTextMatch(value))
        const icon = iconKind === 'steam-categories' ? steamCategoryIcon(value) : null
        return <span key={value} className={`dx-chip ${isMatched ? 'match' : 'miss'}`}>
          {icon && <img className="dx-chip__icon" src={icon === 'single' ? '/images/steam-icons/single-player.svg' : '/images/steam-icons/multi-player.svg'} alt="" aria-hidden="true" />}
          {value}
          {isMatched && <Check />}
        </span>
      })}
    </HorizontalScrollLane>
  </div>
}

function DiagnosisAttemptCard({ attempt, item, index }: { attempt: Attempt; item: TitleItem; index: number }) {
  const byKey = new Map(attempt.hints.map((hint) => [hint.key, hint]))
  const bodySystemsHint = byKey.get('body_systems')
  const attrs = ['disease_types', 'course', 'contagiousness', 'typical_age', 'localization']
    .map((key) => byKey.get(key))
    .filter(Boolean) as Attempt['hints']
  const total = attempt.hints.length
  const matchedCount = progressMatches(attempt.hints)
  const icdValue = item.icd10?.[0] ?? item.icdGroup ?? '—'

  return <article className="attempt-card attempt-card--dx">
    <div className="dx-head">
      <span className="attempt-card__number">{String(index + 1).padStart(2, '0')}</span>
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

    {bodySystemsHint && <DxSystemIcons hint={bodySystemsHint} />}
    {!!attrs.length && <div className="dx-attrs">{attrs.map((hint, hintIndex) => <ClueTile key={hint.key} hint={hint} delay={hintIndex} />)}</div>}

    <div className="dx-clouds">
      <DxChipCloud label="Симптомы" hint={byKey.get('symptoms')} items={item.keySymptoms ?? []} limit={6} wrap />
      <DxChipCloud label="Диагностика" hint={byKey.get('diagnostics')} items={item.diagnostics ?? []} limit={4} wrap />
      <DxChipCloud label="Факторы риска" hint={byKey.get('risk_factors')} items={item.riskFactors ?? []} limit={4} wrap />
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
  date,
  setDate,
  onHome,
  onBack,
  onArchive,
  onStats,
  onRules,
  caseVignettes,
}: {
  titles: TitleItem[]
  mode: TitleMode
  period: PeriodKey
  date: string
  setDate: (date: string) => void
  onHome: () => void
  onBack: () => void
  onArchive: () => void
  onStats: () => void
  onRules: () => void
  caseVignettes: CaseVignetteMap
}) {
  const effectivePeriod: PeriodKey = mode === 'diagnosis' || mode === 'game' ? 'all' : period
  const pool = useMemo(() => poolFor(titles, mode, effectivePeriod), [titles, mode, effectivePeriod])
  const answer = useMemo(() => pool.length ? dailyTitle(pool, mode, effectivePeriod, date) : null, [pool, mode, effectivePeriod, date])
  const key = gameKey(mode, effectivePeriod, date)
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [status, setStatus] = useState<GameStatus>('playing')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<TitleItem | null>(null)
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1)
  const [message, setMessage] = useState('')
  const [gameMatchStripOpen, setGameMatchStripOpen] = useState(false)
  const [hintChoices, setHintChoices] = useState<HintChoice[]>([])
  const [dismissedHintRounds, setDismissedHintRounds] = useState<HintCheckpoint[]>([])
  const [hintModalRound, setHintModalRound] = useState<HintCheckpoint | null>(null)
  const [copied, setCopied] = useState(false)
  const [anamnesisOpen, setAnamnesisOpen] = useState(false)
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
    setActiveSuggestionIndex(-1)
    setMessage('')
    setGameMatchStripOpen(mode === 'diagnosis')
    setAnamnesisOpen(false)
  }, [key, mode])

  const used = useMemo(() => new Set(attempts.map((attempt) => attempt.titleId)), [attempts])
  const suggestions = useMemo(() => searchTitles(pool, query, used), [pool, query, used])
  const matchedTags = useMemo(() => collectMatchedTags(attempts), [attempts])

  useEffect(() => {
    if (!query || selected || !suggestions.length) {
      setActiveSuggestionIndex(-1)
      return
    }
    setActiveSuggestionIndex((current) => {
      if (current < 0) return 0
      if (current >= suggestions.length) return suggestions.length - 1
      return current
    })
  }, [query, selected, suggestions])
  const assistHints = useMemo(() => answer ? buildAssistHints(answer) : [], [answer])
  const anamnesisText = useMemo(() => answer && mode === 'diagnosis'
    ? (pickDailyVignette(caseVignettes[answer.id] ?? [], answer.id, date)?.text ?? '')
    : '', [answer, mode, caseVignettes, date])
  const usedHintsSet = useMemo(() => new Set(hintChoices.map((choice) => choice.key)), [hintChoices])
  const revealedAssistHints = useMemo(() => assistHints.filter((hint) => usedHintsSet.has(hint.key)), [assistHints, usedHintsSet])
  const currentRound = Math.min(attempts.length + 1, 10)
  const unlockedHintRounds: HintCheckpoint[] = []
  if (currentRound >= 5) unlockedHintRounds.push(5)
  if (currentRound >= 8) unlockedHintRounds.push(8)
  const usedHintRounds = useMemo(() => new Set(hintChoices.map((choice) => choice.round)), [hintChoices])
  const pendingHintRounds = useMemo(() => unlockedHintRounds.filter((round) => !usedHintRounds.has(round)), [unlockedHintRounds, usedHintRounds])
  const nextHintRound = pendingHintRounds[0] ?? null
  const nextUndismissedHintRound = pendingHintRounds.find((round) => !dismissedHintRounds.includes(round)) ?? null
  const preferredHintRound = nextUndismissedHintRound ?? nextHintRound
  const canUseHint = status === 'playing' && pendingHintRounds.length > 0
  const hintTriggerLabel = pendingHintRounds.length > 1 ? `Подсказка ×${pendingHintRounds.length}` : 'Подсказка'
  const showTodayLink = date !== getMoscowDate()

  useEffect(() => {
    if (!canUseHint) {
      setHintModalRound(null)
      return
    }
    if (hintModalRound && !pendingHintRounds.includes(hintModalRound)) {
      setHintModalRound(null)
      return
    }
    if (!hintModalRound && nextUndismissedHintRound) {
      setHintModalRound(nextUndismissedHintRound)
    }
  }, [canUseHint, hintModalRound, nextUndismissedHintRound, pendingHintRounds])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.key === 'Escape') {
        event.preventDefault()
        onBack()
        return
      }
      if (status !== 'playing' || hintModalRound) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (isEditableTarget(event.target)) return

      if (event.key.length === 1) {
        event.preventDefault()
        inputRef.current?.focus()
        setQuery((prev) => `${prev}${event.key}`)
        setSelected(null)
        setMessage('')
        return
      }

      if (event.key === 'Backspace') {
        event.preventDefault()
        inputRef.current?.focus()
        setQuery((prev) => prev.slice(0, -1))
        setSelected(null)
        setMessage('')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [hintModalRound, onBack, status])

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
    if (!answer || status !== 'playing') return
    if (usedHintsSet.has(hintKey)) return
    const targetRound = hintModalRound ?? preferredHintRound
    if (!targetRound) return

    const targetHint = assistHints.find((hint) => hint.key === hintKey)
    if (!targetHint?.available) {
      setMessage('Для этой подсказки пока нет данных')
      return
    }
    const nextHintChoices = [...hintChoices, { round: targetRound, key: hintKey }]
    const nextDismissedRounds = dismissedHintRounds.filter((round) => round !== targetRound)
    setDismissedHintRounds(nextDismissedRounds)
    setHintChoices(nextHintChoices)
    setHintModalRound(null)
    setMessage('')
    persistGame(attempts, status, nextHintChoices, nextDismissedRounds)
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
        <span className="keycap-hint" aria-hidden="true">Esc</span>
      </div>
      <section className={`game-heading${mode === 'diagnosis' ? ' game-heading--diagnosis' : ''}`}>
        <div>
          <span className="game-heading__kicker">{date === getMoscowDate() ? 'Сегодня' : 'Архив'} · Сеанс №{dayNumber(date)}</span>
          <h1>{modeDaily(mode)} дня</h1>
          <p>{prettyDate(date)} · обновление в 00:00 МСК</p>
        </div>
        <div className="mini-ticket" aria-hidden="true"><Ticket /><span>{date.slice(8, 10)}<small>/{date.slice(5, 7)}</small></span></div>
      </section>

      {(showTodayLink || (mode === 'diagnosis' && !!anamnesisText)) && <section className="game-toolbar" aria-label="Настройки игры">
        {mode === 'diagnosis' && !!anamnesisText && <ActionButton variant="secondary" className="anamnesis-link" onClick={() => setAnamnesisOpen(true)}><ClipboardList /> Анамнез</ActionButton>}
        {showTodayLink && <ActionButton variant="ghost" className="today-link" onClick={() => setDate(getMoscowDate())}>Сегодня</ActionButton>}
      </section>}

      <div className="progress-row">
        <Progress attempts={attempts.length} />
        {canUseHint && !hintModalRound && <ActionButton variant="hint" className="hint-trigger" onClick={() => preferredHintRound && setHintModalRound(preferredHintRound)}><Sparkles /> {hintTriggerLabel}</ActionButton>}
      </div>

      {!!revealedAssistHints.length && <section className="assist-revealed" aria-label="Открытые подсказки">
        {revealedAssistHints.map((hint) => <article key={hint.key} className="assist-reveal-card">
          <span><Sparkles /> {hint.title}</span>
          {hint.body && <p>{renderHintBody(hint.body)}</p>}
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
            : answer.mode === 'game'
              ? [answer.titleOriginal || 'Оригинальное название не указано', answer.year != null ? String(answer.year) : '—', answer.topRank != null ? `#${answer.topRank}` : null].filter(Boolean).join(' · ')
              : `${answer.titleOriginal || 'Оригинальное название не указано'} · ${answer.year ?? '—'}`}</p>
          <div className="result-tags">{(answer.mode === 'diagnosis'
            ? [...(answer.bodySystems ?? []).slice(0, 2), ...(answer.diseaseTypes ?? []).slice(0, 2), ...(answer.icd10 ?? []).slice(0, 1)]
            : answer.mode === 'game'
              ? [...(answer.genres ?? []).slice(0, 3), ...dedupeGameCategories(answer.steamCategories ?? [], true).slice(0, 2)]
              : (answer.genres ?? [])
          ).map((tag) => <i key={tag}>{tag}</i>)}</div>
          <strong>{status === 'won' ? `${attempts.length}/10 — верный ответ` : 'Правильный ответ открыт'}</strong>
        </div>
        <div className="result-actions">
          <button onClick={share}>{copied ? <Check /> : <Copy />}{copied ? 'Скопировано' : 'Скопировать'}</button>
          <a href={`https://t.me/share/url?url=${encodeURIComponent(location.href)}&text=${encodeURIComponent(resultText(mode, date, effectivePeriod, attempts.map((attempt) => attempt.hints), status === 'won'))}`} target="_blank" rel="noreferrer"><Share2 /> Telegram</a>
        </div>
      </section>}

      {status === 'playing' && <section className="search-area">
        <div className={`search-box ${selected ? 'selected' : ''}`}>
          <Search />
          <input
            ref={inputRef}
            id="movie-search"
            aria-label={mode === 'diagnosis' ? 'Введите диагноз' : mode === 'game' ? 'Введите игру' : 'Введите название'}
            value={query}
            autoComplete="off"
            placeholder={modeSearchPlaceholder(mode)}
            onChange={(event) => {
              setQuery(event.target.value)
              setSelected(null)
              setActiveSuggestionIndex(0)
              setMessage('')
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                if (!suggestions.length || selected) return
                event.preventDefault()
                setActiveSuggestionIndex((current) => current < 0 ? 0 : Math.min(current + 1, suggestions.length - 1))
                return
              }
              if (event.key === 'ArrowUp') {
                if (!suggestions.length || selected) return
                event.preventDefault()
                setActiveSuggestionIndex((current) => current <= 0 ? 0 : current - 1)
                return
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                if (selected) {
                  submit()
                  return
                }
                if (suggestions.length) {
                  const index = activeSuggestionIndex >= 0 ? activeSuggestionIndex : 0
                  submit(suggestions[index])
                  return
                }
                submit()
              }
            }}
          />
          {selected && <Check className="selected-check" />}
          <button onClick={() => submit()} aria-label="Проверить ответ"><ChevronRight /></button>
        </div>
        {(mode === 'diagnosis' || !!attempts.length) && <div className={`game-match-strip ${gameMatchStripOpen ? 'is-open' : ''}`}>
          <button
            type="button"
            className="game-match-strip__toggle"
            onClick={() => setGameMatchStripOpen((current) => !current)}
            aria-expanded={gameMatchStripOpen}
            aria-controls="game-match-strip-panel"
          >
            <span className="game-match-strip__logo" aria-hidden="true"><img src="/images/symbol.svg" alt="" /></span>
            <span className="game-match-strip__title">Что сходится</span>
            <ChevronRight aria-hidden="true" />
          </button>
          <div className="game-match-strip__panel" id="game-match-strip-panel" aria-hidden={!gameMatchStripOpen}>
            <HorizontalScrollLane className="game-match-strip__tags">
              {matchedTags.length
                ? matchedTags.map((tag) => <span key={tag} className="dx-chip match game-match-strip__tag">{tag}</span>)
                : <span className="game-match-strip__empty">{attempts.length ? 'Пока совпадений нет' : 'Появится после первой попытки'}</span>}
            </HorizontalScrollLane>
          </div>
        </div>}
        {query && !selected && <div className="suggestions">
          {suggestions.length ? suggestions.map((item, index) => <button key={item.id} className={index === activeSuggestionIndex ? 'is-active' : ''} onMouseEnter={() => setActiveSuggestionIndex(index)} onClick={() => submit(item)}>
            <Poster item={item} />
            <span><strong>{item.titleRu}</strong><small>{item.mode === 'diagnosis'
              ? [item.titleOriginal || 'Без оригинального названия', ...(item.icd10?.length ? [item.icd10.join(', ')] : []), ...(item.icdGroup ? [item.icdGroup] : [])].filter(Boolean).join(' · ')
              : item.mode === 'game'
                ? [item.titleOriginal || 'Без оригинального названия', item.year != null ? String(item.year) : '—', item.topRank != null ? `#${item.topRank}` : null].filter(Boolean).join(' · ')
                : `${item.titleOriginal || 'Без оригинального названия'} · ${item.year ?? '—'}`}</small></span>
            <em>{item.mode === 'diagnosis'
              ? (item.contagiousness ?? item.icd10?.[0] ?? '—')
              : item.mode === 'game'
                ? (item.ratings?.steamPositivePercent != null ? `${Math.round(item.ratings.steamPositivePercent)}%` : item.ratings?.metacritic ?? item.metacritic ?? item.topRank ?? '—')
                : (item.ratings?.kinopoisk?.toFixed(1) ?? '—')}</em>
          </button>) : <div className="empty-search">Ничего не найдено</div>}
        </div>}
        {message && <div className="search-meta"><strong>{message}</strong></div>}
      </section>}

      {!attempts.length && status === 'playing' && <section className="empty-card">
        <div className="empty-card__icon">{modeIcon(mode)}</div>
        <div><h2>Начните с {mode === 'game' ? 'любой' : 'любого'} {modeSubjectGenitive(mode)}</h2><p>{mode === 'diagnosis'
          ? 'После ответа появятся сравнения по системе, симптомам, диагностике и коду МКБ.'
          : mode === 'game'
            ? 'После ответа появятся сравнения по году, месту в топе, жанрам, категориям Steam и рейтингу.'
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
            : item.mode === 'game'
              ? <GameAttemptCard key={`${attempt.titleId}-${index}`} attempt={attempt} item={item} index={index} />
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
        <p>{hintModalRound === 5 ? 'Это первая возможность. Если пропустить её сейчас, она всё равно останется доступной до конца сеанса.' : 'Это вторая возможность. Её также можно открыть в любой момент до конца сеанса.'}</p>
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

    {anamnesisOpen && !!anamnesisText && <AnamnesisModal text={anamnesisText} dayNo={dayNumber(date)} onClose={() => setAnamnesisOpen(false)} />}
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

function AnamnesisModal({ text, dayNo, onClose, onStart }: {
  text: string
  dayNo: number
  onClose: () => void
  onStart?: () => void
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  return <div className="anamnesis-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="anamnesis-modal" role="dialog" aria-modal="true" aria-labelledby="anamnesis-title">
      <div className="anamnesis-modal__head">
        <span><Stethoscope /> Амбулаторная карта · Анамнез</span>
        <button onClick={onClose} aria-label="Закрыть"><X /></button>
      </div>
      <div className="anamnesis-modal__patient">
        <span className="anamnesis-modal__avatar" aria-hidden="true"><UserRound /></span>
        <div className="anamnesis-modal__patient-copy">
          <small>Анонимный пациент</small>
          <h2 id="anamnesis-title">Приём № {dayNo}</h2>
          <em>Жалобы записаны со слов пациента</em>
        </div>
      </div>
      <p className="anamnesis-modal__text">{text}</p>
      <div className="anamnesis-modal__note"><HeartPulse /> Поставьте верный диагноз по симптомам за десять попыток.</div>
      <div className="anamnesis-modal__actions">
        {onStart
          ? <ActionButton className="anamnesis-modal__start" onClick={onStart}><Stethoscope /> Взяться за дело</ActionButton>
          : <ActionButton className="anamnesis-modal__start" onClick={onClose}><Check /> Понятно</ActionButton>}
      </div>
    </section>
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
    <p>В режиме «Игры» дополнительно сравниваются позиция в топе, метрики Steam и Metacritic.</p>
    <div><i className="match" /><span><strong>Точно</strong> — значение совпало.</span></div>
    <div><i className="close" /><span><strong>Рядом</strong> — число близко или есть частичное совпадение.</span></div>
    <div><i className="miss" /><span><strong>Мимо</strong> — значение не совпало.</span></div>
    <p>Стрелка показывает, выше или ниже находится правильный год, рейтинг, хронометраж или количество сезонов.</p>
  </div>
}

function ResumeSessionsView({ sessions, onOpen }: {
  sessions: SavedGame[]
  onOpen: (session: SavedGame) => void
}) {
  return <>
    <p className="modal-lead">Незавершенные игры сохраняются автоматически. Выберите сохраненную игру, чтобы продолжить.</p>
    <div className="resume-list">
      {sessions.map((session) => {
        const attemptText = `${session.attempts.length}/10`
        const sessionLabel = session.mode === 'diagnosis' ? 'Прием' : 'Сеанс'
        const periodText = session.mode === 'movie' || session.mode === 'series' ? PERIODS[session.period]?.short ?? 'Период не задан' : 'Без периода'
        return <article className="resume-item" key={session.key}>
          <button className="resume-item__open" onClick={() => onOpen(session)}>
            <span className="resume-item__mode">{modeIcon(session.mode)}<i>{modeTitle(session.mode)}</i></span>
            <strong>{prettyDate(session.date)} · {sessionLabel} №{dayNumber(session.date)}</strong>
            <small>{periodText} · Попытки: {attemptText}</small>
          </button>
        </article>
      })}
    </div>
  </>
}

export default function App() {
  const [screen, setScreen] = useState<AppScreen>('hub')
  const [transition, setTransition] = useState<'idle' | 'title-to-game'>('idle')
  const [mode, setMode] = useState<TitleMode>('movie')
  const [period, setPeriod] = useState<PeriodKey>('all')
  const [date, setDate] = useState(getMoscowDate())
  const [gameBackTarget, setGameBackTarget] = useState<'title' | 'rewatch' | 'hub'>('title')
  const [data, setData] = useState<Record<TitleMode, TitleItem[]>>({ movie: [], series: [], game: [], diagnosis: [] })
  const [titleCounts, setTitleCounts] = useState<{ movie: number | null; series: number | null; game: number | null; diagnosis: number | null }>({ movie: null, series: null, game: null, diagnosis: null })
  const [caseVignettes, setCaseVignettes] = useState<CaseVignetteMap>({})
  const [modal, setModal] = useState<'stats' | 'rules' | 'resume' | 'anamnesis' | null>(null)
  const [loading, setLoading] = useState(false)
  const transitionTimerRef = useRef<number | null>(null)
  const screenHistoryReadyRef = useRef(false)
  const screenFromPopStateRef = useRef(false)
  const lastScreenRef = useRef<AppScreen>('hub')

  useEffect(() => {
    fetch('/data/source.json')
      .then((response) => response.json())
      .then((source) => setTitleCounts({
        movie: Number.isFinite(source.movieCount) ? source.movieCount : null,
        series: Number.isFinite(source.seriesCount) ? source.seriesCount : null,
        game: Number.isFinite(source.gameCount) ? source.gameCount : null,
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
    fetch('/data/diagnosis-case-vignettes.by-id.json')
      .then((response) => response.json())
      .then((entries: DiagnosisCaseVignettes[]) => {
        if (!Array.isArray(entries)) return
        const map: CaseVignetteMap = {}
        for (const entry of entries) {
          if (entry?.diagnosisId && Array.isArray(entry.caseVignettes)) {
            map[entry.diagnosisId] = entry.caseVignettes
          }
        }
        setCaseVignettes(map)
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    fetch('/data/games.generated.json')
      .then((response) => response.json())
      .then((items: TitleItem[]) => setTitleCounts((current) => ({ ...current, game: current.game ?? items.length })))
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

  const archiveDates = Array.from({ length: 7 }, (_, offset) => {
    const day = new Date(`${getMoscowDate()}T12:00:00+03:00`)
    day.setDate(day.getDate() - offset)
    return getMoscowDate(day)
  })
  const clearTransitionTimer = () => {
    if (transitionTimerRef.current !== null) {
      window.clearTimeout(transitionTimerRef.current)
      transitionTimerRef.current = null
    }
  }
  useEffect(() => clearTransitionTimer, [])

  useEffect(() => {
    if (!screenHistoryReadyRef.current) {
      window.history.replaceState({ seansScreen: screen }, '')
      screenHistoryReadyRef.current = true
      lastScreenRef.current = screen
      return
    }
    if (screenFromPopStateRef.current) {
      screenFromPopStateRef.current = false
      lastScreenRef.current = screen
      return
    }
    if (lastScreenRef.current !== screen) {
      window.history.pushState({ seansScreen: screen }, '')
      lastScreenRef.current = screen
    }
  }, [screen])

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const nextScreen = event.state?.seansScreen
      if (!isAppScreen(nextScreen)) return

      if (transitionTimerRef.current !== null) {
        window.clearTimeout(transitionTimerRef.current)
        transitionTimerRef.current = null
      }
      screenFromPopStateRef.current = true
      setTransition('idle')
      setModal(null)
      setScreen(nextScreen)
      window.scrollTo({ top: 0 })
    }

    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const setModeSafe = (nextMode: TitleMode) => {
    setMode(nextMode)
    if (nextMode === 'diagnosis' || nextMode === 'game') {
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

  const games = useMemo(() => allGames(), [screen])
  const activeGames = useMemo(() => games.filter((game) => game.status === 'playing').sort((a, b) => b.updatedAt - a.updatedAt), [games])
  const diagnosisAnamnesis = useMemo(() => {
    if (mode !== 'diagnosis' || !data.diagnosis.length) return null
    const pool = poolFor(data.diagnosis, 'diagnosis', 'all')
    if (!pool.length) return null
    const answer = dailyTitle(pool, 'diagnosis', 'all', getMoscowDate())
    if (!answer) return null
    const vignette = pickDailyVignette(caseVignettes[answer.id] ?? [], answer.id, getMoscowDate())
    return vignette?.text ? { text: vignette.text } : null
  }, [mode, data.diagnosis, caseVignettes])
  const goHome = () => moveToScreen('hub')
  const goBackFromTitle = () => moveToScreen('hub')
  const goBackFromGame = () => moveToScreen(gameBackTarget)

  useEffect(() => {
    if (modal === 'resume' && !activeGames.length) {
      setModal(null)
    }
  }, [modal, activeGames.length])

  const openSavedSession = (savedGame: SavedGame, backTarget: 'hub' | 'rewatch' = 'hub') => {
    clearTransitionTimer()
    setTransition('idle')
    setGameBackTarget(backTarget)
    setModeSafe(savedGame.mode)
    setPeriod(savedGame.mode === 'movie' || savedGame.mode === 'series' ? savedGame.period : 'all')
    setDate(savedGame.date)
    setScreen('game')
    setModal(null)
    window.scrollTo({ top: 0 })
  }

  const resumeActiveSession = () => {
    if (!activeGames.length) return
    if (activeGames.length === 1) {
      openSavedSession(activeGames[0], 'hub')
      return
    }
    setModal('resume')
  }

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
    if (savedGame) {
      openSavedSession(savedGame, 'rewatch')
      return
    }
    clearTransitionTimer()
    setTransition('idle')
    setGameBackTarget('rewatch')
    setDate(archiveDate)
    setScreen('game')
    setModal(null)
    window.scrollTo({ top: 0 })
  }
  const appTone = transition === 'title-to-game' ? 'transition-game' : screen

  return <div className={`app app--${appTone}`}>
    {screen === 'hub' && <HubScreen onSelect={selectCategory} onRewatch={() => setScreen('rewatch')} onStats={() => setModal('stats')} onRules={() => setModal('rules')} onResume={resumeActiveSession} activeSessionsCount={activeGames.length} titleCounts={titleCounts} />}

    {screen === 'title' && <TitleScreen mode={mode} period={period} setPeriod={setPeriod} date={getMoscowDate()} onHome={goHome} onBack={goBackFromTitle} onPlay={playToday} onRewatch={() => setScreen('rewatch')} onStats={() => setModal('stats')} onRules={() => setModal('rules')} isLeaving={transition === 'title-to-game'} onReadAnamnesis={() => setModal('anamnesis')} hasAnamnesis={Boolean(diagnosisAnamnesis)} />}

    {screen === 'rewatch' && <RewatchScreen mode={mode} setMode={setModeSafe} period={period} dates={archiveDates} games={games} onOpen={openArchive} onHome={goHome} onStats={() => setModal('stats')} onRules={() => setModal('rules')} />}

    {screen === 'game' && (loading || !data[mode].length
      ? <div className="loading"><Sparkles /> Настраиваем проектор…</div>
      : <Game
          titles={data[mode]}
          mode={mode}
          period={period}
          date={date}
          setDate={setDate}
          onHome={goHome}
          onBack={goBackFromGame}
          onArchive={() => setScreen('rewatch')}
          onStats={() => setModal('stats')}
          onRules={() => setModal('rules')}
          caseVignettes={caseVignettes}
        />)}

    {modal === 'rules' && <Modal title="Как играть" onClose={() => setModal(null)}><RulesView /></Modal>}
    {modal === 'stats' && <Modal title="Статистика" onClose={() => setModal(null)}><div className="modal-mode">{modePlural(mode)}</div><StatsView mode={mode} /></Modal>}
    {modal === 'resume' && <Modal title="Вернуться к игре" onClose={() => setModal(null)}><ResumeSessionsView sessions={activeGames} onOpen={(session) => openSavedSession(session, 'hub')} /></Modal>}
    {modal === 'anamnesis' && diagnosisAnamnesis && <AnamnesisModal text={diagnosisAnamnesis.text} dayNo={dayNumber(getMoscowDate())} onClose={() => setModal(null)} onStart={() => { setModal(null); playToday() }} />}
  </div>
}
