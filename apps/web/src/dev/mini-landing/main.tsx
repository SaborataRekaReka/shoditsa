import { publicAssetUrl } from '../../app/public-asset'
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowDown, ArrowRight, ArrowUp, Check, ChevronDown, ChevronLeft, CircleHelp, Clapperboard, Search, Ticket, X } from 'lucide-react'
import { BrandWordmark } from '../../components/app-shell/BrandWordmark'
import { Mascot } from '../../components/mascot/Mascot'
import { ReferenceIcon, type ReferenceIconName } from '../../components/ui/ReferenceIcon'
import { GAME_RULES, GAME_SEO, INDEXABLE_GAME_SEO } from '../../app/seo-content'
import { LOCAL_PRESENTATION, localPresentationLink } from '../../app/local-presentation'
import '../../styles/reference-tokens.css'
import './mini-landing.css'
import { WidgetBody } from './WidgetBody'
import { SectionBody } from './SectionBody'
import { MOVIE_POSTERS, PosterReel } from './PosterReel'
import { HERO_FONTS, HERO_INFO_LAYOUTS, HeroStudyControls, type HeroFont, type HeroInfoLayout } from './HeroStudyControls'
import { HeroConceptStudy } from './HeroConceptStudy'
import { FreshHero } from './FreshHero'

const content = GAME_SEO.movie
const rules = GAME_RULES.movie
const query = new URLSearchParams(location.search)
const layout = query.get('layout')
const heroStudy = query.get('heroStudy') === '1'
const heroConceptStudy = query.get('heroStudy') === 'concepts'
const widgetLayout = layout !== 'editorial'
const sectionLayout = layout === 'sections'
const freshHero = sectionLayout && !heroStudy
const home = localPresentationLink('/')
const otherGames = INDEXABLE_GAME_SEO.filter(game => game.mode !== 'movie' && (!LOCAL_PRESENTATION || !['danetki', 'connections'].includes(game.mode)))
const featured = otherGames.filter(game => content.relatedModes?.some(mode => mode === game.mode))
const moreGames = otherGames.filter(game => !content.relatedModes?.some(mode => mode === game.mode))
const heroCriteria: Array<{ label: string; icon: ReferenceIconName }> = [
  { label: 'Год', icon: 'calendar' },
  { label: 'Жанры', icon: 'movie' },
  { label: 'Актёры', icon: 'user' },
  { label: 'Страна', icon: 'globe' },
  { label: 'Рейтинг', icon: 'idea' },
]
const matches = [
  { field: 'Жанр', title: 'Точно', note: 'Значение совпало.', tone: 'exact', icon: Check },
  { field: 'Год', title: 'Рядом', note: 'Число близко или есть частичное совпадение.', tone: 'partial', icon: ArrowUp },
  { field: 'Страна', title: 'Мимо', note: 'Значение не совпало.', tone: 'miss', icon: X },
] as const

function Comparison() {
  const [active, setActive] = useState(0)
  const selected = matches[active]
  return <div className="mini-comparison">
    <div className="mini-comparison__cells" role="group" aria-label="Пример сравнительных подсказок">
      {matches.map((match, index) => <button type="button" key={match.tone} className={`mini-match mini-match--${match.tone}`} aria-pressed={active === index} onClick={() => setActive(index)}>
        <span>{match.field}<match.icon size={16} strokeWidth={1.7} aria-hidden="true" /></span>
        <span className="mini-match__title">{match.title}</span>
      </button>)}
    </div>
    <p className="mini-comparison__note" aria-live="polite"><span className={`mini-status-dot mini-status-dot--${selected.tone}`} /><span>{selected.note}</span></p>
  </div>
}

function DemoDialog({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'Tab') { event.preventDefault(); closeRef.current?.focus() }
    }
    window.addEventListener('keydown', key)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', key)
      previous?.focus({ preventScroll: true })
    }
  }, [onClose])
  return <div className="mini-dialog-backdrop" onClick={onClose}>
    <section className="mini-dialog" role="dialog" aria-modal="true" aria-labelledby="mini-demo-title" onClick={event => event.stopPropagation()}>
      <Clapperboard size={25} strokeWidth={1.5} aria-hidden="true" />
      <h2 id="mini-demo-title">Это предпросмотр дизайна</h2>
      <p>Здесь можно оценить страницу. Кнопка запуска пока не начинает настоящую игру.</p>
      <button ref={closeRef} className="mini-primary" type="button" onClick={onClose}>Вернуться к странице<ArrowRight size={17} /></button>
    </section>
  </div>
}

function DailyRiddle() {
  return <span><ReferenceIcon name="idea" size={16} />Новая загадка каждый день</span>
}

