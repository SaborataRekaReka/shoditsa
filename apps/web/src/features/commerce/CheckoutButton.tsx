import { useRef, useState } from 'react'
import type { CommerceProduct } from '@shoditsa/contracts'
import { ApiClientError, api } from '../../api/client'
import { trackClientEvent } from '../../app/client-events'
import { trackMetrikaGoal } from '../../app/metrics'

export function CheckoutButton({ product, authenticated, label, placement = 'club_screen', returnUrl = '/club' }: { product: CommerceProduct; authenticated: boolean; label?: string; placement?: string; returnUrl?: string }) {
  const keyRef = useRef<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

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
    const properties = { productId: product.id, placement, isAuthenticated: true, hasClub: false }
    trackClientEvent('checkout_started', properties)
    trackMetrikaGoal('checkout_started', properties)
    try {
      const response = await api.checkout({ productId: product.id }, keyRef.current)
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
    <button type="button" disabled={pending} onClick={() => void start()}>{pending ? 'Создаём заказ…' : label ?? (product.kind === 'club' ? 'Выбрать абонемент' : 'Поддержать')}</button>
    {error && <span className="club-card__error" role="alert">{error}</span>}
  </>
}
