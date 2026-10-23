import type { ReactNode } from 'react'
import './PageHeading.css'

/** Shared heading hierarchy for sections, forms and supporting pages. */
export function PageHeading({ title, description, id, actions, illustration, className = '', level = 1 }: {
  title: ReactNode
  description?: ReactNode
  id?: string
  actions?: ReactNode
  illustration?: ReactNode
  className?: string
  level?: 1 | 2
}) {
  const Title = level === 1 ? 'h1' : 'h2'
  return <header className={`ui-page-heading ${className}`.trim()}>
    {illustration && <div className="ui-page-heading__illustration" aria-hidden="true">{illustration}</div>}
    <div className="ui-page-heading__copy">
      <Title className="ui-page-heading__title" id={id}>{title}</Title>
      {description && <p className="ui-page-heading__description">{description}</p>}
    </div>
    {actions && <div className="ui-page-heading__actions">{actions}</div>}
  </header>
}
