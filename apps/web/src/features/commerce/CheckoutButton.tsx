import { useId, useRef, useState } from 'react'
import { CURRENT_OFFER_VERSION, type CommerceProduct } from '@shoditsa/contracts'
import { ApiClientError, api } from '../../api/client'
import { trackClientEvent } from '../../app/client-events'
import { trackMetrikaGoal } from '../../app/metrics'

export function CheckoutButton({ product, authenticated, hasClub = false, label, placement = 'club_screen', returnUrl = '/club' }: { product: CommerceProduct; authenticated: boolean; hasClub?: boolean; label?: string; placement?: string; returnUrl?: string }) {
  const keyRef = useRef<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [accepted, setAccepted] = useState(false)
  const acceptanceId = useId()

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
    trackClientEvent('checkout_started', properties)
    trackMetrikaGoal('checkout_started', properties)
    try {
      const response = await api.checkout({ productId: product.id, termsAccepted: true, offerVersion: CURRENT_OFFER_VERSION }, keyRef.current)
      if (response.checkoutUrl) window.location.assign(response.checkoutUrl)
      else window.location.assign(`/purchase/return?orderId=${encodeURIComponent(response.order.id)}`)
    } catch (value) {
      keyRef.current = null
      setError(value instanceof ApiClientError ? value.message : 'Не удалось начать оплату. Попробуйте ещё раз.')
    } finally {
      setPending(false)
    }
  }

  return <>
    <label className="checkout-acceptance" htmlFor={acceptanceId}>
      <input id={acceptanceId} type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
      <span>Принимаю <a href="/legal/terms" target="_blank" rel="noreferrer">оферту</a>, <a href="/legal/tariffs" target="_blank" rel="noreferrer">тариф</a> и <a href="/legal/refunds" target="_blank" rel="noreferrer">условия возврата</a></span>
    </label>
    <button type="button" disabled={pending || !accepted} onClick={() => void start()}>{pending ? 'Создаём заказ…' : label ?? (product.kind === 'club' ? 'Выбрать абонемент' : 'Поддержать')}</button>
    {error && <span className="club-card__error" role="alert">{error}</span>}
  </>
}
