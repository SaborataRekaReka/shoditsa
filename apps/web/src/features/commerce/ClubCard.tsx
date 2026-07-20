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
    <header className="club-card__header">
      <div className="club-card__icon" aria-hidden="true">{offer.id === 'club_365d' ? <CalendarDays /> : <Ticket />}</div>
      <span>{offer.id === 'club_365d' ? 'Лучший выбор' : 'На месяц'}</span>
    </header>
    <h2>{offer.title}</h2>
    <div className="club-card__price">
      {offer.priceLabel && <strong>{offer.priceLabel}</strong>}
      <span>{offer.durationLabel}</span>
    </div>
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
