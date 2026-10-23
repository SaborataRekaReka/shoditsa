import { publicAssetUrl } from '../../app/public-asset'
/** Local visual alternatives. Not an application entry, session or checkout. */
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowDown, ArrowRight, ChevronLeft, Menu, Ticket } from 'lucide-react'
import { ActionButton, ActionLink } from '../../components/ui/UiControls'
import { ReferenceIcon, type ReferenceIconName } from '../../components/ui/ReferenceIcon'
import { BrandWordmark } from '../../components/app-shell/BrandWordmark'
import { GameArtifactSeoDetails } from '../../components/seo-content/SeoContent'
import { GameOption, GameOptionSelect } from '../../components/game-launch-controls/GameLaunchControls'
import { MODE_PRESENTATION } from '../../app/mode-presentation'
import '../../styles/reference-tokens.css'
import '../../components/game-launch-controls/GameLaunchControls.reference.css'
import '../club-directions/study.css'
import './game-study.css'

const home = '/?preview=reference#/?preview=reference'
const referenceOne = new URL('../../../../../qa/club-directions-2026-10-16/home-screen-1.png', import.meta.url).href
const clubA = new URL('../../../../../qa/club-directions-2026-10-16/a-hero-desktop.png', import.meta.url).href
const options = [
  { id: 'a1', name: 'Загадка рядом', short: 'Текст · открытый рисунок · жёлтый блок запуска', description: 'Перенос трёхчастной сцены главной: описание слева, рисунок в центре, запуск и период справа. Сразу за вступлением — цветные карточки правил.' },
  { id: 'a2', name: 'Сцена и полоса запуска', short: 'Большой рисунок · общая полоса действий', description: 'Заголовок и рисунок образуют свободную сцену. Ниже отдельная пастельная полоса собирает попытки, период и запуск. Правила остаются открытыми.' },
  { id: 'a3', name: 'Большая игровая карточка', short: 'Цельная цветная поверхность · всё для начала внутри', description: 'Развитие карточек игр со второго экрана главной: большой рисунок и действия собраны в одной лиловой карточке. Пояснения идут ниже на открытом фоне.' },
] as const
type Variant = typeof options[number]['id']
const query = new URLSearchParams(location.search)
const selected = query.get('view') ?? 'compare'
const embed = query.has('embed')
const isVariant = (id: string): id is Variant => options.some(item => item.id === id)
const criteria: Array<{ text: string; icon: ReferenceIconName }> = [
  { text: 'Год', icon: 'calendar' }, { text: 'Жанры', icon: 'movie' },
  { text: 'Актёры', icon: 'user' }, { text: 'Страна', icon: 'globe' }, { text: 'Рейтинг', icon: 'idea' },
]

