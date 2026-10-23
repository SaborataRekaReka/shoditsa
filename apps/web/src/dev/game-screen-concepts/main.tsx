import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronDown, CircleHelp, Lightbulb, Menu, RotateCcw, Ticket, UserRound, X } from 'lucide-react'
import { BrandWordmark } from '../../components/app-shell/BrandWordmark'
import { Mascot } from '../../components/mascot/Mascot'
import { ReferenceIcon } from '../../components/ui/ReferenceIcon'
import { ActionButton, ActionLink, TextButton } from '../../components/ui/UiControls'
import { Tabs } from '../../components/ui/Tabs'
import { SegmentedProgress } from '../../components/ui/Progress'
import { SearchCombobox } from '../../components/search-combobox/SearchCombobox'
import { publicAssetUrl } from '../../app/public-asset'
import type { Hint } from '../../types'
import examplesJson from './examples.json'
import '../../styles/reference-tokens.css'
import '../../components/search-combobox/SearchCombobox.reference.css'
import './concepts.css'

type Example = Omit<typeof examplesJson[number], 'hints'> & { hints: Hint[] }
const examples = examplesJson as Example[]
const initialIds = examples.slice(0, 3).map(item => item.id)
const screenOnly = new URLSearchParams(location.search).has('screen')
const fields = ['anime_kind', 'studio', 'episodes', 'shiki', 'genres']
const directions = [
  { id: 'console', name: 'Пульт', promise: 'Все сравнения перед глазами', description: 'Один центр управления: ввод сверху, найденные признаки рядом и компактная таблица ответов.', accent: 'mint' },
  { id: 'journal', name: 'Лента', promise: 'Каждая попытка — следующий шаг', description: 'Новый ответ появляется в ленте. Поиск всегда под рукой, а прогресс и подсказки вынесены в узкую колонку.', accent: 'blue' },
  { id: 'case', name: 'Досье', promise: 'Собирай портрет ответа', description: 'В центре — уже известные факты. Справа проверяется новая гипотеза, история остаётся под досье.', accent: 'lilac' },
] as const
type Direction = typeof directions[number]['id']
type View = Direction | 'overview'
const currentView = (): View => directions.some(item => item.id === location.hash.slice(1)) ? location.hash.slice(1) as Direction : 'overview'
const imageUrl = (source: string | null) => source ? publicAssetUrl(source) : undefined
const labelForStatus = (hint: Hint) => hint.status === 'match' ? 'Совпадает' : hint.direction === 'up' ? 'Ответ больше' : hint.direction === 'down' ? 'Ответ меньше' : hint.status === 'partial' ? 'Есть общее' : hint.status === 'unknown' ? 'Нет данных' : 'Не совпало'

function MatchIcon({ hint }: { hint: Hint }) {
  const Icon = hint.status === 'match' ? Check : hint.direction === 'up' ? ArrowUp : hint.direction === 'down' ? ArrowDown : hint.status === 'miss' ? X : null
  return <span className={`gc-match-icon gc-match-icon--${hint.status}`} aria-label={labelForStatus(hint)} title={labelForStatus(hint)}>{Icon ? <Icon size={13} /> : <span>{hint.status === 'unknown' ? '?' : '≈'}</span>}</span>
}

function HintValue({ hint, showLabel = true }: { hint: Hint; showLabel?: boolean }) {
  return <span className="gc-hint-value">{showLabel && <small>{hint.label}</small>}<span><MatchIcon hint={hint} /><strong>{hint.value}</strong></span></span>
}

function FullComparison({ example }: { example: Example }) {
  return <details className="gc-all-hints"><summary>Все признаки · {example.hints.length}<ChevronDown size={14} /></summary><div>{example.hints.map(hint => <HintValue key={hint.key} hint={hint} />)}</div></details>
}

