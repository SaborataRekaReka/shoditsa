import { CalendarDays, Play, Target } from 'lucide-react'
import { useEffect } from 'react'
import { trackMetrikaGoal } from '../../app/metrics'
import type { DailyHubState } from './daily-progress.types'
import { DailyProgressStub } from './DailyProgressStub'

export function DailyHero({ state, onPrimary }: {
  state: DailyHubState
  onPrimary: () => void
}) {
  useEffect(() => {
    const params = {
      mode: state.activeGame?.mode ?? state.recommendedMode,
      completedCount: state.completedCount,
      activeMode: state.activeGame?.mode ?? '',
      attemptsCount: state.activeGame?.attempts.length ?? 0,
      nextMilestone: state.reward.milestone,
      reward: state.reward.reward,
      dateMoscow: new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' }),
    }
    trackMetrikaGoal('hub_daily_hero_view', params)
    trackMetrikaGoal('daily_progress_view', params)
  }, [state.activeGame?.key, state.completedCount, state.reward.milestone, state.reward.reward])

  return <section className="daily-hero" aria-labelledby="daily-hero-title">
    <div className="daily-hero__main">
      <div className="daily-hero__copy">
        <div className="daily-hero__facts" aria-label="Об игре">
          <span className="hero-fact"><CalendarDays aria-hidden="true" /><strong>6 игр сегодня</strong></span>
          <span className="hero-fact"><Target aria-hidden="true" /><strong>10 попыток</strong></span>
        </div>
        <h1 className="daily-hero__title" id="daily-hero-title">Все сойдется!</h1>
        <p className="daily-hero__description">Новые загадки каждый день.<br />Найдите ответ по тому, что сходится.</p>
        <button className="daily-hero__primary" type="button" onClick={onPrimary}>
          <Play aria-hidden="true" />
          <span>{state.primaryLabel}</span>
        </button>
        {state.primaryMeta && <p className="daily-hero__session-meta">{state.primaryMeta}</p>}
      </div>
      <div className="daily-hero__visual" aria-hidden="true">
        <img src="./images/hero.webp" alt="" />
      </div>
    </div>
    <DailyProgressStub state={state} />
  </section>
}
