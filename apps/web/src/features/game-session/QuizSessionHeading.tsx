import { getMoscowDate } from '@shoditsa/game-core'
import { GameArtwork } from '../../components/ui/GameArtwork'
import type { TitleMode } from '../../types'
import './QuizSessionHeading.css'

type QuizSessionHeadingProps = {
  mode: TitleMode
  title: string
  date: string
  kind: 'daily' | 'archive' | 'free_play' | 'pack'
  variantLabel?: string | null
  specialLabel?: string
  packPosition?: number | null
  packTotal?: number | null
  compact?: boolean
}

/** Identify the puzzle without repeating its rules, attempts, or reset schedule. */
export function QuizSessionHeading({ mode, title, date, kind, variantLabel, specialLabel, packPosition, packTotal, compact = false }: QuizSessionHeadingProps) {
  const today = getMoscowDate()
  const isDated = kind === 'daily' || kind === 'archive'
  const isArchive = kind === 'archive' || (isDated && date < today)
  const dateLabel = isDated ? new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'long', ...(date.slice(0, 4) !== today.slice(0, 4) ? { year: 'numeric' } : {}), timeZone: 'Europe/Moscow',
  }).format(new Date(`${date}T12:00:00+03:00`)) : null

  return <header className={`quiz-session-heading${compact ? ' quiz-session-heading--compact' : ''}`}>
    <div className="quiz-session-heading__art" aria-hidden="true">
      <GameArtwork mode={mode} width={56} height={56} alt="" />
    </div>
    <div className="quiz-session-heading__copy">
      <h1>{title}</h1>
      <div className="quiz-session-heading__meta">
        {kind === 'free_play' && <span>Свободная игра</span>}
        {(kind === 'pack' || specialLabel) && <span>{specialLabel || 'Спецпоказ'}</span>}
        {dateLabel && <time dateTime={date}>{isArchive ? 'Архив за ' : ''}{dateLabel}</time>}
        {kind === 'pack' && packPosition != null && <span>Игра {packPosition}{packTotal ? ` из ${packTotal}` : ''}</span>}
        {variantLabel && <span className="quiz-session-heading__variant">{variantLabel}</span>}
      </div>
    </div>
  </header>
}
