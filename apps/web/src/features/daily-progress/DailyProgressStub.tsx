import { Ticket, Trophy } from 'lucide-react'
import { dailyCompletedCopy } from './daily-progress'
import type { DailyHubState } from './daily-progress.types'
import { ProgressPunches } from './ProgressPunches'

export function DailyProgressStub({ state }: { state: DailyHubState }) {
  const { completedCount, completedModes, punchesCaption, reward } = state
  return <div className="daily-progress-stub" aria-label="Прогресс игр за сегодня">
    <svg className="daily-progress-notch daily-progress-notch--start" viewBox="0 0 16 32" aria-hidden="true"><path d="M0 0A16 16 0 0 1 16 16A16 16 0 0 1 0 32" /></svg>
    <svg className="daily-progress-notch daily-progress-notch--end" viewBox="0 0 16 32" aria-hidden="true"><path d="M0 0A16 16 0 0 1 16 16A16 16 0 0 1 0 32" /></svg>
    <div className="daily-progress-summary">
      <span className="daily-progress-summary__label">{reward.fullHouse ? 'Полный зал' : 'Прогресс за сегодня'}</span>
      <strong className="daily-progress-summary__value">{dailyCompletedCopy(completedCount)}</strong>
    </div>
    <ProgressPunches completedModes={completedModes} caption={punchesCaption} />
    <div className={`next-reward ${reward.fullHouse ? 'is-full-house' : ''}`}>
      <p className="next-reward__copy">
        {reward.fullHouse
          ? <>Все игры дня завершены<br /><strong>+25 билетиков получено</strong></>
          : <>Завершите ещё {reward.remaining} {reward.remaining === 1 ? 'игру' : 'игры'}<br />и получите <strong>+{reward.reward} билетиков</strong></>}
      </p>
      <span className="next-reward__icon" aria-hidden="true">{reward.fullHouse ? <Trophy /> : <Ticket />}</span>
    </div>
  </div>
}
