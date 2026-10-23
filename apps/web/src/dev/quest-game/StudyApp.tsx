import { PageHeading } from '../../components/ui/PageHeading'
import { Suspense, useCallback, useContext, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { preloadableScreen } from '../../app/preloadable-screen'
import { RoutePending, RouteLoadingOverlay } from '../../app/RoutePending'
import { navigateApplication } from '../../app/application-navigation'
import { QueryClient, QueryClientContext, QueryClientProvider } from '@tanstack/react-query'
import { ClubScreen } from '../../features/commerce/ClubScreen'
import { getMoscowDate, PERIODS } from '@shoditsa/game-core'
import { isCatalogGuessModeId, type PeriodKey } from '@shoditsa/contracts'
import { ArrowDown, ArrowRight, ArrowUp, BookOpen, Check, ChevronDown, ChevronRight, Clock3, Copy, HelpCircle, Moon, RotateCcw, Search, Settings, Sun, X } from 'lucide-react'
import { QuestButton, QuestDialog, QuestInput, QuestProgress } from '../../components/ui/QuestPrimitives'
import { publicAssetUrl } from '../../app/public-asset'
import { localStudyLaunchHref } from '../../app/local-study-launch'
import type { Hint } from '../../types'
import { confirmedFacts, statusLabel, type DemoEntry } from '../mobile-game-direction/model'
import type { GlyphName } from './QuestArt'
import { isShoditsaStudy, StudyGlyph as QuestGlyph } from './ShoditsaPresentation'
import fixture from './fixtures.json'
import { QuestTitle, QuestTitleAside, type QuestLaunchSelection, type QuestPeriod } from './QuestTitle'
import { QuestGames, QuestGamesAside } from './QuestGames'
import { STUDY_NAV_ITEMS as navItems, studyViewFromHash, type StudyView } from './navigation'
import { StudySidebar } from './StudySidebar'
import { StudyHeader } from './StudyHeader'
import { StudyRightSidebar } from './StudyRightSidebar'
import StudyClubPage from './StudyClubPage'
import { StudyThemeToggle, useStudyTheme } from './StudyTheme'
import { StudySettings } from './StudySettings'
import { StudyProfileIllustration, StudySettingsIcon } from './StudyProfileArt'
import { studyLinkView, transitionStudyPage } from './study-navigation'
import { HomeVariants, type HomeVariant } from '../quest-home/HomeVariants'
import { StudySectionAside, studyAsideLabel } from './StudySectionAside'
import { STUDY_HOME_VARIANT_KEY, isStudyRootHomeLocation, studyHomeHref } from './home-route'
import { writeStudyActivity } from '../quest-home/game-availability'
import { DANETKI_RULES, GAME_RULES, GAME_SEO, HOME_SEO } from '../../app/seo-content'
import { studyTitleMode } from './title-routing'
import { applicationSection, applicationHref } from '../../features/application/routes'
import { useServerRuntime } from '../../hooks/use-server-runtime'
import { ApplicationContinueLink } from '../../features/application/ApplicationContinueLink'
import '../../styles/quest-study-tokens.css'
import '../../styles/reference-tokens.css'
import '../../styles/shoditsa-study-tokens.css'
import './quest-game.css'
import './shoditsa-game.css'
import './quest-title.css'
import '../quest-home/home-variants.css'

const ApplicationProfile = preloadableScreen<Record<string, never>>(() => import('../../features/application/ApplicationProfile').then(module => ({ default: module.ApplicationProfile })))
const ApplicationArchive = preloadableScreen<Record<string, never>>(() => import('../../features/application/ApplicationArchive').then(module => ({ default: module.ApplicationArchive })))
const LeaderboardScreen = preloadableScreen<Record<string, never>>(() => import('../../features/leaderboard/LeaderboardScreen').then(module => ({ default: module.LeaderboardScreen })))
export const prepareSection = (view: string) => view === 'profile' ? ApplicationProfile.preload() : view === 'archive' ? ApplicationArchive.preload() : view === 'league' ? LeaderboardScreen.preload() : undefined

const isHomeLocation = () => location.pathname.endsWith('/shoditsa-home.html') || isStudyRootHomeLocation(location)
const homeVariant = (() => {
  if (!import.meta.env.DEV) return 'a'
  if (isHomeLocation()) {
    const requested = new URLSearchParams(location.search).get('variant')
    const variant = requested && ['a', 'b', 'c'].includes(requested) ? requested : 'a'
    try { sessionStorage.setItem(STUDY_HOME_VARIANT_KEY, variant) } catch { /* Home also works without browser storage. */ }
    return variant
  }
  try { return sessionStorage.getItem(STUDY_HOME_VARIANT_KEY) } catch { return null }
})()
const homeHref = isShoditsaStudy ? studyHomeHref(homeVariant ?? 'a') : undefined
const homeGamesHref = isShoditsaStudy ? studyHomeHref(homeVariant ?? 'a', true) : undefined
const periodParam = new URLSearchParams(location.search).get('period')
const selectedPeriod = (periodParam && periodParam in PERIODS ? periodParam : `from_${periodParam}`) as PeriodKey
const minimumYear = PERIODS[selectedPeriod]?.fromYear ?? 0
const entries = fixture.entries as DemoEntry[]
const initialIds = entries.slice(0, 3).map(entry => entry.id)
const answer = entries.find(entry => entry.id === fixture.answerId)!
const mascot = publicAssetUrl(isShoditsaStudy ? 'images/shoditsa-study/mascot-clue-v1.webp' : 'images/quest-study/mascot-quest-v1.webp')
const image = (entry: DemoEntry) => publicAssetUrl(entry.poster ?? '')

type View = StudyView
type Panel = 'rules' | 'hint' | 'facts' | 'settings' | 'source' | null
type Popup = 'more' | 'streak' | 'tickets' | 'attempts' | null

function Match({ hint }: { hint: Hint }) {
  const Icon = hint.status === 'match' ? Check : hint.direction === 'up' ? ArrowUp : hint.direction === 'down' ? ArrowDown : hint.status === 'miss' ? X : null
  return <span className={`qg-match qg-match--${hint.status}`} role="img" aria-label={statusLabel(hint)} title={statusLabel(hint)}>{Icon ? <Icon size={17} strokeWidth={3} /> : hint.status === 'unknown' ? '?' : '≈'}</span>
}

function Comparison({ hint }: { hint: Hint }) {
  return <div className={`qg-comparison${hint.key === 'genres' ? ' qg-comparison--genres' : ''}`}><div><small>{hint.label === 'Shikimori' ? 'Рейтинг' : hint.label}</small>{hint.key === 'genres' ? <div className="qg-genres">{hint.value.split(',').map(value => {
    const text = value.trim(), match = hint.matchedValues?.includes(text)
    return <span className={match ? 'is-match' : ''} key={text}>{match && <Check size={13} strokeWidth={3} aria-label="Совпадает" />}{text}</span>
  })}</div> : <strong>{hint.value}</strong>}</div><Match hint={hint} /></div>
}

function Attempt({ entry, number, open, onToggle }: { entry: DemoEntry; number: number; open: boolean; onToggle: () => void }) {
  const contentId = useId()
  return <article className={`qg-attempt qg-card${open ? ' is-open' : ''}`}>
    <QuestButton kind="row" className="qg-attempt__toggle" id={`qg-attempt-${entry.id}`} aria-expanded={open} aria-controls={contentId} onClick={onToggle}>
      <img src={image(entry)} width="49" height="69" alt="" /><span><small>Версия {number}</small><strong>{entry.title}</strong><span>{entry.year}, совпадений: {entry.hints.filter(hint => hint.status === 'match').length}</span></span><ChevronDown size={22} />
    </QuestButton>
    {open && <div className="qg-attempt__body" id={contentId}><div className="qg-comparisons">{['year', 'anime_kind', 'studio', 'episodes', 'genres'].map(key => <Comparison key={key} hint={entry.hints.find(hint => hint.key === key)!} />)}</div><details className="qg-rest"><summary>Ещё 5 признаков<ChevronDown size={17} /></summary><div>{entry.hints.filter(hint => !['year', 'anime_kind', 'studio', 'episodes', 'genres'].includes(hint.key)).map(hint => <Comparison hint={hint} key={hint.key} />)}</div></details></div>}
  </article>
}

function Picker({ attempts, onSubmit, query, setQuery, pending, setPending }: { attempts: DemoEntry[]; onSubmit: (entry: DemoEntry) => void; query: string; setQuery: (value: string) => void; pending: DemoEntry | null; setPending: (entry: DemoEntry | null) => void }) {
  const [show, setShow] = useState(false), [active, setActive] = useState(0)
  const ref = useRef<HTMLDivElement>(null), inputRef = useRef<HTMLInputElement>(null), resultsRef = useRef<HTMLDivElement>(null)
  const id = useId()
  const available = entries.filter(entry => entry.year >= minimumYear && !attempts.some(attempt => attempt.id === entry.id) && `${entry.title} ${entry.original}`.toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru').trim()))
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setShow(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [])
  useEffect(() => {
    if (!show) return
    const list = resultsRef.current, option = list?.children[active] as HTMLElement | undefined
    if (!list || !option) return
    if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop
    else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight
  }, [active, show])
  const select = (entry: DemoEntry) => { setPending(entry); setQuery(entry.title); setShow(false) }
  const submit = () => { if (pending) { onSubmit(pending); setPending(null); setQuery(''); setShow(false) } }
  return <section className="qg-picker" aria-labelledby={`${id}-label`}><div className="qg-section-head"><h2 id={`${id}-label`}>Твоя следующая версия</h2><span className="qg-count"><QuestGlyph name="heart" size={23} />{10 - attempts.length} из 10</span></div>
    <form className="qg-picker__form qg-card" onSubmit={event => { event.preventDefault(); submit() }}>
      <p>Какое аниме мы загадали?</p>
      <div className="qg-search" ref={ref}><div className="qg-search__input"><Search size={22} /><QuestInput ref={inputRef} aria-label="Название аниме" role="combobox" aria-expanded={show} aria-controls={`${id}-results`} aria-autocomplete="list" aria-activedescendant={show && available[active] ? `${id}-${available[active].id}` : undefined} placeholder="Название аниме" autoComplete="off" value={query} onFocus={() => !pending && setShow(true)} onChange={event => { setQuery(event.target.value); setPending(null); setActive(0); setShow(true) }} onKeyDown={event => {
        if (event.key === 'Escape') { setShow(false); return }
        if (event.key === 'ArrowDown') { event.preventDefault(); setShow(true); setActive(value => Math.min(Math.max(0, available.length - 1), value + 1)) }
        if (event.key === 'ArrowUp') { event.preventDefault(); setActive(value => Math.max(0, value - 1)) }
        if (event.key === 'Enter' && show && available[active]) { event.preventDefault(); select(available[active]) }
      }} /></div>
      {show && <div className="qg-search__results" ref={resultsRef} role="listbox" id={`${id}-results`} aria-label="Варианты аниме">{available.map((entry, index) => <QuestButton kind="choice" selected={active === index} key={entry.id} role="option" aria-selected={active === index} id={`${id}-${entry.id}`} onPointerMove={() => setActive(index)} onClick={() => select(entry)}><img src={image(entry)} alt="" width="37" height="52" /><span><strong>{entry.title}</strong><small>{entry.year}, {entry.original}</small></span><ChevronRight size={18} /></QuestButton>)}{!available.length && <p>В демонаборе нет такого названия. Попробуй «Клинок» или «Магическая».</p>}</div>}
      </div>
      {pending && <div className="qg-picked"><Check size={20} /><span>{pending.title}</span><QuestButton kind="icon" aria-label="Выбрать другое аниме" onClick={() => { setPending(null); setQuery(''); setShow(true); inputRef.current?.focus() }}><X size={19} /></QuestButton></div>}
      <QuestButton type="submit" disabled={!pending}>Проверить версию<ArrowRight size={20} /></QuestButton>
    </form>
  </section>
}

function Facts({ attempts, compact = false }: { attempts: DemoEntry[]; compact?: boolean }) {
  const facts = confirmedFacts(attempts)
  return <div className={`qg-facts${compact ? ' qg-facts--compact' : ''}`}>{facts.length ? facts.map(fact => <div className="qg-fact" key={fact.key}><span className="qg-fact__check"><Check size={16} strokeWidth={3} /></span><div><small>{fact.label}</small><strong>{fact.values.join(', ')}</strong></div></div>) : <div className="qg-facts__empty"><QuestGlyph name="hint" size={57} /><p>Пока всё — загадка.<br />Проверь первую версию, и здесь появятся совпадения.</p></div>}</div>
}

function Task({ icon, title, value, max }: { icon: GlyphName; title: string; value: number; max: number }) {
  return <article className="qg-task qg-card"><QuestGlyph name={icon} size={48} /><div><h3>{title}</h3><div className="qg-task__progress"><QuestProgress value={Math.min(value, max)} max={max} label={title} />{value >= max ? <span className="qg-task__done" aria-label="Выполнено"><Check size={18} strokeWidth={4} /></span> : <QuestGlyph name="quests" size={34} />}</div></div></article>
}

export default function StudyApp({ routed = false }: { routed?: boolean }) {
  const parent = useContext(QueryClientContext)
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }))
  const content = <><StudyAppContent routed={routed} /><RouteLoadingOverlay /></>
  return parent ? content : <QueryClientProvider client={client}>{content}</QueryClientProvider>
}

