import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { GROWTH_STAGES } from '@shoditsa/contracts'
import { adminApi } from './api'

const labels = { baseline: 'Наблюдение', replay: 'Следующий случай', registration: 'Бонус за регистрацию', club: 'Контекстный клуб' }
export function GrowthPanel() {
  const [days, setDays] = useState<7 | 14 | 31>(7)
  const [reviewed, setReviewed] = useState(false)
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['admin', 'growth', days], queryFn: () => adminApi.growth(days) })
  const mutation = useMutation({ mutationFn: adminApi.updateGrowth, onSuccess: async () => {
    setReviewed(false)
    await Promise.all([client.invalidateQueries({ queryKey: ['admin', 'growth'] }), client.invalidateQueries({ queryKey: ['meta'] })])
  } })
  const data = query.data
  const next = data ? GROWTH_STAGES[GROWTH_STAGES.indexOf(data.policy.stage) + 1] : undefined
  const available = Boolean(data && Date.now() >= Date.parse(data.nextStageAvailableAt))
  return <section className="admin-panel" id="growth" style={{ marginBottom: 24 }}>
    <header><div><span>Эксперимент · Диагнозы</span><h2>Игра → регистрация → клуб</h2></div><div className="admin-periods">{([7, 14, 31] as const).map((value) => <button key={value} className={days === value ? 'is-active' : ''} onClick={() => setDays(value)}>{value} дней</button>)}</div></header>
    <div style={{ padding: 20 }}>
      {query.isLoading && <p role="status">Загружаем серверные агрегаты…</p>}
      {query.error && <p role="alert">{query.error.message}</p>}
      {data && <>
        <p><strong>Текущий этап: {labels[data.effective.stage]}.</strong> Окно: {data.period.from.slice(0, 10)} — {new Date(Date.parse(data.period.toExclusive) - 1).toISOString().slice(0, 10)} включительно, UTC. Сегодня не включено; администраторы исключены.</p>
        <p>До 12 сентября сохраняем действующие рекомендации. Затем включаем по одному этапу и оставляем минимум 7 полных дней на измерение. Автоматического включения нет.</p>
        <div className="admin-economy-observability">
          <div><h3>Повторные партии «Диагнозов»</h3><p>Результатов: <strong>{data.sessions.completions}</strong>. Завершивших игроков: <strong>{data.sessions.firstCompleters}</strong>.</p><p>Продолжили после своего первого результата в окне: <strong>{data.sessions.repeatingCompleters}</strong>.</p><p>Связанные повторные старты: <strong>{data.sessions.repeatStarts}</strong> → завершения: <strong>{data.sessions.repeatCompletions}</strong>.</p></div>
          <div><h3>Новые аккаунты и бонус</h3><p>Аккаунты / server sign_up: <strong>{data.accounts.created} / {data.accounts.signUps}</strong>.</p><p>Получили бонус / начали его использовать: <strong>{data.accounts.bonusGranted} / {data.accounts.bonusPlayers}</strong>.</p><p>Бонусные старты / завершения: <strong>{data.sessions.bonusStarts} / {data.sessions.bonusCompletions}</strong>.</p></div>
          <div><h3>Клуб · все источники</h3><p>Заказы / оплачены: <strong>{data.commerce.orders} / {data.commerce.paidOrders}</strong>.</p><p>Покупатели / использовали свободную игру после оплаты: <strong>{data.commerce.payingUsers} / {data.commerce.paidUsersUsedClub}</strong>.</p><p>Выручка когорты заказов: <strong>{(data.commerce.revenueMinor / 100).toLocaleString('ru-RU')} ₽</strong>.</p></div>
        </div>
        <p>Связь повторов и источник доступа измеряются с релиза 7 сентября. Старые сессии без этой связи — неизвестны, не нулевая конверсия. Завершение означает показ результата, не обязательно победу. Оплаты сверяются по серверным заказам, не кликам; stub и администраторы исключены, прочие тестовые покупки требуют отдельной классификации.</p>
        <details><summary>Показы и клики по этапам / согласиям</summary><div style={{ overflowX: 'auto' }}><table className="admin-table"><thead><tr><th>Событие</th><th>Этап</th><th>Согласие</th><th>События</th><th>Пользователи</th></tr></thead><tbody>{data.events.map((row) => <tr key={`${row.eventName}:${row.stage}:${row.consent}`}><td>{row.eventName}</td><td>{row.stage}</td><td>{row.consent}</td><td>{row.events}</td><td>{row.users}</td></tr>)}</tbody></table>{!data.events.length && <p>Новые показы и клики пока не зарегистрированы.</p>}</div></details>
        {next && <div className="admin-toolbar" style={{ flexWrap: 'wrap', marginTop: 20 }}>
          <label><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /> Проверил результаты текущего окна и готов включить следующий этап</label>
          <button className="admin-btn admin-btn--primary" disabled={!available || !reviewed || mutation.isPending} onClick={() => mutation.mutate(next)}>Включить: {labels[next]}</button>
          {!available && <small>Не раньше {data.nextStageAvailableAt.slice(0, 10)} UTC</small>}
        </div>}
        {data.policy.stage !== 'baseline' && <button className="admin-btn admin-btn--secondary" disabled={mutation.isPending} onClick={() => mutation.mutate('baseline')}>Приостановить эксперимент</button>}
        <p>Выданные бонусы при паузе не пропадают. Цена и условия действующих клубных билетов не меняются.</p>
        {mutation.error && <p role="alert">{mutation.error.message}</p>}
      </>}
    </div>
  </section>
}
