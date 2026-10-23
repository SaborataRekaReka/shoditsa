import { publicAssetUrl } from '../../app/public-asset'
import { useState } from 'react'
import { ArrowRight, ArrowUp, Check, Search, X } from 'lucide-react'
import { ActionButton } from '../../components/ui/UiControls'
import { ReferenceIcon, type ReferenceIconName } from '../../components/ui/ReferenceIcon'
import { GAME_GUIDE_PRESENTATION, GAME_RULES, GAME_SEO, INDEXABLE_GAME_SEO, type GameSeoContent } from '../../app/seo-content'
import { LOCAL_PRESENTATION, localPresentationLink } from '../../app/local-presentation'
import { EvidenceFormat, QuestionsFormat, type SectionFormat } from './SectionFormats'

export type BodyVariant = 'b1' | 'b2' | 'b3'
const content=GAME_SEO.movie
const guide=GAME_GUIDE_PRESENTATION.movie
const rules=GAME_RULES.movie
const instructions=[rules.searchInstruction,rules.comparisonInstruction,'Перед пятой и восьмой попытками можно открыть по одной из трёх дополнительных подсказок.']
const stepNames=['Первая догадка','Замечай детали','Собери ответ']
const evidenceIcons:ReferenceIconName[]=['user','movie','calendar','idea']
const games=(INDEXABLE_GAME_SEO as readonly GameSeoContent[]).filter(game=>game.mode!=='movie'&&(!LOCAL_PRESENTATION||!['danetki','connections'].includes(game.mode)))
const states=[
  {name:'Точно',field:'Жанр',className:'exact',note:'значение совпало',icon:<Check size={24}/>},
  {name:'Рядом',field:'Год',className:'partial',note:'число близко или есть частичное совпадение',icon:<ArrowUp size={24}/>},
  {name:'Мимо',field:'Страна',className:'miss',note:'значение не совпало',icon:<X size={24}/>},
]

function StepTitle({index}:{index:number}) {
  return <div className="body-step-title"><h3>{stepNames[index]}</h3></div>
}
function SearchSketch() {
  const show=()=>{
    const target=document.querySelector<HTMLButtonElement>('.body-demo-cells button')
    target?.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})
    target?.focus({preventScroll:true})
  }
  return <div className="body-search-sketch"><div><Search size={23}/><span>Название фильма</span><button type="button" aria-label="Посмотреть схему сравнения" onClick={show}><ArrowRight size={22}/></button></div></div>
}
function CompareDemo() {
  const [active,setActive]=useState(0)
  return <div className="body-demo">
    <header><span>Схема сравнения</span><small>Нажми на цвет</small></header>
    <div className="body-demo-cells">{states.map((state,index)=><button type="button" className={state.className} aria-pressed={active===index} onClick={()=>setActive(index)} key={state.name}>
      <span className="body-demo-field">{state.field}{state.icon}</span><strong>{state.name}</strong>
    </button>)}</div>
    <p className={`body-demo-note ${states[active].className}`} aria-live="polite"><strong>{states[active].name}</strong><span>{states[active].note}</span></p>
    <p className="body-direction-note">{rules.directionInstruction}</p>
  </div>
}
function HintArt() {
  return <figure className="body-hint-art"><img src={publicAssetUrl('images/mascot/scenes/clue-detective-v1.webp')} width="1254" height="1254" alt=""/><div><span>Перед 5-й попыткой</span><span>Перед 8-й попыткой</span></div></figure>
}
function RuleNotes() {
  return <p className="body-mode-note">{rules.modeNote}</p>
}
function Evidence({variant}:{variant:BodyVariant}) {
  return <section className={`body-evidence body-evidence--${variant}`} aria-labelledby="body-evidence-heading"><h2 id="body-evidence-heading">{guide.evidenceTitle}</h2><div>{content.features.map((feature,index)=><article key={feature}><ReferenceIcon name={evidenceIcons[index]} size={36}/><p>{feature}</p></article>)}</div></section>
}
function Tactics() {
  return <section className="body-tactics" aria-labelledby="body-tactics-heading"><h2 id="body-tactics-heading">{guide.routeTitle}</h2><ol>{content.steps.map(step=><li key={step}><p>{step}</p></li>)}</ol></section>
}
function About({variant}:{variant:BodyVariant}) {
  return <section className={`body-about body-about--${variant}`} aria-labelledby="about-movie"><div className="body-about-poster"><img src={publicAssetUrl('images/mascot/scenes/cinema-projection-v1.webp')} width="1254" height="1254" alt=""/></div><div><h2 id="about-movie">{content.heading}</h2><p className="body-about-lead">{content.lead}</p>{content.paragraphs.map(paragraph=><p key={paragraph}>{paragraph}</p>)}</div></section>
}
function Questions({variant}:{variant:BodyVariant}) {
  return <div className={`body-questions body-questions--${variant}`}>
    <section className="body-faq" aria-labelledby="body-faq-heading"><header><ReferenceIcon name="danetki" size={50}/><h2 id="body-faq-heading">{guide.faqTitle}</h2></header>{content.faq.map(faq=><article key={faq.question}><h3>{faq.question}</h3><p>{faq.answer}</p></article>)}</section>
    <section className="body-method" aria-labelledby="body-method-heading"><header><ReferenceIcon name="guide" size={34}/><h2 id="body-method-heading">Как собран набор</h2></header><p>{content.collectionMethod.text}</p><div className="body-method-sources">{content.collectionMethod.sources.map(source=><a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label}<ArrowRight size={17}/></a>)}</div></section>
  </div>
}
function GameShelf() {
  return <nav className="body-game-shelf" aria-label="Другие ежедневные игры"><header><h2>{guide.linksLabel}</h2><span>Во что сыграем?</span></header><div>{games.map((game,index)=><a key={game.mode} data-tone={index%6} href={localPresentationLink(game.canonicalPath)}><h3>{game.shortName}</h3><span className="body-game-shelf-label">{game.internalLinkLabel??game.shortName}</span><span className="body-game-shelf-arrow"><ArrowRight size={21}/></span><img src={`/images/home-doodle/${game.mode==='connections'?'associations':game.mode==='danetki'?'yes-no':game.mode}.webp`} width="250" height="250" alt=""/></a>)}</div></nav>
}
function StartAgain({onStart}:{onStart:()=>void}) {
  return <ActionButton onClick={onStart}>Начать игру<ArrowRight size={19}/></ActionButton>
}

