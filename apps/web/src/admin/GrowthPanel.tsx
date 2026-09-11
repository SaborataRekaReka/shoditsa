import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Check, ChevronDown, CircleDollarSign, Clock3, Crown, Eye, Gift, Info, LockKeyhole, Pause, RotateCcw, UsersRound } from 'lucide-react'
import { GROWTH_STAGES, type GrowthStage } from '@shoditsa/contracts'
import { adminApi } from './api'
import './GrowthPanel.css'

const labels: Record<GrowthStage, string> = { baseline: 'Наблюдение', replay: 'Следующий случай', registration: 'Бонус за регистрацию', club: 'Предложение клуба' }
const steps = [
  { stage: 'replay', Icon: RotateCcw, title: 'Ещё одна партия', description: 'Сначала непройденный случай из бесплатного недельного архива. Если он исчерпан — другие способы с явной стоимостью.' },
  { stage: 'registration', Icon: Gift, title: 'Причина зарегистрироваться', description: 'Новому аккаунту — 3 дополнительные партии «Диагнозов», один раз.' },
  { stage: 'club', Icon: Crown, title: 'Предложение клуба', description: 'Когда игроку хочется продолжить или не хватает билетов — предложить клуб.' },
] as const
const eventLabels: Record<string, string> = {
  diagnosis_replay_offer_view: 'Увидели «Следующий случай»',
  diagnosis_replay_clicked: 'Нажали «Следующий случай»',
  registration_bonus_offer_view: 'Увидели бонус за регистрацию',
  registration_bonus_offer_clicked: 'Нажали на предложение бонуса',
  club_context_offer_view: 'Увидели предложение клуба',
  club_context_offer_clicked: 'Нажали на предложение клуба',
  commerce_plan_selected: 'Выбрали клубный тариф',
}
const dateLabel = (value: string) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(value))
const numberLabel = (value: number | null) => value == null ? '—' : value.toLocaleString('ru-RU')
function MetricRow({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>
}

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
  const baseline = data?.effective.stage === 'baseline'

  return <section className="admin-panel admin-growth" id="growth" aria-labelledby="growth-title">
    <header className="admin-growth__header">
      <div>
        <span>Рост · эксперимент в «Диагнозах»</span>
        <h2 id="growth-title">Игра → регистрация → клуб</h2>
        <p>Что включено и что делают игроки</p>
      </div>
      <div className="admin-periods" role="group" aria-label="Период показателей роста">
        {([7, 14, 31] as const).map((value) => <button type="button" key={value} aria-pressed={days === value} className={days === value ? 'is-active' : ''} onClick={() => { setDays(value); setReviewed(false) }}>{value} {value === 31 ? 'день' : 'дней'}</button>)}
      </div>
    </header>

    <div className="admin-growth__body">
      {query.isLoading && <div className="admin-growth__notice" role="status"><Clock3 aria-hidden="true" /><p>Загружаем показатели за выбранный период…</p></div>}
      {query.error && <div className="admin-growth__notice admin-growth__notice--error" role="alert"><Info aria-hidden="true" /><p>Не удалось загрузить показатели. {query.error.message}</p></div>}
      {data && <>
        <div className={`admin-growth__status ${baseline ? '' : 'is-running'}`}>
          <span className="admin-growth__status-icon">{baseline ? <Eye aria-hidden="true" /> : <Check aria-hidden="true" />}</span>
          <div>
            <h3>{baseline ? 'Наблюдаем. Новые предложения пока выключены' : `Включён этап: ${labels[data.effective.stage]}`}</h3>
            <p>{baseline
              ? `Собираем исходные показатели. Первый этап можно включить не раньше ${dateLabel(data.nextStageAvailableAt)}.`
              : 'Смотрим, помогает ли изменение. Перед следующим этапом — минимум 7 полных дней измерений.'}</p>
          </div>
          <span className="admin-growth__manual"><LockKeyhole aria-hidden="true" />Включение вручную</span>
        </div>

        <div className="admin-growth__steps" aria-label="Новые предложения игроку">
          {steps.map(({ stage, Icon, title, description }) => <article className={`admin-growth__step ${data.effective[stage] ? 'is-enabled' : ''}`} key={stage}>
            <div className="admin-growth__step-top"><span className="admin-growth__icon"><Icon aria-hidden="true" /></span><span className={`admin-growth__badge ${data.effective[stage] ? 'is-enabled' : ''}`}>{data.effective[stage] ? 'Включено' : 'Выключено'}</span></div>
            <h3>{title}</h3><p>{description}</p>
          </article>)}
        </div>

        <div className="admin-growth__section-heading">
          <div><h3>Результаты за {days} {days === 31 ? 'день' : 'дней'}</h3><p>{dateLabel(data.period.from)} — {dateLabel(new Date(Date.parse(data.period.toExclusive) - 1).toISOString())} {new Date(data.period.from).getUTCFullYear()} · UTC</p></div>
          <p>Сегодня не включено · без администраторов</p>
        </div>

        <div className="admin-growth__metrics">
          <article className="admin-growth__metric">
            <div className="admin-growth__metric-heading"><RotateCcw aria-hidden="true" /><h4>Завершённые «Диагнозы»</h4></div>
            <strong className="admin-growth__value">{numberLabel(data.sessions.completions)}</strong>
            <p className="admin-growth__metric-caption">Игроков с завершённой партией: {numberLabel(data.sessions.firstCompleters)}</p>
            <dl>
              <MetricRow label="Игроки в измерении повторов">{numberLabel(data.sessions.measuredCompleters)}</MetricRow>
              <MetricRow label="Продолжили после результата">{numberLabel(data.sessions.repeatingCompleters)}</MetricRow>
              <MetricRow label="Повторные старты">{numberLabel(data.sessions.repeatStarts)}</MetricRow>
              <MetricRow label="Завершённые повторы">{numberLabel(data.sessions.repeatCompletions)}</MetricRow>
            </dl>
          </article>
          <article className="admin-growth__metric">
            <div className="admin-growth__metric-heading"><UsersRound aria-hidden="true" /><h4>Новые аккаунты</h4></div>
            <strong className="admin-growth__value">{numberLabel(data.accounts.created)}</strong>
            <p className="admin-growth__metric-caption">Создано на сайте · все источники</p>
            <dl>
              <MetricRow label="Регистрации, отмеченные событием">{numberLabel(data.accounts.signUps)}</MetricRow>
              <MetricRow label="Получили бонус из 3 партий">{numberLabel(data.accounts.bonusGranted)}</MetricRow>
              <MetricRow label="Воспользовались бонусом">{numberLabel(data.accounts.bonusPlayers)}</MetricRow>
              <MetricRow label="Бонусные старты / завершения">{numberLabel(data.sessions.bonusStarts)} / {numberLabel(data.sessions.bonusCompletions)}</MetricRow>
            </dl>
          </article>
          <article className="admin-growth__metric">
            <div className="admin-growth__metric-heading"><CircleDollarSign aria-hidden="true" /><h4>Оплаты клуба</h4></div>
            <strong className="admin-growth__value">{numberLabel(data.commerce.revenueMinor / 100)} <span>₽</span></strong>
            <p className="admin-growth__metric-caption">По заказам, созданным в этом окне · все источники</p>
            <dl>
              <MetricRow label="Создано заказов">{numberLabel(data.commerce.orders)}</MetricRow>
              <MetricRow label="Оплачено заказов">{numberLabel(data.commerce.paidOrders)}</MetricRow>
              <MetricRow label="Покупатели">{numberLabel(data.commerce.payingUsers)}</MetricRow>
              <MetricRow label="Играли с клубом после оплаты">{numberLabel(data.commerce.paidUsersUsedClub)}</MetricRow>
            </dl>
          </article>
        </div>

        <div className="admin-growth__notice"><Info aria-hidden="true" /><p>{data.measurement.coverage === 'not_started'
          ? <>Повторы и игру с клубом начинаем измерять с <strong>{dateLabel(data.measurement.from)}</strong>. «—» — ещё нет измерений, а не нулевой результат.</>
          : <>Повторы и игра с клубом измерены с <strong>{dateLabel(data.measurement.from)}</strong>. {data.measurement.coverage === 'partial' ? 'Ранняя часть выбранного периода не покрыта — не считаем её нулём.' : 'Выбранный период покрыт полностью.'}</>}</p></div>

        <div className="admin-growth__details-group">
          <details className="admin-growth__details">
            <summary><Info aria-hidden="true" /><span>Как читать эти цифры</span><ChevronDown aria-hidden="true" /></summary>
            <div className="admin-growth__details-body">
              <ul>
                <li>Партии относятся к «Диагнозам». Новые аккаунты и оплаты — ко всему сайту, из всех источников. Эти числа не означают, что все зарегистрировались или купили клуб после «Диагнозов».</li>
                <li>Завершённая партия — финальный статус на сервере, не обязательно победа или открытый экран результата. Повтор учитывается, когда он связан с предыдущей завершённой партией.</li>
                <li>Связь повторов и способ доступа к игре начали сохранять 7 сентября. Первый полный день — 8 сентября. Для старой истории без этой связи показываем «—».</li>
                <li>Бесплатное архивное продолжение: {data.measurement.freeArchiveFirstObservedAt ? `первая запись в завершённых днях — ${dateLabel(data.measurement.freeArchiveFirstObservedAt)}.` : 'в завершённых днях пока не наблюдалось; это не отсутствие старых архивных игр.'} Новая версия измерения не восстанавливает прошлую историю.</li>
                <li>Новые показы предложений считаются при видимости не менее 25% в активной вкладке (visible-v2). Их нельзя напрямую сравнивать со старыми показами, записанными при загрузке компонента.</li>
                <li>Число аккаунтов берём из созданных записей на сервере. Событие регистрации — отдельная проверка учёта; если числа расходятся, это не дополнительные пользователи.</li>
                <li>Оплаты подтверждаются серверными заказами, а не нажатием кнопки. Показаны заказы, созданные в выбранном периоде. Администраторы и заказы тестового платёжного режима исключены; другие тестовые покупки нужно проверять отдельно.</li>
                <li>«Играли с клубом после оплаты» — свободная игра после покупки в измеренной части периода. Использование архива и других преимуществ клуба в этот показатель не входит.</li>
              </ul>
              {data.sessions.repeatByAccessSource && <>
                <p>Связанные повторы по доступу. Один игрок может использовать несколько способов — число игроков между строками не суммируется.</p>
                <div className="admin-growth__table-scroll"><table className="admin-table"><thead><tr><th>Способ</th><th>Начали</th><th>Завершили</th><th>Игроки</th></tr></thead><tbody>{data.sessions.repeatByAccessSource.map((row) => <tr key={row.accessSource}><td>{({ free_archive: 'Бесплатный архив', tickets: 'За билеты', club: 'Клуб', registration_bonus: 'Бонус регистрации', unknown: 'Неизвестно' } as Record<string, string>)[row.accessSource] || row.accessSource}</td><td>{numberLabel(row.repeatStarts)}</td><td>{numberLabel(row.repeatCompletions)}</td><td>{numberLabel(row.repeatingCompleters)}</td></tr>)}</tbody></table></div>
              </>}
            </div>
          </details>
          <details className="admin-growth__details">
            <summary><Eye aria-hidden="true" /><span>Показы и нажатия на предложения</span><ChevronDown aria-hidden="true" /></summary>
            <div className="admin-growth__details-body">
              <div className="admin-growth__table-scroll"><table className="admin-table"><thead><tr><th>Действие</th><th>Этап</th><th>Согласие на аналитику</th><th>События</th><th>Пользователи</th></tr></thead><tbody>{data.events.map((row) => <tr key={`${row.eventName}:${row.stage}:${row.consent}`}><td>{eventLabels[row.eventName] || row.eventName}<small>{eventLabels[row.eventName] ? row.eventName : ''}</small></td><td>{labels[row.stage as GrowthStage] || row.stage}</td><td>{({ granted: 'Дано', denied: 'Не дано', unknown: 'Неизвестно' } as Record<string, string>)[row.consent] || row.consent}</td><td>{numberLabel(row.events)}</td><td>{numberLabel(row.users)}</td></tr>)}</tbody></table></div>
              {!data.events.length && <p className="admin-growth__empty">Новых показов и нажатий пока нет.{baseline ? ' Предложения ещё выключены — это ожидаемо.' : ''}</p>}
            </div>
          </details>
        </div>

        {next && <div className="admin-growth__activation">
          <div className="admin-growth__activation-heading"><span className="admin-growth__icon">{available ? <ArrowRight aria-hidden="true" /> : <LockKeyhole aria-hidden="true" />}</span><div><h3>Следующий этап: {labels[next]}</h3><p>{available ? 'Доступен для ручного включения после оценки результатов.' : `Можно включить не раньше ${dateLabel(data.nextStageAvailableAt)} (UTC). Сам не включится.`}</p></div></div>
          <div className="admin-growth__activation-controls">
            <label className={`admin-growth__confirmation ${!available ? 'is-disabled' : ''}`}><input type="checkbox" checked={reviewed} disabled={!available || mutation.isPending} onChange={(event) => setReviewed(event.target.checked)} /><span>Проверил результаты и готов включить следующий этап</span></label>
            <button type="button" className="admin-btn admin-btn--primary" disabled={!available || !reviewed || mutation.isPending} onClick={() => mutation.mutate(next)}>{mutation.isPending ? 'Сохраняем…' : `Включить: ${labels[next]}`}<ArrowRight aria-hidden="true" /></button>
          </div>
          <p className="admin-growth__activation-note">Меняем по одному шагу и измеряем минимум 7 полных дней, чтобы понимать, что именно помогло.</p>
        </div>}
        <div className="admin-growth__footer">
          <p>Выданные бонусы сохраняются при паузе. Цены и условия действующих клубных билетов не меняются.</p>
          {data.policy.stage !== 'baseline' && <button type="button" className="admin-btn admin-btn--secondary" disabled={mutation.isPending} onClick={() => mutation.mutate('baseline')}><Pause aria-hidden="true" />Приостановить эксперимент</button>}
        </div>
        {mutation.error && <div className="admin-growth__notice admin-growth__notice--error" role="alert"><Info aria-hidden="true" /><p>{mutation.error.message}</p></div>}
      </>}
    </div>
  </section>
}
