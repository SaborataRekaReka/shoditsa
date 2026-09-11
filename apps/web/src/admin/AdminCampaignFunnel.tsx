import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AdminCampaignFunnelResponse, AdminCampaignPeriod } from '@shoditsa/contracts'
import { adminApi } from './api'
import './AdminCampaignFunnel.css'

const number = (value: number) => value.toLocaleString('ru-RU')
const date = (value: string) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(value))

export function CampaignFunnelData({ report }: { report: AdminCampaignFunnelResponse }) {
  const lastDay = new Date(new Date(report.window.toExclusive).getTime() - 86_400_000).toISOString()
  return <div className="admin-campaign__body">
    <p className="admin-campaign__context">{date(report.window.fromInclusive)} — {date(lastDay)}, полные дни UTC. Сегодня не включено. Только размеченные размещения «Диагнозов»; поисковая органика — в отдельном отчёте.</p>
    {report.status === 'no_observations' ? <div className="admin-campaign__notice" role="status">
      <strong>Измеренных входов пилота пока нет</strong>
      <p>Это не значит, что никто не приходил. Нужны новая UTM-ссылка, согласие на аналитику и хотя бы один завершённый день. Прошлые неразмеченные визиты здесь не восстановятся.</p>
    </div> : <>
      {report.status === 'partial' && <div className="admin-campaign__notice is-warning" role="status"><strong>Выборка неполная</strong><p>Достигнут защитный лимит данных. Числа ниже — только видимая часть; по ним нельзя считать итоговую конверсию или выбирать победивший канал.</p></div>}
      <dl className="admin-campaign__summary">
        <div><dt>Измеренные входы</dt><dd>{number(report.summary.acquisitions)}</dd></div>
        <div><dt>С прохождением</dt><dd>{number(report.summary.completed)}</dd></div>
        <div><dt>С повторным прохождением</dt><dd>{number(report.summary.repeatCompleted)}</dd></div>
        <div><dt>С новой регистрацией</dt><dd>{number(report.summary.registered)}</dd></div>
      </dl>
      <p className="admin-campaign__caption">Каждая колонка считает входы с указанным результатом, не события и не уникальных людей. Регистрация может произойти до первой партии.</p>
      <div className="admin-campaign__table-scroll" tabIndex={0} role="region" aria-label="Результаты каналов продвижения">
        <table>
          <thead><tr><th scope="col">Источник и кампания</th><th scope="col">Входы</th><th scope="col">Старт</th><th scope="col">Прошли</th><th scope="col">Прошли 2+</th><th scope="col">Регистрация</th><th scope="col">Клуб · новые аккаунты</th></tr></thead>
          <tbody>{report.items.map((item) => <tr key={`${item.source}/${item.medium}/${item.campaign}/${item.landing}`}>
            <th scope="row"><strong>{item.source}</strong><span>{item.medium === 'paid_social' ? 'Платное размещение' : 'Рекомендация / ссылка'} · {item.campaign}</span><span>{item.landing}</span></th>
            <td>{number(item.acquisitions)}</td><td>{number(item.started)}</td><td>{number(item.completed)}</td><td>{number(item.repeatCompleted)}</td><td>{number(item.registered)}</td><td>{number(item.paidClub)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className="admin-campaign__caption">Регистрация после первого прохождения: {number(report.summary.registeredAfterCompletion)} входов. Клуб — только оплаты новых аккаунтов с подтверждённым sign_up этой когорты; покупки существующих игроков сюда не входят. Оплаченных заказов: {number(report.summary.paidClubOrders)}. Администраторы и stub-платежи исключены.</p>
    </>}
    <details className="admin-campaign__details"><summary>Покрытие, зрелость и правила подсчёта</summary>
      <dl className="admin-campaign__coverage">
        <div><dt>Первая запись пилота в доступном RAW</dt><dd>{report.coverage.firstObservedAt ? date(report.coverage.firstObservedAt) : 'Ещё нет'}</dd></div>
        <div><dt>Связи с серверными сессиями</dt><dd>{number(report.coverage.matchedSessionLinks)} из {number(report.coverage.sessionLinks)}</dd></div>
        <div><dt>Входы с полными 24 часами / 7 днями наблюдения</dt><dd>{number(report.summary.matured24h)} / {number(report.summary.matured7d)}</dd></div>
        <div><dt>Исключено конфликтующих UTM-входов</dt><dd>{number(report.coverage.conflictingAcquisitions)}</dd></div>
        <div><dt>Удержание D2–7 / доля согласившихся</dt><dd>Пока не измерено</dd></div>
      </dl>
      <ul>{report.methodology.map((item) => <li key={item}>{item}</li>)}</ul>
    </details>
  </div>
}

export function AdminCampaignFunnel() {
  const [days, setDays] = useState<AdminCampaignPeriod>(14)
  const query = useQuery({ queryKey: ['admin', 'campaign-funnel', days], queryFn: () => adminApi.campaignFunnel(days), staleTime: 60_000 })
  return <section className="admin-panel admin-campaign" id="campaigns" aria-labelledby="admin-campaign-title">
    <header className="admin-campaign__header"><div><span className="admin-kicker">Привлечение · отдельный пилот</span><h2 id="admin-campaign-title">Продвижение «Диагнозов»</h2><p>От измеренного входа до повторной игры и клуба.</p></div>
      <div className="admin-periods" role="group" aria-label="Период продвижения">{([7, 14, 31] as const).map((period) => <button key={period} type="button" className={days === period ? 'is-active' : ''} aria-pressed={days === period} onClick={() => setDays(period)}>{period} {period === 31 ? 'день' : 'дней'}</button>)}</div>
    </header>
    {query.isPending ? <p className="admin-campaign__state" role="status">Собираем измеренные входы…</p> : query.isError ? <div className="admin-campaign__state" role="alert"><p>Не удалось загрузить отчёт. Данные не заменены нулями.</p><button className="admin-btn" type="button" onClick={() => void query.refetch()}>Повторить</button></div> : query.data && <CampaignFunnelData report={query.data} />}
  </section>
}
