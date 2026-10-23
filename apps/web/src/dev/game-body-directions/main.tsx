import { useEffect,useRef,useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowRight,ChevronLeft } from 'lucide-react'
import { ActionButton,ActionLink } from '../../components/ui/UiControls'
import { Header,Hero,Footer } from '../game-directions/main'
import { BodyLanding,type BodyVariant } from './BodyLayouts'
import { SECTION_FORMATS,type SectionFormat } from './SectionFormats'
import './body-study.css'

const query=new URLSearchParams(location.search)
const view=query.get('view')??'compare'
const embed=query.has('embed')
const bodyOnly=query.has('bodyOnly')
const heroOnly=query.has('heroOnly')
const formatOnly=query.has('formatOnly')
const activeFormat:SectionFormat=SECTION_FORMATS.find(item=>item.id===query.get('format'))?.id??'f1'
const variants=[
  {id:'b1',name:'Пример в центре',short:'Большая схема сравнения, полка признаков',description:'Сначала — большой наглядный пример. Затем цветные объекты признаков, заметка о кино и полка других игр.'},
  {id:'b2',name:'Три сцены',short:'Ввод → сравнение → следующая идея',description:'Три широкие сцены меняют ритм: поле ответа, цветные подсказки и следующая версия. Текст встроен в эти сцены.'},
  {id:'b3',name:'Игровая мозаика',short:'Разные игровые объекты в одной композиции',description:'Схема подсказок, первый ответ и новые идеи собраны в асимметричную мозаику. Дальше — широкая полоса поиска и иллюстрированная полка игр.'},
] as const
const isVariant=(value:string):value is BodyVariant=>variants.some(item=>item.id===value)
function StudyBar() {
  return <nav className="study-nav" aria-label="Варианты продолжения страницы"><a className="study-nav__title" href="?preview=reference">Хиро A3 / продолжение страницы</a><div>{[['compare','Сравнить'],['b1','1'],['b2','2'],['b3','3']].map(([id,label])=><a key={id} href={`?preview=reference&view=${id}`} aria-current={view===id?'page':undefined}>{label}</a>)}</div><a href="?preview=reference&view=formats" aria-current={view==='formats'?'page':undefined}>Новые форматы блоков</a></nav>
}
function Page({variant}:{variant:BodyVariant}) {
  const [opened,setOpened]=useState(false)
  const closeRef=useRef<HTMLButtonElement>(null)
  const returnRef=useRef<HTMLElement|null>(null)
  useEffect(()=>{
    if(!embed)return
    const observer=new ResizeObserver(()=>parent.postMessage({type:'body-study-height',key:formatOnly?activeFormat:heroOnly?'hero':variant,height:Math.ceil(document.body.getBoundingClientRect().height)},location.origin))
    observer.observe(document.body)
    return()=>observer.disconnect()
  },[variant])
  useEffect(()=>{
    if(!opened)return
    returnRef.current=document.activeElement as HTMLElement
    closeRef.current?.focus()
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpened(false);if(event.key==='Tab'){event.preventDefault();closeRef.current?.focus()}}
    window.addEventListener('keydown',key)
    return()=>{window.removeEventListener('keydown',key);returnRef.current?.focus({preventScroll:true})}
  },[opened])
  const showRules=()=>document.getElementById('artifact-rules-movie')?.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})
  return <div className={`game-study game-study--a3 body-study--${variant}`}>
    {!bodyOnly&&!formatOnly&&<Header/>}
    <main className="study-container">{!bodyOnly&&!formatOnly&&<><div className="club-study-back"><a href="/?preview=reference#/?preview=reference"><ChevronLeft size={16}/>Все игры</a></div><Hero variant="a3" onStart={()=>setOpened(true)} onRules={showRules}/></>}
      {!heroOnly&&<div id="study-rules"><BodyLanding variant={variant} format={activeFormat} formatOnly={formatOnly} onStart={()=>setOpened(true)}/></div>}
    </main>
    {!heroOnly&&!formatOnly&&<Footer/>}
    {opened&&<div className="study-dialog-backdrop" onClick={()=>setOpened(false)}><section className="study-dialog" role="dialog" aria-modal="true" aria-labelledby="body-study-demo-title" onClick={event=>event.stopPropagation()}><h2 id="body-study-demo-title">Макет страницы</h2><p>Здесь выбираем дизайн. Настоящая игра, билеты и прогресс не запускаются.</p><ActionButton ref={closeRef} onClick={()=>setOpened(false)}>Вернуться к варианту</ActionButton></section></div>}
  </div>
}
function MiniPage({variant,hero=false,sectionFormat}:{variant:typeof variants[number];hero?:boolean;sectionFormat?:SectionFormat}) {
  const [width,setWidth]=useState(400)
  const [height,setHeight]=useState(hero?700:3000)
  const ref=useRef<HTMLDivElement>(null)
  useEffect(()=>{
    const observer=new ResizeObserver(entries=>setWidth(entries[0].contentRect.width))
    if(ref.current)observer.observe(ref.current)
    const receive=(event:MessageEvent)=>{if(event.origin===location.origin&&event.data?.type==='body-study-height'&&event.data.key===(sectionFormat??(hero?'hero':variant.id)))setHeight(event.data.height)}
    window.addEventListener('message',receive)
    return()=>{observer.disconnect();window.removeEventListener('message',receive)}
  },[variant.id,hero,sectionFormat])
  const format=SECTION_FORMATS.find(item=>item.id===sectionFormat)
  const url=`?preview=reference&view=${variant.id}${sectionFormat?`&format=${sectionFormat}`:''}`
  const frame=<div ref={ref} className="body-mini-frame" style={{height:height*width/1413}}><iframe title={hero?'Общее хиро A3':`Продолжение ${format?.name??variant.name}`} tabIndex={-1} aria-hidden="true" src={`${url}&embed=1&${sectionFormat?'formatOnly':hero?'heroOnly':'bodyOnly'}=1`} style={{width:1413,height,transform:`scale(${width/1413})`}}/></div>
  if(hero)return frame
  return <article className="study-preview"><header><span>{sectionFormat?.toUpperCase()??variant.id.slice(1)}</span><h2>{format?.name??variant.name}</h2><p>{format?.note??variant.short}</p><ActionLink variant="secondary" href={url}>Открыть с хиро<ArrowRight size={18}/></ActionLink></header><a className="study-preview__page" href={url} aria-label={`Открыть ${format?.name??variant.name} целиком`}>{frame}</a></article>
}
function FormatGallery(){
  return <main className="study-comparison"><div className="study-intro format-comparison-intro"><p>B2 / другие форматы</p><h1>Признаки, ответы и каталог</h1><p>Три способа подать отмеченные блоки. В каждом — весь текст, открытые ответы и источники. Остальные секции B2 одинаковые.</p></div><div className="study-preview-grid">{SECTION_FORMATS.map(format=><MiniPage key={format.id} variant={variants[1]} sectionFormat={format.id}/>)}</div><div className="study-choice"><h2>Какой способ подачи ближе?</h2><p>Любой формат можно открыть в полной странице с теми же хиро и иллюстрациями.</p></div></main>
}
function FormatSwitch(){return <nav className="format-switch" aria-label="Формат информационных блоков"><a href="?preview=reference&view=formats">Сравнить форматы</a>{SECTION_FORMATS.map(format=><a href={`?preview=reference&view=b2&format=${format.id}`} key={format.id} aria-current={activeFormat===format.id?'page':undefined}>{format.id.toUpperCase()} / {format.name}</a>)}</nav>}
function App() {
  return <>{!embed&&<StudyBar/>}{view==='formats'?<FormatGallery/>:isVariant(view)?<>{!embed&&<><div className="study-direction-note"><strong>A3 + {view.slice(1)} / {variants.find(v=>v.id===view)?.name}</strong><span>{variants.find(v=>v.id===view)?.description}</span></div>{view==='b2'&&<FormatSwitch/>}</>}<Page variant={view}/></>:<main className="study-comparison"><div className="study-intro"><p>Хиро A3 — общий ориентир</p><h1>Три продолжения страницы</h1><p>Открытые секции и две новые сцены с персонажем. Сравниваем композицию и ритм ниже общего хиро.</p><small>Схемы показывают принцип подсказок. Ответ загадки дня нигде не раскрывается.</small></div><section className="body-common-hero" aria-label="Общее начало — хиро A3"><h2>Общее начало — хиро A3</h2><MiniPage variant={variants[0]} hero/></section><div className="study-preview-grid">{variants.map(variant=><MiniPage key={variant.id} variant={variant}/>)}</div><div className="study-choice"><h2>Какое продолжение живее?</h2><p>Хиро одинаковое. Можно выбрать один вариант или соединить понравившиеся секции.</p></div></main>}</>
}
createRoot(document.getElementById('root')!).render(<App/> )
