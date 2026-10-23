import type { ReactNode } from 'react'
import { Check, Minus } from 'lucide-react'
import type { Attempt, TitleItem, TitleMode } from '../../types'
import { TitlePoster } from '../../components/title-poster/TitlePoster'
import { attemptProgressStats } from '../../game/attempt-progress'
import './ComparisonAttemptCard.css'

export type AttemptPresentation = {
  media: 'poster' | 'landscape' | 'photo' | 'portrait' | 'illustration' | 'emblem'
  summary: 'compact' | 'labels' | 'bar'
}

// Modes configure presentation here; their comparison rules and clue bodies stay with the game.
export const ATTEMPT_PRESENTATION = {
  movie: { media: 'poster', summary: 'compact' },
  series: { media: 'poster', summary: 'compact' },
  anime: { media: 'poster', summary: 'compact' },
  game: { media: 'landscape', summary: 'compact' },
  city: { media: 'emblem', summary: 'compact' },
  music: { media: 'photo', summary: 'compact' },
  diagnosis: { media: 'illustration', summary: 'compact' },
  animal: { media: 'photo', summary: 'compact' },
  book: { media: 'poster', summary: 'compact' },
  character: { media: 'portrait', summary: 'compact' },
} satisfies Record<TitleMode, AttemptPresentation>

export function AttemptMatchSummary({ hints, variant = 'compact' }: {
  hints: Attempt['hints']
  variant?: AttemptPresentation['summary']
}) {
  const { matchedFields, partialFields, totalFields } = attemptProgressStats(hints)
  const label = `Точных совпадений: ${matchedFields} из ${totalFields}; частичных: ${partialFields}`
  return <div className={`attempt-match attempt-match--${variant}`} role="img" aria-label={label} title={label}>
    {variant !== 'bar' && <span className="attempt-match__label" aria-hidden="true">Сходится</span>}
    <span className="attempt-match__bar" aria-hidden="true">
      {Array.from({ length: totalFields }, (_, index) => <i key={index} className={index < matchedFields ? 'exact' : index < matchedFields + partialFields ? 'partial' : ''} />)}
    </span>
    {variant !== 'bar' && <span className="attempt-match__counts" aria-hidden="true">
      <span className="attempt-match__count attempt-match__count--exact"><Check /><b>{matchedFields}</b>{variant === 'labels' && <small>точно</small>}</span>
      {partialFields > 0 && <span className="attempt-match__count attempt-match__count--partial"><Minus /><b>{partialFields}</b>{variant === 'labels' && <small>частично</small>}</span>}
    </span>}
  </div>
}

export function AttemptMetadata({ label, children }: { label: string; children: ReactNode }) {
  return <div className="comparison-attempt__metadata"><small>{label}</small><strong>{children}</strong></div>
}

/** Only the submitted item and its hints enter this view, never the hidden target. */
export function ComparisonAttemptCard({ item, attempt, index, isCorrectAttempt, isAnswerReveal = false, className = '', presentation, title = item.titleRu, subtitle, details, metadata, children }: {
  item: TitleItem
  attempt: Attempt
  index: number
  isCorrectAttempt: boolean
  isAnswerReveal?: boolean
  className?: string
  presentation?: Partial<AttemptPresentation>
  title?: string
  subtitle?: ReactNode
  details?: ReactNode
  metadata?: ReactNode
  children: ReactNode
}) {
  const config = { ...ATTEMPT_PRESENTATION[item.mode], ...presentation }
  const attemptLabel = isAnswerReveal ? 'Правильный ответ' : `Попытка ${index + 1}`
  return <article className={`attempt-card comparison-attempt comparison-attempt--${config.media} ${className}`} aria-label={`${attemptLabel}: ${title}`}>
    <header className="comparison-attempt__header">
      <span className="comparison-attempt__art" aria-hidden="true"><TitlePoster item={item} className="comparison-attempt__image" /></span>
      <div className="comparison-attempt__identity">
        <span className="comparison-attempt__eyebrow">{attemptLabel}{isCorrectAttempt && !isAnswerReveal && <span><Check aria-hidden="true" />Угадано</span>}</span>
        <h2>{title}</h2>
        {subtitle && <div className="comparison-attempt__subtitle">{subtitle}</div>}
        {details && <div className="comparison-attempt__details">{details}</div>}
      </div>
      {metadata && <div className="comparison-attempt__aside">{metadata}</div>}
    </header>
    <AttemptMatchSummary hints={attempt.hints} variant={config.summary} />
    {children}
  </article>
}
