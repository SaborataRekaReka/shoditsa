import { ThemedArtwork } from '../../components/ui/ThemedArtwork'
import { GameArtwork } from '../../components/ui/GameArtwork'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ArrowRight, ArrowUp, BookOpenText, Check, ChevronDown, Lightbulb, Search, X } from 'lucide-react'
import { GAME_RULES, GAME_SEO, INDEXABLE_GAME_SEO, type GameSeoContent } from '../../app/seo-content'
import { Mascot } from '../../components/mascot/Mascot'
import { ReferenceIcon } from '../../components/ui/ReferenceIcon'
import { IconButton, ControlButton } from '../../components/ui'
import { publicAssetUrl } from '../../app/public-asset'
import { LOCAL_PRESENTATION, localPresentationLink } from '../../app/local-presentation'
import type { TitleMode } from '../../types'
import type { ReelPoster } from '../../components/poster-reel/PosterReel'
import { CATALOG_ENTRY_PRESENTATION, catalogEntryCovers } from './catalog-entry-presentation'
import './CatalogEntryDetails.css'

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
  return <section ref={ref} className={`entry-story-section entry-story-section--${name}`} aria-labelledby={`entry-story-${name}-title`} data-seen={seen}>
    <div className="entry-story-copy"><h2 id={`entry-story-${name}-title`}>{title}</h2>{children}</div>
    <div className={`entry-story-scene entry-story-scene--${name}`}>{scene}</div>
  </section>
}

function SearchIllustration({ mode, example }: { mode: TitleMode; example: ReelPoster }) {
  const [run, setRun] = useState(0)
  return <div className="entry-story-search">
    <div className="entry-story-search__back" aria-hidden="true"><ReferenceIcon name={mode} size={18} /><span>Твоя версия</span><span>…</span></div>
    <div className="entry-story-search__field"><Search size={18} strokeWidth={1.5} aria-hidden="true" /><span>{example.title}<span className="entry-story-search__caret" aria-hidden="true" /></span><IconButton className="entry-story-search__submit" label="Повторить пример выбора ответа" onClick={() => setRun(value => value + 1)}><ArrowRight size={17} /></IconButton></div>
    <div className="entry-story-search__result" key={run}>{example.src ? <ThemedArtwork src={example.src} alt="" width="36" height="50" /> : <ReferenceIcon name={mode} size={30} />}<div><strong>{example.title}</strong><span>Ответ из каталога</span></div><span className="entry-story-search__check"><Check size={17} strokeWidth={1.6} /></span></div>
  </div>
}

function ComparisonIllustration({ mode }: { mode: TitleMode }) {
  const criteria = CATALOG_ENTRY_PRESENTATION[mode].criteria
  const numeric = criteria.find(item => /^(Год|Период|Эпизоды|Население|Дебют)$/.test(item.label))
  const near = numeric ?? criteria[1]
  const exact = criteria.find(item => item !== near)!
  const miss = criteria.find(item => item !== near && item !== exact)!
  const outcomes = [
    { field: exact.label, title: 'Точно', tone: 'exact', Icon: Check },
    { field: near.label, title: 'Рядом', tone: 'partial', Icon: numeric ? ArrowUp : null },
    { field: miss.label, title: 'Мимо', tone: 'miss', Icon: X },
  ]

  return <div className="entry-story-compare">
    <div className="entry-story-compare__tiles" role="group" aria-label="Пример сравнительных подсказок">{outcomes.map(({ field, title, tone, Icon }) => <div key={tone} className={`entry-story-match entry-story-match--${tone}`}><span className="entry-story-match__field">{field}</span><span className="entry-story-match__status" aria-hidden="true">{Icon ? <Icon size={16} strokeWidth={1.8} /> : <span>≈</span>}</span><strong>{title}</strong></div>)}</div>
  </div>
}

function AttemptsIllustration({ mode }: { mode: TitleMode }) {
  return <div className="entry-story-attempts" aria-hidden="true">
    <div className="entry-story-attempts__heading"><strong>10</strong></div>
    <div className="entry-story-attempts__tickets">{Array.from({ length: 10 }, (_, index) => <span key={index} style={{ '--ticket-index': index } as CSSProperties}><ReferenceIcon name={mode} size={17} /></span>)}</div>
  </div>
}

function HintIllustration() {
  const [open, setOpen] = useState(false)
  return <div className="entry-story-hint">
    <div className="entry-story-hint__circle" aria-hidden="true" />
    <ThemedArtwork src={publicAssetUrl('images/mascot/scenes/clue-detective-v1.webp')} alt="Персонаж с лупой изучает карточки с подсказками" width="1254" height="1254" />
    <div className="entry-story-hint__cards" data-open={open}>
      <span className="entry-story-hint__sheet entry-story-hint__sheet--back" aria-hidden="true" />
      <span className="entry-story-hint__sheet entry-story-hint__sheet--middle" aria-hidden="true" />
      <ControlButton className="entry-story-hint__sheet entry-story-hint__sheet--front" aria-label={open ? 'Закрыть пример подсказки' : 'Открыть пример подсказки'} aria-pressed={open} onClick={() => setOpen(value => !value)}><Lightbulb size={25} strokeWidth={1.5} /><span>{open ? 'Есть зацепка!' : 'Нужна идея?'}</span><small>{open ? 'Посмотри по-новому' : 'Выбери одну из трёх'}</small></ControlButton>
    </div>
  </div>
}

function GuestIllustration({ mode }: { mode: TitleMode }) {
  return <div className="entry-story-guest" role="img" aria-label="Персонаж приглашает играть гостем">
    <Mascot pose="welcome" className="entry-story-guest__mascot" width={180} height={180} alt="" />
    <div className="entry-story-guest__card" aria-hidden="true">
      <span className="entry-story-guest__label">Гость<span /></span>
      <ReferenceIcon name={mode} className="entry-story-guest__game" size={32} />
      <div className="entry-story-guest__cells"><span><Check size={13} strokeWidth={1.7} /></span><span /><span /></div>
    </div>
  </div>
}

