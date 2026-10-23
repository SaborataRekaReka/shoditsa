import type { KeyboardEvent } from 'react'
import { Check } from 'lucide-react'
import { QuestButton } from '../../components/ui/QuestPrimitives'
import { dailyPriceMinor, type ClubPageViewModel } from '../../features/commerce/club-page-model'
import './study-club-plans.css'

const money = (minor: number, currency = 'RUB', digits = 0) => new Intl.NumberFormat('ru-RU', {
  style: 'currency', currency, maximumFractionDigits: digits,
}).format(minor / 100)

/** Shared plan prices, selection and keyboard behavior on the offer and invitation. */
export function StudyClubPlans({ pricing, selectedPlan, onSelect, variant = 'default' }: {
  pricing: ClubPageViewModel['pricing']
  selectedPlan: string
  onSelect: (id: string) => void
  variant?: 'default' | 'premium'
}) {
  const { monthly, annual } = pricing
  const planKeys = (event: KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next = event.key === 'Home' ? monthly.id : event.key === 'End' ? annual.id : selectedPlan === monthly.id ? annual.id : monthly.id
    onSelect(next)
    event.currentTarget.querySelector<HTMLElement>(`[data-plan-id="${next}"] [role="radio"]`)?.focus()
  }
  return <div className={`study-club-plan-options${variant === 'premium' ? ' study-club-plan-options--premium' : ''}`} role="radiogroup" aria-label="Срок клубного билета" onKeyDown={planKeys}>
    {[monthly, annual].map((product, index) => <article className="study-club-plan-option" data-plan-id={product.id} data-selected={selectedPlan === product.id || undefined} key={product.id}>
      {index === 1 && pricing.annualDiscountPercent > 0 && <span className="study-club-discount">{variant === 'premium' ? `−${pricing.annualDiscountPercent}% за год` : `Выгоднее на ${pricing.annualDiscountPercent}%`}</span>}
      <QuestButton kind="choice" selected={selectedPlan === product.id} role="radio" aria-checked={selectedPlan === product.id} tabIndex={selectedPlan === product.id ? 0 : -1} onClick={() => onSelect(product.id)}>
        <span className="study-club-radio" aria-hidden="true">{selectedPlan === product.id && <Check size={15} strokeWidth={3} />}</span>
        <span className="study-club-plan-name"><strong>{product.durationDays ?? (index ? 365 : 30)} дней{variant === 'default' ? ' в Клубе' : ''}</strong><small>{index && pricing.annualSavingsMinor > 0 ? `Экономия ${money(pricing.annualSavingsMinor, product.currency)}` : 'Все возможности Клуба'}</small></span>
        <span className="study-club-plan-price"><strong>{money(product.priceMinor, product.currency)}</strong><small>{money(dailyPriceMinor(product), product.currency, 2)} в день</small></span>
      </QuestButton>
    </article>)}
  </div>
}
