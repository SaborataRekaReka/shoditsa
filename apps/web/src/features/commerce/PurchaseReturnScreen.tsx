import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Clock3, XCircle } from 'lucide-react'
import { api, queryKeys } from '../../api/client'
import { apiErrorMessage } from '../../api/error-message'
import { trackClientEvent } from '../../app/client-events'
import { trackMetrikaGoal } from '../../app/metrics'
import { AppHeader } from '../../components/app-shell/AppShell'
import { useServerRuntime } from '../../hooks/use-server-runtime'
import { ControlButton } from '../../components/ui'
import './CommercialShell.css'

type Props = { onHome: () => void; onClub: () => void; onProfile: () => void; onArchive: () => void; onStats: () => void; onRules: () => void; onReview: () => void }

export function PurchaseReturnScreen({ onHome, onClub, onProfile, onArchive, onStats, onRules, onReview }: Props) {
  const queryClient = useQueryClient()
  const runtime = useServerRuntime()
  const startedAt = useRef(Date.now())
  const trackedStatus = useRef<string | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const orderId = typeof window === 'undefined'
    ? ''
    : (() => {
        const params = new URLSearchParams(window.location.search)
        return params.get('orderId')?.trim() || params.get('Shp_order')?.trim() || ''
      })()
  const order = useQuery({
    queryKey: queryKeys.commerceOrder(orderId),
    queryFn: () => api.commerceOrder(orderId),
    enabled: Boolean(orderId),
    refetchInterval: (query) => {
      const status = query.state.data?.order.status
      if (status && status !== 'created' && status !== 'pending') return false
      return elapsedMs < 60_000 ? 2_000 : 15_000
    },
  })
  const status = order.data?.order.status
  const productKind = order.data?.product.kind
  const hasClub = productKind === 'club' || Boolean(runtime.dashboard?.membership.active)
  const paidTitle = productKind === 'club'
    ? 'Клубный билет активирован'
    : productKind === 'pack'
      ? 'Спецпоказ открыт'
      : productKind === 'tip'
        ? 'Жетон передан кассиру!'
        : productKind === 'tickets'
          ? 'Билеты начислены'
        : 'Покупка подтверждена'
  const paidDescription = productKind === 'club'
    ? 'Оплата подтверждена сервером, клубный доступ уже действует.'
    : productKind === 'pack'
      ? 'Спецпоказ навсегда добавлен в ваш аккаунт.'
      : productKind === 'tip'
        ? 'Покупка подтверждена: памятный цифровой жетон добавлен в личный кабинет, а счётчик поддержки кассира обновлён.'
        : productKind === 'tickets'
          ? 'Оплата подтверждена сервером, билеты уже добавлены на баланс.'
        : 'Оплата подтверждена сервером.'

  useEffect(() => {
    if (status && status !== 'created' && status !== 'pending') return
    const updateElapsed = () => setElapsedMs(Date.now() - startedAt.current)
    updateElapsed()
    const timer = window.setInterval(updateElapsed, 1_000)
    return () => window.clearInterval(timer)
  }, [status])

  useEffect(() => {
    trackClientEvent('checkout_returned', { orderStatus: status ?? 'checking', placement: 'purchase_return', hasClub })
    trackMetrikaGoal('checkout_returned', { orderStatus: status ?? 'checking' })
  }, [])

  useEffect(() => {
    if (!status || trackedStatus.current === status) return
    trackedStatus.current = status
    if (status === 'paid') {
      trackClientEvent('purchase_succeeded', { ...(order.data?.order.productId ? { productId: order.data.order.productId } : {}), orderStatus: status, hasClub })
      if (productKind === 'tickets') trackClientEvent('ticket_bundle_purchased', {
        productId: order.data?.order.productId ?? null,
        tickets: Number(order.data?.product.metadata.ticketAmount ?? 0),
      })
      trackMetrikaGoal('purchase_succeeded', { productId: order.data?.order.productId })
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
        queryClient.invalidateQueries({ queryKey: queryKeys.commerce }),
        queryClient.invalidateQueries({ queryKey: ['archive'] }),
      ])
    } else if (['failed', 'canceled', 'expired', 'refunded', 'chargeback'].includes(status)) {
      trackClientEvent('purchase_failed', { ...(order.data?.order.productId ? { productId: order.data.order.productId } : {}), orderStatus: status, hasClub })
      trackMetrikaGoal('purchase_failed', { productId: order.data?.order.productId, orderStatus: status })
    }
  }, [hasClub, order.data?.order.productId, productKind, queryClient, status])

  const pendingTimedOut = (status === 'created' || status === 'pending') && elapsedMs >= 60_000
  return <>
    <AppHeader onHome={onHome} onArchive={onArchive} onStats={onStats} onRules={onRules} onReview={onReview} />
    <main className="purchase-return">
      {!orderId ? <><XCircle /><h1>Заказ не указан</h1><p>Вернитесь в клуб и выберите абонемент ещё раз.</p></>
        : order.isError ? <><XCircle /><h1>Не удалось проверить заказ</h1><p>{apiErrorMessage(order.error)}</p></>
          : status === 'paid' ? <><CheckCircle2 /><h1>{paidTitle}</h1><p>{paidDescription}</p></>
            : ['failed', 'canceled', 'expired'].includes(status ?? '') ? <><XCircle /><h1>Оплата не завершена</h1><p>Доступ не выдан. Можно безопасно попробовать ещё раз.</p></>
              : ['refunded', 'chargeback'].includes(status ?? '') ? <><XCircle /><h1>Платёж возвращён</h1><p>Возврат зарегистрирован, доступ по этому заказу не действует.</p></>
              : pendingTimedOut ? <><Clock3 /><h1>Платёж ещё обрабатывается</h1><p>Мы продолжаем автоматически проверять CloudPayments. Обновлять страницу или оплачивать повторно не нужно.</p></>
                : <><Clock3 className="purchase-return__spin" /><h1>Проверяем оплату</h1><p>Не закрывайте страницу — подтверждение обычно занимает несколько секунд.</p></>}
      <div className="purchase-return__actions">
        {pendingTimedOut && <ControlButton type="button" disabled={order.isFetching} onClick={() => { void order.refetch() }}>
          {order.isFetching ? 'Проверяем…' : 'Проверить ещё раз'}
        </ControlButton>}
        <ControlButton type="button" onClick={productKind === 'tip' ? onProfile : onClub}>
          {productKind === 'tip' ? 'Посмотреть жетон' : 'Перейти в клуб'}
        </ControlButton>
      </div>
    </main>
  </>
}
