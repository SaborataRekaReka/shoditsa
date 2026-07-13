import { useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock, Ticket } from 'lucide-react'
import { api, queryKeys } from '../../api/client'
import { apiErrorMessage } from '../../api/error-message'
import { ensureServerSession, useServerRuntime } from '../../hooks/use-server-runtime'
import { emptyAttendanceStats } from '../../storage'
import { formatMultiplier, formatTickets, nextMultiplierAt, streakMultiplier } from './economy-rules'

const ledgerReasonLabel = (reason: string) => reason === 'game-completion'
  ? 'Награда за сеанс'
  : reason === 'period-unlock'
    ? 'Открыт период'
    : reason === 'free-play'
      ? 'Свободная игра'
      : reason === 'promo'
        ? 'Промокод'
        : reason === 'legacy-import'
          ? 'Перенос прогресса'
          : 'Операция с билетами'

export function ServerEconomyView() {
  const queryClient = useQueryClient()
  const serverRuntime = useServerRuntime()
  const ledger = useQuery({
    queryKey: queryKeys.ledger,
    queryFn: api.ledger,
    enabled: Boolean(serverRuntime.me),
  })
  const [promoCode, setPromoCode] = useState('')
  const [promoMessage, setPromoMessage] = useState('')
  const promoKeyRef = useRef<string | null>(null)
  const promo = useMutation({
    mutationFn: async ({ code, key }: { code: string; key: string }) => {
      await ensureServerSession()
      return api.redeem(code, key)
    },
    onSuccess: async (result) => {
      promoKeyRef.current = null
      setPromoCode('')
      setPromoMessage(result.alreadyRedeemed
        ? 'Этот запрос уже был обработан.'
        : result.reward ? `Начислено ${formatTickets(result.reward.amount)}.` : 'Промокод активирован.')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
        queryClient.invalidateQueries({ queryKey: queryKeys.ledger }),
      ])
    },
    onError: (error) => setPromoMessage(apiErrorMessage(error)),
  })
  const attendance = { ...emptyAttendanceStats(), ...(serverRuntime.dashboard?.attendance ?? {}) }
  const wallet = serverRuntime.dashboard?.wallet ?? { balance: 0, lifetimeEarned: 0 }
  const nextAt = nextMultiplierAt(attendance.currentDailyStreak)
  const multiplier = streakMultiplier(attendance.currentDailyStreak)
  const submitPromoCode = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const code = promoCode.trim()
    if (!code || promo.isPending) {
      if (!code) setPromoMessage('Введите промокод.')
      return
    }
    const key = promoKeyRef.current ?? crypto.randomUUID()
    promoKeyRef.current = key
    promo.mutate({ code, key })
  }

  return <div className="economy-view">
    <div className="stats-grid stats-grid--economy">
      <div><strong>{wallet.balance}</strong><span>сейчас</span></div>
      <div><strong>{wallet.lifetimeEarned}</strong><span>всего</span></div>
      <div><strong>{attendance.currentDailyStreak}</strong><span>абонемент</span></div>
      <div><strong>{formatMultiplier(multiplier)}</strong><span>множитель</span></div>
    </div>
    <div className="economy-note"><Ticket /><p>Билеты открывают дополнительные периоды и свободные игры. Все списания и начисления подтверждает сервер.</p></div>
    <p className="modal-lead">Баланс и история сохраняются в серверном профиле. Для гостя они привязаны к текущей гостевой сессии; после регистрации прогресс можно сохранить в аккаунте.</p>
    <form className="ticket-promo" onSubmit={submitPromoCode}>
      <div className="ticket-promo__copy"><span><Ticket /> Промокод</span><small>Код проверяется на сервере</small></div>
      <div className="ticket-promo__row"><input value={promoCode} onChange={(event) => { setPromoCode(event.target.value); promoKeyRef.current = null; setPromoMessage('') }} placeholder="Промокод" autoComplete="off" /><button type="submit" disabled={promo.isPending}>{promo.isPending ? 'Проверяем…' : 'Активировать'}</button></div>
      {promoMessage && <p>{promoMessage}</p>}
    </form>
    <h3 className="subheading">Как начисляется</h3>
    <div className="economy-rules"><span><strong>+10</strong> завершить сеанс</span><span><strong>+10</strong> угадать ответ</span><span><strong>+0-9</strong> бонус за попытки</span><span><strong>+5</strong> первый сеанс дня</span><span><strong>+25</strong> полный зал всех режимов</span></div>
    <p className="modal-lead">Абонемент продлевается за первый завершённый daily-сеанс дня. {nextAt ? `До ${formatMultiplier(streakMultiplier(nextAt))}: ${nextAt - attendance.currentDailyStreak} дн.` : 'Максимальный множитель уже активен.'}</p>
    <h3 className="subheading">История билетов</h3>
    {ledger.isLoading
      ? <p className="modal-lead">Загружаем историю…</p>
      : ledger.isError
        ? <p className="server-error">{apiErrorMessage(ledger.error)}</p>
        : ledger.data?.items.length
          ? <div className="ticket-ledger">{ledger.data.items.map((entry) => <article className={`ticket-ledger__item ${entry.amount >= 0 ? 'earn' : 'spend'}`} key={entry.id}><span>{entry.amount >= 0 ? <Ticket /> : <Lock />}</span><div><strong>{ledgerReasonLabel(entry.reason)}</strong><small>{new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(entry.createdAt))}</small></div><em>{entry.amount >= 0 ? '+' : '−'}{Math.abs(entry.amount)}</em></article>)}</div>
          : <p className="modal-lead">История появится после первого завершённого сеанса или открытия периода.</p>}
  </div>
}
