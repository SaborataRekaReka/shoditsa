import { publicAssetUrl } from '../../app/public-asset'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ArrowRight, ArrowUp, BookOpenText, Check, Clapperboard, Lightbulb, Search, X } from 'lucide-react'
import { GAME_RULES, GAME_SEO } from '../../app/seo-content'
import { Mascot } from '../../components/mascot/Mascot'
import './section-body.css'

const content = GAME_SEO.movie
const rules = GAME_RULES.movie
const outcomes = [
  { field: 'Жанр', title: 'Точно', tone: 'exact', Icon: Check },
  { field: 'Год', title: 'Рядом', tone: 'partial', Icon: ArrowUp },
  { field: 'Страна', title: 'Мимо', tone: 'miss', Icon: X },
] as const

function StorySection({ name, title, children, scene }: { name: string; title: string; children: ReactNode; scene: ReactNode }) {
  const ref = useRef<HTMLElement>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setSeen(true); observer.disconnect() }
    }, { threshold: .25 })
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  return <section ref={ref} className={`story-section story-section--${name}`} aria-labelledby={`story-${name}-title`} data-seen={seen}>
    <div className="story-copy"><h2 id={`story-${name}-title`}>{title}</h2>{children}</div>
    <div className={`story-scene story-scene--${name}`}>{scene}</div>
  </section>
}

function SearchIllustration() {
  const [run, setRun] = useState(0)
  return <div className="story-search">
    <div className="story-search__back" aria-hidden="true"><Clapperboard size={18} strokeWidth={1.5} /><span>Твоя версия</span><span>…</span></div>
    <div className="story-search__field"><Search size={18} strokeWidth={1.5} aria-hidden="true" /><span>Матрица<span className="story-search__caret" aria-hidden="true" /></span><button type="button" className="story-search__submit" aria-label="Повторить пример выбора фильма" onClick={() => setRun(value => value + 1)}><ArrowRight size={17} /></button></div>
    <div className="story-search__result" key={run}><img src="/data/libraries/movies/img/kp_301/poster.webp" alt="" width="36" height="50" /><div><strong>Матрица</strong><span>Фильм из каталога</span></div><span className="story-search__check"><Check size={17} strokeWidth={1.6} /></span></div>
  </div>
}

function ComparisonIllustration() {
  return <div className="story-compare">
    <div className="story-compare__tiles" role="group" aria-label="Пример сравнительных подсказок">{outcomes.map(({ field, title, tone, Icon }) => <div key={tone} className={`story-match story-match--${tone}`}><span className="story-match__field">{field}</span><span className="story-match__status" aria-hidden="true"><Icon size={16} strokeWidth={1.8} /></span><strong>{title}</strong></div>)}</div>
  </div>
}

function AttemptsIllustration() {
  return <div className="story-attempts" aria-hidden="true">
    <div className="story-attempts__heading"><strong>10</strong></div>
    <div className="story-attempts__tickets">{Array.from({ length: 10 }, (_, index) => <span key={index} style={{ '--ticket-index': index } as CSSProperties}><Clapperboard size={17} strokeWidth={1.5} /></span>)}</div>
  </div>
}

function HintIllustration() {
  const [open, setOpen] = useState(false)
  return <div className="story-hint">
    <div className="story-hint__circle" aria-hidden="true" />
    <img src={publicAssetUrl('images/mascot/scenes/clue-detective-v1.webp')} alt="Персонаж с лупой изучает карточки с подсказками" width="1254" height="1254" />
    <div className="story-hint__cards" data-open={open}>
      <span className="story-hint__sheet story-hint__sheet--back" aria-hidden="true" />
      <span className="story-hint__sheet story-hint__sheet--middle" aria-hidden="true" />
      <button type="button" className="story-hint__sheet story-hint__sheet--front" aria-label={open ? 'Закрыть пример подсказки' : 'Открыть пример подсказки'} aria-pressed={open} onClick={() => setOpen(value => !value)}><Lightbulb size={25} strokeWidth={1.5} /><span>{open ? 'Есть зацепка!' : 'Нужна идея?'}</span><small>{open ? 'Посмотри по-новому' : 'Выбери одну из трёх'}</small></button>
    </div>
  </div>
}

function GuestIllustration() {
  return <div className="story-guest" role="img" aria-label="Персонаж приглашает играть гостем">
    <Mascot pose="welcome" className="story-guest__mascot" width={180} height={180} alt="" />
    <div className="story-guest__card" aria-hidden="true">
      <span className="story-guest__label">Гость<span /></span>
      <Clapperboard className="story-guest__game" size={32} strokeWidth={1.35} />
      <div className="story-guest__cells"><span><Check size={13} strokeWidth={1.7} /></span><span /><span /></div>
    </div>
  </div>
}

export function SectionBody() {
  return <>
    <div className="section-story" id="mini-guide">
      <StorySection name="search" title="Начни со знакомого фильма" scene={<SearchIllustration />}><p>{rules.searchInstruction}</p><p className="story-aside">{rules.modeNote}</p></StorySection>
      <StorySection name="compare" title="Каждое совпадение — зацепка" scene={<ComparisonIllustration />}><p>{rules.comparisonInstruction}</p><p className="story-direction">{rules.directionInstruction}</p></StorySection>
      <StorySection name="attempts" title="Десять попыток. Одна разгадка." scene={<AttemptsIllustration />}><p>{content.paragraphs[1]}</p></StorySection>
      <StorySection name="hint" title="Иногда нужна свежая идея" scene={<HintIllustration />}><p>Перед пятой и восьмой попытками можно открыть по одной из трёх дополнительных подсказок.</p><div className="story-hint-times"><span>Перед 5-й попыткой</span><span>Перед 8-й попыткой</span></div></StorySection>
      <StorySection name="guest" title="Можно просто зайти и играть" scene={<GuestIllustration />}><p>{content.faq[1].answer.replace(/^Нет\. /, '')}</p></StorySection>
    </div>
    <aside id="mini-about" className="mini-reference" aria-labelledby="mini-reference-title">
      <div className="mini-reference__copy"><div className="mini-reference__label"><BookOpenText size={16} strokeWidth={1.6} aria-hidden="true" />Справка</div><h2 id="mini-reference-title">{content.heading}</h2><p>{content.paragraphs[0]}</p><p>{content.collectionMethod.text}</p></div>
      <img className="mini-reference__art" src={publicAssetUrl('images/mascot/scenes/cinema-projection-v1.webp')} width="1254" height="1254" alt="Персонаж с проектором готовится к киносеансу" />
    </aside>
  </>
}
