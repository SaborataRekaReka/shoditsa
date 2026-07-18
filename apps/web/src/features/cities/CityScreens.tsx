import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Compass,
  Database,
  Flag,
  Globe2,
  Landmark,
  Map as MapIcon,
  MapPin,
  Play,
  Search,
  Sparkles,
  Ticket,
} from 'lucide-react'
import { ActionButton, AppHeader } from '../../components/app-shell/AppShell'
import { HorizontalScrollLane } from '../../components/horizontal-scroll-lane/HorizontalScrollLane'
import { GameResult } from '../result/GameResult'
import { CityRankProfile } from './CityRankProfile'
import {
  CITY_POOL_OPTIONS,
  cityPool,
  compareCities,
  dailyCity,
  loadCitySession,
  saveCitySession,
  searchCities,
  type CityHint,
  type CityItem,
  type CityPoolMode,
  type CitySessionStatus,
} from './city-game'

type CityNavigation = {
  onHome: () => void
  onArchive: () => void
  onStats: () => void
  onRules: () => void
  onReview: () => void
}

const modeMeta = (mode: CityPoolMode) => CITY_POOL_OPTIONS.find((entry) => entry.mode === mode) ?? CITY_POOL_OPTIONS[0]
const prettyDate = (date: string) => new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'long' }).format(new Date(`${date}T12:00:00+03:00`))
const dayNumber = (date: string) => {
  const current = new Date(`${date}T12:00:00+03:00`)
  const first = new Date(`${date.slice(0, 4)}-01-01T12:00:00+03:00`)
  return Math.floor((current.getTime() - first.getTime()) / 86_400_000) + 1
}

const CityAsset = ({ src, alt, className = '' }: { src: string | null; alt: string; className?: string }) => src
  ? <img className={className} src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.hidden = true }} />
  : null

const CityMark = ({ city }: { city: CityItem }) => {
  const sources = [
    city.coatOfArmsUrl ? { src: city.coatOfArmsUrl, label: 'Герб' } : null,
    city.cityFlagUrl ? { src: city.cityFlagUrl, label: 'Флаг города' } : null,
    city.countryFlagUrl ? { src: city.countryFlagUrl, label: 'Флаг страны' } : null,
  ].filter((entry): entry is { src: string; label: string } => Boolean(entry))
  const [sourceIndex, setSourceIndex] = useState(0)
  const current = sources[sourceIndex] ?? null

  return <span className="city-mark">
    {current
      ? <img src={current.src} alt={`${current.label}: ${city.titleRu}`} loading="lazy" referrerPolicy="no-referrer" onError={() => setSourceIndex((index) => index + 1)} />
      : <Landmark aria-hidden="true" />}
    <small>{current?.label ?? 'Город'}</small>
  </span>
}

const CityModeControl = ({ items, value, disabled, onChange }: { items: CityItem[]; value: CityPoolMode; disabled: boolean; onChange: (mode: CityPoolMode) => void }) => {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const current = modeMeta(value)

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  return <div ref={wrapRef} className={`city-mode-select ${open ? 'is-open' : ''}`}>
    <button type="button" className="city-mode-trigger" disabled={disabled} aria-expanded={open} aria-haspopup="listbox" onClick={(event) => { event.stopPropagation(); setOpen((value) => !value) }}>
      <span className="city-mode-trigger__label"><MapIcon /> Режим</span>
      <span className="city-mode-trigger__value"><span className={`city-mode-bars city-mode-bars--${value}`} aria-hidden="true"><i /><i /><i /></span><strong>{current.shortLabel}</strong><ChevronRight /></span>
    </button>
    {open && <div className="city-mode-menu" role="listbox" aria-label="Режим городов">
      <span className="city-mode-menu__head">Круг возможных ответов</span>
      {CITY_POOL_OPTIONS.map((entry) => {
        const count = cityPool(items, entry.mode).length
        const active = value === entry.mode
        return <button type="button" role="option" aria-selected={active} className={`city-mode-option ${active ? 'active' : ''}`} key={entry.mode} onClick={(event) => { event.stopPropagation(); onChange(entry.mode); setOpen(false) }}>
          <span className={`city-mode-bars city-mode-bars--${entry.mode}`} aria-hidden="true"><i /><i /><i /></span>
          <span className="city-mode-option__copy"><strong>{entry.label}</strong><small>{count || '—'} городов · {entry.description}</small></span>
          {active && <Check className="city-mode-option__check" />}
        </button>
      })}
    </div>}
  </div>
}

