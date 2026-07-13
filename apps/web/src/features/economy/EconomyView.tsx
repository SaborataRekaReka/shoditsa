import { useState, type FormEvent } from 'react'
import { Lock, Ticket } from 'lucide-react'
import { trackMetrikaGoal } from '../../app/metrics'
import {
  addTicketLedgerEntry,
  loadAttendanceStats,
  loadPromoUsage,
  loadTicketLedger,
  loadWallet,
  savePromoUsage,
  saveWallet,
} from '../../storage'
import { SERVER_RUNTIME } from '../../hooks/use-server-runtime'
import { formatMultiplier, formatTickets, nextMultiplierAt, streakMultiplier } from './economy-rules'
import { ServerEconomyView } from './ServerEconomyView'

const TICKET_PROMO_CODE = 'ДАЙБИЛЕТИК'
const TICKET_PROMO_AWARD = 50
const TICKET_PROMO_LIMIT = 3

export const ECONOMY_CHANGE_EVENT = 'seans:economy-change'

export function EconomyView() {
  return SERVER_RUNTIME ? <ServerEconomyView /> : <LocalEconomyView />
}

function LocalEconomyView() {
  const [wallet, setWallet] = useState(loadWallet)
  const [ledger, setLedger] = useState(loadTicketLedger)
  const [promoUsage, setPromoUsage] = useState(loadPromoUsage)
  const [promoCode, setPromoCode] = useState('')
  const [promoMessage, setPromoMessage] = useState('')
  const attendance = loadAttendanceStats()
  const nextAt = nextMultiplierAt(attendance.currentDailyStreak)
  const multiplier = streakMultiplier(attendance.currentDailyStreak)
  const notifyEconomyChange = () => window.dispatchEvent(new Event(ECONOMY_CHANGE_EVENT))

  const submitPromoCode = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalizedCode = promoCode.trim().toLocaleUpperCase('ru-RU').replace(/Ё/g, 'Е')
    if (!normalizedCode) {
      trackMetrikaGoal('promo_empty_submit')
      setPromoMessage('Кассир ждёт')
      return
    }
    if (normalizedCode !== TICKET_PROMO_CODE) {
      trackMetrikaGoal('promo_invalid_code')
      setPromoMessage('Кассир не узнал этот код.')
      return
    }
    const used = promoUsage[TICKET_PROMO_CODE] ?? 0
    if (used >= TICKET_PROMO_LIMIT) {
      trackMetrikaGoal('promo_limit_reached')
      setPromoMessage('Этот код уже шептали кассиру три раза.')
      return
    }

    const currentWallet = loadWallet()
    const nextWallet = {
      tickets: currentWallet.tickets + TICKET_PROMO_AWARD,
      lifetimeTickets: currentWallet.lifetimeTickets + TICKET_PROMO_AWARD,
    }
    const nextUsage = { ...promoUsage, [TICKET_PROMO_CODE]: used + 1 }
    saveWallet(nextWallet)
    savePromoUsage(nextUsage)
    addTicketLedgerEntry({
      type: 'earn',
      amount: TICKET_PROMO_AWARD,
      balanceAfter: nextWallet.tickets,
      title: 'Кассирский шёпот',
      detail: `Промокод ${TICKET_PROMO_CODE} · ${used + 1}/${TICKET_PROMO_LIMIT}`,
    })
    setWallet(nextWallet)
    setLedger(loadTicketLedger())
    setPromoUsage(nextUsage)
    setPromoCode('')
    setPromoMessage(`Кассир выдал ${formatTickets(TICKET_PROMO_AWARD)}.`)
    trackMetrikaGoal('promo_ticket_bonus', { amount: TICKET_PROMO_AWARD, usage: used + 1 })
    notifyEconomyChange()
  }

  return <div className="economy-view">
    <div className="stats-grid stats-grid--economy">
      <div><strong>{wallet.tickets}</strong><span>сейчас</span></div>
      <div><strong>{wallet.lifetimeTickets}</strong><span>всего</span></div>
      <div><strong>{attendance.currentDailyStreak}</strong><span>абонемент</span></div>
      <div><strong>{formatMultiplier(multiplier)}</strong><span>множитель</span></div>
    </div>
    <div className="economy-note"><Ticket /><p>Билеты открывают дополнительные периоды в кино, сериалах, аниме и музыке. Базовый сеанс всегда доступен, а закрытый период можно выбрать заранее.</p></div>
    <p className="modal-lead">Билеты хранятся только в этом браузере на этом устройстве. В другом браузере или на другом устройстве они не переносятся. Если очистить данные сайта, билеты и их история могут исчезнуть.</p>
    <form className="ticket-promo" onSubmit={submitPromoCode}>
      <div className="ticket-promo__copy"><span><Ticket /> Шепнуть кассиру</span><small>Неизвестно, сколько раз это сработает</small></div>
      <div className="ticket-promo__row"><input value={promoCode} onChange={(event) => setPromoCode(event.target.value)} placeholder="Секретная фраза" autoComplete="off" /><button type="submit">Сказать</button></div>
      {promoMessage && <p>{promoMessage}</p>}
    </form>
    <h3 className="subheading">Как начисляется</h3>
    <div className="economy-rules"><span><strong>+10</strong> завершить сеанс</span><span><strong>+10</strong> угадать ответ</span><span><strong>+0-9</strong> бонус за попытки</span><span><strong>+5</strong> первый сеанс дня</span><span><strong>+25</strong> полный зал всех режимов</span></div>
    <p className="modal-lead">Абонемент продлевается за первый завершённый daily-сеанс дня, даже если ответ не угадан. Первый сеанс дня умножается на текущий множитель. {nextAt ? `До ${formatMultiplier(streakMultiplier(nextAt))}: ${nextAt - attendance.currentDailyStreak} дн.` : 'Максимальный множитель уже активен.'}</p>
    <h3 className="subheading">История билетов</h3>
    {ledger.length
      ? <div className="ticket-ledger">{ledger.slice(0, 14).map((entry) => <article className={`ticket-ledger__item ${entry.type}`} key={entry.id}><span>{entry.type === 'earn' ? <Ticket /> : <Lock />}</span><div><strong>{entry.title}</strong><small>{entry.detail} · {new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(entry.at))}</small></div><em>{entry.type === 'earn' ? '+' : '-'}{entry.amount}</em></article>)}</div>
      : <p className="modal-lead">История появится после первого завершённого сеанса или открытия периода.</p>}
  </div>
}
