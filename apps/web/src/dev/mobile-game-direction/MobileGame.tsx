import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronRight, CircleHelp, History, Lightbulb, LockKeyhole, Search, X } from 'lucide-react'
import { ActionButton, ActionLink, IconButton, TextButton, TextInput } from '../../components/ui/UiControls'
import { BottomSheet } from '../../components/ui/BottomSheet'
import { SelectionRow } from '../../components/ui/SelectionRow'
import { Mascot } from '../../components/mascot/Mascot'
import { publicAssetUrl } from '../../app/public-asset'
import type { Hint } from '../../types'
import { confirmedFacts, entries, initialIds, statusLabel, type DemoEntry } from './model'
import './mobile-game.css'

type Panel = 'search' | 'history' | 'matches' | 'all' | 'help' | 'hint' | null
const allowedPanels = ['search', 'history', 'matches', 'all', 'help', 'hint']
const poster = (entry: DemoEntry) => publicAssetUrl(entry.poster ?? '')

function Status({ hint }: { hint: Hint }) {
  const Icon = hint.status === 'match' ? Check : hint.direction === 'up' ? ArrowUp : hint.direction === 'down' ? ArrowDown : hint.status === 'miss' ? X : null
  return <span className={`mapp-status mapp-status--${hint.status}`} role="img" aria-label={statusLabel(hint)} title={statusLabel(hint)}>{Icon ? <Icon size={15} /> : <span>{hint.status === 'unknown' ? '?' : '≈'}</span>}</span>
}

function Comparison({ hint }: { hint: Hint }) {
  return <div className="mapp-comparison"><div><span>{hint.label === 'Shikimori' ? 'Рейтинг' : hint.label}</span>{hint.key === 'genres' ? <div className="mapp-genre-values">{hint.value.split(',').map(value => {
    const genre = value.trim()
    const matched = hint.matchedValues?.includes(genre)
    return <span key={genre} className={matched ? 'is-match' : undefined}>{matched && <Check size={12} aria-label="Совпадает" />}{genre}</span>
  })}</div> : <strong>{hint.value}</strong>}</div><Status hint={hint} /></div>
}

function SearchTask({ attempts, pending, onPending, confirmRef, inputRef }: { attempts: DemoEntry[]; pending: DemoEntry | null; onPending: (entry: DemoEntry | null) => void; confirmRef: RefObject<HTMLButtonElement | null>; inputRef: RefObject<HTMLInputElement | null> }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const resultsId = useId()
  const available = entries.filter(entry => !attempts.some(attempt => attempt.id === entry.id) && `${entry.title} ${entry.original}`.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')))
  return <div className="mapp-search-task"><div className="mapp-search-label"><Search size={18} /><label htmlFor={`${resultsId}-input`}>Название аниме</label></div><TextInput ref={inputRef} id={`${resultsId}-input`} type="search" role="combobox" aria-expanded="true" aria-controls={resultsId} aria-activedescendant={available[active] ? `${resultsId}-${available[active].id}` : undefined} aria-label="Название аниме" placeholder="Начни печатать название…" autoComplete="off" value={query} onChange={event => { setQuery(event.target.value); onPending(null); setActive(0) }} onKeyDown={event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive(value => Math.min(available.length - 1, value + 1)) }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActive(value => Math.max(0, value - 1)) }
    if (event.key === 'Enter' && available[active]) { event.preventDefault(); onPending(available[active]); requestAnimationFrame(() => confirmRef.current?.focus()) }
  }} /><p className="mapp-search-caption">{query ? `Найдено: ${available.length}` : 'Можно начать со знакомого тайтла'}</p><div className="mapp-search-results" role="listbox" id={resultsId} aria-label="Результаты поиска">{available.map((entry, index) => <SelectionRow title={entry.title} description={`${entry.original}, ${entry.year}`} leading={<img src={poster(entry)} width="43" height="60" alt="" />} selected={pending?.id === entry.id} highlighted={active === index} id={`${resultsId}-${entry.id}`} role="option" aria-selected={pending?.id === entry.id} key={entry.id} onMouseEnter={() => setActive(index)} onClick={() => onPending(entry)} />)}{!available.length && <p className="mapp-search-empty">В демонстрационном наборе такого тайтла нет. Попробуй «Ванпанчмен» или «Человек».</p>}</div></div>
}