export function CityTitleScreen({
  items,
  loading,
  error,
  mode,
  date,
  onModeChange,
  onPlay,
  onBack,
}: {
  items: CityItem[]
  loading: boolean
  error: string | null
  mode: CityPoolMode
  date: string
  onModeChange: (mode: CityPoolMode) => void
  onPlay: () => void
  onBack: () => void
}) {
  const selectedCount = cityPool(items, mode).length

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onBack()
      const target = event.target as HTMLElement | null
      const isInteractiveTarget = Boolean(target?.closest('button, input, select, textarea, [role="option"]'))
      if (event.key === 'Enter' && !isInteractiveTarget && selectedCount > 0 && !loading && !error) onPlay()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [error, loading, onBack, onPlay, selectedCount])

  return <div className="city-surface city-surface--title">
    <main className="city-title-screen">
      <div className="screen-back-row">
        <button className="screen-back" onClick={onBack} aria-label="Назад"><ChevronLeft /></button>
        <span className="keycap-hint" aria-hidden="true">Esc</span>
      </div>

      <section className="city-title-stage">
        <div className="city-title-heading">
          <div className="city-title-mark">
            <span><MapPin /></span>
            <div><small>Игра дня · №{dayNumber(date)}</small><h1>Города</h1></div>
          </div>
          <time>{prettyDate(date)} · {date.slice(0, 4)}</time>
          <p>Угадайте город дня за десять попыток</p>
        </div>

        <article className="city-travel-pass">
          <div className="city-travel-pass__body">
            <div className="city-travel-pass__intro">
              <span className="city-travel-pass__eyebrow">Ежедневное путешествие</span>
              <h2>Угадайте город дня</h2>
              <p>Режим меняет только круг возможных ответов.<br />В поиске доступны все {items.length || 980} городов.</p>
            </div>
            <div className="city-travel-pass__visual" aria-hidden="true">
              <img src="./images/cities/city-title-v2.webp" alt="" />
            </div>
          </div>
          <div className="city-travel-pass__stub" aria-hidden="true">
            <span>Вход</span>
            <strong>Один</strong>
            <small>№ {dayNumber(date)}</small>
            <em>{date.slice(8, 10)}.{date.slice(5, 7)}</em>
            <i />
          </div>
        </article>

        {error && <div className="city-data-state city-data-state--error">{error}</div>}
        <div className="city-title-actions">
          <ActionButton className="city-title-play" disabled={loading || Boolean(error) || selectedCount === 0} onClick={onPlay}>
            <Play /> {loading ? 'Загружаем…' : 'Начать игру'} <span className="keycap-hint keycap-hint--inline" aria-hidden="true">Enter</span>
          </ActionButton>
          <CityModeControl items={items} value={mode} disabled={loading || Boolean(error)} onChange={onModeChange} />
        </div>
        <div className="city-title-facts">
          <span><Compass /><strong>10</strong><small>попыток</small></span>
          <span><MapPin /><strong>{selectedCount || '—'}</strong><small>городов</small></span>
          <span><Database /><strong>10</strong><small>признаков</small></span>
        </div>
      </section>
    </main>
  </div>
}

const hintStatusLabel: Record<CityHint['status'], string> = {
  match: 'Совпало',
  close: 'Близко',
  partial: 'Частично',
  miss: 'Не совпало',
  unknown: 'Нет данных',
}

const CityClue = ({ hint }: { hint: CityHint }) => <div className={`city-clue city-clue--${hint.status}`}>
  <span>{hint.label}</span>
  <strong>{hint.value}</strong>
  <small>{hintStatusLabel[hint.status]} {hint.direction === 'up' ? <ArrowUp /> : hint.direction === 'down' ? <ArrowDown /> : hint.status === 'match' ? <Check /> : null}</small>
</div>

