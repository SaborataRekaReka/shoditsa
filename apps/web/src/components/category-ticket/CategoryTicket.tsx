import type { CSSProperties } from 'react'
import { ChevronRight } from 'lucide-react'
import type { TitleMode } from '../../types'
import type { CategoryTicketConfig } from './category-ticket.config'
import './CategoryTicket.css'

export type CategoryTicketStatus = 'new' | 'active' | 'completed'

type Props = CategoryTicketConfig & {
  poolCount: number | null
  status: CategoryTicketStatus
  attempts: number | null
  onClick: () => void
}

const statusLabel: Record<CategoryTicketStatus, string> = {
  new: '',
  active: 'ПРОДОЛЖИТЬ',
  completed: 'ЗАВЕРШЕНО',
}

const actionLabel: Record<CategoryTicketStatus, string> = {
  new: 'ИГРАТЬ',
  active: 'ПРОДОЛЖИТЬ',
  completed: 'РЕЗУЛЬТАТ',
}

const ariaLabel = (title: string, status: CategoryTicketStatus, attempts: number | null) => {
  if (status === 'active') return `Продолжить игру: ${title}, попытка ${attempts ?? 0} из 10`
  if (status === 'completed') return `Открыть результат игры: ${title}`
  return `Играть: ${title}`
}

export function CategoryTicket({ mode, title, description, color, watermarkUrl, poolCount, status, attempts, onClick }: Props) {
  const style = { '--ticket-color': color } as CSSProperties
  const badge = status === 'active'
    ? `В ПРОЦЕССЕ · ${attempts ?? 0}/10`
    : status === 'completed'
      ? `ГОТОВО · ${attempts ?? 0}/10`
      : null

  return <button
    type="button"
    className={`category-ticket category-ticket--${mode} ${status === 'completed' ? 'is-completed' : ''}`}
    style={style}
    aria-label={ariaLabel(title, status, attempts)}
    onClick={onClick}
  >
    <span className="category-ticket__stub" aria-hidden="true">
      <img className="category-ticket__watermark" src={watermarkUrl} alt="" aria-hidden="true" />
    </span>
    <span className="category-ticket__body">
      <span className="category-ticket__top">
        <span className="category-ticket__kicker">ЕЖЕДНЕВНАЯ ИГРА</span>
        {status !== 'active' && <span className="category-ticket__meta"><strong>{poolCount ?? '—'}</strong> В ПУЛЕ</span>}
      </span>
      <strong className="category-ticket__title">{title}</strong>
      <span className="category-ticket__description">{description}</span>
      <span className="category-ticket__footer">
        <span className="category-ticket__state">{statusLabel[status]}</span>
        <span className="category-ticket__action">{actionLabel[status]} <ChevronRight aria-hidden="true" /></span>
      </span>
    </span>
    {badge && <span className={`category-ticket__badge ${status === 'completed' ? 'category-ticket__badge--completed' : ''}`}>{badge}</span>}
  </button>
}
