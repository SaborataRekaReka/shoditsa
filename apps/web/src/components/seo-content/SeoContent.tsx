import type { PlayableModeId } from '@shoditsa/contracts'
import type { LucideIcon } from 'lucide-react'
import {
  BookOpenText,
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  Film,
  Flower2,
  Gamepad2,
  MapPinned,
  Music2,
  Route,
  ScanSearch,
  Sparkles,
  Stethoscope,
  Target,
  Tv,
} from 'lucide-react'
import { GAME_GUIDE_PRESENTATION, GAME_SEO, HOME_SEO, INDEXABLE_GAME_SEO } from '../../app/seo-content'
import './SeoContent.css'

const GUIDE_ICONS = {
  movie: Film,
  series: Tv,
  anime: Flower2,
  game: Gamepad2,
  city: MapPinned,
  music: Music2,
  diagnosis: Stethoscope,
} satisfies Record<PlayableModeId, LucideIcon>

const GuideSummary = ({ title, note }: { title: string; note: string }) => <summary className="seo-content__summary">
  <span className="seo-content__summary-title"><BookOpenText aria-hidden="true" /> {title}</span>
  <small>{note}</small>
  <ChevronDown className="seo-content__summary-chevron" aria-hidden="true" />
</summary>

export function GameArtifactSeoDetails({ mode }: { mode: PlayableModeId }) {
  const content = GAME_SEO[mode]
  const presentation = GAME_GUIDE_PRESENTATION[mode]
  const ModeIcon = GUIDE_ICONS[mode]
  return <details className={`artifact-dossier ticket-dossier ticket-dossier--${mode}`}>
    <summary className="ticket-dossier__summary">
      <span className="ticket-dossier__summary-title">
        <ModeIcon aria-hidden="true" />
        <span>
          <strong className="ticket-dossier__closed-label">{presentation.closedLabel}</strong>
          <strong className="ticket-dossier__open-label">{presentation.openLabel}</strong>
          <small>об игре · подсказки · вопросы</small>
        </span>
      </span>
      <ChevronDown className="ticket-dossier__chevron" aria-hidden="true" />
    </summary>

    <div className="ticket-dossier__drawer">
      <header className="ticket-dossier__intro">
        <span className="ticket-dossier__frame" aria-hidden="true">01</span>
        <div>
          <span className="ticket-dossier__eyebrow">{presentation.introLabel}</span>
          <h3 id={`about-${mode}`}>{content.heading}</h3>
          <p className="ticket-dossier__lead">{content.lead}</p>
        </div>
      </header>

      <section className="ticket-dossier__story" aria-label="Об игре подробнее">
        {content.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
      </section>

      <div className="ticket-dossier__guide">
        <section className="ticket-dossier__evidence" aria-labelledby={`artifact-features-${mode}`}>
          <header><ScanSearch aria-hidden="true" /><div><span>{presentation.evidenceLabel}</span><h4 id={`artifact-features-${mode}`}>{presentation.evidenceTitle}</h4></div></header>
          <ul>{content.features.map((feature) => <li key={feature}><Check aria-hidden="true" /><span>{feature}</span></li>)}</ul>
        </section>
        <section className="ticket-dossier__route" aria-labelledby={`artifact-steps-${mode}`}>
          <header><Route aria-hidden="true" /><div><span>{presentation.routeLabel}</span><h4 id={`artifact-steps-${mode}`}>{presentation.routeTitle}</h4></div></header>
          <ol>{content.steps.map((step, index) => <li key={step}><strong>{String(index + 1).padStart(2, '0')}</strong><span>{step}</span></li>)}</ol>
        </section>
      </div>

      <section className="ticket-dossier__faq" aria-labelledby={`artifact-faq-${mode}`}>
        <header><CircleHelp aria-hidden="true" /><div><span>{presentation.faqLabel}</span><h4 id={`artifact-faq-${mode}`}>{presentation.faqTitle}</h4></div></header>
        <div>{content.faq.map((entry) => <details key={entry.question}>
          <summary><span>{entry.question}</span><ChevronDown aria-hidden="true" /></summary>
          <p>{entry.answer}</p>
        </details>)}</div>
      </section>

      <nav className="ticket-dossier__links" aria-label="Другие ежедневные игры">
        <span><Sparkles aria-hidden="true" /> {presentation.linksLabel}</span>
        <div>{INDEXABLE_GAME_SEO.filter((game) => game.mode !== mode).map((game) => <a key={game.mode} href={game.canonicalPath}>{game.shortName}</a>)}</div>
      </nav>
    </div>
  </details>
}

export function HomeSeoContent() {
  return <section className="seo-content seo-content--home" aria-labelledby="home-about-title">
    <header className="seo-content__preview">
      <span className="seo-content__seal" aria-hidden="true"><Sparkles /></span>
      <div className="seo-content__preview-copy">
        <span className="seo-content__eyebrow">Путеводитель по «Сходится!»</span>
        <h2 id="home-about-title">{HOME_SEO.heading}</h2>
        <p className="seo-content__lead">{HOME_SEO.lead}</p>
      </div>
      <div className="seo-content__signals" aria-label="Коротко о платформе">
        <span><Target aria-hidden="true" /><strong>7 игр</strong><small>в одном месте</small></span>
        <span><CalendarDays aria-hidden="true" /><strong>Каждый день</strong><small>новые загадки</small></span>
      </div>
    </header>
    <details className="seo-content__details">
      <GuideSummary title="Как устроены ежедневные игры" note="формат · подсказки · все режимы" />
      <div className="seo-content__drawer">
        <section className="seo-content__story" aria-label="О платформе">
          <span className="seo-content__story-mark" aria-hidden="true">01</span>
          <div>{HOME_SEO.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
        </section>
        <nav className="seo-content__game-links" aria-label="Все ежедневные игры">
          <span><Route aria-hidden="true" /> Выберите маршрут</span>
          <div>{INDEXABLE_GAME_SEO.map((game) => <a key={game.mode} href={game.canonicalPath}>{game.shortName}</a>)}</div>
        </nav>
      </div>
    </details>
  </section>
}
