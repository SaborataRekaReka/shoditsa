import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { IconButton } from './UiControls'
import './Feedback.css'

const icons = {
  neutral: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: AlertTriangle,
}

export function InlineAlert({ tone = 'neutral', children, onDismiss, className = '', role }: {
  tone?: 'neutral' | 'success' | 'warning' | 'danger'
  children: ReactNode
  onDismiss?: () => void
  className?: string
  role?: 'alert' | 'status'
}) {
  const Icon = icons[tone]
  return <div className={`ui-alert ui-alert--${tone} ${className}`.trim()} role={role ?? (tone === 'danger' ? 'alert' : 'status')}>
    <Icon className="ui-alert__icon" aria-hidden="true" />
    <div className="ui-alert__content">{children}</div>
    {onDismiss && <IconButton className="ui-alert__dismiss" size="sm" label="Закрыть" onClick={onDismiss}><X /></IconButton>}
  </div>
}

export function StatusBadge({ tone = 'neutral', children, className = '' }: {
  tone?: 'neutral' | 'success' | 'warning' | 'danger'
  children: ReactNode
  className?: string
}) {
  return <span className={`ui-status ui-status--${tone} ${className}`.trim()}>{children}</span>
}

export function EmptyState({ icon, title, description, action, className = '' }: {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return <section className={`ui-empty-state ${className}`.trim()}>
    {icon && <span className="ui-empty-state__icon" aria-hidden="true">{icon}</span>}
    <div><h2>{title}</h2>{description && <p>{description}</p>}</div>
    {action}
  </section>
}