export function CatalogEntryDetails({ mode }: { mode: TitleMode }) {
  const content: GameSeoContent = GAME_SEO[mode]
  const rules = GAME_RULES[mode]
  const design = CATALOG_ENTRY_PRESENTATION[mode]
  const example = catalogEntryCovers(mode)[mode === 'movie' ? 3 : 0]
  const attemptParagraph = content.paragraphs.find(text => /десять попыток|десяти попыток|10 попыток/.test(text))
  const guestAnswer = content.faq.find(entry => /регистр|аккаунт|гост/.test(entry.question))?.answer ?? GAME_SEO.movie.faq[1].answer
  const otherGames = INDEXABLE_GAME_SEO.filter(game => game.mode !== mode && (!LOCAL_PRESENTATION || !['danetki', 'connections'].includes(game.mode)))
  const featured = [...otherGames.filter(game => content.relatedModes?.includes(game.mode)), ...otherGames.filter(game => !content.relatedModes?.includes(game.mode))].slice(0, 3)
  const moreGames = otherGames.filter(game => !featured.includes(game))
  const sources = content.collectionMethod.sources.filter(source => source.label !== 'Навигатор Кинопоиска')
  return <>
    <div className="entry-stories" id={`entry-guide-${mode}`}>
      <StorySection name="search" title={design.searchTitle} scene={<SearchIllustration mode={mode} example={example} />}><p>{rules.searchInstruction}</p>{rules.modeNote && <p className="entry-story-aside">{rules.modeNote}</p>}</StorySection>
      <StorySection name="compare" title="Каждое совпадение — зацепка" scene={<ComparisonIllustration mode={mode} />}><p>{rules.comparisonInstruction}</p><ul className="entry-story-features">{content.features.map(feature => <li key={feature}>{feature}</li>)}</ul>{rules.directionInstruction && <p className="entry-story-direction">{rules.directionInstruction}</p>}</StorySection>
      <StorySection name="attempts" title="Десять попыток. Одна разгадка." scene={<AttemptsIllustration mode={mode} />}><p>{attemptParagraph ?? content.faq.find(entry => /попыток/.test(entry.question))?.answer ?? 'На поиск ответа даётся десять попыток. Загадка обновляется каждый день.'}</p></StorySection>
      <StorySection name="hint" title="Иногда нужна свежая идея" scene={<HintIllustration />}><p>Перед пятой и восьмой попытками можно открыть по одной из трёх дополнительных подсказок.</p><div className="entry-story-hint-times"><span>Перед 5-й попыткой</span><span>Перед 8-й попыткой</span></div></StorySection>
      <StorySection name="guest" title="Можно просто зайти и играть" scene={<GuestIllustration mode={mode} />}><p>{guestAnswer.replace(/^Нет\. /, '')}</p></StorySection>
    </div>
    <aside id={`about-${mode}`} className="entry-reference" aria-labelledby={`entry-reference-${mode}`}>
      <div className="entry-reference__copy"><div className="entry-reference__label"><BookOpenText size={16} strokeWidth={1.6} aria-hidden="true" />Справка</div><h2 id={`entry-reference-${mode}`}>{content.heading}</h2><p>{content.lead}</p>{content.paragraphs.filter(text => text !== attemptParagraph).map(text => <p key={text}>{text}</p>)}<p>{content.collectionMethod.text}</p></div>
      <ThemedArtwork className="entry-reference__art" src={publicAssetUrl(mode === 'movie' ? 'images/mascot/scenes/cinema-projection-v1.webp' : `images/home-doodle/${mode}.webp`)} width="250" height="250" alt="" />
    </aside>
    {content.searchSummary && <section className="entry-search-summary" aria-labelledby={`entry-search-summary-${mode}`}><h2 id={`entry-search-summary-${mode}`}>{content.searchSummary.heading}</h2>{content.searchSummary.paragraphs.map(text => <p key={text}>{text}</p>)}{content.searchSummary.action && <a href={localPresentationLink(content.searchSummary.action.href)}>{content.searchSummary.action.label}<ArrowRight size={15} /></a>}</section>}
    <section className="entry-faq" aria-labelledby={`entry-faq-${mode}`}><h2 id={`entry-faq-${mode}`}>Вопросы об игре</h2><div>{content.faq.map(entry => <details key={entry.question}><summary><span>{entry.question}</span><ChevronDown size={16} aria-hidden="true" /></summary><p>{entry.answer}</p></details>)}</div></section>
    {sources.length > 0 && <details className="entry-sources"><summary>Источники набора<ChevronDown size={16} aria-hidden="true" /></summary><div>{sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label}<ArrowRight size={14} /></a>)}</div></details>}
    <nav className="entry-more" aria-labelledby={`entry-more-${mode}`}><div className="entry-section-head"><h2 id={`entry-more-${mode}`}>Ещё одна загадка?</h2><a href={localPresentationLink('/')}>Все игры<ArrowRight size={15} /></a></div><div className="entry-more__cards">{featured.map(game => <a key={game.mode} className="entry-game" href={localPresentationLink(game.canonicalPath)}><div><h3>{game.shortName}</h3><ArrowRight size={16} /></div><GameArtwork mode={game.mode} width="90" height="90" alt="" /></a>)}</div><div className="entry-more__links">{moreGames.map(game => <a key={game.mode} href={localPresentationLink(game.canonicalPath)}>{game.shortName}<ArrowRight size={12} /></a>)}</div></nav>
  </>
}
