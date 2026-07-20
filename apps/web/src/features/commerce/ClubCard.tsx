import { CalendarDays, Check, Ticket } from 'lucide-react'
import type { ReactNode } from 'react'

export type ClubOffer = {
  id: 'club_30d' | 'club_365d'
  title: string
  durationLabel: string
  note: string
  priceLabel?: string
}

export function ClubCard({ offer, disabled, onSelect, action }: { offer: ClubOffer; disabled?: boolean; onSelect?: (offer: ClubOffer) => void; action?: ReactNode }) {
  return <article className={`club-card ${offer.id === 'club_365d' ? 'club-card--featured' : ''}`}>
    {offer.id === 'club_365d' && <span className="club-card__ribbon">На весь год</span>}
    <div className="club-card__icon" aria-hidden="true">{offer.id === 'club_365d' ? <CalendarDays /> : <Ticket />}</div>
    <h2>{offer.title}</h2>
    <strong>{offer.priceLabel ? `${offer.priceLabel} · ${offer.durationLabel}` : offer.durationLabel}</strong>
    <p>{offer.note}</p>
    <ul>
      <li><Check /> Архив с даты запуска</li>
      <li><Check /> Свободная игра без списания билетов</li>
      <li><Check /> Клубный бейдж в профиле</li>
    </ul>
    <div className="club-card__action">{action ?? <button type="button" disabled={disabled} onClick={() => onSelect?.(offer)}>Хочу такой абонемент</button>}</div>
    <small>Продление только вручную</small>
  </article>
}