const CityAttemptCard = ({ city, answer, index }: { city: CityItem; answer: CityItem; index: number }) => {
  const hints = compareCities(city, answer)
  const primaryHints = hints.slice(0, 5)
  const rankHints = hints.slice(5)
  const matchedFields = hints.filter((hint) => hint.status === 'match').length
  const scoreTone = matchedFields === 0 ? 'miss' : 'match'
  return <article className={`attempt-card attempt-card--city city-attempt-card ${city.id === answer.id ? 'is-correct' : ''}`}>
    <header className="attempt-card__header city-attempt-card__header">
      <span className="attempt-card__number city-attempt-card__number">{String(index + 1).padStart(2, '0')}</span>
      <CityMark city={city} />
      <span className="attempt-card__identity city-attempt-card__identity">
        <span className="attempt-label">Попытка {index + 1} · {city.capital ? 'столица' : city.popular ? 'популярный город' : 'город'}</span>
        <h2>{city.titleRu}</h2>
        <i>{city.titleOriginal}</i>
        <span className="city-attempt-card__country"><span><CityAsset src={city.countryFlagUrl} alt={`Флаг: ${city.country}`} /><Flag /></span>{city.country} · {city.continent}</span>
        {city.id === answer.id && <span className="city-attempt-card__correct"><Check /> Найден</span>}
      </span>
    </header>
    <div className={`dx-score dx-score--${scoreTone}`} aria-label={`Совпадений: ${matchedFields}; полей с совпадениями: ${matchedFields} из ${hints.length}`}>
      <span>Совпадений</span>
      <div className="dx-score__bar">{hints.map((_, hintIndex) => <i className={hintIndex < matchedFields ? 'on' : ''} key={hintIndex} />)}</div>
      <strong>{matchedFields}</strong>
    </div>
    <div className="attempt-clue-grid city-clue-grid">{primaryHints.map((hint) => <CityClue hint={hint} key={hint.key} />)}</div>
    <CityRankProfile ranks={city.ranks} hints={rankHints} />
  </article>
}

const CityProgress = ({ attempts }: { attempts: number }) => <div className="progress-block">
  <div className="progress-copy"><span>Попытка</span><strong>{Math.min(attempts + 1, 10)} <i>из 10</i></strong></div>
  <div className="progress-track" aria-label={`Использовано попыток: ${attempts} из 10`}>
    {Array.from({ length: 10 }, (_, index) => <i key={index} className={index < attempts ? 'used' : index === attempts ? 'current' : ''} />)}
  </div>
</div>

