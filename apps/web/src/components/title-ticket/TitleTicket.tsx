import type { ReactNode } from 'react'
import './TitleArtifacts.css'

export function TicketKicker({ title, detail }: { title: ReactNode; detail: ReactNode }) {
  return <div className="ticket-kicker"><span>{title}</span><i aria-hidden="true" /><small>{detail}</small></div>
}

export function AdmissionTitleTicket({
  id,
  mode,
  posterUrl,
  stubLabel,
  stubTitle,
  stubMeta,
  stubEnd,
  children,
  details,
  className = '',
  stubClassName = '',
  eager = true,
}: {
  id: string
  mode: string
  posterUrl: string
  stubLabel: ReactNode
  stubTitle: ReactNode
  stubMeta: ReactNode
  stubEnd: ReactNode
  children: ReactNode
  details?: ReactNode
  className?: string
  stubClassName?: string
  eager?: boolean
}) {
  return <section className={`admit-ticket admit-ticket--dossier ${className}`.trim()} aria-labelledby={id}>
    <div className={`admit-ticket__stub admit-ticket__stub--poster admit-ticket__stub--${mode} ${stubClassName}`.trim()} aria-hidden="true">
      <img
        className="admit-ticket__stub-art"
        src={posterUrl}
        alt=""
        aria-hidden="true"
        width="480"
        height="1200"
        decoding="async"
        loading={eager ? 'eager' : 'lazy'}
        fetchPriority={eager ? 'high' : undefined}
      />
      <span>{stubLabel}</span>
      <strong>{stubTitle}</strong>
      <small>{stubMeta}</small>
      <em>{stubEnd}</em>
      <i />
    </div>
    <div className="admit-ticket__body">{children}</div>
    {details}
  </section>
}
