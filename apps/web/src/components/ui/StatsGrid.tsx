import type { ReactNode } from 'react'
import './StatsGrid.css'

export function StatsGrid({ children, variant = 'default' }: {
  children: ReactNode
  variant?: 'default' | 'economy'
}) {
  return <div className={`ui-stats-grid${variant === 'economy' ? ' ui-stats-grid--economy' : ''}`}>{children}</div>
}