const CityResult = ({ city, status, attempts, mode, date, onHome, onChooseMode }: {
  city: CityItem
  status: Exclude<CitySessionStatus, 'playing'>
  attempts: number
  mode: CityPoolMode
  date: string
  onHome: () => void
  onChooseMode: () => void
}) => {
  const [copied, setCopied] = useState(false)
  const primaryAsset = city.coatOfArmsUrl ?? city.cityFlagUrl ?? city.countryFlagUrl
  const copyResult = async () => {
    const text = `Сходится! · Города · ${modeMeta(mode).label}\n${status === 'won' ? `Угадано за ${attempts}/10` : 'Не угадано за 10 попыток'}\n${prettyDate(date)}`
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  const tags = [
    city.country,
    city.capital ? 'Столица' : null,
    city.popular ? 'Популярный город' : null,
    city.timezone,
    city.population != null ? `${new Intl.NumberFormat('ru-RU').format(city.population)} жителей` : null,
  ].filter((tag): tag is string => Boolean(tag))

  return <GameResult
    mode="city"
    won={status === 'won'}
    attempts={attempts}
    poster={<div className="poster-fallback poster-fallback--city city-result-poster">
      {primaryAsset ? <CityAsset src={primaryAsset} alt={`Символ города: ${city.titleRu}`} /> : <MapPin aria-hidden="true" />}
      {city.countryFlagUrl && primaryAsset !== city.countryFlagUrl && <CityAsset className="city-result-poster__flag" src={city.countryFlagUrl} alt={`Флаг страны: ${city.country}`} />}
    </div>}
    title={city.titleRu}
    meta={[city.titleOriginal, city.country].filter(Boolean).join(' · ')}
    tags={tags}
    nextLabel="Другой режим"
    configureLabel="На главную"
    award={null}
    copied={copied}
    onNext={onChooseMode}
    onConfigure={onHome}
    onCopy={() => void copyResult()}
  />
}

export function CityGameScreen({
  items,
  loading,
  error,
  mode,
  date,
  onBack,
  onChooseMode,
  onProgress,
  navigation,
}: {
  items: CityItem[]
  loading: boolean
  error: string | null
  mode: CityPoolMode
  date: string
  onBack: () => void
  onChooseMode: () => void
  onProgress: () => void
  navigation: CityNavigation
}) {
  const answer = useMemo(() => dailyCity(items, mode, date), [date, items, mode])
  const [attemptIds, setAttemptIds] = useState<string[]>([])
  const [status, setStatus] = useState<CitySessionStatus>('playing')
  const [query, setQuery] = useState('')
  const [message, setMessage] = useState('')
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0)
  const [isSearchDropdownOpen, setIsSearchDropdownOpen] = useState(false)
  const [matchStripOpen, setMatchStripOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const searchPickerRef = useRef<HTMLDivElement>(null)
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const attempts = useMemo(() => attemptIds.map((id) => byId.get(id)).filter((item): item is CityItem => Boolean(item)), [attemptIds, byId])
  const used = useMemo(() => new Set(attemptIds), [attemptIds])
  const suggestions = useMemo(() => searchCities(items, query, used), [items, query, used])
  const latestMatchCount = useMemo(() => {
    const latest = attempts.at(-1)
    return latest && answer ? compareCities(latest, answer).filter((hint) => hint.status === 'match').length : 0
  }, [answer, attempts])
  const matchedTags = useMemo(() => {
    if (!answer) return []
    const seen = new Set<string>()
    const tags: string[] = []
    for (const city of attempts) {
      for (const hint of compareCities(city, answer)) {
        if (hint.status !== 'match' || hint.value === 'Нет данных') continue
        const tag = `${hint.label}: ${hint.value}`
        if (seen.has(tag)) continue
        seen.add(tag)
        tags.push(tag)
      }
    }
    return tags
  }, [answer, attempts])

  useEffect(() => {
    if (!answer) return
    const saved = loadCitySession(mode, date)
    if (saved?.answerId === answer.id) {
      setAttemptIds(saved.attemptIds.filter((id) => byId.has(id)))
      setStatus(saved.status)
    } else {
      setAttemptIds([])
      setStatus('playing')
    }
    setQuery('')
    setMessage('')
    setIsSearchDropdownOpen(false)
    setMatchStripOpen(false)
  }, [answer, byId, date, mode])

  useEffect(() => {
    if (!isSearchDropdownOpen) return
    const close = (event: PointerEvent) => {
      if (!searchPickerRef.current?.contains(event.target as Node)) setIsSearchDropdownOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [isSearchDropdownOpen])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onBack()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onBack])

  const submit = (city?: CityItem) => {
    const selected = city ?? suggestions[0]
    if (!selected || !answer || status !== 'playing') {
      setMessage('Выберите город из найденного списка')
      return
    }
    if (used.has(selected.id)) {
      setMessage('Этот город уже был в попытках')
      return
    }
    const nextAttemptIds = [...attemptIds, selected.id].slice(0, 10)
    const nextStatus: CitySessionStatus = selected.id === answer.id ? 'won' : nextAttemptIds.length >= 10 ? 'lost' : 'playing'
    setAttemptIds(nextAttemptIds)
    setStatus(nextStatus)
    setQuery('')
    setMessage('')
    setIsSearchDropdownOpen(false)
    setMatchStripOpen(true)
    saveCitySession({ mode, date, answerId: answer.id, attemptIds: nextAttemptIds, status: nextStatus, updatedAt: Date.now() })
    onProgress()
    if (nextStatus === 'playing') {
      window.requestAnimationFrame(() => document.querySelector('.city-attempt-list article:first-child')?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
    } else {
      window.setTimeout(() => document.querySelector('.result-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
    }
  }

  const submitForm = (event: FormEvent) => {
    event.preventDefault()
    submit()
  }

  return <div className="city-surface">
    <AppHeader {...navigation} />
    <main className="game-shell city-game-screen">
      <div className="screen-back-row">
        <button className="screen-back" onClick={onBack} aria-label="Назад"><ChevronLeft /></button>
        <span className="keycap-hint" aria-hidden="true">Esc</span>
      </div>

      <section className="game-heading city-game-heading">
        <div>
          <div className="game-heading__kicker">Сегодня · Сеанс №{dayNumber(date)} · {modeMeta(mode).shortLabel}</div>
          <h1>Город дня</h1>
          <p>{prettyDate(date)} · обновление в 00:00 МСК</p>
        </div>
        <div className="mini-ticket" aria-hidden="true"><Ticket /><span>{date.slice(8, 10)}<small>/{date.slice(5, 7)}</small></span></div>
      </section>

      {loading && <section className="city-game-state">Открываем атлас городов…</section>}
      {error && <section className="city-game-state city-data-state--error">{error}</section>}
      {!loading && !error && !answer && <section className="city-game-state city-data-state--error">В выбранном режиме нет городов</section>}

      {answer && <>
        {status === 'playing' && <div className="progress-row"><CityProgress attempts={attemptIds.length} /></div>}

        {status !== 'playing' && <CityResult city={answer} status={status} attempts={attemptIds.length} mode={mode} date={date} onHome={navigation.onHome} onChooseMode={onChooseMode} />}

        {status === 'playing' && <form className="search-area search-area--sticky city-search" onSubmit={submitForm}>
          <div className="sticky-composer__status">
            <span>Попытка {Math.min(attemptIds.length + 1, 10)} из 10</span>
            {!!attempts.length && <strong>{latestMatchCount} {latestMatchCount === 1 ? 'признак совпал' : latestMatchCount >= 2 && latestMatchCount <= 4 ? 'признака совпали' : 'признаков совпали'}</strong>}
          </div>
          <div className="search-picker" ref={searchPickerRef}>
          <div className="search-box city-search__box">
            <Search />
            <input
              ref={searchRef}
              value={query}
              autoComplete="off"
              aria-label="Введите название города"
              placeholder="Например, Алматы или Buenos Aires…"
              onFocus={() => setIsSearchDropdownOpen(true)}
              onChange={(event) => { setQuery(event.target.value); setMessage(''); setActiveSuggestionIndex(0); setIsSearchDropdownOpen(true) }}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && isSearchDropdownOpen) { event.preventDefault(); setIsSearchDropdownOpen(false); return }
                if (event.key === 'ArrowDown') { event.preventDefault(); setActiveSuggestionIndex((index) => Math.min(index + 1, suggestions.length - 1)); return }
                if (event.key === 'ArrowUp') { event.preventDefault(); setActiveSuggestionIndex((index) => Math.max(index - 1, 0)); return }
                if (event.key === 'Enter') { event.preventDefault(); submit(suggestions[activeSuggestionIndex]); }
              }}
            />
            <button type="submit" aria-label="Проверить город"><ChevronRight /></button>
          </div>
          {query && isSearchDropdownOpen && <div className="suggestions city-suggestions">
            {suggestions.length ? suggestions.map((city, index) => <button type="button" className={index === activeSuggestionIndex ? 'is-active' : ''} key={city.id} onMouseEnter={() => setActiveSuggestionIndex(index)} onClick={() => submit(city)}>
              <span className="city-suggestions__flag"><CityAsset src={city.countryFlagUrl} alt="" /><MapPin /></span>
              <span><strong>{city.titleRu}</strong><small>{city.titleOriginal} · {city.country}</small></span>
              <em>{city.capital ? 'СТОЛИЦА' : city.continent}</em>
            </button>) : <div>Ничего не найдено</div>}
          </div>}
          </div>
          {!!attempts.length && <div className={`game-match-strip ${matchStripOpen ? 'is-open' : ''}`}>
            <button type="button" className="game-match-strip__toggle" onClick={() => setMatchStripOpen((open) => !open)} aria-expanded={matchStripOpen} aria-controls="city-match-strip-panel">
              <span className="game-match-strip__logo" aria-hidden="true"><img src="./images/symbol.svg" alt="" /></span>
              <span className="game-match-strip__title">Что сходится</span>
              <ChevronRight aria-hidden="true" />
            </button>
            <div className="game-match-strip__panel" id="city-match-strip-panel" aria-hidden={!matchStripOpen}>
              <HorizontalScrollLane className="game-match-strip__tags">
                {matchedTags.length ? matchedTags.map((tag) => <span key={tag} className="dx-chip match game-match-strip__tag">{tag}</span>) : <span className="game-match-strip__empty">Пока совпадений нет</span>}
              </HorizontalScrollLane>
            </div>
          </div>}
          {message && <div className="search-meta"><strong>{message}</strong></div>}
        </form>}

        {status === 'playing' && attemptIds.length >= 5 && answer.plotHint && <section className="city-answer-hint">
          <span><Sparkles /> Подсказка маршрута</span>
          <p>{answer.plotHint}</p>
        </section>}

        {!attempts.length && status === 'playing' && <section className="empty-card city-empty-card">
          <div className="empty-card__icon"><Globe2 /></div>
          <div><h2>Начните с любого города</h2><p>Стрелка вверх означает, что у ответа больше население, более поздний часовой пояс или более высокое место в рейтинге. Точное совпадение станет зелёным.</p></div>
        </section>}

        {!!attempts.length && <section className="attempt-list city-attempt-list">
          <div className="section-title"><span>Ваши попытки</span><strong>{attempts.length}/10</strong></div>
          {attempts.map((city, index) => ({ city, index })).reverse().map(({ city, index }) => <CityAttemptCard city={city} answer={answer} index={index} key={`${city.id}-${index}`} />)}
        </section>}
      </>}
    </main>
  </div>
}
