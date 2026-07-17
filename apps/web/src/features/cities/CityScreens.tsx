import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Compass,
  Copy,
  Flag,
  Globe2,
  Landmark,
  Map as MapIcon,
  MapPin,
  Play,
  Search,
} from 'lucide-react'
import { ActionButton, AppHeader } from '../../components/app-shell/AppShell'
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

const CityModeTabs = ({ items, value, onChange }: { items: CityItem[]; value: CityPoolMode; onChange: (mode: CityPoolMode) => void }) => (
  <div className="city-mode-tabs" role="radiogroup" aria-label="Режим городов">
    {CITY_POOL_OPTIONS.map((entry) => {
      const count = cityPool(items, entry.mode).length
      return <button
        type="button"
        role="radio"
        aria-checked={value === entry.mode}
        className={value === entry.mode ? 'active' : ''}
        key={entry.mode}
        onClick={() => onChange(entry.mode)}
      >
        <span>{entry.label}</span>
        <small>{count || '—'} городов</small>
        <i>{entry.description}</i>
      </button>
    })}
  </div>
)

export function CityTitleScreen({
  items,
  loading,
  error,
  mode,
  date,
  onModeChange,
  onPlay,
  onBack,
  navigation,
}: {
  items: CityItem[]
  loading: boolean
  error: string | null
  mode: CityPoolMode
  date: string
  onModeChange: (mode: CityPoolMode) => void
  onPlay: () => void
  onBack: () => void
  navigation: CityNavigation
}) {
  const selectedCount = cityPool(items, mode).length

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onBack()
      if (event.key === 'Enter' && selectedCount > 0 && !loading && !error) onPlay()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [error, loading, onBack, onPlay, selectedCount])

  return <div className="city-surface">
    <AppHeader {...navigation} />
    <main className="city-title-screen">
      <div className="screen-back-row">
        <button className="screen-back" onClick={onBack} aria-label="Назад"><ChevronLeft /></button>
        <span className="keycap-hint" aria-hidden="true">Esc</span>
      </div>

      <section className="city-title-stage">
        <div className="city-title-heading">
          <span><MapPin /> Игра дня · №{dayNumber(date)}</span>
          <h1>Города</h1>
          <time>{prettyDate(date)} · {date.slice(0, 4)}</time>
          <p>Угадайте город за десять попыток по стране, континенту, населению, часовому поясу и мировым рейтингам.</p>
        </div>

        <article className="city-travel-pass">
          <div className="city-travel-pass__visual" aria-hidden="true">
            <img src="./images/cities/city-title-v1.webp" alt="" />
            <span><Globe2 /> WORLD CITY ROUTE</span>
          </div>
          <div className="city-travel-pass__body">
            <div className="city-travel-pass__intro">
              <span className="city-travel-pass__eyebrow"><Compass /> Выберите маршрут</span>
              <h2>Какой город сегодня?</h2>
              <p>Режим меняет только круг возможных ответов. В поиске доступны все 980 городов, поэтому сравнивать признаки можно свободно.</p>
            </div>
            {loading
              ? <div className="city-data-state">Загружаем атлас городов…</div>
              : error
                ? <div className="city-data-state city-data-state--error">{error}</div>
                : <CityModeTabs items={items} value={mode} onChange={onModeChange} />}
            <div className="city-travel-pass__facts">
              <span><strong>10</strong><small>попыток</small></span>
              <span><strong>{selectedCount || '—'}</strong><small>в пуле</small></span>
              <span><strong>10</strong><small>признаков</small></span>
            </div>
          </div>
          <div className="city-travel-pass__stub" aria-hidden="true">
            <MapPin />
            <strong>{date.slice(8, 10)}.{date.slice(5, 7)}</strong>
            <small>{modeMeta(mode).shortLabel}</small>
            <i />
          </div>
        </article>

        <ActionButton className="city-title-play" disabled={loading || Boolean(error) || selectedCount === 0} onClick={onPlay}>
          <Play /> Начать маршрут <span className="keycap-hint keycap-hint--inline" aria-hidden="true">Enter</span>
        </ActionButton>
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
  return <article className={`city-attempt-card ${city.id === answer.id ? 'is-correct' : ''}`}>
    <header>
      <span className="city-attempt-card__number">{String(index + 1).padStart(2, '0')}</span>
      <CityMark city={city} />
      <span className="city-attempt-card__identity">
        <small>{city.capital ? 'Столица' : city.popular ? 'Популярный город' : 'Город'}</small>
        <strong>{city.titleRu}</strong>
        <i>{city.titleOriginal}</i>
        <span className="city-attempt-card__country"><span><CityAsset src={city.countryFlagUrl} alt={`Флаг: ${city.country}`} /><Flag /></span>{city.country} · {city.continent}</span>
      </span>
      {city.id === answer.id && <span className="city-attempt-card__correct"><Check /> Найден</span>}
    </header>
    <div className="city-clue-grid">{primaryHints.map((hint) => <CityClue hint={hint} key={hint.key} />)}</div>
    <CityRankProfile ranks={city.ranks} hints={rankHints} />
  </article>
}

