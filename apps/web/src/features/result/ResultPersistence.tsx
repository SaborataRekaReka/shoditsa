import { forwardRef, type ReactNode } from 'react'
import { Save } from 'lucide-react'
import './ResultPersistence.css'

/** Shared account/bonus message: presentation only; callers retain links and tracking. */
export const ResultPersistence = forwardRef<HTMLDivElement, {
  title: ReactNode
  children: ReactNode
  icon?: ReactNode
  action?: ReactNode
  saved?: boolean
  'aria-label'?: string
}>(function ResultPersistence({ title, children, icon = <Save />, action, saved = false, 'aria-label': label }, ref) {
  return <div ref={ref} className={`result-persistence result-card__wide${saved ? ' result-persistence--saved' : ''}`} aria-label={label}>
    <span className="result-persistence__icon" aria-hidden="true">{icon}</span>
    <div className="result-persistence__copy"><strong>{title}</strong><p>{children}</p></div>
    {action && <div className="result-persistence__action">{action}</div>}
  </div>
})