function StudyAppContent({ routed }: { routed: boolean }) {
  useServerRuntime()
  const homeEntry = isHomeLocation()
  const isTitleEntry = routed || document.documentElement.dataset.questEntry === 'title' || homeEntry
  const titleMode = studyTitleMode(location.pathname, location.search)
  const titleRules = titleMode === 'danetki' ? DANETKI_RULES : GAME_RULES[titleMode]
  const params = new URLSearchParams(location.search)
  const [view, setView] = useState<View | 'home'>(() => {
    if (isShoditsaStudy && params.get('panel') === 'settings') return 'settings'
    const requested = applicationSection(location.pathname) ?? studyViewFromHash(location.hash, isTitleEntry, isShoditsaStudy)
    if (homeEntry || (isShoditsaStudy && requested === 'games')) return 'home'
    return params.get('view') === 'kit' ? 'kit' : requested ?? (isTitleEntry ? 'title' : 'play')
  })
  const viewRef = useRef(view)
  viewRef.current = view
  const [demoTone, setDemoTone] = useState(params.get('tone') === 'light' ? 'light' : 'dark')
  const [studyTone, setStudyTone] = useStudyTheme(isShoditsaStudy)
  const tone = isShoditsaStudy ? studyTone : demoTone
  const setTone = isShoditsaStudy ? setStudyTone : setDemoTone
  const [ids, setIds] = useState<string[]>(params.get('state') === 'empty' || (isTitleEntry && !params.has('state')) ? [] : params.get('state') === 'won' ? [...initialIds, answer.id] : params.get('state') === 'lost' ? entries.filter(entry => entry.id !== answer.id).map(entry => entry.id) : initialIds)
  const [expanded, setExpanded] = useState(params.get('state') === 'won' ? answer.id : initialIds[2])
  const [panel, setPanel] = useState<Panel>(null), [popup, setPopup] = useState<Popup>(null), [mobileTab, setMobileTab] = useState<'game' | 'facts'>('game')
  const [hintOpened, setHintOpened] = useState(false), [message, setMessage] = useState(''), [copied, setCopied] = useState(false)
  const [draftQuery, setDraftQuery] = useState(''), [draftPending, setDraftPending] = useState<DemoEntry | null>(null)
  const popupRef = useRef<HTMLDivElement>(null), triggerRef = useRef<HTMLButtonElement | null>(null)
  const dialogReturnRef = useRef<HTMLElement | null>(null)
  const attempts = ids.map(id => entries.find(entry => entry.id === id)!)
  const facts = confirmedFacts(attempts)
  const won = ids.includes(answer.id), finished = won || ids.length >= 10
  const goalsDone = Number(ids.length >= 3) + Number(facts.some(fact => fact.key === 'genres')) + Number(won)
  useEffect(() => { if (!isShoditsaStudy) { document.documentElement.dataset.questTone = tone; document.querySelector('meta[name="theme-color"]')?.setAttribute('content', tone === 'dark' ? '#131f24' : '#fff') } }, [tone])
  useEffect(() => {
    if (view === 'club' || view === 'club-offer') { document.title = 'Клуб — Сходится!'; return }
    if (view === 'settings') { document.title = 'Настройки — Сходится!'; return }
    if (view === 'home' || view === 'games') { document.title = HOME_SEO.title; document.querySelector('meta[name="description"]')?.setAttribute('content', HOME_SEO.description); return }
    if (isShoditsaStudy && ['archive', 'league', 'quests', 'profile'].includes(view)) { document.title = `${({ archive: 'Архив', league: 'Рейтинг', quests: 'Задания', profile: 'Профиль' } as Record<string, string>)[view]} — Сходится!`; return }
    if (!isTitleEntry) return
    const metadata = GAME_SEO[titleMode]
    document.title = metadata.title
    document.querySelector('meta[name="description"]')?.setAttribute('content', metadata.description)
  }, [view])
  useEffect(() => {
    const url = new URL(location.href)
    if (!isShoditsaStudy || url.searchParams.get('panel') !== 'settings') return
    url.searchParams.delete('panel')
    history.replaceState({ ...history.state, studyView: 'settings' }, '', `/settings${url.search}`)
  }, [])
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 700px)')
    const update = () => { if (desktop.matches) setMobileTab('game') }
    desktop.addEventListener('change', update)
    return () => desktop.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    if (routed) return
    const onHash = () => {
      const remembered = history.state?.studyView as View | 'home' | undefined
      const requested = applicationSection(location.pathname) ?? studyViewFromHash(location.hash, isTitleEntry, isShoditsaStudy)
      const next = isHomeLocation() ? 'home' : remembered ?? (requested === 'games' && homeGamesHref ? 'home' : requested)
      if (!next || next === viewRef.current) return
      viewRef.current = next
      const update = () => { setView(next); setMobileTab('game'); setPopup(null); window.scrollTo({ top: 0, behavior: 'instant' }) }
      if (isShoditsaStudy) transitionStudyPage(update, () => prepareSection(next)); else update()
    }
    window.addEventListener('hashchange', onHash)
    window.addEventListener('popstate', onHash)
    return () => { window.removeEventListener('hashchange', onHash); window.removeEventListener('popstate', onHash) }
  }, [])
  useEffect(() => {
    if (!popup) return
    const frame = popup === 'more' ? requestAnimationFrame(() => popupRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()) : null
    const outside = (event: PointerEvent) => { if (!popupRef.current?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) setPopup(null) }
    const keyboard = (event: KeyboardEvent) => { if (event.key === 'Escape') { setPopup(null); triggerRef.current?.focus() } }
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', keyboard)
    return () => { if (frame !== null) cancelAnimationFrame(frame); document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', keyboard) }
  }, [popup])
  const menuKeys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
  }
  const navigate = useCallback((next: View) => {
    if (routed) {
      void navigateApplication(next === 'play' ? `/play/${isCatalogGuessModeId(titleMode) ? titleMode : 'anime'}` : next === 'games' ? homeGamesHref! : applicationHref(next))
      return
    }
    if (isShoditsaStudy && next === 'play') { location.assign(`/play/${isCatalogGuessModeId(titleMode) ? titleMode : 'anime'}`); return }
    const destination = next === 'games' && homeGamesHref ? 'home' : next
    if (destination === viewRef.current) {
      if (destination === 'home') document.getElementById('home-games')?.scrollIntoView({ behavior: 'smooth' })
      return
    }
    viewRef.current = destination
    const update = () => {
      setView(destination); setMobileTab('game'); setPopup(null)
      const url = isShoditsaStudy ? destination === 'home' ? homeGamesHref! : applicationHref(next) : `#${next}`
      if (next !== 'kit') history.pushState({ ...history.state, studyView: destination }, '', url)
      window.scrollTo({ top: 0, behavior: 'instant' })
    }
    if (isShoditsaStudy) transitionStudyPage(update, () => prepareSection(destination)); else update()
  }, [])
  useEffect(() => {
    if (!isShoditsaStudy || routed) return
    const follow = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
      if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return
      const next = studyLinkView(link.href, location.origin)
      if (!next) return
      event.preventDefault()
      navigate(next)
    }
    const warm = (event: Event) => {
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
      const next = link && studyLinkView(link.href, location.origin)
      if (next) void prepareSection(next)?.catch(() => {})
    }
    document.addEventListener('click', follow)
    document.addEventListener('pointerover', warm)
    document.addEventListener('focusin', warm)
    return () => {
      document.removeEventListener('click', follow)
      document.removeEventListener('pointerover', warm)
      document.removeEventListener('focusin', warm)
    }
  }, [navigate])
  const settingsFromGame = useRef(false)
  const open = (next: Panel) => {
    if (isShoditsaStudy && next === 'settings') { if (viewRef.current !== 'settings') settingsFromGame.current = viewRef.current === 'play'; setPanel(null); navigate('settings'); return }
    dialogReturnRef.current = popup ? triggerRef.current : document.activeElement as HTMLElement; setPopup(null); setPanel(next)
  }
  const close = () => {
    setPanel(null)
    if (isShoditsaStudy) {
      const url = new URL(location.href)
      if (url.searchParams.get('panel') === 'settings') {
        url.searchParams.delete('panel')
        history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`)
      }
    }
    requestAnimationFrame(() => { if (dialogReturnRef.current?.isConnected) dialogReturnRef.current.focus() })
  }
  const togglePopup = (next: Popup, element: HTMLButtonElement) => { triggerRef.current = element; setPopup(current => current === next ? null : next) }
  const recordActivity = (nextIds: string[]) => {
    if (!isShoditsaStudy || isTitleEntry) return
    try { writeStudyActivity(localStorage, getMoscowDate(), nextIds.length, nextIds.includes(answer.id) ? 'won' : nextIds.length >= 10 ? 'lost' : 'playing') } catch { /* The preview also works without storage. */ }
  }
  const reset = () => { setIds([]); recordActivity([]); setHintOpened(false); setCopied(false); setDraftQuery(''); setDraftPending(null); setPanel(null); setPopup(null); setMessage('Новая демонстрационная игра. Впереди 10 попыток.'); navigate('play') }
  const submit = (entry: DemoEntry) => { if (finished || ids.includes(entry.id)) return; const nextIds = [...ids, entry.id]; setIds(nextIds); recordActivity(nextIds); setExpanded(entry.id); setMessage(entry.id === answer.id ? 'Сходится! Аниме угадано.' : `Версия ${entry.title} проверена. Осталось попыток: ${9 - ids.length}.`); requestAnimationFrame(() => document.getElementById(entry.id === answer.id || ids.length >= 9 ? 'qg-outcome-heading' : `qg-attempt-${entry.id}`)?.focus()) }
  const startTitleGame = (period: QuestPeriod, selection: QuestLaunchSelection) => {
    if (!isCatalogGuessModeId(titleMode)) return
    void navigateApplication(localStudyLaunchHref(titleMode, { period, ...selection }))
  }
  const primaryTasks = <><Task icon="bolt" title="Проверь три версии" value={ids.length} max={3} /><Task icon="hint" title="Найди совпадающий жанр" value={facts.some(fact => fact.key === 'genres') ? 1 : 0} max={1} /><Task icon="play" title="Угадай аниме дня" value={won ? 1 : 0} max={1} /></>
  const collection = <section className="qg-card qg-collection"><div><QuestGlyph name="medal" size={88} /><h3>Мастер деталей</h3><p>Собери пять разных признаков загаданного аниме.</p></div><QuestProgress value={Math.min(facts.length, 5)} max={5} label="Коллекция признаков" tone="green" /><p>{facts.length >= 5 ? 'Все детали собраны. Отличная работа!' : `Уже найдено ${Math.min(facts.length, 5)} из 5 признаков`}</p></section>
  const dialog = panel && <QuestDialog title={panel === 'rules' ? (view === 'title' ? `Как играть: ${GAME_SEO[titleMode].shortName}` : view === 'games' ? 'Как играть' : 'Как найти аниме?') : panel === 'facts' ? 'Твои находки' : panel === 'hint' ? 'Новая зацепка' : panel === 'settings' ? 'Настройки' : 'О новом дизайне'} description={panel === 'facts' ? 'Подтверждённые признаки из всех твоих версий.' : undefined} onClose={close} footer={panel === 'rules' ? <QuestButton onClick={close}>Понятно, играем!</QuestButton> : undefined}>
      {panel === 'rules' && view === 'title' && <div className="qg-rules"><p>{titleRules.searchInstruction}</p><p>{titleRules.comparisonInstruction}</p>{titleRules.directionInstruction && <p>{titleRules.directionInstruction}</p>}{titleRules.modeNote && <p>{titleRules.modeNote}</p>}</div>}
      {panel === 'rules' && view === 'games' && <div className="qg-rules"><p>Выберите игру в каталоге. Её правила, подсказки и ответы на частые вопросы находятся на титульной странице.</p></div>}
      {panel === 'rules' && view !== 'title' && view !== 'games' && <div className="qg-rules"><p>Выбирай знакомое аниме. После каждой попытки сравнивай его признаки с загаданным.</p><div><span className="qg-match qg-match--match"><Check size={18} /></span><span><strong>Совпало!</strong><small>Этот признак подходит загаданному аниме.</small></span></div><div><span className="qg-match qg-match--partial">≈</span><span><strong>Есть что-то общее</strong><small>У жанров отмечаем именно те, которые совпали.</small></span></div><div><span className="qg-match qg-match--close"><ArrowUp size={18} /></span><span><strong>Следуй за стрелками</strong><small>Вверх — у ответа число больше. Вниз — меньше.</small></span></div><div><span className="qg-match qg-match--miss"><X size={18} /></span><span><strong>Не совпало</strong><small>Попробуй другую версию и учти эту зацепку.</small></span></div></div>}
      {panel === 'facts' && <Facts attempts={attempts} />}
      {panel === 'hint' && <div className="qg-hint-dialog"><QuestGlyph name={ids.length < 4 ? 'lock' : 'hint'} size={84} /><h3>{ids.length < 4 ? 'Ещё чуть-чуть!' : 'Ты близко к разгадке'}</h3><p>{ids.length < 4 ? 'Дополнительную подсказку можно открыть перед пятой попыткой.' : 'Можно получить ещё одну деталь, которая направит поиск.'}</p>{ids.length >= 4 && <QuestButton onClick={() => setHintOpened(true)} aria-pressed={hintOpened}>{hintOpened ? 'Подсказка открыта' : 'Открыть подсказку'}</QuestButton>}{hintOpened && <div className="qg-hint-reveal" role="status">В этом аниме школьная жизнь сталкивается с миром проклятий.</div>}</div>}
      {panel === 'settings' && <div className="qg-settings"><h3>Оформление</h3><p>Выбери тему для этого макета.</p><QuestButton kind="choice" selected={tone === 'dark'} aria-pressed={tone === 'dark'} onClick={() => setTone('dark')}><Moon size={22} />Тёмная тема{tone === 'dark' && <Check size={22} />}</QuestButton><QuestButton kind="choice" selected={tone === 'light'} aria-pressed={tone === 'light'} onClick={() => setTone('light')}><Sun size={22} />Светлая тема{tone === 'light' && <Check size={22} />}</QuestButton><h3>Текущая игра</h3><QuestButton kind="outline" onClick={reset}><RotateCcw size={19} />Начать заново</QuestButton></div>}
      {panel === 'source' && <div className="qg-source"><p>Локальный эксперимент для «Сходится!» по визуальным паттернам Duolingo Quests, Learn и Shop: сетка, округлая типографика, рамки, кнопки, меню и прогресс.</p><p>{isTitleEntry ? 'Все титульники используют общие компоненты, иллюстрации «Сходится!» и исходные тексты действующего сайта.' : isShoditsaStudy ? 'В этом варианте изменены только цвета, шрифты и значки. Структура, размеры, тексты, маскот и поведение совпадают с исходным Quest study.' : 'Используются оригинальные значки и маскот «Сходится!». Шрифт — Nunito с открытой лицензией.'}</p><a href="https://www.duolingo.com/quests" target="_blank" rel="noreferrer">Посмотреть Duolingo Quests<ArrowRight size={18} /></a><p className="qg-source__note">{isTitleEntry ? 'Это локальный просмотр. Запуск «Связей» и «Данеток» требует серверного режима.' : 'Все игровые данные здесь демонстрационные. Поиск содержит 11 аниме, ответ фиксирован, прогресс аккаунта не меняется.'}</p></div>}
    </QuestDialog>

  if (isShoditsaStudy && (view === 'club' || view === 'club-offer')) return <ClubScreen studyPage={StudyClubPage} studySection={view === 'club' ? 'library' : 'offers'} onHome={() => navigate('games')} onArchive={() => navigate('archive')} onFreePlay={() => navigate('games')} onProfile={() => navigate('profile')} onStats={() => navigate('league')} onRules={() => open('rules')} onReview={() => navigate('games')} />

  if (isShoditsaStudy && view === 'settings') return <div className="qg-app"><StudySidebar view="profile" shoditsa homeHref={homeHref ?? '#games'} Glyph={QuestGlyph} onNavigate={navigate} /><div className="qg-layout study-layout study-settings-layout"><StudyHeader Glyph={QuestGlyph} onHome={() => navigate('games')} onProfile={() => navigate('profile')} onSettings={() => open('settings')} /><StudySettings onReset={settingsFromGame.current ? reset : undefined} /></div></div>

  if (view === 'home') return <><HomeVariants variant={(homeVariant === 'b' || homeVariant === 'c' ? homeVariant : 'a') as HomeVariant} clubPreview={params.get('access') === 'club'} onNavigate={navigate} onSettings={() => open('settings')} />{dialog}</>

  if (isShoditsaStudy && (view === 'profile' || view === 'archive' || view === 'league')) return <div className="qg-app">
    <StudySidebar view={view} shoditsa homeHref={homeHref ?? '/'} Glyph={QuestGlyph} onNavigate={navigate} />
    <div className="qg-layout study-layout">
      <StudyHeader Glyph={QuestGlyph} onHome={() => navigate('games')} onProfile={() => navigate('profile')} onSettings={() => open('settings')} />
      <main className="qg-main" id="quest-main"><Suspense fallback={<RoutePending />}>{view === 'profile' ? <ApplicationProfile /> : view === 'league' ? <LeaderboardScreen /> : <ApplicationArchive />}</Suspense></main>
      <StudyRightSidebar label={studyAsideLabel(view)}><StudySectionAside view={view} homeHref="/" goalsDone={0} factsFound={0} onContinue={() => navigate('games')} /></StudyRightSidebar>
    </div>
  </div>

  return <div className="qg-app">
    <StudySidebar view={view} shoditsa={isShoditsaStudy} homeHref={homeHref ?? (isShoditsaStudy ? '#games' : '#play')} Glyph={QuestGlyph} onNavigate={navigate} onSettings={() => open('settings')} more={<div className="qg-more-wrap"><QuestButton kind="nav" selected={popup === 'more'} className="qg-nav-item" aria-label="Ещё" aria-expanded={popup === 'more'} aria-haspopup="menu" onClick={event => togglePopup('more', event.currentTarget)}><QuestGlyph name="more" size={36} /><span>Ещё</span></QuestButton>{popup === 'more' && <div className="qg-popover qg-more" ref={popupRef} role="menu" aria-label="Дополнительное меню" onKeyDown={menuKeys}><QuestButton kind="menu" role="menuitem" onClick={() => open('settings')}><Settings size={22} />Настройки</QuestButton><QuestButton kind="menu" role="menuitem" onClick={() => open('rules')}><BookOpen size={22} />Как играть</QuestButton>{view !== 'title' && view !== 'games' && <QuestButton kind="menu" role="menuitem" onClick={reset}><RotateCcw size={22} />Начать заново</QuestButton>}<QuestButton kind="menu" role="menuitem" onClick={() => open('source')}><HelpCircle size={22} />Об этом макете</QuestButton></div>}</div>}>{view !== 'title' && view !== 'games' && <div className="qg-rail-note"><QuestGlyph name="quests" size={54} /><h3>Каждый день —<br />новая загадка</h3><p>Развивай чутьё.<br />Собирай совпадения.</p><QuestButton kind="text" onClick={() => navigate('quests')}>К заданиям</QuestButton></div>}</StudySidebar>
    {!isShoditsaStudy && ((view === 'play' || view === 'quests') ? <div className="qg-mobile-tabs" role="tablist" aria-label="Раздел игрового экрана"><QuestButton kind="tab" selected={mobileTab === 'game'} role="tab" aria-selected={mobileTab === 'game'} onClick={() => setMobileTab('game')}>{view === 'quests' ? 'Задания' : 'Игра'}</QuestButton><QuestButton kind="tab" selected={mobileTab === 'facts'} role="tab" aria-selected={mobileTab === 'facts'} onClick={() => setMobileTab('facts')}>{view === 'quests' ? 'Значок' : 'Находки'}{facts.length > 0 && view !== 'quests' && <span>{facts.length}</span>}</QuestButton></div> : <div className="qg-mobile-heading"><span>{view === 'title' ? GAME_SEO[titleMode].shortName : view === 'games' ? 'Все игры' : navItems.find(item => item.id === view)?.label ?? 'Компоненты'}</span><QuestButton kind="icon" aria-label="Настройки" onClick={() => open('settings')}><Settings size={22} /></QuestButton></div>)}
    <div className={`qg-layout${isShoditsaStudy ? ' study-layout' : ''}`}>
      {isShoditsaStudy && <StudyHeader Glyph={QuestGlyph} onHome={() => navigate('games')} onProfile={() => navigate('profile')} onSettings={() => open('settings')} />}
      {isShoditsaStudy && view === 'play' && <div className="qg-mobile-tabs" role="tablist" aria-label="Раздел игрового экрана"><QuestButton kind="tab" selected={mobileTab === 'game'} role="tab" aria-selected={mobileTab === 'game'} onClick={() => setMobileTab('game')}>Игра</QuestButton><QuestButton kind="tab" selected={mobileTab === 'facts'} role="tab" aria-selected={mobileTab === 'facts'} onClick={() => setMobileTab('facts')}>Находки{facts.length > 0 && <span>{facts.length}</span>}</QuestButton></div>}
      <main id="quest-main" className="qg-main">
      {view === 'games' ? <QuestGames tone={tone} /> : view === 'title' ? <QuestTitle mode={titleMode} onStart={startTitleGame} allGamesHref={homeGamesHref} /> : mobileTab === 'facts' && (!isShoditsaStudy || view === 'play') ? <div className="qg-mobile-facts"><h1>{view === 'quests' ? 'Твой следующий значок' : 'Уже сходится'}</h1>{view === 'quests' ? collection : <><p>Все подтверждённые признаки собраны здесь.</p><Facts attempts={attempts} /><QuestButton kind="outline" onClick={() => setMobileTab('game')}>Вернуться к игре</QuestButton></>}</div> : view === 'play' ? <>
        <header className={`qg-welcome${won ? ' qg-welcome--won' : ''}`}><div><span className="qg-welcome__kicker">Ежедневная загадка</span><h1>{won ? 'Сходится!' : 'Найди аниме дня'}</h1><p>{won ? 'Отличная работа. Ты нашёл ответ!' : 'Каждая версия открывает новые детали.'}</p></div><figure><span /><img src={mascot} alt="Маскот «Сходится!» с загадочной кинохлопушкой" width="200" height="200" /></figure></header>
        {finished ? <section className={`qg-outcome qg-card${won ? ' qg-outcome--won' : ''}`}><QuestGlyph name={won ? 'medal' : 'hint'} size={70} /><h2 id="qg-outcome-heading" tabIndex={-1}>{won ? `Угадано за ${ids.length} ${ids.length === 1 ? 'попытку' : ids.length < 5 ? 'попытки' : 'попыток'}!` : 'Сегодня не сошлось'}</h2><div><img src={image(answer)} width="78" height="110" alt="" /><span><strong>{answer.title}</strong><small>{answer.year}, {answer.original}</small></span></div><p>{won ? 'Каждая зацепка была важна. Продолжай в том же духе!' : 'Ты собрал хорошие зацепки. Следующая загадка обязательно поддастся.'}</p><QuestButton onClick={reset}>Сыграть заново<RotateCcw size={19} /></QuestButton><QuestButton kind="text" onClick={async () => { try { await navigator.clipboard.writeText(`Сходится! Аниме, ${won ? ids.length : 'X'}/10\nДемонстрационная игра`); setCopied(true); setMessage('Результат скопирован.') } catch { setMessage('Не удалось скопировать результат. Попробуй ещё раз.') } }}>{copied ? <Check size={18} /> : <Copy size={18} />}{copied ? 'Скопировано!' : 'Скопировать результат'}</QuestButton></section> : <Picker attempts={attempts} onSubmit={submit} query={draftQuery} setQuery={setDraftQuery} pending={draftPending} setPending={setDraftPending} />}
        {attempts.length > 0 ? <section className="qg-attempts"><div className="qg-section-head"><h2>Твои версии</h2><span className="qg-quiet">{ids.length} из 10</span></div><div>{[...attempts].reverse().map(entry => <Attempt key={entry.id} entry={entry} number={ids.indexOf(entry.id) + 1} open={entry.id === expanded} onToggle={() => setExpanded(current => current === entry.id ? '' : entry.id)} />)}</div></section> : <section className="qg-first-move qg-card"><QuestGlyph name="hint" size={56} /><div><h3>С чего начнём?</h3><p>Выбери знакомое аниме. Мы сравним год, жанры, студию и другие признаки.</p><QuestButton kind="text" onClick={() => open('rules')}>Как читать подсказки<ChevronRight size={17} /></QuestButton></div></section>}
      </> : view === 'quests' ? <><PageHeading title="Задания" description="Играй, находи совпадения и двигайся к разгадке." /><div className="qg-section-head"><h2>Задания дня</h2><span className="qg-time"><Clock3 size={18} />Сегодня</span></div><div className="qg-tasks">{primaryTasks}</div>{isShoditsaStudy ? <ApplicationContinueLink className="quest-button--primary qg-full">Продолжить игру<ArrowRight size={19} /></ApplicationContinueLink> : <QuestButton className="qg-full" onClick={() => navigate('play')}>Продолжить игру<ArrowRight size={19} /></QuestButton>}<div className="qg-section-head qg-collection-head"><h2>Следующий значок</h2><span className="qg-quiet">{goalsDone} из 3 заданий</span></div>{collection}</> : view === 'archive' ? <section className="qg-empty-page"><h1>Архив игр</h1><QuestGlyph name="archive" size={120} /><h2>История начинается сегодня</h2><p>Здесь будут прошлые загадки.<br />В этом макете можно пройти сегодняшнюю демонстрационную игру.</p><QuestButton onClick={() => navigate('play')}>К аниме дня<ArrowRight size={18} /></QuestButton></section> : view === 'league' ? <section className="qg-empty-page"><h1>Рейтинг</h1><QuestGlyph name="league" size={120} /><h2>Первая победа — первый шаг!</h2><p>Находи ответы и улучшай свой результат.<br />Этот экран показывает оформление рейтинга до начала соревнования.</p><QuestButton onClick={() => navigate('play')}>Продолжить игру<ArrowRight size={18} /></QuestButton></section> : view === 'profile' ? <section className="qg-profile"><div className="qg-profile__top">{isShoditsaStudy ? <StudyProfileIllustration /> : <QuestGlyph name="profile" size={104} />}<h1>Гость</h1><p>Твоя маленькая история больших догадок</p></div><h2>Текущая игра</h2><div className="qg-profile__stats"><div className="qg-card"><QuestGlyph name="flame" size={37} /><strong>{won ? 1 : 0}</strong><span>Побед</span></div><div className="qg-card"><QuestGlyph name="bolt" size={37} /><strong>{ids.length}</strong><span>Попыток</span></div><div className="qg-card"><QuestGlyph name="hint" size={37} /><strong>{facts.length}</strong><span>Признаков</span></div><div className="qg-card"><QuestGlyph name="quests" size={37} /><strong>{goalsDone}</strong><span>Задания</span></div></div><h2>Достижения</h2>{collection}<QuestButton kind="outline" className="qg-full" onClick={() => open('settings')}>Настройки{isShoditsaStudy ? <StudySettingsIcon size={24} /> : <Settings size={19} />}</QuestButton></section> : <section className="qg-kit"><h1>Компоненты Quest study</h1><p>Изолированный набор для проверки новой визуальной системы.</p><QuestButton>Проверить версию</QuestButton><QuestButton kind="outline">Продолжить</QuestButton><div className="qg-kit-promo"><QuestButton kind="promo">Играть сейчас</QuestButton></div>{isShoditsaStudy && <StudyThemeToggle />}<QuestButton disabled>Пока недоступно</QuestButton><QuestButton kind="choice" selected>Выбранная версия<Check size={20} /></QuestButton><QuestInput placeholder="Название аниме" aria-label="Пример поля" /><QuestProgress value={3} max={10} label="Пример прогресса" /><QuestButton onClick={() => open('rules')}>Открыть диалог</QuestButton></section>}
      {view !== 'title' && view !== 'games' && (!isShoditsaStudy || view === 'play') && <div className="qg-mobile-extra"><QuestButton kind="text" onClick={() => open('hint')}><QuestGlyph name="hint" size={25} />Подсказка</QuestButton><QuestButton kind="text" onClick={() => open('rules')}><BookOpen size={20} />Правила</QuestButton></div>}
    </main><StudyRightSidebar enabled={isShoditsaStudy} label={isShoditsaStudy ? studyAsideLabel(view) : "Прогресс и помощь"}>{view === 'games' ? <QuestGamesAside /> : view === 'title' ? <QuestTitleAside mode={titleMode} showDate={!isShoditsaStudy} /> : isShoditsaStudy && view !== 'play' ? <StudySectionAside view={view} homeHref={homeGamesHref ?? '#games'} goalsDone={goalsDone} factsFound={facts.length} onContinue={() => navigate('play')} /> : <>{!isShoditsaStudy && <div className="qg-stats"><span className="qg-mode"><QuestGlyph name="play" size={32} /><span>Аниме</span></span>{([{ id: 'streak', glyph: 'flame', value: won ? 1 : 0, label: 'Серия побед' }, { id: 'tickets', glyph: 'ticket', value: 15, label: 'Билеты' }, { id: 'attempts', glyph: 'heart', value: 10 - ids.length, label: 'Осталось попыток' }] as const).map(stat => <div className="qg-stat-wrap" key={stat.id}><QuestButton kind="icon" aria-label={`${stat.label}: ${stat.value}`} aria-expanded={popup === stat.id} onClick={event => togglePopup(stat.id, event.currentTarget)}><QuestGlyph name={stat.glyph} size={29} /><strong>{stat.value}</strong></QuestButton>{popup === stat.id && <div className="qg-popover qg-stat-popover" ref={popupRef}><QuestGlyph name={stat.glyph} size={58} /><h3>{stat.label}</h3><p>{stat.id === 'streak' ? 'Каждая разгаданная загадка — ещё один повод вернуться завтра.' : stat.id === 'tickets' ? '15 билетов — пример отображения баланса в макете. Покупки и списания здесь не выполняются.' : 'У тебя десять попыток на аниме. Проверяй версии и собирай зацепки.'}</p><QuestButton kind="text" onClick={() => setPopup(null)}>Понятно</QuestButton></div>}</div>)}</div>}
      <section className="qg-card qg-known-card"><div className="qg-side-head"><h2>Уже сходится</h2><QuestGlyph name="hint" size={43} /></div><Facts attempts={attempts} compact />{facts.length > 0 && <QuestButton kind="text" onClick={() => open('facts')}>Все находки<ChevronRight size={17} /></QuestButton>}</section>
      <section className="qg-card qg-hint-card"><div className="qg-side-head"><h2>Свежая идея?</h2><QuestGlyph name="bolt" size={44} /></div><p>{ids.length < 4 ? 'Подсказка откроется перед пятой попыткой. Ты уже на верном пути!' : 'Посмотри на загадку с другой стороны. Новая зацепка уже доступна.'}</p><QuestButton kind="outline" onClick={() => open('hint')}>{ids.length < 4 ? <><QuestGlyph name="lock" size={21} />О подсказках</> : 'Открыть подсказку'}</QuestButton></section>
      <section className="qg-card qg-sidebar-tasks"><div className="qg-section-head"><h2>Задания дня</h2><QuestButton kind="text" onClick={() => navigate('quests')}>Все</QuestButton></div><Task icon="quests" title="Сделай три попытки" value={ids.length} max={3} /></section>
      </>}{!isShoditsaStudy && <footer className="qg-footer"><a href={homeGamesHref ?? (isShoditsaStudy ? '#games' : '#play')}>{isShoditsaStudy ? 'Игры' : 'Играть'}</a><QuestButton kind="footer" onClick={() => open('rules')}>Правила</QuestButton><QuestButton kind="footer" onClick={() => open('source')}>О макете</QuestButton>{isShoditsaStudy && <div className="study-footer-theme"><StudyThemeToggle /></div>}<span>Локальный просмотр</span></footer>}
    </StudyRightSidebar></div>
    {dialog}
    <div className="qg-live" aria-live="polite" role="status">{message}</div>
  </div>
}