const CityProgress = ({ attempts }: { attempts: number }) => <div className="city-progress">
  <span>Попытка <strong>{Math.min(attempts + 1, 10)}</strong> из 10</span>
  <div aria-label={`Использовано попыток: ${attempts} из 10`}>
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
  const assets = [
    city.countryFlagUrl ? { src: city.countryFlagUrl, alt: `Флаг страны: ${city.country}`, label: 'Флаг страны' } : null,
    city.cityFlagUrl ? { src: city.cityFlagUrl, alt: `Флаг города: ${city.titleRu}`, label: 'Флаг города' } : null,
    city.coatOfArmsUrl ? { src: city.coatOfArmsUrl, alt: `Герб города: ${city.titleRu}`, label: 'Герб города' } : null,
  ].filter((entry): entry is { src: string; alt: string; label: string } => Boolean(entry))
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

  return <section className={`city-result city-result--${status}`}>
    <div className="city-result__copy">
      <span>{status === 'won' ? <Check /> : <MapPin />} {status === 'won' ? 'Маршрут найден' : 'Маршрут завершён'}</span>
      <h2>{city.titleRu}</h2>
      <p>{city.titleOriginal} · {city.country} · {new Intl.NumberFormat('ru-RU').format(city.population ?? 0)} жителей</p>
      <div className="city-result__tags">
        {city.capital && <span><Landmark /> Столица</span>}
        {city.popular && <span><Globe2 /> Популярный</span>}
        <span><Compass /> {city.timezone}</span>
      </div>
    </div>
    <div className="city-result__assets">
      {assets.map((asset) => <span key={asset.label}><CityAsset src={asset.src} alt={asset.alt} /><small>{asset.label}</small></span>)}
    </div>
    <div className="city-result__actions">
      <ActionButton onClick={onChooseMode}><MapIcon /> Другой режим</ActionButton>
      <ActionButton variant="secondary" onClick={copyResult}><Copy /> {copied ? 'Скопировано' : 'Поделиться'}</ActionButton>
      <ActionButton variant="ghost" onClick={onHome}>На главную</ActionButton>
    </div>
  </section>
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
  const searchRef = useRef<HTMLInputElement>(null)
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const attempts = useMemo(() => attemptIds.map((id) => byId.get(id)).filter((item): item is CityItem => Boolean(item)), [attemptIds, byId])
  const used = useMemo(() => new Set(attemptIds), [attemptIds])
  const suggestions = useMemo(() => searchCities(items, query, used), [items, query, used])

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
  }, [answer, byId, date, mode])

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
    saveCitySession({ mode, date, answerId: answer.id, attemptIds: nextAttemptIds, status: nextStatus, updatedAt: Date.now() })
    onProgress()
    window.requestAnimationFrame(() => document.querySelector('.city-attempt-list article:last-child')?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }

  const submitForm = (event: FormEvent) => {
    event.preventDefault()
    submit()
  }

  return <div className="city-surface">
    <AppHeader {...navigation} />
    <main className="city-game-screen">
      <div className="screen-back-row">
        <button className="screen-back" onClick={onBack} aria-label="Назад"><ChevronLeft /></button>
        <span className="keycap-hint" aria-hidden="true">Esc</span>
      </div>

      <header className="city-game-heading">
        <span><MapPin /> Город дня</span>
        <div><h1>Найдите город</h1><strong>{modeMeta(mode).label}</strong></div>
        <p>{prettyDate(date)} · сравнивайте признаки после каждой попытки</p>
      </header>

      {loading && <section className="city-game-state">Открываем атлас городов…</section>}
      {error && <section className="city-game-state city-data-state--error">{error}</section>}
      {!loading && !error && !answer && <section className="city-game-state city-data-state--error">В выбранном режиме нет городов</section>}

      {answer && <>
        {status === 'playing' && <CityProgress attempts={attemptIds.length} />}

        {status !== 'playing' && <CityResult city={answer} status={status} attempts={attemptIds.length} mode={mode} date={date} onHome={navigation.onHome} onChooseMode={onChooseMode} />}

        {status === 'playing' && <form className="city-search" onSubmit={submitForm}>
          <div className="city-search__status"><span>Введите название города</span><strong>{attemptIds.length}/10</strong></div>
          <div className="city-search__box">
            <Search />
            <input
              ref={searchRef}
              value={query}
              autoComplete="off"
              aria-label="Введите название города"
              placeholder="Например, Алматы или Buenos Aires…"
              onChange={(event) => { setQuery(event.target.value); setMessage('') }}
            />
            <button type="submit" aria-label="Проверить город"><ChevronRight /></button>
          </div>
          {query && <div className="city-suggestions">
            {suggestions.length ? suggestions.map((city) => <button type="button" key={city.id} onClick={() => submit(city)}>
              <span className="city-suggestions__flag"><CityAsset src={city.countryFlagUrl} alt="" /><MapPin /></span>
              <span><strong>{city.titleRu}</strong><small>{city.titleOriginal} · {city.country}</small></span>
              <em>{city.capital ? 'СТОЛИЦА' : city.continent}</em>
            </button>) : <div>Ничего не найдено</div>}
          </div>}
          {message && <p>{message}</p>}
        </form>}

        {!attempts.length && status === 'playing' && <section className="city-empty-card">
          <span><Globe2 /></span>
          <div><h2>Начните с любого города</h2><p>Стрелка вверх означает, что у ответа больше население, более поздний часовой пояс или более высокое место в рейтинге. Точное совпадение станет зелёным.</p></div>
        </section>}

        {!!attempts.length && <section className="city-attempt-list">
          <div className="section-title"><span>Ваши попытки</span><strong>{attempts.length}/10</strong></div>
          {attempts.map((city, index) => <CityAttemptCard city={city} answer={answer} index={index} key={`${city.id}-${index}`} />)}
        </section>}
      </>}
    </main>
  </div>
}
