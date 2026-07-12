import { ChevronRight, Film, Gamepad2, Music2, Sparkles, Stethoscope, Tv } from 'lucide-react'
import type { ReactNode } from 'react'
import type { TitleMode } from '../types'

export type CategoryCardState = 'completed' | 'active' | 'pending'

const icons: Record<TitleMode, ReactNode> = {
  movie: <Film />,
  series: <Tv />,
  anime: <Sparkles />,
  game: <Gamepad2 />,
  music: <Music2 />,
  diagnosis: <Stethoscope />,
}

export function CategoryCard({ mode, title, description, pool, state, attempts, onClick }: {
  mode: TitleMode
  title: string
  description: string
  pool: number | null
  state: CategoryCardState
  attempts?: number
  onClick: () => void
}) {
  const status = state === 'completed'
    ? `Готово${attempts ? ` · ${attempts}/10` : ''}`
    : state === 'active'
      ? `В процессе · ${attempts ?? 0}/10`
      : null
  const action = state === 'completed' ? 'Результат' : state === 'active' ? 'Продолжить' : 'Играть'

  return <button className={`category-card category-card--${mode} category-card--state-${state}`} onClick={onClick}>
    <span className="category-card__grain" aria-hidden="true" />
    <div className="category-card__head">
      <span className="category-card__icon">{icons[mode]}</span>
      {status
        ? <span className={`category-card__status category-card__status--${state}`}>{status}</span>
        : <span className="category-card__pool"><b>{pool ?? '—'}</b> в пуле</span>}
    </div>
    <i>Ежедневная игра</i>
    <h2>{title}</h2>
    <p>{description}</p>
    <strong>{action} <ChevronRight aria-hidden="true" /></strong>
  </button>
}