function KnownFacts({ attempts, board = false }: { attempts: Example[]; board?: boolean }) {
  const seen = new Map<string, { label: string; values: string[] }>()
  for (const example of attempts) for (const hint of example.hints) {
    // Numeric matches may include a tolerance, so they are not confirmed facts.
    const values = hint.matchedValues?.length ? hint.matchedValues : hint.status === 'match' && ['anime_kind', 'anime_status', 'studio', 'age'].includes(hint.key) ? [hint.value] : []
    if (values.length) seen.set(hint.key, { label: hint.label, values: [...new Set([...(seen.get(hint.key)?.values ?? []), ...values])] })
  }
  const facts = [...seen.entries()]
  if (board) return <div className="gc-fact-board">
    {[['anime_kind', 'Формат'], ['studio', 'Студия'], ['genres', 'Жанры'], ['anime_status', 'Статус'], ['episodes', 'Эпизоды'], ['shiki', 'Рейтинг']].map(([key, label]) => {
      const fact = seen.get(key)
      return <div className={`gc-fact-card${fact ? '' : ' gc-fact-card--unknown'}`} key={key}><span>{fact && <Check size={15} />}{label}</span><strong>{fact ? fact.values.join(', ') : 'Пока неизвестно'}</strong>{!fact && <span className="gc-unknown-line" />}</div>
    })}
  </div>
  return <div className="gc-known"><span>Уже сходится</span>{facts.length ? facts.slice(0, 5).map(([key, fact]) => <span className="gc-known__fact" key={key}><Check size={13} />{fact.values.join(', ')}</span>) : <p>Совпавшие признаки появятся после первого ответа.</p>}</div>
}

