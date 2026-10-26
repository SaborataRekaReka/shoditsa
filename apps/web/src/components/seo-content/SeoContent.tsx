import type { LucideIcon } from 'lucide-react'
import { useRef, useState } from 'react'
import { BookOpenText, BookOpen, Check, ChevronDown, CircleHelp, Database, Drama, Film, Flower2, Gamepad2, Grid2X2, MapPinned, Music2, PawPrint, Route, ScanSearch, Lightbulb, Stethoscope, Tv } from 'lucide-react'
import { DANETKI_RULES, GAME_GUIDE_PRESENTATION, GAME_RULES, GAME_SEO, HOME_SEO, INDEXABLE_GAME_SEO, type GameSeoContent, type SeoGameMode } from '../../app/seo-content'
import { PUBLIC_GAME_LINKS } from '../../app/public-game-links'
import { LOCAL_PRESENTATION, REFERENCE_PRESENTATION, localPresentationLink } from '../../app/local-presentation'
import { DANETKI_DISCOVERY_LINKS } from '../../app/danetki-discovery-links'
import { trackMetrikaGoal } from '../../app/metrics'
import { ReferenceIcon, type ReferenceIconName } from '../ui/ReferenceIcon'
import './SeoContent.css'

const GUIDE_ICONS = {
  movie: Film,
  series: Tv,
  anime: Flower2,
  game: Gamepad2,
  city: MapPinned,
  music: Music2,
  diagnosis: Stethoscope,
  animal: PawPrint,
  book: BookOpen,
  character: Drama,
  connections: Grid2X2,
  danetki: ScanSearch,
  word: Lightbulb,
} satisfies Record<SeoGameMode, LucideIcon>

const INDEXABLE_GAME_CONTENT = INDEXABLE_GAME_SEO as readonly GameSeoContent[]

const GuideIcon = ({ name, fallback: Fallback }: { name: ReferenceIconName; fallback: LucideIcon }) => REFERENCE_PRESENTATION
  ? <ReferenceIcon name={name} />
  : <Fallback aria-hidden="true" />

const GuideSummary = ({ title, openTitle, note, expanded, controls }: { title: string; openTitle: string; note: string; expanded: boolean; controls: string }) => <summary className="hub-guide__summary" role="button" aria-expanded={expanded} aria-controls={controls}>
  <span className="hub-guide__summary-title"><GuideIcon name="guide" fallback={BookOpenText} /><span><strong className="hub-guide__closed-label">{title}</strong><strong className="hub-guide__open-label">{openTitle}</strong></span></span>
  <small>{note}</small>
  <ChevronDown className="hub-guide__summary-chevron" aria-hidden="true" />
</summary>

