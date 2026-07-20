import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CommerceProduct } from '@shoditsa/contracts'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowUpRight,
  ChevronRight,
  Crown,
  Heart,
  LoaderCircle,
  Medal,
  Ticket,
  X,
} from 'lucide-react'
import { ApiClientError, api, queryKeys } from '../../api/client'
import { trackClientEvent } from '../../app/client-events'
import { trackMetrikaGoal } from '../../app/metrics'
import { useDialogFocusTrap } from '../../components/app-shell/AppShell'
import { SERVER_RUNTIME, useServerRuntime } from '../../hooks/use-server-runtime'
import './CommercialShell.css'

type TipTier = 'paper' | 'silver' | 'gold'

const tierFor = (product: CommerceProduct): TipTier => product.id.includes('gold')
  ? 'gold'
  : product.id.includes('silver')
    ? 'silver'
    : 'paper'

const tierLabel: Record<TipTier, string> = {
  paper: 'Бумажный жетон',
  silver: 'Серебряный жетон',
  gold: 'Золотой жетон',
}

const tierIcon = (tier: TipTier) => tier === 'gold'
  ? Crown
  : tier === 'silver'
    ? Medal
    : Ticket

const priceLabel = (product: CommerceProduct) => new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: product.currency,
  maximumFractionDigits: 0,
}).format(product.priceMinor / 100)

type TipCheckoutTriggerProps = {
  className?: string
  placement?: string
  initialOpen?: boolean
  label?: string
  hint?: string
}

export function TipCheckoutTrigger({
  className = '',
  placement = 'victory_tip',
  initialOpen = false,
  label = 'Оставить чаевые',
  hint = '99, 299 или 699 ₽',
}: TipCheckoutTriggerProps) {
  const runtime = useServerRuntime()
  const [open, setOpen] = useState(initialOpen)
  const [pendingProductId, setPendingProductId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const idempotencyKeyRef = useRef<string | null>(null)
  const authenticated = Boolean(runtime.me && !runtime.me.user.isAnonymous)
  const catalog = useQuery({
    queryKey: queryKeys.commerceCatalog,
    queryFn: api.commerceCatalog,
    enabled: SERVER_RUNTIME,
  })
  const tipProducts = (catalog.data?.products ?? [])
    .filter((product) => product.kind === 'tip')
    .sort((left, right) => left.priceMinor - right.priceMinor)
  const commerceEnabled = SERVER_RUNTIME && Boolean(
    catalog.data?.enabled && runtime.meta?.commerce.enabled,
  )

  useEffect(() => {
    if (initialOpen) setOpen(true)
  }, [initialOpen])

  const close = () => {
    if (pendingProductId) return
    setOpen(false)
    setError('')
  }
  const dialogRef = useDialogFocusTrap<HTMLElement>(open, close)

  const chooseTip = async (product: CommerceProduct) => {
    if (pendingProductId) return
    if (!authenticated) {
      const returnUrl = `/club?section=tips&product=${encodeURIComponent(product.id)}`
      window.location.assign(`/register?returnUrl=${encodeURIComponent(returnUrl)}`)
      return
    }

    setPendingProductId(product.id)
    setError('')
    idempotencyKeyRef.current ??= crypto.randomUUID()
    const properties = {
      productId: product.id,
      placement,
      isAuthenticated: true,
      hasClub: false,
    }
    trackClientEvent('checkout_started', properties)
    trackMetrikaGoal('checkout_started', properties)
    try {
      const response = await api.checkout(
        { productId: product.id },
        idempotencyKeyRef.current,
      )
      if (response.checkoutUrl) {
        window.location.assign(response.checkoutUrl)
        return
      }
      window.location.assign(
        `/purchase/return?orderId=${encodeURIComponent(response.order.id)}`,
      )
    } catch (value) {
      idempotencyKeyRef.current = null
      setError(value instanceof ApiClientError
        ? value.message
        : 'Не удалось открыть оплату. Попробуйте ещё раз.')
      setPendingProductId(null)
    }
  }

  const modal = open && typeof document !== 'undefined'
    ? createPortal(
        <div
          className="tip-modal-backdrop"
          onMouseDown={(event) => event.target === event.currentTarget && close()}
        >
          <section
            className="tip-modal"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="tip-modal-title"
            tabIndex={-1}
          >
            <header className="tip-modal__header">
              <span className="tip-modal__mark" aria-hidden="true"><Heart /></span>
              <div>
                <span>Поддержать проект</span>
                <h2 id="tip-modal-title">Оставить чаевые кассиру</h2>
              </div>
              <button type="button" onClick={close} disabled={Boolean(pendingProductId)} aria-label="Закрыть">
                <X />
              </button>
            </header>
            <p className="tip-modal__lead">
              Выберите сумму — сразу после нажатия откроется безопасная страница оплаты ЮKassa.
            </p>
            {catalog.isPending ? (
              <div className="tip-modal__loading" role="status">
                <LoaderCircle /> Загружаем варианты…
              </div>
            ) : commerceEnabled && tipProducts.length ? (
              <div className="tip-modal__options">
                {tipProducts.map((product) => {
                  const tier = tierFor(product)
                  const Icon = tierIcon(tier)
                  const pending = pendingProductId === product.id
                  return (
                    <button
                      type="button"
                      className={`tip-modal__option tip-modal__option--${tier}`}
                      key={product.id}
                      disabled={Boolean(pendingProductId)}
                      onClick={() => void chooseTip(product)}
                    >
                      <span className="tip-modal__token" aria-hidden="true"><Icon /></span>
                      <span className="tip-modal__option-copy">
                        <small>{tierLabel[tier]}</small>
                        <strong>{priceLabel(product)}</strong>
                      </span>
                      {pending ? <LoaderCircle className="tip-modal__spinner" /> : <ArrowUpRight />}
                    </button>
                  )
                })}
              </div>
            ) : (
              <p className="tip-modal__unavailable" role="status">
                Оплата сейчас недоступна. Попробуйте немного позже.
              </p>
            )}
            {error && <p className="tip-modal__error" role="alert">{error}</p>}
            <p className="tip-modal__note">
              Чаевые добровольные и не дают игровых преимуществ. В профиле останется памятный жетон самого высокого уровня.
            </p>
          </section>
        </div>,
        document.body,
      )
    : null

  return <>
    <button
      type="button"
      className={`tip-checkout-trigger ${className}`.trim()}
      onClick={() => {
        setError('')
        setOpen(true)
      }}
    >
      <Heart className="tip-checkout-trigger__heart" />
      <span><strong>{label}</strong><small>{hint}</small></span>
      <ChevronRight />
    </button>
    {modal}
  </>
}
