import type { CommerceProduct, GrowthFeatures } from '@shoditsa/contracts'
import { Save, Ticket } from 'lucide-react'
import { deterministicClientEventId, trackClientEvent, type EventName } from '../../app/client-events'
import { trackMetrikaGoal } from '../../app/metrics'
import { offerObservationScope, useVisibleImpression } from '../../app/visible-impression'

export const trackGrowthAction = (event: EventName, growth: GrowthFeatures, sessionId?: string, extra: Record<string, unknown> = {}) => {
  const properties = { mode: 'diagnosis', growth_stage: growth.stage, campaign: growth.campaign, ...extra }
  trackClientEvent(event, properties, sessionId ? { gameSessionId: sessionId, eventId: deterministicClientEventId(`${sessionId}:${growth.stage}`, event) } : {})
  trackMetrikaGoal(event, properties)
}

// Count exposure only after the CTA actually enters the viewport, once per result/stage.
export function useGrowthImpression(event: EventName, growth?: GrowthFeatures, sessionId?: string) {
  const namespace = `${sessionId ?? offerObservationScope('growth')}:${growth?.stage ?? 'baseline'}`
  return useVisibleImpression<HTMLDivElement>(growth ? deterministicClientEventId(namespace, event) : null, () => {
    if (growth) trackGrowthAction(event, growth, sessionId)
  })
}

export function DiagnosisRegistrationOffer({ growth, sessionId, href }: { growth: GrowthFeatures; sessionId?: string; href: string }) {
  const ref = useGrowthImpression('registration_bonus_offer_view', growth, sessionId)
  return <div ref={ref} className="result-persistence result-card__wide" aria-label="Три дополнительных случая за регистрацию">
    <span className="result-persistence__icon" aria-hidden="true"><Save /></span>
    <div className="result-persistence__copy">
      <strong>Хотите ещё? Три дополнительных случая — бесплатно</strong>
      <p>Создайте аккаунт: сохраните результат и получите 3 свободные партии «Диагнозов» без списания билетов. Это дополнение к бесплатному недельному архиву, один раз на новый аккаунт.</p>
    </div>
    <a href={href} onClick={() => trackGrowthAction('registration_bonus_offer_clicked', growth, sessionId)}>Получить 3 случая</a>
  </div>
}

export function DiagnosisClubOffer({ growth, sessionId, product }: { growth: GrowthFeatures; sessionId?: string; product: CommerceProduct }) {
  const ref = useGrowthImpression('club_context_offer_view', growth, sessionId)
  const price = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: product.currency, maximumFractionDigits: 0 }).format(product.priceMinor / 100)
  return <div ref={ref} className="result-persistence result-card__wide" aria-label="Продолжить с клубным билетом">
    <span className="result-persistence__icon" aria-hidden="true"><Ticket /></span>
    <div className="result-persistence__copy">
      <strong>Больше диагнозов без ожидания до завтра</strong>
      <p>Весь архив и свободные партии «Диагнозов» без списания билетов — {price} на {product.durationDays} дней. Другие игры клуба тоже доступны. Автопродление выключено по умолчанию.</p>
    </div>
    <a href="/club?from=diagnosis#club-offers" onClick={() => trackGrowthAction('club_context_offer_clicked', growth, sessionId, { productId: product.id })}>Клуб на {product.durationDays} дней · {price}</a>
  </div>
}