function HeroGameInfo({ split = false }: { split?: boolean }) {
  const help = <a href="#mini-guide"><ReferenceIcon name="guide" size={16} />Как играть?<ArrowDown size={14} aria-hidden="true" /></a>
  const attempts = <span><strong>10</strong> попыток</span>
  return <div className={`mini-hero__info${split ? ' mini-hero__info--split' : ''}`}>{split ? <>{attempts}{help}</> : <>{help}{attempts}<DailyRiddle /></>}</div>
}

function updateHeroPreview(font: HeroFont, info: HeroInfoLayout) {
  const url = new URL(location.href)
  url.searchParams.set('heroFont', font)
  url.searchParams.set('heroInfo', info)
  history.replaceState(null, '', url)
}

function App() {
  const [demo, setDemo] = useState(false)
  const [heroFont, setHeroFont] = useState<HeroFont>(() => HERO_FONTS.find(option => option.id === query.get('heroFont'))?.id ?? 'inter')
  const [heroInfo, setHeroInfo] = useState<HeroInfoLayout>(() => HERO_INFO_LAYOUTS.find(option => option.id === query.get('heroInfo'))?.id ?? 'inline')
  const infoLayout = heroStudy ? heroInfo : 'inline'
  const closeDemo = useRef(() => setDemo(false)).current
  const startRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (event.defaultPrevented || event.key !== 'Enter' || demo || target.closest('a, button, input, select, textarea, [contenteditable], [tabindex]')) return
      event.preventDefault()
      startRef.current?.focus()
      setDemo(true)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [demo])
  if (heroConceptStudy) return <div className="mini-landing hero-directions"><HeroConceptStudy onStart={() => setDemo(true)} startRef={startRef} />{demo && <DemoDialog onClose={closeDemo} />}</div>
  return <div className={`mini-landing${widgetLayout ? ' mini-landing--widgets' : ''}${sectionLayout ? ' mini-landing--sections' : ''}${heroStudy ? ' mini-landing--hero-study' : ''}${freshHero ? ' mini-landing--fresh-hero' : ''}`}>
    <a className="mini-skip" href="#mini-main">К содержанию</a>
    {heroStudy && <HeroStudyControls font={heroFont} info={heroInfo} onFontChange={font => { setHeroFont(font); updateHeroPreview(font, heroInfo) }} onInfoChange={info => { setHeroInfo(info); updateHeroPreview(heroFont, info) }} />}
    <header className="mini-header"><div className="mini-container mini-header__inner">
      <a className="mini-brand" href={home} aria-label="Сходится! — главная"><BrandWordmark variant="compact" /></a>
      <nav aria-label="Главная навигация"><a href={home}>Все игры</a><a href="#mini-about">Об игре</a><a href="#mini-guide" className="mini-header__help"><CircleHelp size={17} strokeWidth={1.6} />Как играть</a></nav>
    </div></header>
    <main id="mini-main">{freshHero ? <FreshHero onStart={() => setDemo(true)} startRef={startRef} /> : <><div className="mini-container">
      <a className="mini-back" href={home}><ChevronLeft size={15} />Все игры</a>
      <section className="mini-hero" aria-labelledby="mini-title" data-hero-font={heroStudy ? heroFont : undefined} data-hero-info={heroStudy ? infoLayout : undefined}>
        <figure className="mini-hero__art"><img src={publicAssetUrl('images/home-doodle/movie.webp')} width="250" height="250" alt="Нарисованные кинохлопушка и катушка плёнки" /></figure>
        <div className="mini-hero__copy">
          {infoLayout === 'split' && <div className="mini-hero__eyebrow"><DailyRiddle /></div>}
          <h1 id="mini-title">Угадай фильм</h1>
          <p className="mini-hero__lead">{content.lead}</p>
          {infoLayout === 'inline' && <HeroGameInfo />}
          <div className="mini-launch">
            <button ref={startRef} className="mini-primary mini-primary--mascot" type="button" onClick={() => setDemo(true)}>
              <span className="mini-primary__peek" aria-hidden="true"><span className="mini-primary__peek-rise"><Mascot pose="peek" width={1254} height={1254} draggable={false} /></span></span>
              <span className="mini-primary__content">Начать игру<kbd>Enter</kbd><ArrowRight size={17} strokeWidth={1.7} aria-hidden="true" /></span>
            </button>
            <label className="mini-period"><span className="mini-period__caption"><ReferenceIcon name="calendar" size={12} />Период</span><span className="mini-period__cost"><Ticket size={12} aria-hidden="true" /><span aria-label="15 билетов">15</span></span><select aria-label="Период фильмов" defaultValue="all"><option value="all">Все годы</option></select><ChevronDown size={14} aria-hidden="true" /></label>
          </div>
          {infoLayout === 'below' && <HeroGameInfo />}
          {infoLayout === 'split' && <HeroGameInfo split />}
        </div>
        <section className="mini-hero__criteria" aria-labelledby="mini-criteria-title">
          <h2 id="mini-criteria-title">Что сравниваем</h2>
          <ul>{heroCriteria.map(({ label, icon }) => <li key={label}><ReferenceIcon name={icon} size={16} /><span>{label}</span></li>)}</ul>
        </section>
      </section>
      </div>
      {widgetLayout && <PosterReel posters={MOVIE_POSTERS} />}</>}
      <div className="mini-container">

      {sectionLayout ? <SectionBody /> : widgetLayout ? <WidgetBody /> : <><section id="mini-guide" className="mini-guide" aria-labelledby="mini-guide-title">
        <div className="mini-section-head"><h2 id="mini-guide-title">От первой версии до «сходится!»</h2><span>Без спойлеров</span></div>
        <div className="mini-guide__grid">
          <div className="mini-search-guide"><h3>Начни с любого фильма</h3><p>{rules.searchInstruction}</p><div className="mini-search-example" role="img" aria-label="Пример поля поиска фильма"><Search size={18} strokeWidth={1.5} /><span>Название фильма</span><span className="mini-search-example__arrow"><ArrowRight size={17} /></span></div><p className="mini-subnote">{rules.modeNote}</p></div>
          <div><h3>Следи за совпадениями</h3><p>{rules.comparisonInstruction}</p><Comparison /><p className="mini-direction-note">{rules.directionInstruction}</p></div>
        </div>
        <div className="mini-guide__bottom">
          <div className="mini-features"><h3>Что сравниваем</h3><ul>{content.features.map(feature => <li key={feature}><span className="mini-feature-dot" />{feature}</li>)}</ul></div>
          <div className="mini-hint"><img src={publicAssetUrl('images/mascot/scenes/clue-detective-v1.webp')} width="1254" height="1254" alt="Зелёный персонаж изучает карточки через лупу" /><div><h3>Немного помощи?</h3><p>Перед пятой и восьмой попытками можно открыть по одной из трёх дополнительных подсказок.</p></div></div>
        </div>
      </section>

      <section id="mini-about" className="mini-about" aria-labelledby="mini-about-title">
        <div className="mini-about__main"><h2 id="mini-about-title">{content.heading}</h2>{content.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}<div className="mini-route"><h3>Как искать фильм</h3><ul>{content.steps.map(step => <li key={step}><Check size={14} strokeWidth={1.7} />{step}</li>)}</ul></div></div>
        <aside className="mini-answers" aria-label="Ответы о правилах и регистрации">{content.faq.map(faq => <article key={faq.question}><h3>{faq.question}</h3><p>{faq.answer}</p></article>)}<img src={publicAssetUrl('images/mascot/scenes/cinema-projection-v1.webp')} width="1254" height="1254" alt="Зелёный персонаж устроил маленький киносеанс" /></aside>
      </section>
      <section className="mini-method" aria-labelledby="mini-method-title"><h3 id="mini-method-title">Как собран набор</h3><div><p>{content.collectionMethod.text}</p>{content.collectionMethod.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label}<ArrowRight size={14} /></a>)}</div></section></>}

      <nav className="mini-more" aria-labelledby="mini-more-title"><div className="mini-section-head"><h2 id="mini-more-title">Ещё одна загадка?</h2><a href={home}>Все игры<ArrowRight size={15} /></a></div><div className="mini-more__cards">{featured.map((game, index) => <a key={game.mode} className="mini-game" href={localPresentationLink(game.canonicalPath)} data-tone={index}><div><h3>{game.shortName}</h3><span>{game.mode === 'series' ? 'Сериал по деталям' : game.mode === 'anime' ? 'Аниме по подсказкам' : 'Видеоигра по деталям'}</span><ArrowRight size={16} /></div><img src={`/images/home-doodle/${game.mode}.webp`} width="250" height="250" alt="" /></a>)}</div><div className="mini-more__links">{moreGames.map(game => <a key={game.mode} href={localPresentationLink(game.canonicalPath)}>{game.shortName}<ArrowRight size={12} /></a>)}</div></nav>
    </div></main>
    <footer className="mini-footer"><div className="mini-container"><span>Каждый день что-нибудь сходится.</span><a href={home}>Сходится!<ArrowRight size={14} /></a></div></footer>
    {demo && <DemoDialog onClose={closeDemo} />}
  </div>
}

createRoot(document.getElementById('root')!).render(<App />)