function DemoStage({onStart}:{onStart:()=>void}) {
  return <section className="body-rules body-rules--stage" id="artifact-rules-movie" aria-labelledby="body-rules-heading"><h2 id="body-rules-heading">Как играть</h2><div className="body-main-stage"><div className="body-stage-search"><StepTitle index={0}/><p>{instructions[0]}</p><SearchSketch/></div><div className="body-stage-compare"><StepTitle index={1}/><CompareDemo/><p className="body-comparison-copy">{instructions[1]}</p></div></div><div className="body-stage-next"><div><StepTitle index={2}/><p>{instructions[2]}</p><StartAgain onStart={onStart}/></div><HintArt/></div><RuleNotes/></section>
}
function Scenes({onStart}:{onStart:()=>void}) {
  return <section className="body-rules body-rules--scenes" id="artifact-rules-movie" aria-labelledby="body-rules-heading"><h2 id="body-rules-heading">Как играть</h2><article className="body-scene body-scene--search"><div><StepTitle index={0}/><p>{instructions[0]}</p></div><SearchSketch/></article><article className="body-scene body-scene--compare"><div><StepTitle index={1}/><p>{instructions[1]}</p></div><CompareDemo/></article><article className="body-scene body-scene--next"><HintArt/><div><StepTitle index={2}/><p>{instructions[2]}</p><StartAgain onStart={onStart}/></div></article><RuleNotes/></section>
}
function Mosaic({onStart}:{onStart:()=>void}) {
  return <section className="body-rules body-rules--mosaic" id="artifact-rules-movie" aria-labelledby="body-rules-heading"><h2 id="body-rules-heading">Как играть</h2><div className="body-mosaic"><article className="body-mosaic-compare"><StepTitle index={1}/><CompareDemo/><p className="body-comparison-copy">{instructions[1]}</p></article><article className="body-mosaic-search"><StepTitle index={0}/><p>{instructions[0]}</p><SearchSketch/></article><article className="body-mosaic-next"><div><StepTitle index={2}/><p>{instructions[2]}</p><StartAgain onStart={onStart}/></div><HintArt/></article></div><RuleNotes/></section>
}
export function BodyLanding({variant,onStart,format='f1',formatOnly=false}:{variant:BodyVariant;onStart:()=>void;format?:SectionFormat;formatOnly?:boolean}) {
  if(formatOnly)return <div className={`body-landing section-format-preview section-format-preview--${format}`}><EvidenceFormat format={format}/><QuestionsFormat format={format}/></div>
  return <div className={`body-landing body-landing--${variant}`}>
    {variant==='b1'?<DemoStage onStart={onStart}/>:variant==='b2'?<Scenes onStart={onStart}/>:<Mosaic onStart={onStart}/>}
    {variant==='b3'?<><div className="body-evidence-tactics"><Evidence variant={variant}/><Tactics/></div><About variant={variant}/></>:<>{variant==='b2'?<EvidenceFormat format={format}/>:<Evidence variant={variant}/>}<About variant={variant}/><Tactics/></>}
    {variant==='b2'?<QuestionsFormat format={format}/>:<Questions variant={variant}/>}<GameShelf/>
  </div>
}
