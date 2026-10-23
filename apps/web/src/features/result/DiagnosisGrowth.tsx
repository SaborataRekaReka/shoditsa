import type { CommerceProduct, GrowthFeatures } from '@shoditsa/contracts'
import { Ticket } from 'lucide-react'
import { deterministicClientEventId, trackClientEvent, type EventName } from '../../app/client-events'
import { trackMetrikaGoal } from '../../app/metrics'
import { ActionLink } from '../../components/ui'
import { ResultPersistence } from './ResultPersistence'
import { offerObservationScope, useVisibleImpression } from '../../app/visible-impression'

export const trackGrowthAction = (event: EventName, growth: GrowthFeatures, sessionId?: string, extra: Record<string, unknown> = {}) => {
  const properties = { mode: 'diagnosis', growth_stage: growth.stage, campaign: growth.campaign, ...extra }
  trackClientEvent(event, properties, sessionId ? { gameSessionId: sessionId, eventId: deterministicClientEventId(`${sessionId}:${growth.stage}`, event) } : {})
  trackMetrikaGoal(event, properties)
}

// Count exposure only after the CTA actually enters the viewport, once per result/stage.
export function useGrowthImpression(event: EventName, growth?: GrowthFeatures, sessionId?: string, mode = 'diagnosis') {
  const namespace = `${sessionId ?? offerObservationScope(`growth:${mode}`)}:${growth?.stage ?? 'baseline'}`
  return useVisibleImpression<HTMLDivElement>(growth ? deterministicClientEventId(namespace, event) : null, () => {
    if (growth) trackGrowthAction(event, growth, sessionId, { mode })
  })
}

export function DiagnosisRegistrationOffer({ growth, sessionId, href, mode = 'diagnosis' }: { growth: GrowthFeatures; sessionId?: string; href: string; mode?: string }) {
  const ref = useGrowthImpression('registration_bonus_offer_view', growth, sessionId, mode)
  return <ResultPersistence ref={ref} aria-label="По три бонусные партии в каждой игре"
    title="По 3 бонусные партии в каждой игре"
    action={<ActionLink variant="secondary" href={href} onClick={() => trackGrowthAction('registration_bonus_offer_clicked', growth, sessionId, { mode })}>Получить бонусы</ActionLink>}>
    Создайте аккаунт: сохраните результат и получите по 3 дополнительные партии во всех 12 играх. У каждой игры свой запас, без списания билетов. Один раз на новый аккаунт.
  </ResultPersistence>
}

export function DiagnosisClubOffer({ growth, sessionId, product }: { growth: GrowthFeatures; sessionId?: string; product: CommerceProduct }) {
  const ref = useGrowthImpression('club_context_offer_view', growth, sessionId)
  const price = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: product.currency, maximumFractionDigits: 0 }).format(product.priceMinor / 100)
  return <ResultPersistence ref={ref} aria-label="Продолжить с клубным билетом" icon={<Ticket />}
    title="Больше диагнозов без ожидания до завтра"
    action={<ActionLink variant="secondary" href="/club?from=diagnosis#club-offers" onClick={() => trackGrowthAction('club_context_offer_clicked', growth, sessionId, { productId: product.id })}>Клуб на {product.durationDays} дней · {price}</ActionLink>}>
    Весь архив и свободные партии «Диагнозов» без списания билетов — {price} на {product.durationDays} дней. Другие игры клуба тоже доступны. Автопродление выключено по умолчанию.
  </ResultPersistence>
}
