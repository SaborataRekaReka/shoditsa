import { useEffect, useId, useRef, useState } from 'react'
import { CURRENT_OFFER_VERSION, type CommerceProduct } from '@shoditsa/contracts'
import { ApiClientError, api } from '../../api/client'
import { trackClientEvent } from '../../app/client-events'
import { trackMetrikaGoal } from '../../app/metrics'
import { ActionButton } from '../../components/app-shell/AppShell'
import { TextInput } from '../../components/ui'
import { checkoutDestination } from './checkout-flow'

export function CheckoutButton({ product, authenticated, hasClub = false, label, placement = 'club_screen', returnUrl = '/club' }: { product: CommerceProduct; authenticated: boolean; hasClub?: boolean; label?: string; placement?: string; returnUrl?: string }) {
  const keyRef = useRef<string | null>(null)
  const autoStartedRef = useRef(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [accepted, setAccepted] = useState(true)
  const [autoRenew, setAutoRenew] = useState(true)
  const acceptanceId = useId()
  const autoRenewId = useId()

  const start = async () => {
    if (pending) return
    if (!authenticated) {
      const selectedReturnUrl = `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}product=${encodeURIComponent(product.id)}`
      window.location.assign(`/register?returnUrl=${encodeURIComponent(selectedReturnUrl)}`)
      return
    }
    setPending(true)
    setError('')
    keyRef.current ??= crypto.randomUUID()
    const properties = { productId: product.id, placement, isAuthenticated: true, hasClub }
    if (product.kind === 'tickets') trackClientEvent('ticket_offer_clicked', properties)
    trackClientEvent('checkout_started', properties)
    trackMetrikaGoal('checkout_started', properties)
    try {
      const response = await api.checkout({
        productId: product.id,
        termsAccepted: true,
        offerVersion: CURRENT_OFFER_VERSION,
        ...(product.kind === 'club' ? { autoRenew } : {}),
      }, keyRef.current)
      const destination = await checkoutDestination(response)
      if (destination) window.location.assign(destination)
    } catch (value) {
      keyRef.current = null
      setError(value instanceof ApiClientError || value instanceof Error ? value.message : 'Не удалось начать оплату. Попробуйте ещё раз.')
    } finally {
      setPending(false)
    }
  }

  useEffect(() => {
    if (!authenticated || autoStartedRef.current || typeof window === 'undefined') return
    if (new URLSearchParams(window.location.search).get('product') !== product.id) return
    autoStartedRef.current = true
    void start()
  }, [authenticated, product.id])

  return <>
    <label className="checkout-acceptance" htmlFor={acceptanceId}>
      <TextInput id={acceptanceId} type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
      <span>Принимаю <a href="/legal/terms" target="_blank" rel="noreferrer">оферту</a>, <a href="/legal/tariffs" target="_blank" rel="noreferrer">тариф</a> и <a href="/legal/refunds" target="_blank" rel="noreferrer">условия возврата</a></span>
    </label>
    {product.kind === 'club' && <label className="checkout-acceptance checkout-acceptance--renewal" htmlFor={autoRenewId}>
      <TextInput id={autoRenewId} type="checkbox" checked={autoRenew} onChange={(event) => setAutoRenew(event.target.checked)} />
      <span>Включить автопродление каждые {product.durationDays} суток по указанной цене. Отключить можно в профиле до следующего списания.</span>
    </label>}
    <ActionButton type="button" disabled={pending || !accepted} onClick={() => void start()}>{pending ? 'Создаём заказ…' : label ?? (product.kind === 'club' ? 'Выбрать абонемент' : 'Поддержать')}</ActionButton>
    {error && <span className="club-card__error" role="alert">{error}</span>}
  </>
}