function DemoSearch({ attempts, onAdd, placement = 'top' }: { attempts: Example[]; onAdd: (id: string) => void; placement?: 'top' | 'bottom' }) {
  const id = useId()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const suggestions = examples.filter(item => !attempts.some(attempt => attempt.id === item.id) && item.title.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru'))).slice(0, 5)
  const select = (example: Example) => { onAdd(example.id); setQuery(''); setActive(0) }
  return <div className={`gc-search search-area gc-search--${placement}`}>
    <label htmlFor={id}>{attempts.length ? 'Следующая версия' : 'С какого аниме начнём?'}</label>
    <SearchCombobox inputProps={{ id, value: query, autoComplete: 'off', placeholder: 'Название аниме…', 'aria-label': 'Название аниме', onChange: event => { setQuery(event.target.value); setActive(0) }, onKeyDown: event => {
      if (event.key === 'Escape') setQuery('')
      if (event.key === 'ArrowDown') { event.preventDefault(); setActive(value => Math.min(suggestions.length - 1, value + 1)) }
      if (event.key === 'ArrowUp') { event.preventDefault(); setActive(value => Math.max(0, value - 1)) }
      if (event.key === 'Enter' && query.trim() && suggestions[active]) { event.preventDefault(); select(suggestions[active]) }
    } }} open={!!query.trim()} suggestions={suggestions} activeIndex={active} submitDisabled={!query.trim() || !suggestions.length} onSubmit={() => { if (suggestions[active]) select(suggestions[active]) }} onSuggestionSelect={select} onSuggestionHover={(_, index) => setActive(index)} getSuggestionKey={item => item.id} emptyMessage="В демонстрационном наборе такого тайтла нет." renderSuggestion={item => <><img src={imageUrl(item.poster)} alt="" width="32" height="44" /><span><strong>{item.title}</strong><small>{item.year}</small></span><ArrowRight size={15} /></>} />
    <span className="gc-search__note">Для примера: {examples.find(item => !attempts.some(attempt => attempt.id === item.id))?.title ?? 'все примеры уже проверены'}</span>
  </div>
}

function Rules() {
  return <details className="gc-rules"><summary><CircleHelp size={16} />Как читать подсказки<ChevronDown size={14} /></summary><div><p>Предложи аниме. Каждый ответ сравнивается с загаданным тайтлом.</p><span><Check size={14} />Признак совпал</span><span>≈ Есть общие значения</span><span><ArrowUp size={14} />Загаданное число больше</span><span><ArrowDown size={14} />Загаданное число меньше</span><span><X size={14} />Признак не совпал</span></div></details>
}

function ExtraHint({ count }: { count: number }) {
  const [open, setOpen] = useState(false)
  return <section className="gc-assist"><div><Lightbulb size={19} /><span>Свежая идея</span></div><p>{count < 4 ? `Ещё ${4 - count} ${count === 3 ? 'ответ' : 'ответа'} — и можно открыть подсказку.` : 'Дополнительная зацепка уже доступна.'}</p><ActionButton variant="secondary" size="compact" disabled={count < 4} onClick={() => setOpen(value => !value)}>{open ? 'Скрыть пример' : 'Открыть подсказку'}<ArrowRight size={15} /></ActionButton>{open && <p className="gc-assist__opened" role="status">Пример подсказки: обрати внимание на жанры, которые уже совпали.</p>}</section>
}

function EmptyGame({ variant }: { variant: Direction }) {
  return <div className={`gc-empty gc-empty--${variant}`}><img src={publicAssetUrl('images/home-doodle/anime.webp')} alt="" width="120" height="120" /><h3>{variant === 'case' ? 'Соберём портрет неизвестного аниме' : 'Первая версия может быть любой'}</h3><p>Вспомни знакомый тайтл. Совпадения и стрелки подскажут, куда двигаться дальше.</p></div>
}

function AttemptTable({ attempts }: { attempts: Example[] }) {
  return <div className="gc-attempt-table"><div className="gc-table-labels" aria-hidden="true"><span>Твоя версия</span><span>Формат</span><span>Студия</span><span>Эпизоды</span><span>Рейтинг</span></div>{[...attempts].reverse().map((example, index) => <article className="gc-table-row" key={example.id} data-latest={index === 0}><div className="gc-title-cell"><img src={imageUrl(example.poster)} alt="" width="38" height="53" /><div><h3>{example.title}</h3><small>{example.year} · версия {attempts.length - index}</small></div></div>{fields.slice(0, 4).map(key => { const hint = example.hints.find(item => item.key === key); return hint && <HintValue key={key} hint={hint} /> })}<FullComparison example={example} /></article>)}</div>
}

function AttemptFeed({ attempts }: { attempts: Example[] }) {
  return <div className="gc-feed">{[...attempts].reverse().map((example, index) => <article className="gc-feed-card" key={example.id} data-latest={index === 0}><header><span className="gc-feed__step">{attempts.length - index}</span><img src={imageUrl(example.poster)} width="42" height="58" alt="" /><div><small>{index === 0 ? 'Последняя версия' : 'Твоя версия'}</small><h3>{example.title}</h3><p>{example.original} · {example.year}</p></div><span className="gc-feed__score"><Check size={13} />{example.hints.filter(hint => hint.status === 'match').length} совпало</span></header><div className="gc-feed__hints">{fields.map(key => { const hint = example.hints.find(item => item.key === key); return hint && <HintValue key={key} hint={hint} /> })}</div><FullComparison example={example} /></article>)}</div>
}

function History({ attempts }: { attempts: Example[] }) {
  return <div className="gc-history">{[...attempts].reverse().map(example => <details key={example.id}><summary><img src={imageUrl(example.poster)} width="26" height="36" alt="" /><span>{example.title}</span><small>{example.hints.filter(hint => hint.status === 'match').length} совпало</small><ChevronDown size={15} /></summary><div className="gc-history__hints">{example.hints.map(hint => <HintValue key={hint.key} hint={hint} />)}</div></details>)}</div>
}

function ScreenChrome() {
  return <header className="gc-screen-chrome"><BrandWordmark variant="compact" /><span>Демо · Аниме</span><div><span className="gc-wallet"><Ticket size={15} />15</span><span className="gc-avatar"><UserRound size={17} /></span><Menu size={19} /></div></header>
}

function ConsoleScreen({ attempts, search }: { attempts: Example[]; search: ReactNode }) {
  return <div className="gc-console"><header className="gc-console__header"><div><span className="gc-eyebrow"><ReferenceIcon name="anime" size={18} />Ежедневная загадка</span><h1>Аниме дня</h1></div><div className="gc-console__progress"><SegmentedProgress value={attempts.length} label="Твои попытки" /></div></header><section className="gc-console__composer"><div><h2>Есть версия?</h2><p>Проверяй догадки. Собирай совпадения.</p></div>{search}</section><KnownFacts attempts={attempts} /><section className="gc-console__history"><div className="gc-section-title"><h2>Твои версии</h2><Rules /></div>{attempts.length ? <AttemptTable attempts={attempts} /> : <EmptyGame variant="console" />}</section><div className="gc-console__bottom"><span><Lightbulb size={16} />Подсказки откроются перед 5-й и 8-й попытками.</span><span>Новая загадка каждый день</span></div></div>
}

function JournalScreen({ attempts, search }: { attempts: Example[]; search: ReactNode }) {
  return <div className="gc-journal"><aside className="gc-journal__rail"><span className="gc-eyebrow"><ReferenceIcon name="anime" size={18} />Ежедневная загадка</span><h1>Аниме дня</h1><p>Одна хорошая версия<br />может всё прояснить.</p><SegmentedProgress value={attempts.length} label="Твои попытки" /><div className="gc-journal__art"><img src={publicAssetUrl('images/home-doodle/anime.webp')} alt="" width="150" height="150" /><span>Уже ближе!</span></div></aside><div className="gc-journal__main"><div className="gc-section-title"><h2>{attempts.length ? 'Идём по следу' : 'Начнём со знакомого тайтла'}</h2><span>{attempts.length ? `${10 - attempts.length} попыток впереди` : 'Впереди 10 попыток'}</span></div><KnownFacts attempts={attempts} />{attempts.length ? <AttemptFeed attempts={attempts} /> : <EmptyGame variant="journal" />}<div className="gc-journal__composer">{search}</div></div><aside className="gc-journal__tools"><ExtraHint count={attempts.length} /><Rules /></aside></div>
}

function CaseScreen({ attempts, search }: { attempts: Example[]; search: ReactNode }) {
  return <div className="gc-case"><header className="gc-case__header"><div><span className="gc-eyebrow"><ReferenceIcon name="search" size={18} />Собираем по деталям</span><h1>Какое аниме загадано?</h1></div><span className="gc-case__counter"><strong>{10 - attempts.length}</strong> попыток осталось</span></header><div className="gc-case__grid"><section className="gc-case__dossier"><header><div><span className="gc-case__file"><ReferenceIcon name="anime" size={26} /></span><div><h2>Портрет ответа</h2><p>{attempts.length ? 'Эти факты уже подтверждены.' : 'Пока здесь только вопросы.'}</p></div></div><span className="gc-case__mystery" aria-hidden="true">?</span></header><KnownFacts attempts={attempts} board /><div className="gc-case__note"><Mascot pose="think" width={85} height={85} alt="" /><p>{attempts.length ? 'Отталкивайся от того, что уже сходится.' : 'Начни с любимого аниме — зацепки найдутся.'}</p></div></section><aside className="gc-case__workbench"><div className="gc-case__search"><h2>Проверим гипотезу</h2>{search}</div><ExtraHint count={attempts.length} /><Rules /></aside></div><section className="gc-case__history"><div className="gc-section-title"><h2>Проверенные версии</h2><span>{attempts.length} из 10</span></div>{attempts.length ? <History attempts={attempts} /> : <p className="gc-history-empty">Первый ответ появится здесь.</p>}</section></div>
}

function ConceptScreen({ variant, attempts, onAdd }: { variant: Direction; attempts: Example[]; onAdd: (id: string) => void }) {
  const search = <DemoSearch attempts={attempts} onAdd={onAdd} placement={variant === 'journal' ? 'bottom' : 'top'} />
  return <div className={`gc-canvas gc-canvas--${variant}`}><div className="gc-screen"><ScreenChrome />{variant === 'console' ? <ConsoleScreen attempts={attempts} search={search} /> : variant === 'journal' ? <JournalScreen attempts={attempts} search={search} /> : <CaseScreen attempts={attempts} search={search} />}</div></div>
}

function Preview({ variant }: { variant: Direction }) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(340)
  useEffect(() => { const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width)); if (ref.current) observer.observe(ref.current); return () => observer.disconnect() }, [])
  return <div ref={ref} className="gc-preview" style={{ height: width * 770 / 1040 }}><div className="gc-preview__scaled" style={{ width: 1040, transform: `scale(${width / 1040})` }} inert aria-hidden="true"><ConceptScreen variant={variant} attempts={examples.slice(0, 3)} onAdd={() => undefined} /></div></div>
}

