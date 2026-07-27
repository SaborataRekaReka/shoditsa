import type { ReactNode } from 'react'

export type ClubPlanFeature = {
  label: string
  value: ReactNode
  locked?: boolean
}

export function ClubCard({
  eyebrow,
  title,
  priceLabel,
  unitLabel,
  features,
  action,
  note,
  featured = false,
  guest = false,
  badge,
  planId,
}: {
  eyebrow: string
  title: string
  priceLabel: string
  unitLabel: string
  features: ClubPlanFeature[]
  action: ReactNode
  note: ReactNode
  featured?: boolean
  guest?: boolean
  badge?: ReactNode
  planId?: string
}) {
  return (
    <article
      className={[
        'club-plan-card',
        featured && 'club-plan-card--featured',
        guest && 'club-plan-card--guest',
      ].filter(Boolean).join(' ')}
      data-plan-id={planId}
      aria-label={`${eyebrow}: ${title}`}
    >
      {badge && <span className="club-plan-card__badge">{badge}</span>}
      <div className="club-plan-card__surface">
        <header className="club-plan-card__header">
          <span>{eyebrow}</span>
          <h3>{title}</h3>
          <strong>{priceLabel}</strong>
          <p>{unitLabel}</p>
        </header>
        <ul>
          {features.map((feature) => (
            <li className={feature.locked ? 'is-locked' : undefined} key={feature.label}>
              <span className="club-plan-card__feature-label">{feature.label}</span>
              <span className="club-plan-card__feature-dots" aria-hidden="true" />
              <strong className="club-plan-card__feature-value">{feature.value}</strong>
            </li>
          ))}
        </ul>
        <div className="club-plan-card__action">{action}</div>
        <small className="club-plan-card__note">{note}</small>
      </div>
    </article>
  )
}