const GameSearchSummary = ({ mode, landing = false, preserveLiveLinks = false }: { mode: SeoGameMode; landing?: boolean; preserveLiveLinks?: boolean }) => {
  const content: GameSeoContent = GAME_SEO[mode]
  const summary = content.searchSummary
  if (!summary) return null
  return <section className={landing ? 'game-landing__search' : `ticket-search-summary ticket-search-summary--${mode}`} aria-labelledby={`search-summary-${mode}`}>
    {!landing && <span>Играть онлайн, без спойлеров</span>}
    <h2 id={`search-summary-${mode}`}>{summary.heading}</h2>
    <div>{summary.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
    {summary.action && <a
      href={preserveLiveLinks ? summary.action.href : localPresentationLink(summary.action.href)}
      onClick={() => trackMetrikaGoal('seo_search_action_clicked', { mode, destination: summary.action?.href })}
    >{summary.action.label}<span aria-hidden="true">↗</span></a>}
    {!!content.relatedModes?.length && <nav className="ticket-search-summary__related" aria-label="Похожие игры">
      <span>Попробуйте также</span>
      <div>{content.relatedModes.map((relatedMode) => {
        const related: GameSeoContent = GAME_SEO[relatedMode]
        return <a key={related.mode} href={preserveLiveLinks ? related.canonicalPath : localPresentationLink(related.canonicalPath)}>{related.internalLinkLabel ?? related.shortName}</a>
      })}</div>
    </nav>}
  </section>
}

export function GameArtifactSeoDetails({ mode, variant = 'auto' }: { mode: SeoGameMode; variant?: 'auto' | 'live' }) {
  if (variant === 'live') return <LegacyGameArtifactSeoDetails mode={mode} preserveLiveLinks />
  return REFERENCE_PRESENTATION ? <ReferenceGameLanding mode={mode} /> : <LegacyGameArtifactSeoDetails mode={mode} />
}

function ReferenceGameLanding({ mode }: { mode: SeoGameMode }) {
  const content: GameSeoContent = GAME_SEO[mode]
  const presentation = GAME_GUIDE_PRESENTATION[mode]
  const rules = mode === 'danetki' ? DANETKI_RULES : GAME_RULES[mode]
  const comparable = mode !== 'danetki' && mode !== 'connections' && mode !== 'word'
  const instructions = [rules.searchInstruction, rules.comparisonInstruction, comparable
    ? 'Перед пятой и восьмой попытками можно открыть по одной из трёх дополнительных подсказок.'
    : rules.directionInstruction]
  const otherGames = INDEXABLE_GAME_CONTENT.filter((game) => game.mode !== mode && (!LOCAL_PRESENTATION || !['danetki', 'connections'].includes(game.mode)))
  const story = <div className="game-landing__story" id={`artifact-story-${mode}`} aria-label="Об игре подробнее">
    {content.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
  </div>

  return <div className={`game-landing game-landing--${mode}`}>
    <section className="game-landing__intro" aria-labelledby={`about-${mode}`}>
      <header>
        <h2 id={`about-${mode}`}>{content.heading}</h2>
        <p className="game-landing__lead">{content.lead}</p>
        {content.searchSummary && story}
      </header>
      {content.searchSummary ? <GameSearchSummary mode={mode} landing /> : story}
    </section>

    <section className="game-landing__rules" aria-labelledby={`artifact-rules-${mode}`}>
      <h2 id={`artifact-rules-${mode}`}>Как играть</h2>
      <ol className="game-landing__instructions">{instructions.map((instruction, index) => <li key={instruction}>
        <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><p>{instruction}</p>
      </li>)}</ol>
      {comparable && <div className="game-landing__legend" aria-label="Значения цветов подсказок">
        <span className="is-match"><ReferenceIcon name="check" size={18} /><span><strong>Точно</strong><small>значение совпало</small></span></span>
        <span className="is-close"><span aria-hidden="true">≈</span><span><strong>Рядом</strong><small>число близко или есть частичное совпадение</small></span></span>
        <span className="is-miss"><span aria-hidden="true">×</span><span><strong>Мимо</strong><small>значение не совпало</small></span></span>
      </div>}
      {(comparable && rules.directionInstruction || rules.modeNote) && <div className="game-landing__rule-notes">
        {comparable && rules.directionInstruction && <p>{rules.directionInstruction}</p>}
        {rules.modeNote && <p>{rules.modeNote}</p>}
      </div>}
    </section>

    <div className="game-landing__comparison">
      <section aria-labelledby={`artifact-features-${mode}`}>
        <h2 id={`artifact-features-${mode}`}>{presentation.evidenceTitle}</h2>
        <ul>{content.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
      </section>
      <section aria-labelledby={`artifact-steps-${mode}`}>
        <h2 id={`artifact-steps-${mode}`}>{presentation.routeTitle}</h2>
        <ol>{content.steps.map((step) => <li key={step}>{step}</li>)}</ol>
      </section>
    </div>

    <section className="game-landing__faq" aria-labelledby={`artifact-faq-${mode}`}>
      <h2 id={`artifact-faq-${mode}`}>{presentation.faqTitle}</h2>
      <div>{content.faq.map((entry) => <details key={entry.question}>
        <summary><span>{entry.question}</span><ChevronDown aria-hidden="true" /></summary>
        <p>{entry.answer}</p>
      </details>)}</div>
    </section>

    <details className="game-landing__method">
      <summary><span><ReferenceIcon name="guide" size={20} />Как собран набор</span><ChevronDown aria-hidden="true" /></summary>
      <div>
        <p>{content.collectionMethod.text}</p>
        {content.collectionMethod.sources.length > 0 && <div className="game-landing__sources">
          {content.collectionMethod.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label}</a>)}
        </div>}
      </div>
    </details>

    <nav className="game-landing__games" aria-label="Другие ежедневные игры">
      <h2>{presentation.linksLabel}</h2>
      <div>{otherGames.map((game) => <a key={game.mode} href={localPresentationLink(game.canonicalPath)}>
        <ReferenceIcon name={game.mode} size={24} /><span>{game.internalLinkLabel ?? game.shortName}</span><ReferenceIcon name="arrow" size={18} />
      </a>)}</div>
    </nav>
    {!LOCAL_PRESENTATION && <nav className="game-landing__collections" aria-label="Данетки с ответами">
      <h2>Подборки и классические истории</h2>
      <div>{DANETKI_DISCOVERY_LINKS.map((link) => <a key={link.href} href={link.href}>{link.label}</a>)}</div>
    </nav>}
  </div>
}

function LegacyGameArtifactSeoDetails({ mode, preserveLiveLinks = false }: { mode: SeoGameMode; preserveLiveLinks?: boolean }) {
  const content = GAME_SEO[mode]
  const presentation = GAME_GUIDE_PRESENTATION[mode]
  const rules = mode === 'danetki' ? DANETKI_RULES : GAME_RULES[mode]
  const ModeIcon = GUIDE_ICONS[mode]
  const scrollPosition = useRef<number | null>(null)
  const [open, setOpen] = useState(false)
  return <>
    <GameSearchSummary mode={mode} preserveLiveLinks={preserveLiveLinks} />
    <details
    className={`artifact-dossier ticket-dossier ticket-dossier--${mode}`}
    open={open}
    onToggle={(event) => {
      setOpen(event.currentTarget.open)
      if (!event.currentTarget.open || scrollPosition.current === null) return
      const top = scrollPosition.current
      const details = event.currentTarget
      scrollPosition.current = null
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => window.scrollTo({ top, behavior: 'auto' })))
      window.setTimeout(() => {
        if (details.open) window.scrollTo({ top, behavior: 'auto' })
      }, 320)
    }}
  >
    <summary
      className="ticket-dossier__summary"
      role="button"
      aria-expanded={open}
      aria-controls={`ticket-dossier-drawer-${mode}`}
      onPointerDown={() => { scrollPosition.current = window.scrollY }}
      onMouseDown={(event) => { event.preventDefault() }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') scrollPosition.current = window.scrollY
      }}
    >
      <span className="ticket-dossier__summary-title">
        <GuideIcon name={mode} fallback={ModeIcon} />
        <span>
          <strong className="ticket-dossier__closed-label">{presentation.closedLabel}</strong>
          <strong className="ticket-dossier__open-label">{presentation.openLabel}</strong>
          <small>как играть, подсказки, вопросы</small>
        </span>
      </span>
      <ChevronDown className="ticket-dossier__chevron" aria-hidden="true" />
    </summary>

    <div className="ticket-dossier__drawer" id={`ticket-dossier-drawer-${mode}`}>
      <header className="ticket-dossier__intro">
        <div>
          {mode !== 'diagnosis' && <span className="ticket-dossier__eyebrow">{presentation.introLabel}</span>}
          <h3 id={`about-${mode}`}>{content.heading}</h3>
          <p className="ticket-dossier__lead">{content.lead}</p>
        </div>
      </header>

      <section className="ticket-dossier__collection" aria-labelledby={`artifact-collection-${mode}`}>
        <GuideIcon name="guide" fallback={Database} />
        <div>
          <span>Происхождение каталога</span>
          <h4 id={`artifact-collection-${mode}`}>Как собран набор</h4>
          <p>{content.collectionMethod.text}</p>
          {content.collectionMethod.sources.length > 0 && <div className="ticket-dossier__collection-links">
            {content.collectionMethod.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label}</a>)}
          </div>}
        </div>
      </section>

      <section className="ticket-dossier__rules" aria-labelledby={`artifact-rules-${mode}`}>
        <header><GuideIcon name="guide" fallback={BookOpenText} /><div><span>Правила игры</span><h4 id={`artifact-rules-${mode}`}>Как играть</h4></div></header>
        <ol>
          <li><strong>01</strong><span>{rules.searchInstruction}</span></li>
          <li><strong>02</strong><span>{rules.comparisonInstruction}</span></li>
          <li><strong>03</strong><span>{mode === 'word'
            ? GAME_RULES.word.directionInstruction
            : mode === 'danetki'
            ? DANETKI_RULES.directionInstruction
            : mode === 'connections'
              ? GAME_RULES.connections.directionInstruction
              : 'Перед пятой и восьмой попытками можно открыть по одной из трёх дополнительных подсказок.'}</span></li>
        </ol>
        {mode !== 'word' && mode !== 'danetki' && mode !== 'connections' && <div className="ticket-dossier__legend" aria-label="Значения цветов подсказок">
          <span><i className="match" /><b>Точно</b><small>значение совпало</small></span>
          <span><i className="close" /><b>Рядом</b><small>число близко или есть частичное совпадение</small></span>
          <span><i className="miss" /><b>Мимо</b><small>значение не совпало</small></span>
        </div>}
        {mode !== 'word' && mode !== 'danetki' && mode !== 'connections' && rules.directionInstruction && <p>{rules.directionInstruction}</p>}
        {rules.modeNote && <p className="ticket-dossier__mode-note">{rules.modeNote}</p>}
      </section>

      <div className="ticket-dossier__guide">
        <section className="ticket-dossier__evidence" aria-labelledby={`artifact-features-${mode}`}>
          <header><GuideIcon name="search" fallback={ScanSearch} /><div><span>{presentation.evidenceLabel}</span><h4 id={`artifact-features-${mode}`}>{presentation.evidenceTitle}</h4></div></header>
          <ul>{content.features.map((feature) => <li key={feature}><Check aria-hidden="true" /><span>{feature}</span></li>)}</ul>
        </section>
        <section className="ticket-dossier__route" aria-labelledby={`artifact-steps-${mode}`}>
          <header><GuideIcon name="arrow" fallback={Route} /><div><span>{presentation.routeLabel}</span><h4 id={`artifact-steps-${mode}`}>{presentation.routeTitle}</h4></div></header>
          <ol>{content.steps.map((step, index) => <li key={step}><strong>{String(index + 1).padStart(2, '0')}</strong><span>{step}</span></li>)}</ol>
        </section>
      </div>

      <details className="ticket-dossier__more">
        <summary><span>Подробнее об игре</span><ChevronDown aria-hidden="true" /></summary>
        <section className="ticket-dossier__story" aria-label="Об игре подробнее">
          {content.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </section>
      </details>

      <section className="ticket-dossier__faq" aria-labelledby={`artifact-faq-${mode}`}>
        <header><GuideIcon name="danetki" fallback={CircleHelp} /><div><span>{presentation.faqLabel}</span><h4 id={`artifact-faq-${mode}`}>{presentation.faqTitle}</h4></div></header>
        <div>{content.faq.map((entry) => <details key={entry.question}>
          <summary><span>{entry.question}</span><ChevronDown aria-hidden="true" /></summary>
          <p>{entry.answer}</p>
        </details>)}</div>
      </section>

      <nav className="ticket-dossier__links" aria-label="Другие ежедневные игры">
        <span><GuideIcon name="idea" fallback={Lightbulb} /> {presentation.linksLabel}</span>
        <div>{INDEXABLE_GAME_CONTENT.filter((game) => game.mode !== mode && (preserveLiveLinks || !LOCAL_PRESENTATION || !['danetki', 'connections'].includes(game.mode))).map((game) => <a key={game.mode} href={preserveLiveLinks ? game.canonicalPath : localPresentationLink(game.canonicalPath)}>{game.internalLinkLabel ?? game.shortName}</a>)}</div>
      </nav>
      {(preserveLiveLinks || !LOCAL_PRESENTATION) && <nav className="ticket-dossier__links" aria-label="Данетки с ответами">
        <span><GuideIcon name="idea" fallback={Lightbulb} /> Подборки и классические истории</span>
        <div>{DANETKI_DISCOVERY_LINKS.map((link) => <a key={link.href} href={link.href}>{link.label}</a>)}</div>
      </nav>}
    </div>
    </details>
  </>
}