function App() {
  const [view, setView] = useState<View>(currentView)
  const [ids, setIds] = useState(initialIds)
  const [announcement, setAnnouncement] = useState('')
  useEffect(() => { const update = () => { setView(currentView()); window.scrollTo({ top: 0 }) }; window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update) }, [])
  const attempts = ids.map(id => examples.find(item => item.id === id)!)
  const add = (id: string) => { if (!ids.includes(id) && ids.length < 10) { setIds(previous => [...previous, id]); setAnnouncement(`Версия «${examples.find(item => item.id === id)?.title}» добавлена. Это демонстрация, прогресс игры не изменён.`) } }
  const direction = directions.find(item => item.id === view)
  if (screenOnly && view !== 'overview') return <div className="gc-screen-only"><ConceptScreen variant={view} attempts={attempts} onAdd={add} /><a className="gc-screen-only__back" href={`game-screen-concepts.html#${view}`}><ArrowLeft size={14} />К концептам</a><div className="gc-sr-only" role="status" aria-live="polite">{announcement}</div></div>
  return <div className="gc-study"><header className="gc-study__bar"><a href="/?preview=reference#/play/anime?preview=reference" className="gc-study__back"><ArrowLeft size={17} />К игре</a><nav aria-label="Концепты экрана"><a href="#overview" aria-current={view === 'overview' ? 'page' : undefined}>Обзор</a>{directions.map(item => <a href={`#${item.id}`} key={item.id} aria-current={view === item.id ? 'page' : undefined}>{item.name}</a>)}</nav><span>Локальные концепты</span></header>{view === 'overview' ? <main className="gc-overview"><div className="gc-overview__intro"><span>Игровой экран / Аниме</span><h1>Как будет выглядеть игра?</h1><p>Три композиции на одном наборе ответов. Открой любую и попробуй поиск.</p></div><div className="gc-overview__grid">{directions.map(item => <article key={item.id}><a className="gc-overview__preview" href={`#${item.id}`} aria-label={`Открыть концепт «${item.name}»`}><Preview variant={item.id} /></a><div className="gc-overview__copy"><span>{item.promise}</span><h2>{item.name}</h2><p>{item.description}</p><ActionLink variant="secondary" href={`#${item.id}`}>Посмотреть экран<ArrowRight size={16} /></ActionLink></div></article>)}</div><p className="gc-study__notice">Это отдельные демонстрации дизайна. Ответ дня, билеты и сохранённая игра не затрагиваются.</p></main> : <main className="gc-study__direction"><div className="gc-direction-head"><div><span>{direction!.promise}</span><h2>{direction!.name}</h2><p>{direction!.description}</p></div><div className="gc-direction-head__states"><ActionLink variant="ghost" href={`?screen=1#${view}`}>Только экран<ArrowRight size={14} /></ActionLink><Tabs surface="paper" label="Состояние демонстрации" value={ids.length ? 'played' : 'empty'} items={[{ id: 'empty', label: 'До ответа' }, { id: 'played', label: 'После 3 ответов' }]} onChange={value => { setIds(value === 'empty' ? [] : initialIds); setAnnouncement('') }} />{ids.length > 3 && <TextButton onClick={() => { setIds(initialIds); setAnnouncement('') }}><RotateCcw size={14} />Сбросить пример</TextButton>}</div></div><ConceptScreen variant={view} attempts={attempts} onAdd={add} /><p className="gc-study__notice">Демонстрационный поиск по восьми тайтлам. Ответы и сравнения взяты из публичного каталога, к загадке дня этот пример не относится.</p></main>}<div className="gc-sr-only" role="status" aria-live="polite">{announcement}</div></div>
}

const root = createRoot(document.getElementById('root')!)
root.render(<App />)
import.meta.hot?.dispose(() => root.unmount())
