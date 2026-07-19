import type { PlayableModeId } from '@shoditsa/contracts'
import type { LucideIcon } from 'lucide-react'
import { useRef } from 'react'
import {
  BookOpenText,
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
  Tv,
} from 'lucide-react'
import { GAME_GUIDE_PRESENTATION, GAME_RULES, GAME_SEO, HOME_SEO, INDEXABLE_GAME_SEO } from '../../app/seo-content'
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

const GuideSummary = ({ title, openTitle, note }: { title: string; openTitle: string; note: string }) => <summary className="hub-guide__summary">
  <span className="hub-guide__summary-title"><BookOpenText aria-hidden="true" /><span><strong className="hub-guide__closed-label">{title}</strong><strong className="hub-guide__open-label">{openTitle}</strong></span></span>
  <small>{note}</small>
  <ChevronDown className="hub-guide__summary-chevron" aria-hidden="true" />
</summary>

export function GameArtifactSeoDetails({ mode }: { mode: PlayableModeId }) {
  const content = GAME_SEO[mode]
  const presentation = GAME_GUIDE_PRESENTATION[mode]
  const rules = GAME_RULES[mode]
  const ModeIcon = GUIDE_ICONS[mode]
  const scrollPosition = useRef<number | null>(null)
  return <details
    className={`artifact-dossier ticket-dossier ticket-dossier--${mode}`}
    onToggle={(event) => {
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
      onPointerDown={() => { scrollPosition.current = window.scrollY }}
      onMouseDown={(event) => { event.preventDefault() }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') scrollPosition.current = window.scrollY
      }}
    >
      <span className="ticket-dossier__summary-title">
        <ModeIcon aria-hidden="true" />
        <span>
          <strong className="ticket-dossier__closed-label">{presentation.closedLabel}</strong>
          <strong className="ticket-dossier__open-label">{presentation.openLabel}</strong>
          <small>как играть · подсказки · вопросы</small>
        </span>
      </span>
      <ChevronDown className="ticket-dossier__chevron" aria-hidden="true" />
    </summary>

    <div className="ticket-dossier__drawer">
      <header className="ticket-dossier__intro">
        <div>
          <span className="ticket-dossier__eyebrow">{presentation.introLabel}</span>
          <h3 id={`about-${mode}`}>{content.heading}</h3>
          <p className="ticket-dossier__lead">{content.lead}</p>
        </div>
      </header>

      <section className="ticket-dossier__rules" aria-labelledby={`artifact-rules-${mode}`}>
        <header><BookOpenText aria-hidden="true" /><div><span>Правила игры</span><h4 id={`artifact-rules-${mode}`}>Как играть</h4></div></header>
        <ol>
          <li><strong>01</strong><span>{rules.searchInstruction}</span></li>
          <li><strong>02</strong><span>{rules.comparisonInstruction}</span></li>
          <li><strong>03</strong><span>Перед пятой и восьмой попытками можно открыть по одной из трёх дополнительных подсказок.</span></li>
        </ol>
        <div className="ticket-dossier__legend" aria-label="Значения цветов подсказок">
          <span><i className="match" /><b>Точно</b><small>значение совпало</small></span>
          <span><i className="close" /><b>Рядом</b><small>число близко или есть частичное совпадение</small></span>
          <span><i className="miss" /><b>Мимо</b><small>значение не совпало</small></span>
        </div>
        {rules.directionInstruction && <p>{rules.directionInstruction}</p>}
        {rules.modeNote && <p className="ticket-dossier__mode-note">{rules.modeNote}</p>}
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

      <details className="ticket-dossier__more">
        <summary><span>Подробнее об игре</span><ChevronDown aria-hidden="true" /></summary>
        <section className="ticket-dossier__story" aria-label="Об игре подробнее">
          {content.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </section>
      </details>

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
  return <details className="hub-guide">
    <GuideSummary title="Как устроены ежедневные игры" openTitle="Путеводитель по «Сходится!»" note="формат · подсказки · все режимы" />
    <div className="hub-guide__drawer">
      <header className="hub-guide__intro">
        <span>Путеводитель · без спойлеров</span>
        <h2 id="home-about-title">{HOME_SEO.heading}</h2>
        <p>{HOME_SEO.lead}</p>
      </header>
      <div className="hub-guide__content">
        <section className="hub-guide__story" aria-label="О платформе">
          {HOME_SEO.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </section>
        <nav className="hub-guide__game-links" aria-label="Все ежедневные игры">
          <span><Route aria-hidden="true" /> Все игровые маршруты</span>
          <div>{INDEXABLE_GAME_SEO.map((game) => <a key={game.mode} href={game.canonicalPath}>{game.shortName}</a>)}</div>
        </nav>
      </div>
    </div>
  </details>
}
