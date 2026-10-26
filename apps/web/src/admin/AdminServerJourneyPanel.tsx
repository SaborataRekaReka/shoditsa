import type { AdminServerJourneyReport } from '@shoditsa/contracts'
import './admin-server-journeys.css'

const rate = (value: number | null) => value == null ? '—' : `${value.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`
const date = (value: string) => new Date(value).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', timeZone: 'UTC' })
const modeLabels = { animal: 'Животные', character: 'Персонажи', book: 'Книги' }

export function AdminServerJourneyPanel({ report }: { report?: AdminServerJourneyReport }) {
  if (!report) return null
  if (report.status !== 'available' || !report.current || !report.previous) return <section className="admin-acquisition__danetki admin-server-journeys">
    <header><div><span>Серверная проверка</span><h3>Повторы и переходы</h3></div></header>
    <p>Серверная проверка временно недоступна. Отсутствующие значения не считаются нулём; клиентские события выше остаются отдельным источником.</p>
  </section>
  const periods = [['current', 'Текущий период'], ['previous', 'Предыдущий период']] as const
  return <>
    <section className="admin-acquisition__danetki admin-server-journeys">
      <header><div><span>Серверные партии, без сотрудников и спецпаков</span><h3>Диагнозы: повтор или другая игра</h3></div><small>Новая методика {report.method}</small></header>
      <p>Повтор подтверждён ссылкой на исходную партию. Другая игра — связанная цепочка завершения, клика и новой серверной партии в пределах 15 минут. Возобновление старой партии не считается новым стартом.</p>
      <div className="admin-acquisition__danetki-columns">
        {periods.map(([key, label]) => {
          const period = report[key]!
          return <article key={key}>
            <header><strong>{label}</strong><small>{date(period.window.from)}–{date(new Date(Date.parse(period.window.toExclusive) - 1).toISOString())} UTC</small></header>
            {(period.factsCoverage !== 'complete' || period.rawCoverage !== 'complete') && <p>Частичное покрытие: сравнение конверсий этого периода ненадёжно. Исторические пропуски не восстановлены.</p>}
            {(['all', 'organic'] as const).map(scope => {
              const data = period.diagnosis[scope]
              return <div key={scope} className="admin-acquisition__danetki-group">
                <h4>{scope === 'all' ? 'Все источники' : 'Органика с согласием и атрибуцией'}</h4>
                <dl>
                  <div><dt>Завершённые диагнозы</dt><dd>{data.completedSessions}</dd></div>
                  <div><dt>Повторы Диагнозов</dt><dd>{data.sameGameStarts}<small>из {data.sameGameSources} исходных партий</small></dd></div>
                  <div><dt>Клики по другим играм</dt><dd>{data.recommendationClicks}</dd></div>
                  <div><dt>Новые партии других игр</dt><dd>{data.crossGameStarts}<small>{data.crossGameCompletions} завершены</small></dd></div>
                  <div><dt>Исходные партии с переходом</dt><dd>{data.crossGameSources}/{data.completedSessions}<small>{rate(data.crossGameRate)}</small></dd></div>
                  {data.byMode.map(mode => <div key={mode.mode}><dt>{modeLabels[mode.mode]}</dt><dd>{mode.starts}<small>{mode.completions} завершены</small></dd></div>)}
                </dl>
                {!!data.linkedExistingTargets && <p>{data.linkedExistingTargets} связанных партий начались до клика и не засчитаны как новые. Возможны возобновление или разница клиентских и серверных часов.</p>}
              </div>
            })}
          </article>
        })}
      </div>
      <p>Знаменатель — серверные завершения won/lost в периоде, expired исключён. Доля переходов считается по различным исходным партиям, а не по числу кликов. Органический сегмент отражает только доступные события с согласием, а не весь трафик Метрики.</p>
    </section>
    <section className="admin-acquisition__danetki admin-server-journeys">
      <header><div><span>Одинаковое время наблюдения</span><h3>Первый опыт и возвраты</h3></div><small>Малые выборки не доказывают эффект изменений</small></header>
      <div className="admin-acquisition__danetki-columns">
        {periods.map(([key, label]) => {
          const period = report[key]!
          const retention = period.retention
          return <article key={key}>
            <header><strong>{label}</strong><small>Все источники</small></header>
            {period.factsCoverage !== 'complete' && <p>История серверных партий за этот период неполна. Показаны только сохранившиеся наблюдения; проценты скрыты.</p>}
            <div className="admin-acquisition__danetki-group">
              <h4>Персонажи, полные 48 часов после старта</h4>
              <dl>{period.character.cohorts.map(cohort => <div key={cohort.cohort}>
                <dt>{cohort.cohort === 'first' ? 'Первая наблюдаемая партия' : 'Повторные партии'}</dt>
                <dd>{cohort.completions48h}/{cohort.starts}<small>{rate(cohort.completionRate)} завершены</small><small>{cohort.zeroAttempts48h} без попыток</small><small>{cohort.unknownAttempts} с неизвестными попытками</small><small>До первого ответа: {cohort.medianFirstAttemptSeconds == null ? '—' : `${cohort.medianFirstAttemptSeconds} с`} ({cohort.observedFirstAttempts})</small></dd>
              </div>)}</dl>
              <p>Включены старты до {date(period.character.matureBefore)} UTC. Ещё {period.character.notYetMature} партий не прожили 48 часов и исключены. Удалённые детали попыток неизвестны, а не равны нулю. Медиана времени только по партиям с ответом.</p>
            </div>
            <div className="admin-acquisition__danetki-group">
              <h4>Возвраты зарегистрированных аккаунтов</h4>
              <dl>
                <div><dt>D1, зрелые аккаунты</dt><dd>{retention.d1Returned}/{retention.d1Eligible}<small>{rate(retention.d1Rate)}</small></dd></div>
                <div><dt>D7, зрелые аккаунты</dt><dd>{retention.d7Returned}/{retention.d7Eligible}<small>{rate(retention.d7Rate)}</small></dd></div>
              </dl>
              <p>Всего {retention.accounts} новых аккаунтов. Возврат — серверный старт игры точно в день +1 или +7 по UTC. Недозревшие аккаунты не входят в знаменатель.</p>
            </div>
          </article>
        })}
      </div>
      <details><summary>Границы измерения</summary>
        <p>Полные дни защищённой истории партий: {report.factsFullDaysFrom ? date(report.factsFullDaysFrom) : 'неизвестны'}. Самые ранние доступные клиентские события: {report.rawObservedFrom ? date(report.rawObservedFrom) : 'неизвестны'}.</p>
        {report.limitations.map(text => <p key={text}>{text}</p>)}
      </details>
    </section>
  </>
}