export function HomeSeoContent({ variant = 'default' }: { variant?: 'default' | 'reference' } = {}) {
  const [open, setOpen] = useState(false)
  if (variant === 'reference') return <details className="hub-guide hub-guide--reference" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <GuideSummary title="Как устроены ежедневные игры" openTitle="Путеводитель по «Сходится!»" note="формат, подсказки, все режимы" expanded={open} controls="home-guide-drawer" />
    <div className="hub-guide__drawer" id="home-guide-drawer">
      <div className="home-guide-overview">
        <header className="hub-guide__intro">
          <h2 id="home-about-title">{HOME_SEO.heading}</h2>
          <p>{HOME_SEO.lead}</p>
        </header>
        <section className="hub-guide__story" aria-label="О платформе">
          {HOME_SEO.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </section>
      </div>
      <div className="home-guide-navigation">
        <nav className="home-guide-links" aria-label="Все ежедневные игры">
          <h3>Во что можно сыграть</h3>
          <div>{PUBLIC_GAME_LINKS.map((game) => <a key={game.mode} href={localPresentationLink(game.href)}>{game.label}</a>)}</div>
        </nav>
        <nav className="home-guide-links home-guide-links--stories" aria-label="Данетки с ответами">
          <h3>Данетки и классические истории</h3>
          <div>{DANETKI_DISCOVERY_LINKS.map((link) => <a key={link.href} href={localPresentationLink(link.href)}>{link.label}</a>)}</div>
        </nav>
      </div>
    </div>
  </details>
  return <details className="hub-guide" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <GuideSummary title="Как устроены ежедневные игры" openTitle="Путеводитель по «Сходится!»" note="формат, подсказки, все режимы" expanded={open} controls="home-guide-drawer" />
    <div className="hub-guide__drawer" id="home-guide-drawer">
      <header className="hub-guide__intro">
        <span>Путеводитель, без спойлеров</span>
        <h2 id="home-about-title">{HOME_SEO.heading}</h2>
        <p>{HOME_SEO.lead}</p>
      </header>
      <div className="hub-guide__content">
        <section className="hub-guide__story" aria-label="О платформе">
          {HOME_SEO.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </section>
        <nav className="hub-guide__game-links" aria-label="Все ежедневные игры">
          <span><Route aria-hidden="true" /> Все игровые маршруты</span>
          <div>{PUBLIC_GAME_LINKS.map((game) => <a key={game.mode} href={localPresentationLink(game.href)}>{game.label}</a>)}</div>
        </nav>
        <nav className="hub-guide__game-links" aria-label="Данетки с ответами">
          <span><Route aria-hidden="true" /> Подборки и классические истории</span>
          <div>{DANETKI_DISCOVERY_LINKS.map((link) => <a key={link.href} href={localPresentationLink(link.href)}>{link.label}</a>)}</div>
        </nav>
      </div>
    </div>
  </details>
}
