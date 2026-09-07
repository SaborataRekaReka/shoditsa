import { useId, useRef, useState } from 'react'
import { CURRENT_OFFER_VERSION, type CommerceProduct } from '@shoditsa/contracts'
import { ApiClientError, api } from '../../api/client'
import { trackClientEvent } from '../../app/client-events'
import { trackMetrikaGoal } from '../../app/metrics'
import { ActionButton } from '../../components/app-shell/AppShell'
import { TextInput } from '../../components/ui'
import { checkoutDestination } from './checkout-flow'
import { checkoutContext, checkoutRegistrationHref } from './checkout-context'

export function CheckoutButton({ product, authenticated, hasClub = false, label, placement = 'club_screen', returnUrl = '/club', growthStage = 'baseline' }: { product: CommerceProduct; authenticated: boolean; hasClub?: boolean; label?: string; placement?: string; returnUrl?: string; growthStage?: string }) {
  const keyRef = useRef<string | null>(null)
  const pendingRef = useRef(false)
  const contextRef = useRef<ReturnType<typeof checkoutContext> | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [autoRenew, setAutoRenew] = useState(false)
  const acceptanceId = useId()
  const autoRenewId = useId()

  const start = async () => {
    if (pendingRef.current || (authenticated && !accepted)) return
    const context = contextRef.current ??= checkoutContext(window.location.search, product.id, () => crypto.randomUUID())
    const properties = { productId: product.id, placement, isAuthenticated: authenticated, hasClub, intent_id: context.intentId, mode: context.sourceMode ?? null, growth_stage: growthStage }
    trackClientEvent('commerce_plan_selected', properties)
    trackMetrikaGoal('commerce_plan_selected', properties)
    if (!authenticated) {
      window.location.assign(checkoutRegistrationHref(returnUrl, product.id, context))
      return
    }
    pendingRef.current = true
    setPending(true)
    setError('')
    keyRef.current ??= crypto.randomUUID()
    if (product.kind === 'tickets') trackClientEvent('ticket_offer_clicked', properties)
    trackClientEvent('checkout_started', properties)
    trackMetrikaGoal('checkout_started', properties)
    try {
      const response = await api.checkout({
        productId: product.id,
        termsAccepted: true,
        offerVersion: CURRENT_OFFER_VERSION,
        intentId: context.intentId,
        placement,
        sourceMode: context.sourceMode,
        ...(product.kind === 'club' ? { autoRenew } : {}),
      }, keyRef.current)
      const destination = await checkoutDestination(response)
      if (destination) window.location.assign(destination)
      else keyRef.current = null
    } catch (value) {
      keyRef.current = null
      setError(value instanceof ApiClientError || value instanceof Error ? value.message : 'Не удалось начать оплату. Попробуйте ещё раз.')
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }

  return <>
    {authenticated && <label className="checkout-acceptance" htmlFor={acceptanceId}>
      <TextInput id={acceptanceId} type="checkbox" checked={accepted} disabled={pending} onChange={(event) => setAccepted(event.target.checked)} />
      <span>Принимаю <a href="/legal/terms" target="_blank" rel="noreferrer">оферту</a>, <a href="/legal/tariffs" target="_blank" rel="noreferrer">тариф</a> и <a href="/legal/refunds" target="_blank" rel="noreferrer">условия возврата</a></span>
    </label>}
    {authenticated && product.kind === 'club' && <label className="checkout-acceptance checkout-acceptance--renewal" htmlFor={autoRenewId}>
      <TextInput id={autoRenewId} type="checkbox" checked={autoRenew} disabled={pending} onChange={(event) => { keyRef.current = null; setAutoRenew(event.target.checked) }} />
      <span>Включить автопродление каждые {product.durationDays} суток по указанной цене. Отключить можно в профиле до следующего списания.</span>
    </label>}
    <ActionButton type="button" disabled={pending || (authenticated && !accepted)} onClick={() => void start()}>{pending ? 'Создаём заказ…' : label ?? (product.kind === 'club' ? 'Выбрать абонемент' : 'Поддержать')}</ActionButton>
    {!authenticated && <small>Сначала вход или регистрация. Оплата — только после вашего подтверждения.</small>}
    {error && <span className="club-card__error" role="alert">{error}</span>}
  </>
}
