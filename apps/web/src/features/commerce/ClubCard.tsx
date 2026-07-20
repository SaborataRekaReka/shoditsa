import { Check, CircleHelp, LockKeyhole } from 'lucide-react'
import type { ReactNode } from 'react'

export type ClubOffer = {
  id: 'club_30d' | 'club_365d'
  title: string
  durationLabel: string
  note: string
  priceLabel?: string
  unitLabel?: string
  savingsLabel?: string
  discountLabel?: string
}

export function ClubCard({ offer, disabled, onSelect, action }: { offer: ClubOffer; disabled?: boolean; onSelect?: (offer: ClubOffer) => void; action?: ReactNode }) {
  const annual = offer.id === 'club_365d'
  return <article className={`club-card ${annual ? 'club-card--featured' : ''}`} aria-label={offer.title}>
    <div className="club-card__body">
      <div className="club-card__price">
        <h2>{offer.durationLabel}</h2>
        <strong>{offer.priceLabel ?? '—'}</strong>
        {offer.unitLabel && <span>{offer.unitLabel}</span>}
        {offer.savingsLabel && <em>{offer.savingsLabel}</em>}
      </div>
      {annual && <span className="club-card__stamp">Выгоднее<br /><strong>на {offer.discountLabel ?? '25%'}</strong></span>}
      {!annual && <span className="club-card__brand-stamp" aria-hidden="true">Сходится!</span>}
      <ul>
        <li><Check /> Архив с даты запуска</li>
        <li><Check /> Свободная игра без списания билетов</li>
        <li><Check /> Все клубные спецпоказы</li>
        <li><Check /> 2 дополнительные Данетки в сутки</li>
      </ul>
    </div>
    <div className="club-card__rule" aria-hidden="true" />
    <span className="club-card__renewal"><LockKeyhole /> Продление вручную <CircleHelp /></span>
    <div className="club-card__action">{action ?? <button type="button" disabled={disabled} onClick={() => onSelect?.(offer)}>{annual ? 'Взять на год' : 'Взять на месяц'}</button>}</div>
  </article>
}