export function MobileGame() {
  const query = new URLSearchParams(location.search)
  const [ids, setIds] = useState(query.has('empty') ? [] : initialIds)
  const [activeId, setActiveId] = useState(initialIds[2])
  const [panel, setPanel] = useState<Panel>(allowedPanels.includes(query.get('panel') ?? '') ? query.get('panel') as Panel : null)
  const [pending, setPending] = useState<DemoEntry | null>(null)
  const [hintOpened, setHintOpened] = useState(false)
  const [message, setMessage] = useState('')
  const confirmRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const contentRef = useRef<HTMLElement>(null)
  const attempts = ids.map(id => entries.find(entry => entry.id === id)!)
  const active = attempts.find(entry => entry.id === activeId) ?? attempts.at(-1)
  const facts = confirmedFacts(attempts)
  useEffect(() => { contentRef.current?.scrollTo({ top: 0 }) }, [active?.id])
  const open = (next: Panel) => { setPending(null); setPanel(next) }
  const close = () => setPanel(null)
  const submit = () => {
    if (!pending || ids.includes(pending.id)) return
    setIds(previous => [...previous, pending.id]); setActiveId(pending.id); setMessage(`Версия «${pending.title}» проверена. Попытка ${ids.length + 1} из 10.`); setPending(null); close()
  }
  const title = panel === 'search' ? 'Твоя следующая версия' : panel === 'history' ? 'Твои попытки' : panel === 'matches' ? 'Что уже сходится' : panel === 'all' ? 'Сравнение по признакам' : panel === 'hint' ? 'Свежая идея' : 'Как найти аниме'
  const description = panel === 'search' ? 'Выбери тайтл и проверь свою догадку.' : panel === 'history' ? `${attempts.length} из 10, нажми, чтобы посмотреть сравнение` : panel === 'matches' ? 'Собрали подтверждённые детали из твоих ответов.' : panel === 'all' ? active?.title : undefined
  return <div className="mapp"><header className="mapp-bar"><ActionLink variant="ghost" href="mobile-game-direction.html" target="_top" aria-label="К обзору направления"><ArrowLeft size={21} /></ActionLink><div><h1>Аниме дня</h1><span>Демо, ежедневная загадка</span></div><IconButton label="Как играть" onClick={() => open('help')}><CircleHelp size={21} /></IconButton></header><div className="mapp-progress"><div><span>{ids.length ? `Попытка ${ids.length} из 10` : 'Впереди 10 попыток'}</span><span>{10 - ids.length} осталось</span></div><div className="mapp-progress__steps" role="progressbar" aria-label="Использовано попыток" aria-valuemin={0} aria-valuemax={10} aria-valuenow={ids.length}>{Array.from({ length: 10 }, (_, index) => <span className={index < ids.length ? 'is-used' : ''} key={index} />)}</div></div><main className="mapp-content" ref={contentRef}>{active ? <><section className="mapp-answer"><div className="mapp-answer__eyebrow">{active.id === ids.at(-1) ? 'Последняя версия' : `Версия ${ids.indexOf(active.id) + 1}`}</div><div className="mapp-answer__identity"><div className="mapp-answer__poster"><img src={poster(active)} width="74" height="106" alt={`Постер «${active.title}»`} /></div><div><h2>{active.title}</h2><p>{active.year}, {active.hints.find(hint => hint.key === 'anime_kind')?.value}</p><span className="mapp-answer__matches"><Check size={14} />Совпадений: {active.hints.filter(hint => hint.status === 'match').length}</span></div></div></section><section className="mapp-findings"><header><h3>Что узнали</h3><TextButton onClick={() => open('all')}>Все {active.hints.length}<ChevronRight size={14} /></TextButton></header><div className="mapp-findings__grid">{['anime_kind', 'studio', 'episodes', 'shiki'].map(key => { const hint = active.hints.find(item => item.key === key); return hint ? <Comparison key={key} hint={hint} /> : null })}</div>{active.hints.find(hint => hint.key === 'genres') && <div className="mapp-findings__genres"><Comparison hint={active.hints.find(hint => hint.key === 'genres')!} /></div>}</section><ActionButton variant="secondary" className="mapp-fact-link" onClick={() => open('matches')}><span className="mapp-fact-link__icon"><Lightbulb size={19} /></span><span><strong>Уже кое-что сходится</strong><small>Подтверждённых деталей: {facts.length}</small></span><ChevronRight size={18} /></ActionButton>{attempts.length > 1 && <section className="mapp-history-preview"><header><h3>Предыдущие версии</h3><TextButton onClick={() => open('history')}>Все<ChevronRight size={14} /></TextButton></header><div>{[...attempts].reverse().filter(entry => entry.id !== active.id).slice(0, 2).map(entry => <SelectionRow key={entry.id} compact title={entry.title} leading={<img src={poster(entry)} alt="" width="27" height="38" />} onClick={() => setActiveId(entry.id)} />)}</div></section>}</> : <section className="mapp-empty"><div><span className="mapp-empty__blob" /><Mascot pose="think" width={150} height={150} alt="Персонаж задумался над первой версией" /></div><h2>Какое аниме<br />мы загадали?</h2><p>Начни со знакомого тайтла.<br />Каждый ответ откроет новые детали.</p><ul><li><Check size={15} />Ищи совпадения</li><li><ArrowUp size={15} />Следи за стрелками</li></ul></section>}</main><footer className="mapp-dock"><div className="mapp-dock__tools"><TextButton onClick={() => open('history')}><History size={18} />Попытки, {ids.length}</TextButton><TextButton onClick={() => open('hint')}><Lightbulb size={18} />Подсказка{ids.length < 4 && <LockKeyhole size={12} />}</TextButton></div><ActionButton onClick={() => open('search')} disabled={ids.length >= entries.length}><Search size={19} />{ids.length ? 'Предложить версию' : 'Выбрать аниме'}<ArrowRight size={19} /></ActionButton></footer>{panel && <BottomSheet initialFocusRef={panel === 'search' ? inputRef : undefined} title={title} description={description} onClose={close} footer={panel === 'search' ? <><div className="mapp-confirm-note">{pending ? pending.title : 'Проверка использует одну попытку'}</div><ActionButton ref={confirmRef} disabled={!pending} onClick={submit}>Проверить версию<ArrowRight size={18} /></ActionButton></> : undefined}>
      {panel === 'search' && <SearchTask attempts={attempts} pending={pending} onPending={setPending} confirmRef={confirmRef} inputRef={inputRef} />}
      {panel === 'history' && <div className="mapp-history-list">{[...attempts].reverse().map(entry => <SelectionRow title={entry.title} description={`Попытка ${ids.indexOf(entry.id) + 1}, ${entry.year}`} leading={<img src={poster(entry)} width="43" height="60" alt="" />} selected={entry.id === active?.id} aria-pressed={entry.id === active?.id} key={entry.id} onClick={() => { setActiveId(entry.id); close() }} />)}{!attempts.length && <p className="mapp-sheet-empty">После первой версии здесь появится история.</p>}</div>}
      {panel === 'matches' && <div className="mapp-facts-list">{facts.map(fact => <div key={fact.key}><span><Check size={16} /></span><div><small>{fact.label}</small><strong>{fact.values.join(', ')}</strong></div></div>)}{!facts.length && <p className="mapp-sheet-empty">Начни с любой версии. Здесь соберутся совпадения.</p>}<p className="mapp-sheet-note">Эти детали можно учитывать в следующей версии.</p></div>}
      {panel === 'all' && active && <div className="mapp-all-comparisons">{active.hints.map(hint => <Comparison key={hint.key} hint={hint} />)}</div>}
      {panel === 'help' && <div className="mapp-help"><Mascot pose="welcome" width={100} height={100} alt="" /><p>У тебя десять попыток. Выбирай знакомое аниме и сравнивай его с загаданным.</p><div><Check size={19} /><span><strong>Значение совпало</strong><small>Этот признак подходит.</small></span></div><div><span>≈</span><span><strong>Есть что-то общее</strong><small>Совпала часть жанров или значений.</small></span></div><div><ArrowUp size={19} /><span><strong>Стрелка задаёт направление</strong><small>Вверх — у ответа число больше. Вниз — меньше.</small></span></div><ActionButton variant="secondary" onClick={() => { setIds([]); setMessage('Демонстрация начата с первого экрана.'); close() }}>Показать начало игры</ActionButton></div>}
      {panel === 'hint' && <div className="mapp-hint"><Mascot pose="think" width={120} height={120} alt="" /><h3>{ids.length < 4 ? 'Ещё немного — и будет зацепка' : 'Посмотрим с другой стороны'}</h3><p>{ids.length < 4 ? 'Дополнительная подсказка откроется перед пятой попыткой.' : 'В этом макете можно открыть демонстрационную подсказку.'}</p><ActionButton variant="secondary" disabled={ids.length < 4} onClick={() => setHintOpened(true)}>Открыть подсказку<Lightbulb size={17} /></ActionButton>{hintOpened && <p role="status" className="mapp-hint__message">Пример: попробуй тайтл с теми жанрами, которые уже совпали.</p>}</div>}
    </BottomSheet>}<div className="mapp-sr-only" role="status" aria-live="polite">{message}</div></div>
}
