import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Clock3, XCircle } from 'lucide-react'
import { api, queryKeys } from '../../api/client'
import { apiErrorMessage } from '../../api/error-message'
import { trackClientEvent } from '../../app/client-events'
import { trackMetrikaGoal } from '../../app/metrics'
import { AppHeader } from '../../components/app-shell/AppShell'
import './CommercialShell.css'

type Props = { onHome: () => void; onClub: () => void; onArchive: () => void; onStats: () => void; onRules: () => void; onReview: () => void }

export function PurchaseReturnScreen({ onHome, onClub, onArchive, onStats, onRules, onReview }: Props) {
  const queryClient = useQueryClient()
  const startedAt = useRef(Date.now())
  const trackedStatus = useRef<string | null>(null)
  const orderId = typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('orderId')?.trim() || ''
  const order = useQuery({
    queryKey: queryKeys.commerceOrder(orderId),
    queryFn: () => api.commerceOrder(orderId),
    enabled: Boolean(orderId),
    refetchInterval: (query) => {
      const status = query.state.data?.order.status
      return (!status || status === 'created' || status === 'pending') && Date.now() - startedAt.current < 60_000 ? 2_000 : false
    },
  })
  const status = order.data?.order.status
  const productKind = order.data?.product.kind
  const paidTitle = productKind === 'club'
    ? 'Клубный билет активирован'
    : productKind === 'pack'
      ? 'Спецпоказ открыт'
      : productKind === 'tip'
        ? 'Спасибо за поддержку!'
        : 'Покупка подтверждена'
  const paidDescription = productKind === 'club'
    ? 'Оплата подтверждена сервером, клубный доступ уже действует.'
    : productKind === 'pack'
      ? 'Спецпоказ навсегда добавлен в ваш аккаунт.'
      : productKind === 'tip'
        ? 'Памятный жетон уже добавлен в ваш профиль.'
        : 'Оплата подтверждена сервером.'

  useEffect(() => {
    trackClientEvent('checkout_returned', { orderStatus: status ?? 'checking', placement: 'purchase_return' })
    trackMetrikaGoal('checkout_returned', { orderStatus: status ?? 'checking' })
  }, [])

  useEffect(() => {
    if (!status || trackedStatus.current === status) return
    trackedStatus.current = status
    if (status === 'paid') {
      trackClientEvent('purchase_succeeded', { ...(order.data?.order.productId ? { productId: order.data.order.productId } : {}), orderStatus: status, hasClub: productKind === 'club' })
      trackMetrikaGoal('purchase_succeeded', { productId: order.data?.order.productId })
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
        queryClient.invalidateQueries({ queryKey: queryKeys.commerce }),
        queryClient.invalidateQueries({ queryKey: ['archive'] }),
      ])
    } else if (['failed', 'canceled', 'expired', 'refunded', 'chargeback'].includes(status)) {
      trackClientEvent('purchase_failed', { ...(order.data?.order.productId ? { productId: order.data.order.productId } : {}), orderStatus: status })
      trackMetrikaGoal('purchase_failed', { productId: order.data?.order.productId, orderStatus: status })
    }
  }, [order.data?.order.productId, productKind, queryClient, status])

  const pendingTimedOut = (status === 'created' || status === 'pending') && Date.now() - startedAt.current >= 60_000
  return <>
    <AppHeader onHome={onHome} onArchive={onArchive} onStats={onStats} onRules={onRules} onReview={onReview} />
    <main className="purchase-return">
      {!orderId ? <><XCircle /><h1>Заказ не указан</h1><p>Вернитесь в клуб и выберите абонемент ещё раз.</p></>
        : order.isError ? <><XCircle /><h1>Не удалось проверить заказ</h1><p>{apiErrorMessage(order.error)}</p></>
          : status === 'paid' ? <><CheckCircle2 /><h1>{paidTitle}</h1><p>{paidDescription}</p></>
            : ['failed', 'canceled', 'expired'].includes(status ?? '') ? <><XCircle /><h1>Оплата не завершена</h1><p>Доступ не выдан. Можно безопасно попробовать ещё раз.</p></>
              : pendingTimedOut ? <><Clock3 /><h1>Платёж ещё обрабатывается</h1><p>Мы продолжим ждать подтверждение платёжного сервиса. Проверьте статус позже.</p></>
                : <><Clock3 className="purchase-return__spin" /><h1>Проверяем оплату</h1><p>Не закрывайте страницу — подтверждение обычно занимает несколько секунд.</p></>}
      <button type="button" onClick={onClub}>Перейти в клуб</button>
    </main>
  </>
}