function StudyBar() {
  return <nav className="study-nav" aria-label="Варианты старта игры"><a className="study-nav__title" href="/game-directions.html?preview=reference">Старт игры / направление A</a><div>{[['compare','Сравнить'],['a1','A1'],['a2','A2'],['a3','A3'],['reference','Эталон']].map(([id,label]) => <a key={id} href={`?preview=reference&view=${id}`} aria-current={selected===id?'page':undefined}>{label}</a>)}</div><a href="/club-directions.html?view=a">Выбранный клуб A</a></nav>
}
export function Header() {
  const [open,setOpen]=useState(false)
  const menuRef=useRef<HTMLDivElement>(null)
  const triggerRef=useRef<HTMLButtonElement>(null)
  useEffect(()=>{
    if(!open)return
    const outside=(event:PointerEvent)=>{if(!menuRef.current?.contains(event.target as Node))setOpen(false)}
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOpen(false);triggerRef.current?.focus()}}
    window.addEventListener('pointerdown',outside)
    window.addEventListener('keydown',escape)
    return()=>{window.removeEventListener('pointerdown',outside);window.removeEventListener('keydown',escape)}
  },[open])
  return <header className="club-study-header"><div className="study-container"><a href={home} aria-label="Сходится! — на главную"><BrandWordmark /></a><div className="club-study-header__actions"><span className="club-study-wallet"><Ticket size={17}/><b>15</b><span>билетов</span><i/><ReferenceIcon name="flame" size={17}/>1</span><span className="club-study-guest"><ReferenceIcon name="user" size={20}/>Гость</span><div ref={menuRef} className="club-study-menu"><button type="button" ref={triggerRef} aria-label="Открыть меню" aria-expanded={open} aria-controls="study-header-menu" onClick={()=>setOpen(!open)}><Menu size={23}/></button>{open&&<nav id="study-header-menu" aria-label="Навигация" onClick={()=>setOpen(false)}><a href={home}>Все игры</a><a href="#study-rules">Как играть</a><a href="/club-directions.html?view=a">Клуб: выбранный вариант A</a></nav>}</div></div></div></header>
}
export function Footer() {
  return <footer className="club-study-footer"><div className="study-container"><div><BrandWordmark variant="footer"/><p>Немного любопытства, одна хорошая догадка —<br/>и маленькое открытие каждый день.</p></div><a href={home}>Во что сыграем?<ArrowRight size={20}/></a><span className="club-study-footer__note">До новой загадки!</span></div></footer>
}
function Edition() {
  return <div className="game-study-edition"><span><ReferenceIcon name="movie" size={20}/>Фильмы <i>·</i> Загадка № 289</span><time dateTime="2026-10-16"><ReferenceIcon name="calendar" size={18}/>16 октября</time></div>
}
function FilmArt() {
  return <figure className="game-study-art"><img src={publicAssetUrl('images/home-doodle/movie.webp')} width="500" height="500" alt=""/></figure>
}
function Copy({ onRules }: { onRules: () => void }) {
  return <div className="game-study-copy"><h1>Угадай фильм.</h1><p>{MODE_PRESENTATION.movie.description} Каждый ответ приближает к разгадке.</p><a href="#study-rules" className="game-study-rules-link" onClick={event=>{event.preventDefault();onRules()}}><ReferenceIcon name="guide" size={22}/>Как играть?<ArrowDown size={17}/></a></div>
}
function Facts() {
  return <div className="game-study-facts"><span><strong>10</strong> попыток</span><span><ReferenceIcon name="idea" size={19}/>новая загадка каждый день</span></div>
}
function Launch({ onStart }: { onStart: () => void }) {
  const [period, setPeriod] = useState('Все годы')
  return <div className="game-study-launch"><ActionButton className="game-study-start" onClick={onStart}>Начать игру<kbd>Enter</kbd><ArrowRight size={18}/></ActionButton><GameOptionSelect label="Период" labelIcon={<ReferenceIcon name="calendar" size={20}/>} value={period} menuLabel="Выберите период" endLabel={<><Ticket size={14}/>15</>}>{close=><GameOption title="Все годы" selected={period==='Все годы'} icon={<ReferenceIcon name="calendar" size={24}/>} onSelect={()=>{setPeriod('Все годы');close()}}/>}</GameOptionSelect></div>
}
function Criteria() {
  return <section className="game-study-criteria" aria-labelledby="study-criteria-heading"><h2 id="study-criteria-heading">Что сравниваем</h2><div>{criteria.map(item=><div key={item.text}><ReferenceIcon name={item.icon} size={26}/><span>{item.text}</span></div>)}</div></section>
}
export function Hero({ variant, onStart, onRules }: { variant: Variant; onStart: () => void; onRules: () => void }) {
  if(variant==='a1') return <><Edition/><section className="game-study-hero"><Copy onRules={onRules}/><FilmArt/><aside className="game-study-daily" aria-labelledby="study-daily-heading"><h2 id="study-daily-heading">Загадка дня</h2><Facts/><Launch onStart={onStart}/></aside></section><Criteria/></>
  if(variant==='a2') return <><Edition/><section className="game-study-hero"><Copy onRules={onRules}/><FilmArt/></section><section className="game-study-launch-strip" aria-label="Начало игры"><Facts/><Launch onStart={onStart}/></section><Criteria/></>
  return <><Edition/><section className="game-study-hero"><FilmArt/><div><Copy onRules={onRules}/><Facts/><Launch onStart={onStart}/></div><Criteria/></section></>
}
function GamePage({ variant }: { variant: Variant }) {
  const [start, setStart] = useState(false)
  const closeRef=useRef<HTMLButtonElement>(null)
  const sourceRef=useRef<HTMLElement|null>(null)
  const rules = () => document.getElementById('artifact-rules-movie')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start' })
  useEffect(()=>{
    if(!start)return
    sourceRef.current=document.activeElement as HTMLElement
    closeRef.current?.focus()
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setStart(false);if(e.key==='Tab'){e.preventDefault();closeRef.current?.focus()}}
    window.addEventListener('keydown',key)
    return()=>{window.removeEventListener('keydown',key);sourceRef.current?.focus({preventScroll:true})}
  },[start])
  useEffect(()=>{
    if(!embed)return
    const observer=new ResizeObserver(()=>parent.postMessage({type:'game-study-height',variant,height:Math.ceil(document.body.getBoundingClientRect().height)},location.origin))
    observer.observe(document.body)
    return()=>observer.disconnect()
  },[variant])
  return <div className={`game-study game-study--${variant}`}><Header/><main className="study-container"><div className="club-study-back"><a href={home}><ChevronLeft size={16}/>Все игры</a></div><Hero variant={variant} onStart={()=>setStart(true)} onRules={rules}/><div className="game-study-details" id="study-rules"><GameArtifactSeoDetails mode="movie"/></div></main><Footer/>{start&&<div className="study-dialog-backdrop" onClick={()=>setStart(false)}><section className="study-dialog" role="dialog" aria-modal="true" aria-labelledby="game-study-demo-title" onClick={e=>e.stopPropagation()}><h2 id="game-study-demo-title">Макет старта игры</h2><p>Здесь выбираем оформление страницы. Настоящая игра, билеты и прогресс не запускаются.</p><ActionButton ref={closeRef} onClick={()=>setStart(false)}>Вернуться к варианту</ActionButton></section></div>}</div>
}
function Preview({ option }: { option: typeof options[number] }) {
  const [width,setWidth]=useState(400)
  const [height,setHeight]=useState(2600)
  const ref=useRef<HTMLDivElement>(null)
  useEffect(()=>{
    const observer=new ResizeObserver(entries=>setWidth(entries[0].contentRect.width))
    if(ref.current)observer.observe(ref.current)
    const receive=(event:MessageEvent)=>{if(event.origin===location.origin&&event.data?.type==='game-study-height'&&event.data.variant===option.id)setHeight(event.data.height)}
    window.addEventListener('message',receive)
    return()=>{observer.disconnect();window.removeEventListener('message',receive)}
  },[option.id])
  return <article className="study-preview"><header><span>{option.id.toUpperCase()}</span><h2>{option.name}</h2><p>{option.short}</p><ActionLink variant="secondary" href={`?preview=reference&view=${option.id}`}>Открыть целиком<ArrowRight size={18}/></ActionLink></header><a className="study-preview__page" href={`?preview=reference&view=${option.id}`} aria-label={`Открыть ${option.id.toUpperCase()} — ${option.name}`}><div ref={ref} style={{height:height*width/1413}}><iframe title={`Вариант ${option.id.toUpperCase()}`} aria-hidden="true" tabIndex={-1} src={`?preview=reference&view=${option.id}&embed=1`} style={{width:1413,height,transform:`scale(${width/1413})`}}/></div></a></article>
}
function References() {
  return <main className="study-reference study-container"><h1>A / Рядом с главной</h1><p>Ты выбрал это направление. Для старта игры проверяем три композиции в том же языке.</p><ul className="game-study-reference-rules"><li>Рисунок крупный, тематический, виден целиком.</li><li>Пастель заполняет осмысленный объект: игровой блок, полосу запуска или карточку.</li><li>Чёрный заголовок и одно основное действие. Остальной текст спокойнее.</li><li>Секции меняют масштаб, фон страницы остаётся светлым.</li></ul><img src={referenceOne} alt="Первый экран главной — исходный визуальный эталон"/><img src={clubA} alt="Выбранное направление A страницы клуба"/><ActionLink href="?preview=reference&view=compare">Сравнить варианты старта<ArrowRight size={18}/></ActionLink></main>
}
function App() {
  return <>{!embed&&<StudyBar/>}{isVariant(selected)?<><div className="study-direction-note" hidden={embed}><strong>{selected.toUpperCase()} / {options.find(v=>v.id===selected)?.name}</strong><span>{options.find(v=>v.id===selected)?.description}</span></div><GamePage variant={selected}/></>:selected==='reference'?<References/>:<main className="study-comparison"><div className="study-intro"><p>Выбранное направление A / следующий тип страницы</p><h1>Как выглядит начало игры?</h1><p>Три целых страницы в стиле главной. Во всех — одинаковые тексты, правила и рисунок. Различается композиция.</p><a href="?preview=reference&view=reference">Посмотреть выбранный эталон<ArrowRight size={18}/></a><small>Изолированные варианты. Основные страницы остаются без изменений.</small></div><div className="study-preview-grid">{options.map(option=><Preview key={option.id} option={option}/>)}</div><div className="study-choice"><h2>Какой старт ближе?</h2><p>Можно выбрать целый вариант или объединить части. После старта отдельно посмотрим варианты игрового экрана и результата.</p></div></main>}</>
}

if (document.documentElement.dataset.designStudy !== 'body') createRoot(document.getElementById('root')!).render(<App/> )
